import type { DiscoveryQuery, DiscoverySource } from "@aurascholar/core";
import type { ConfirmFunction } from "../../components/ConfirmDialog";
import type { CreateSavedSearchResult, SavedSearchView } from "../../services/saved-searches";
import { savedSearchCriteriaKey } from "../../shared/saved-search-criteria";

export type DiscoverySavedSearchRowAction = "checking" | "deleting" | "opening";
export type DiscoverySavedSearchFailureKind = "delete" | "restore" | "save";

export interface DiscoverySavedSearchUndo {
  item: SavedSearchView;
  message: string;
}

export interface DiscoverySavedSearchSnapshot {
  items: readonly SavedSearchView[];
  rowActions: ReadonlyMap<string, DiscoverySavedSearchRowAction>;
  saving: boolean;
  undo: DiscoverySavedSearchUndo | null;
  undoBusy: boolean;
}

export interface DiscoverySavedSearchDataSource {
  clearBadge(id: string): Promise<void>;
  create(criteria: DiscoveryQuery, sources: DiscoverySource[]): Promise<CreateSavedSearchResult>;
  delete(id: string): Promise<void>;
  list(): Promise<SavedSearchView[]>;
  restore(id: string): Promise<void>;
  run(id: string): Promise<number>;
}

export interface DiscoverySavedSearchControllerDependencies {
  data: DiscoverySavedSearchDataSource;
  defaultSources: readonly DiscoverySource[];
  desktopRuntime: boolean;
  consumeFailure?: (kind: DiscoverySavedSearchFailureKind) => Error | null;
  describeError?: (error: unknown) => string;
  now?: () => number;
  waitForMinimumElapsed?: (
    startedAt: number,
    action: DiscoverySavedSearchRowAction | DiscoverySavedSearchFailureKind,
  ) => Promise<void>;
}

export interface ActivateSavedSearchInput {
  criteria: DiscoveryQuery;
  sources: DiscoverySource[];
}

export interface DiscoverySavedSearchActionPorts {
  activateSearch: (input: ActivateSavedSearchInput) => Promise<boolean>;
  confirm: ConfirmFunction;
  reportMessage: (message: string) => void;
}

export function upsertSavedSearch(
  items: readonly SavedSearchView[],
  restored: SavedSearchView,
): SavedSearchView[] {
  if (items.some((item) => item.id === restored.id)) {
    return items.map((item) => (item.id === restored.id ? restored : item));
  }
  return [restored, ...items];
}

export function matchesSavedSearch(
  saved: SavedSearchView,
  criteria: DiscoveryQuery,
  sources: readonly DiscoverySource[],
  defaultSources: readonly DiscoverySource[],
): boolean {
  return (
    savedSearchCriteriaKey(saved.criteria) === savedSearchCriteriaKey(criteria) &&
    sourceKey(saved.sources ?? defaultSources) === sourceKey(sources)
  );
}

export function toDiscoverySavedSearchError(
  error: unknown,
  describeError: (error: unknown) => string,
): Error {
  return error instanceof Error ? error : new Error(describeError(error));
}

function sourceKey(sources: readonly DiscoverySource[]): string {
  return [...new Set(sources)].sort().join("|");
}
