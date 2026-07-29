import type { DiscoverySource } from "@aurascholar/core";
import type { SavedSearchRow } from "@aurascholar/db/repos/saved-searches";
import type { DiscoverySearchReportWithLibrary } from "./discovery";

export interface CreateSavedSearchResult {
  created: boolean;
  id: string;
}

export interface SavedSearchReadRepository {
  due(now?: number): Promise<SavedSearchRow[]>;
  get(id: string): Promise<SavedSearchRow | null>;
  list(): Promise<SavedSearchRow[]>;
}

export interface SavedSearchScope {
  libraryId: string;
  repository: SavedSearchReadRepository;
}

export interface SavedSearchWriteGateway {
  clearNew(input: { libraryId: string; savedSearchId: string }): Promise<{ updated: number }>;
  create(input: {
    libraryId: string;
    query: string;
    sources: DiscoverySource[] | null;
  }): Promise<CreateSavedSearchResult>;
  delete(input: { libraryId: string; savedSearchId: string }): Promise<{ updated: number }>;
  recordError(input: {
    error: string;
    expectedUpdatedAt: number;
    libraryId: string;
    nextRunAt: number;
    savedSearchId: string;
  }): Promise<{ committed: boolean; updatedAt: number | null }>;
  recordRun(input: {
    expectedUpdatedAt: number;
    libraryId: string;
    nextRunAt: number;
    observedIds: string[];
    savedSearchId: string;
  }): Promise<{ committed: boolean; freshCount: number; updatedAt: number | null }>;
  restore(input: { libraryId: string; savedSearchId: string }): Promise<{ updated: number }>;
}

export type SavedSearchNotification = {
  body: string;
  tag: string;
  title: string;
};

export type SavedSearchTimer = ReturnType<typeof globalThis.setTimeout>;

export interface SavedSearchServiceDependencies {
  clearTimer(timer: SavedSearchTimer): void;
  dispatchUpdated(): void;
  loopIntervalMs: number;
  nextRunDelayMs: number;
  notify(notification: SavedSearchNotification): Promise<void>;
  now(): number;
  onLoopError(error: unknown): void;
  openScope(): Promise<SavedSearchScope>;
  schedule(callback: () => void, delayMs: number): SavedSearchTimer;
  search(
    query: string,
    sources: DiscoverySource[] | undefined,
    signal: AbortSignal,
  ): Promise<DiscoverySearchReportWithLibrary>;
  writes: SavedSearchWriteGateway;
}
