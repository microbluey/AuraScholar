import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import {
  WorksRepo,
  type AuthorRole,
  type WorkAuthorInput,
  type WorkWithAuthors,
  type WorkPatch,
} from "@aurascholar/db/repos/works";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryGetWorkMetadataCommandInput,
  LibraryGetWorkMetadataCommandResult,
  LibraryUpdateWorkMetadataCommandInput,
  LibraryUpdateWorkMetadataCommandResult,
  WorkMetadataSnapshot,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_WORK_METADATA_AUTHOR_COUNT = 1_000;
const MAX_WORK_METADATA_AUTHOR_TEXT_LENGTH = 16 * 1024;
const MAX_WORK_METADATA_KEYWORD_COUNT = 1_000;
const MAX_WORK_METADATA_KEYWORD_LENGTH = 16 * 1024;
const MAX_WORK_METADATA_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_WORK_METADATA_TEXT_LENGTH = 256 * 1024;

type WorkMetadataCommandName = "library.getWorkMetadata" | "library.updateWorkMetadata";
type NullableWorkMetadataPatchField = Exclude<
  keyof WorkPatch,
  "authors" | "keywords" | "title" | "type" | "year"
>;

const NULLABLE_TEXT_PATCH_FIELDS: readonly NullableWorkMetadataPatchField[] = [
  "abstract",
  "accessedDate",
  "accessionNumber",
  "arxivId",
  "callNumber",
  "databaseName",
  "doi",
  "edition",
  "isbn",
  "issn",
  "issue",
  "label",
  "language",
  "notesMd",
  "numberOfVolumes",
  "openalexId",
  "originalTitle",
  "pages",
  "placePublished",
  "pmid",
  "publicationDate",
  "publisher",
  "s2Id",
  "section",
  "seriesTitle",
  "shortTitle",
  "url",
  "venueName",
  "venueType",
  "volume",
];
const WORK_METADATA_PATCH_FIELDS = new Set<string>([
  "authors",
  "keywords",
  "title",
  "type",
  "year",
  ...NULLABLE_TEXT_PATCH_FIELDS,
]);

export type WorkMetadataCommandRequest = Extract<
  DataCommandRequest,
  { name: WorkMetadataCommandName }
>;

/**
 * Main-process metadata access. Renderer input has no Library id: every lease
 * resolves the current durable local Library before work rows are read or
 * updated.
 */
export async function executeWorkMetadataCommand(
  request: WorkMetadataCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<WorkMetadataCommandName>> {
  switch (request.name) {
    case "library.getWorkMetadata": {
      const input = parseGetWorkMetadataInput(request.input);
      return executeWorkMetadataCommandLease(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadWorkMetadata(database, libraryId, input);
      });
    }
    case "library.updateWorkMetadata": {
      const input = parseUpdateWorkMetadataInput(request.input);
      // WorksRepo.update owns the author-and-fingerprint transaction and its
      // write lock. Running it under dependencies.transaction would nest BEGIN.
      return executeWorkMetadataCommandLease(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return updateWorkMetadata(database, libraryId, input);
      });
    }
  }
}

function executeWorkMetadataCommandLease<K extends WorkMetadataCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process work metadata command execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function parseGetWorkMetadataInput(value: unknown): LibraryGetWorkMetadataCommandInput {
  const input = requireExactWorkMetadataInput(value, "library.getWorkMetadata", ["workId"]);
  return { workId: requireRecordId(input.workId, "Work id") };
}

