import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { SavedSearchesRepo, type SavedSearchRow } from "@aurascholar/db/repos/saved-searches";
import { Buffer } from "node:buffer";
import type {
  DataCommandOutput,
  DataCommandRequest,
  RecordSavedSearchErrorCommandInput,
  RecordSavedSearchRunCommandInput,
  SavedSearchCommandInput,
  SavedSearchGetCommandInput,
  SavedSearchGetCommandResult,
  SavedSearchListCommandResult,
  SavedSearchScopeCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";
import { matchesSavedSearchInput, parseCreateSavedSearchInput } from "./saved-search-create-input";

const MAX_OBSERVED_ID_LENGTH = 4_096;
const MAX_OBSERVED_IDS = 2_000;
const MAX_PERSISTED_ERROR_LENGTH = 16_384;
const MAX_SAVED_SEARCH_ROWS = 1_000;
const MAX_SAVED_SEARCH_OUTPUT_BYTES = 8 * 1024 * 1024;

type SavedSearchCommandName =
  | "savedSearch.clearNew"
  | "savedSearch.create"
  | "savedSearch.delete"
  | "savedSearch.get"
  | "savedSearch.getScope"
  | "savedSearch.list"
  | "savedSearch.listDue"
  | "savedSearch.recordError"
  | "savedSearch.recordRun"
  | "savedSearch.restore";

type SavedSearchReadCommandName =
  | "savedSearch.get"
  | "savedSearch.getScope"
  | "savedSearch.list"
  | "savedSearch.listDue";

export type SavedSearchCommandRequest = Extract<
  DataCommandRequest,
  { name: SavedSearchCommandName }
>;

export async function executeSavedSearchCommand(
  request: SavedSearchCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<SavedSearchCommandName>> {
  switch (request.name) {
    case "savedSearch.getScope": {
      parseSavedSearchScopeInput(request.input, request.name);
      return executeSavedSearchQuery(dependencies, request.name, async (database) => ({
        libraryId: await requireActiveLocalLibraryId(database),
      }));
    }
    case "savedSearch.list": {
      parseSavedSearchScopeInput(request.input, request.name);
      return executeSavedSearchQuery(dependencies, request.name, async (database) =>
        listSavedSearches(database, await requireActiveLocalLibraryId(database)),
      );
    }
    case "savedSearch.get": {
      const input = parseSavedSearchGetInput(request.input);
      return executeSavedSearchQuery(dependencies, request.name, async (database) =>
        getSavedSearch(database, await requireActiveLocalLibraryId(database), input),
      );
    }
    case "savedSearch.listDue": {
      parseSavedSearchScopeInput(request.input, request.name);
      return executeSavedSearchQuery(dependencies, request.name, async (database) =>
        listDueSavedSearches(database, await requireActiveLocalLibraryId(database)),
      );
    }
    case "savedSearch.create": {
      const input = parseCreateSavedSearchInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const repository = new SavedSearchesRepo(database, input.libraryId);
        const existing = (await repository.list()).find((row) =>
          matchesSavedSearchInput(row, input),
        );
        if (existing) return { created: false, id: existing.id };
        const id = await repository.create({
          query: input.query,
          criteriaJson: JSON.stringify(input.criteria),
          sources: input.sources,
        });
        return { created: true, id };
      });
    }
    case "savedSearch.delete": {
      const input = parseSavedSearchInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await new SavedSearchesRepo(database, input.libraryId).softDelete(input.savedSearchId);
        return { updated: 1 };
      });
    }
    case "savedSearch.restore": {
      const input = parseSavedSearchInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await new SavedSearchesRepo(database, input.libraryId).restore(input.savedSearchId);
        return { updated: 1 };
      });
    }
    case "savedSearch.clearNew": {
      const input = parseSavedSearchInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await new SavedSearchesRepo(database, input.libraryId).clearNew(input.savedSearchId);
        return { updated: 1 };
      });
    }
    case "savedSearch.recordRun": {
      const input = parseRecordRunInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        return new SavedSearchesRepo(database, input.libraryId).commitRunIfCurrent(
          input.savedSearchId,
          {
            expectedUpdatedAt: input.expectedUpdatedAt,
            nextRunAt: input.nextRunAt,
            observedIds: input.observedIds,
          },
        );
      });
    }
    case "savedSearch.recordError": {
      const input = parseRecordErrorInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        return new SavedSearchesRepo(database, input.libraryId).recordErrorIfCurrent(
          input.savedSearchId,
          {
            error: input.error,
            expectedUpdatedAt: input.expectedUpdatedAt,
            nextRunAt: input.nextRunAt,
          },
        );
      });
    }
  }
}

function executeSavedSearchQuery<K extends SavedSearchReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function parseSavedSearchScopeInput(
  value: unknown,
  commandName: "savedSearch.getScope" | "savedSearch.list" | "savedSearch.listDue",
): SavedSearchScopeCommandInput {
  return requireExactSavedSearchInput(value, commandName, []) as SavedSearchScopeCommandInput;
}

