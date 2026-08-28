import type { DiscoveryQuery, DiscoverySource } from "@aurascholar/core";

/**
 * Saved-search state needed by the renderer and polling coordinator. Internal
 * de-duplication history stays in the main-process database repository.
 */
export interface SavedSearchReadRow {
  criteria_json: string | null;
  deleted_at: number | null;
  id: string;
  last_error: string | null;
  last_run_at: number | null;
  new_count: number;
  query: string;
  sources_json: string | null;
  updated_at: number;
}

/** The main process resolves the durable local Library for saved-search reads. */
export type SavedSearchScopeCommandInput = Record<string, never>;

export interface SavedSearchGetScopeCommandResult {
  libraryId: string;
}

export interface SavedSearchListCommandResult {
  savedSearches: SavedSearchReadRow[];
}

/** The main process owns the current-time policy for due polling. */
export type SavedSearchListDueCommandInput = SavedSearchScopeCommandInput;

/** A single saved-search lookup is scoped to the active local Library. */
export interface SavedSearchGetCommandInput {
  savedSearchId: string;
}

export interface SavedSearchGetCommandResult {
  savedSearch: SavedSearchReadRow | null;
}

export interface CreateSavedSearchCommandInput {
  libraryId: string;
  query: string;
  /** Optional only so an older renderer can still create a text-only subscription. */
  criteria?: DiscoveryQuery;
  sources: DiscoverySource[] | null;
}

export interface CreateSavedSearchCommandResult {
  created: boolean;
  id: string;
}

export interface SavedSearchCommandInput {
  libraryId: string;
  savedSearchId: string;
}

export interface SavedSearchMutationResult {
  updated: number;
}

export interface RecordSavedSearchRunCommandInput extends SavedSearchCommandInput {
  expectedUpdatedAt: number;
  nextRunAt: number;
  observedIds: string[];
}

export interface RecordSavedSearchRunCommandResult {
  committed: boolean;
  freshCount: number;
  updatedAt: number | null;
}

export interface RecordSavedSearchErrorCommandInput extends SavedSearchCommandInput {
  error: string;
  expectedUpdatedAt: number;
  nextRunAt: number;
}

export interface RecordSavedSearchErrorCommandResult {
  committed: boolean;
  updatedAt: number | null;
}

/**
 * Typed saved-search commands. Read commands derive Library scope in main;
 * mutation commands retain the existing explicit scope and stale-scope guard.
 */
export interface SavedSearchDataCommandMap {
  "savedSearch.clearNew": {
    input: SavedSearchCommandInput;
    output: SavedSearchMutationResult;
  };
  "savedSearch.create": {
    input: CreateSavedSearchCommandInput;
    output: CreateSavedSearchCommandResult;
  };
  "savedSearch.delete": {
    input: SavedSearchCommandInput;
    output: SavedSearchMutationResult;
  };
  "savedSearch.get": {
    input: SavedSearchGetCommandInput;
    output: SavedSearchGetCommandResult;
  };
  "savedSearch.getScope": {
    input: SavedSearchScopeCommandInput;
    output: SavedSearchGetScopeCommandResult;
  };
  "savedSearch.list": {
    input: SavedSearchScopeCommandInput;
    output: SavedSearchListCommandResult;
  };
  "savedSearch.listDue": {
    input: SavedSearchListDueCommandInput;
    output: SavedSearchListCommandResult;
  };
  "savedSearch.recordError": {
    input: RecordSavedSearchErrorCommandInput;
    output: RecordSavedSearchErrorCommandResult;
  };
  "savedSearch.recordRun": {
    input: RecordSavedSearchRunCommandInput;
    output: RecordSavedSearchRunCommandResult;
  };
  "savedSearch.restore": {
    input: SavedSearchCommandInput;
    output: SavedSearchMutationResult;
  };
}
