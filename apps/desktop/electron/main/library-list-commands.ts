import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import {
  listWorks as listDatabaseWorks,
  searchWorksByMetadata as searchDatabaseWorksByMetadata,
  type WorkWithAuthors,
  type WorkWithAuthorsAndTags,
} from "@aurascholar/db/work-list";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryListWork,
  LibraryListWorksCommandInput,
  LibraryListWorksCommandResult,
  LibraryMetadataSearchWork,
  LibrarySearchWorksByMetadataCommandInput,
  LibrarySearchWorksByMetadataCommandResult,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_LIBRARY_LIST_LIMIT = 500;
const MAX_LIBRARY_LIST_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_SEARCH_LIMIT = 100;
const MAX_SEARCH_LENGTH = 512;

type LibraryListCommandName = "library.listWorks" | "library.searchWorksByMetadata";

export type LibraryListCommandRequest = Extract<
  DataCommandRequest,
  { name: LibraryListCommandName }
>;

/**
 * Lightweight Library lists for desktop surfaces outside the full Library
 * table. These reads intentionally avoid page facets and derive scope inside
 * the main-process lease, so a renderer cannot select another Library.
 */
export async function executeLibraryListCommand(
  request: LibraryListCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryListCommandName>> {
  switch (request.name) {
    case "library.listWorks": {
      const input = parseLibraryListWorksInput(request.input);
      return executeLibraryListQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        const works = await listDatabaseWorks(database, libraryId, input);
        return requireBoundedLibraryListOutput({
          works: works.map(toLibraryListWork),
        } satisfies LibraryListWorksCommandResult);
      });
    }
    case "library.searchWorksByMetadata": {
      const input = parseLibrarySearchWorksByMetadataInput(request.input);
      return executeLibraryListQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        const works = await searchDatabaseWorksByMetadata(
          database,
          libraryId,
          input.search,
          input.limit,
        );
        return requireBoundedLibraryListOutput({
          works: works.map(toLibraryMetadataSearchWork),
        } satisfies LibrarySearchWorksByMetadataCommandResult);
      });
    }
  }
}

function executeLibraryListQuery<K extends LibraryListCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function parseLibraryListWorksInput(
  value: unknown,
): Required<Pick<LibraryListWorksCommandInput, "limit">> {
  const input = requireLibraryListInput(value, "library.listWorks", ["limit"]);
  return {
    limit: requireLibraryListLimit(input.limit, 200),
  };
}

function parseLibrarySearchWorksByMetadataInput(
  value: unknown,
): Required<Pick<LibrarySearchWorksByMetadataCommandInput, "limit" | "search">> {
  const input = requireLibraryListInput(value, "library.searchWorksByMetadata", [
    "limit",
    "search",
  ]);
  if (!Object.hasOwn(input, "search")) {
    throw new Error("Library metadata search is required");
  }
  return {
    limit: requireMetadataSearchLimit(input.limit, 40),
    search: requireSearch(input.search, "Library metadata search"),
  };
}

function requireLibraryListInput(
  value: unknown,
  commandName: LibraryListCommandName,
  allowedFields: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((field) => !allowedFields.includes(field))) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireSearch(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  if (value.length > MAX_SEARCH_LENGTH) throw new Error(`${label} is too long`);
  return value;
}

function requireLibraryListLimit(value: unknown, fallback: number): number {
  return requireBoundedLimit(value, fallback, MAX_LIBRARY_LIST_LIMIT, "Library list limit");
}

function requireMetadataSearchLimit(value: unknown, fallback: number): number {
  return requireBoundedLimit(value, fallback, MAX_METADATA_SEARCH_LIMIT, "Metadata search limit");
}

function requireBoundedLimit(
  value: unknown,
  fallback: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireBoundedLibraryListOutput<
  T extends LibraryListWorksCommandResult | LibrarySearchWorksByMetadataCommandResult,
>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Library list output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_LIBRARY_LIST_OUTPUT_BYTES) {
    throw new Error(`Library list output is limited to ${MAX_LIBRARY_LIST_OUTPUT_BYTES} bytes`);
  }
  return output;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

function toLibraryListWork(work: WorkWithAuthors): LibraryListWork {
  return {
    abstract: work.abstract,
    authorNames: [...work.authorNames],
    createdAt: work.created_at,
    doi: work.doi,
    id: work.id,
    readingStatus: toReadingStatus(work.reading_status),
    starred: work.starred !== 0,
    title: work.title,
    venueName: work.venue_name,
    year: work.year,
  };
}

function toLibraryMetadataSearchWork(work: WorkWithAuthorsAndTags): LibraryMetadataSearchWork {
  return { ...toLibraryListWork(work), tagNames: [...work.tagNames] };
}

function toReadingStatus(value: string): "unread" | "reading" | "read" {
  if (value === "unread" || value === "reading" || value === "read") return value;
  throw new Error("Work reading status is invalid");
}