function parseUpdateWorkMetadataInput(value: unknown): LibraryUpdateWorkMetadataCommandInput {
  const input = requireExactWorkMetadataInput(value, "library.updateWorkMetadata", ["patch", "workId"]);
  return {
    patch: parseWorkMetadataPatch(input.patch),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

function requireExactWorkMetadataInput(
  value: unknown,
  commandName: WorkMetadataCommandName,
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

function parseWorkMetadataPatch(value: unknown): WorkPatch {
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !WORK_METADATA_PATCH_FIELDS.has(field))
  ) {
    throw new Error("Invalid work metadata patch");
  }

  const patch: WorkPatch = {};
  const title = optionalWorkMetadataText(value, "title", "Work title", MAX_WORK_METADATA_TEXT_LENGTH);
  if (title !== undefined) patch.title = title;
  const type = optionalWorkMetadataText(value, "type", "Work type", MAX_WORK_METADATA_TEXT_LENGTH);
  if (type !== undefined) patch.type = type;
  const year = optionalWorkMetadataYear(value);
  if (year !== undefined) patch.year = year;
  const keywords = optionalWorkMetadataKeywords(value);
  if (keywords !== undefined) patch.keywords = keywords;
  const authors = optionalWorkMetadataAuthors(value);
  if (authors !== undefined) patch.authors = authors;

  for (const field of NULLABLE_TEXT_PATCH_FIELDS) {
    const parsed = optionalNullableWorkMetadataText(
      value,
      field,
      `Work metadata ${field}`,
      MAX_WORK_METADATA_TEXT_LENGTH,
    );
    if (parsed !== undefined) patch[field] = parsed;
  }
  return patch;
}

function optionalWorkMetadataText(
  input: Record<string, unknown>,
  field: string,
  label: string,
  maxLength: number,
): string | undefined {
  if (!Object.hasOwn(input, field) || input[field] === undefined) return undefined;
  return requireWorkMetadataText(input[field], label, maxLength);
}

function optionalNullableWorkMetadataText(
  input: Record<string, unknown>,
  field: string,
  label: string,
  maxLength: number,
): string | null | undefined {
  if (!Object.hasOwn(input, field) || input[field] === undefined) return undefined;
  if (input[field] === null) return null;
  return requireWorkMetadataText(input[field], label, maxLength);
}

function optionalWorkMetadataYear(input: Record<string, unknown>): number | null | undefined {
  if (!Object.hasOwn(input, "year") || input.year === undefined) return undefined;
  if (input.year === null) return null;
  const year = input.year;
  if (typeof year !== "number" || !Number.isSafeInteger(year)) {
    throw new Error("Work year is invalid");
  }
  return year;
}

function optionalWorkMetadataKeywords(
  input: Record<string, unknown>,
): string[] | null | undefined {
  if (!Object.hasOwn(input, "keywords") || input.keywords === undefined) return undefined;
  if (input.keywords === null) return null;
  if (!Array.isArray(input.keywords) || input.keywords.length > MAX_WORK_METADATA_KEYWORD_COUNT) {
    throw new Error("Work keywords are invalid");
  }
  return input.keywords.map((keyword, index) =>
    requireWorkMetadataText(
      keyword,
      `Work keyword at index ${index}`,
      MAX_WORK_METADATA_KEYWORD_LENGTH,
    ),
  );
}

function optionalWorkMetadataAuthors(
  input: Record<string, unknown>,
): WorkAuthorInput[] | undefined {
  if (!Object.hasOwn(input, "authors") || input.authors === undefined) return undefined;
  if (!Array.isArray(input.authors) || input.authors.length > MAX_WORK_METADATA_AUTHOR_COUNT) {
    throw new Error("Work authors are invalid");
  }
  const authors = input.authors.map((author, index) => parseWorkMetadataAuthor(author, index));
  if (new Set(authors.map((author) => author.position)).size !== authors.length) {
    throw new Error("Work author positions must be unique");
  }
  return authors;
}

function parseWorkMetadataAuthor(value: unknown, index: number): WorkAuthorInput {
  const label = `Work author at index ${index}`;
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !["displayName", "orcid", "position", "role"].includes(field)) ||
    !Object.hasOwn(value, "displayName") ||
    !Object.hasOwn(value, "position")
  ) {
    throw new Error(`${label} is invalid`);
  }
  const position = value.position;
  if (typeof position !== "number" || !Number.isSafeInteger(position) || position < 0) {
    throw new Error(`${label} position is invalid`);
  }
  const displayName = requireWorkMetadataText(
    value.displayName,
    `${label} display name`,
    MAX_WORK_METADATA_AUTHOR_TEXT_LENGTH,
  );
  if (displayName.trim() === "") throw new Error(`${label} display name is required`);
  const author: WorkAuthorInput = {
    displayName,
    position,
  };
  const orcid = optionalWorkMetadataText(
    value,
    "orcid",
    `${label} ORCID`,
    MAX_WORK_METADATA_AUTHOR_TEXT_LENGTH,
  );
  if (orcid !== undefined) author.orcid = orcid;
  const role = optionalWorkMetadataAuthorRole(value, label);
  if (role !== undefined) author.role = role;
  return author;
}

function optionalWorkMetadataAuthorRole(
  input: Record<string, unknown>,
  label: string,
): AuthorRole | undefined {
  if (!Object.hasOwn(input, "role") || input.role === undefined) return undefined;
  if (input.role === "author" || input.role === "editor" || input.role === "translator") {
    return input.role;
  }
  throw new Error(`${label} role is invalid`);
}

function requireWorkMetadataText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  if (value.length > maxLength) throw new Error(`${label} is too long`);
  return value;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function loadWorkMetadata(
  database: Database,
  libraryId: string,
  input: LibraryGetWorkMetadataCommandInput,
): Promise<LibraryGetWorkMetadataCommandResult> {
  const works = new WorksRepo(database, libraryId);
  // Keep the editor's historical read semantics: get() deliberately includes
  // a soft-deleted row, while update() below continues to reject it.
  const storedWork = await works.get(input.workId);
  if (!storedWork) return { metadata: null };
  const authors = await works.authorsOf(input.workId);
  return requireBoundedWorkMetadataOutput({
    metadata: {
      authors,
      keywords: parseWorkMetadataKeywords(storedWork.keywords_json),
      work: metadataWorkRow(storedWork),
    },
  });
}

function metadataWorkRow(
  { authorNames: _authorNames, csl_json: _cslJson, ...work }: WorkWithAuthors & { csl_json?: unknown },
): WorkMetadataSnapshot["work"] {
  return work;
}

async function updateWorkMetadata(
  database: Database,
  libraryId: string,
  input: LibraryUpdateWorkMetadataCommandInput,
): Promise<LibraryUpdateWorkMetadataCommandResult> {
  const works = new WorksRepo(database, libraryId);
  // A no-op patch must not turn a foreign or deleted id into a false success;
  // WorksRepo.update repeats the active-row check for the actual write.
  const existing = await works.get(input.workId);
  if (!existing || existing.deleted_at !== null) {
    throw new Error(`Work ${input.workId} is missing or removed`);
  }
  await works.update(input.workId, input.patch);
  return { updated: 1 };
}

function parseWorkMetadataKeywords(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((keyword): keyword is string => typeof keyword === "string") : [];
  } catch {
    return [];
  }
}

function requireBoundedWorkMetadataOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Work metadata output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_WORK_METADATA_OUTPUT_BYTES) {
    throw new Error(`Work metadata output is limited to ${MAX_WORK_METADATA_OUTPUT_BYTES} bytes`);
  }
  return output;
}
