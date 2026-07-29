import type { DiscoverySource } from "@aurascholar/core";
import { SavedSearchesRepo, type SavedSearchRow } from "@aurascholar/db/repos/saved-searches";
import type {
  CreateSavedSearchCommandInput,
  DataCommandOutput,
  DataCommandRequest,
  RecordSavedSearchErrorCommandInput,
  RecordSavedSearchRunCommandInput,
  SavedSearchCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const ALL_DISCOVERY_SOURCES: readonly DiscoverySource[] = ["arxiv", "crossref", "openalex", "s2"];
const MAX_OBSERVED_ID_LENGTH = 4_096;
const MAX_OBSERVED_IDS = 2_000;
const MAX_PERSISTED_ERROR_LENGTH = 16_384;
const MAX_QUERY_LENGTH = 4_096;

type SavedSearchCommandName =
  | "savedSearch.clearNew"
  | "savedSearch.create"
  | "savedSearch.delete"
  | "savedSearch.recordError"
  | "savedSearch.recordRun"
  | "savedSearch.restore";

export type SavedSearchCommandRequest = Extract<
  DataCommandRequest,
  { name: SavedSearchCommandName }
>;

export async function executeSavedSearchCommand(
  request: SavedSearchCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<SavedSearchCommandName>> {
  switch (request.name) {
    case "savedSearch.create": {
      const input = parseCreateSavedSearchInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const repository = new SavedSearchesRepo(database, input.libraryId);
        const existing = (await repository.list()).find((row) => matchesInput(row, input));
        if (existing) return { created: false, id: existing.id };
        const id = await repository.create({ query: input.query, sources: input.sources });
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

function parseCreateSavedSearchInput(value: unknown): CreateSavedSearchCommandInput {
  if (!isRecord(value)) throw new Error("Invalid savedSearch.create input");
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    query: normalizeStoredQuery(value.query),
    sources: parseSources(value.sources),
  };
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

function parseSources(value: unknown): DiscoverySource[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > ALL_DISCOVERY_SOURCES.length) {
    throw new Error("Saved search sources are invalid");
  }
  const sources = value.map((source) => {
    if (!isDiscoverySource(source)) throw new Error("Saved search source is invalid");
    return source;
  });
  if (new Set(sources).size !== sources.length) {
    throw new Error("Saved search sources must be unique");
  }
  if (
    sources.length === ALL_DISCOVERY_SOURCES.length &&
    ALL_DISCOVERY_SOURCES.every((source) => sources.includes(source))
  ) {
    return null;
  }
  return [...sources].sort(
    (left, right) => ALL_DISCOVERY_SOURCES.indexOf(left) - ALL_DISCOVERY_SOURCES.indexOf(right),
  );
}

function matchesInput(row: SavedSearchRow, input: CreateSavedSearchCommandInput): boolean {
  return (
    normalizeComparableQuery(row.query) === normalizeComparableQuery(input.query) &&
    sourceKey(parsePersistedSources(row.sources_json)) === sourceKey(input.sources)
  );
}

function parsePersistedSources(value: string | null): DiscoverySource[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const sources = parsed.filter(isDiscoverySource);
    if (sources.length === 0) return null;
    return [...new Set(sources)].sort(
      (left, right) => ALL_DISCOVERY_SOURCES.indexOf(left) - ALL_DISCOVERY_SOURCES.indexOf(right),
    );
  } catch {
    return null;
  }
}

function sourceKey(value: DiscoverySource[] | null): string {
  return JSON.stringify(value ?? ALL_DISCOVERY_SOURCES);
}

function normalizeStoredQuery(value: unknown): string {
  return boundedText(value, "Saved search query", MAX_QUERY_LENGTH).replace(/\s+/g, " ");
}

function normalizeComparableQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
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

function isDiscoverySource(value: unknown): value is DiscoverySource {
  return (ALL_DISCOVERY_SOURCES as readonly unknown[]).includes(value);
}