function parseSavedSearchGetInput(value: unknown): SavedSearchGetCommandInput {
  const input = requireExactSavedSearchInput(value, "savedSearch.get", ["savedSearchId"]);
  return { savedSearchId: requireRecordId(input.savedSearchId, "Saved search id") };
}

function requireExactSavedSearchInput(
  value: unknown,
  commandName: SavedSearchReadCommandName,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function listSavedSearches(
  database: Database,
  libraryId: string,
): Promise<SavedSearchListCommandResult> {
  const savedSearches = await database.query<SavedSearchRow>(
    `SELECT id, library_id, query, criteria_json, sources_json, seen_ids_json, new_count, last_run_at, next_run_at,
            last_error, created_at, updated_at, deleted_at
     FROM saved_searches
     WHERE library_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT ?`,
    [libraryId, MAX_SAVED_SEARCH_ROWS + 1],
  );
  return requireBoundedSavedSearchOutput({
    savedSearches: requireBoundedSavedSearchRows(savedSearches),
  });
}

async function getSavedSearch(
  database: Database,
  libraryId: string,
  input: SavedSearchGetCommandInput,
): Promise<SavedSearchGetCommandResult> {
  const rows = await database.query<SavedSearchRow>(
    `SELECT id, library_id, query, criteria_json, sources_json, seen_ids_json, new_count, last_run_at, next_run_at,
            last_error, created_at, updated_at, deleted_at
     FROM saved_searches
     WHERE id = ? AND library_id = ?
     LIMIT 1`,
    [input.savedSearchId, libraryId],
  );
  return requireBoundedSavedSearchOutput({ savedSearch: rows[0] ?? null });
}

async function listDueSavedSearches(
  database: Database,
  libraryId: string,
): Promise<SavedSearchListCommandResult> {
  const savedSearches = await database.query<SavedSearchRow>(
    `SELECT id, library_id, query, criteria_json, sources_json, seen_ids_json, new_count, last_run_at, next_run_at,
            last_error, created_at, updated_at, deleted_at
     FROM saved_searches
     WHERE library_id = ?
       AND deleted_at IS NULL
       AND (next_run_at IS NULL OR next_run_at <= ?)
     ORDER BY created_at
     LIMIT ?`,
    [libraryId, Date.now(), MAX_SAVED_SEARCH_ROWS + 1],
  );
  return requireBoundedSavedSearchOutput({
    savedSearches: requireBoundedSavedSearchRows(savedSearches),
  });
}

function requireBoundedSavedSearchRows(rows: SavedSearchRow[]): SavedSearchRow[] {
  if (rows.length > MAX_SAVED_SEARCH_ROWS) {
    throw new Error(`Saved search rows are limited to ${MAX_SAVED_SEARCH_ROWS}`);
  }
  return rows;
}

function requireBoundedSavedSearchOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Saved search output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SAVED_SEARCH_OUTPUT_BYTES) {
    throw new Error(`Saved search output is limited to ${MAX_SAVED_SEARCH_OUTPUT_BYTES} bytes`);
  }
  return output;
}

function parseSavedSearchInput(
  value: unknown,
  commandName: "savedSearch.clearNew" | "savedSearch.delete" | "savedSearch.restore",
): SavedSearchCommandInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    savedSearchId: requireRecordId(value.savedSearchId, "Saved search id"),
  };
}

function parseRecordRunInput(value: unknown): RecordSavedSearchRunCommandInput {
  if (!isRecord(value)) throw new Error("Invalid savedSearch.recordRun input");
  return {
    expectedUpdatedAt: requireRevision(value.expectedUpdatedAt),
    libraryId: requireRecordId(value.libraryId, "Library id"),
    nextRunAt: requireTimestamp(value.nextRunAt, "Next saved search run"),
    observedIds: parseObservedIds(value.observedIds),
    savedSearchId: requireRecordId(value.savedSearchId, "Saved search id"),
  };
}

function parseRecordErrorInput(value: unknown): RecordSavedSearchErrorCommandInput {
  if (!isRecord(value)) throw new Error("Invalid savedSearch.recordError input");
  return {
    error: boundedText(value.error, "Saved search polling error", MAX_PERSISTED_ERROR_LENGTH),
    expectedUpdatedAt: requireRevision(value.expectedUpdatedAt),
    libraryId: requireRecordId(value.libraryId, "Library id"),
    nextRunAt: requireTimestamp(value.nextRunAt, "Next saved search run"),
    savedSearchId: requireRecordId(value.savedSearchId, "Saved search id"),
  };
}

function parseObservedIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_OBSERVED_IDS) {
    throw new Error(`Observed result ids are limited to ${MAX_OBSERVED_IDS} per run`);
  }
  const ids = value.map((candidate, index) =>
    boundedText(candidate, `Observed result id at index ${index}`, MAX_OBSERVED_ID_LENGTH),
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error("Observed result ids must be unique");
  }
  return ids;
}

function requireRevision(value: unknown): number {
  return requireTimestamp(value, "Expected saved search revision");
}

function requireTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label} is too long`);
  return text;
}
