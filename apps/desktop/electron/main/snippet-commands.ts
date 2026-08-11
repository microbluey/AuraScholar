import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { SnippetsRepo, type SnippetWithWork } from "@aurascholar/db/repos/snippets";
import type {
  DataCommandOutput,
  DataCommandRequest,
  SnippetCreateCommandInput,
  SnippetCreateCommandResult,
  SnippetListAllCommandInput,
  SnippetListAllCommandResult,
  SnippetMutationCommandInput,
  SnippetMutationCommandResult,
  SnippetUpdateNoteCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_SNIPPET_NOTE_LENGTH = 256 * 1024;
const MAX_SNIPPET_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_SNIPPET_QUOTE_LENGTH = 256 * 1024;
const MAX_SNIPPET_ROWS = 10_000;
const MAX_SNIPPET_TAG_LENGTH = 1_024;

type SnippetReadCommandName = "snippet.listAll";
type SnippetMutationCommandName =
  | "snippet.create"
  | "snippet.delete"
  | "snippet.restore"
  | "snippet.updateNote";
type SnippetCommandName = SnippetReadCommandName | SnippetMutationCommandName;

export type SnippetCommandRequest = Extract<DataCommandRequest, { name: SnippetCommandName }>;

/**
 * Snippet persistence belongs to the main process. The renderer supplies
 * record content and ids only; each coordinator lease resolves the local
 * Library before reading or mutating its rows.
 */
export async function executeSnippetCommand(
  request: SnippetCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<SnippetCommandName>> {
  switch (request.name) {
    case "snippet.listAll": {
      parseSnippetListAllInput(request.input);
      return executeSnippetQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return listAllSnippets(database, libraryId);
      });
    }
    case "snippet.create": {
      const input = parseSnippetCreateInput(request.input);
      return executeSnippetMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return createSnippet(database, libraryId, input);
      });
    }
    case "snippet.updateNote": {
      const input = parseSnippetUpdateNoteInput(request.input);
      return executeSnippetMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return updateSnippetNote(database, libraryId, input);
      });
    }
    case "snippet.delete": {
      const input = parseSnippetMutationInput(request.input, request.name);
      return executeSnippetMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return deleteSnippet(database, libraryId, input);
      });
    }
    case "snippet.restore": {
      const input = parseSnippetMutationInput(request.input, request.name);
      return executeSnippetMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return restoreSnippet(database, libraryId, input);
      });
    }
  }
}

function executeSnippetQuery<K extends SnippetReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function executeSnippetMutation<K extends SnippetMutationCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  return dependencies.transaction(commandName, operation);
}

function parseSnippetListAllInput(value: unknown): SnippetListAllCommandInput {
  return requireExactSnippetInput(value, "snippet.listAll", []) as SnippetListAllCommandInput;
}

function parseSnippetCreateInput(value: unknown): SnippetCreateCommandInput {
  const input = requireExactSnippetInput(
    value,
    "snippet.create",
    ["workId", "quote"],
    ["pageIndex", "noteMd", "tag"],
  );
  const pageIndex = optionalSnippetPageIndex(input, "pageIndex");
  const noteMd = optionalNullableSnippetText(
    input,
    "noteMd",
    "Snippet note",
    MAX_SNIPPET_NOTE_LENGTH,
  );
  const tag = optionalNullableSnippetText(input, "tag", "Snippet tag", MAX_SNIPPET_TAG_LENGTH);
  return {
    ...(noteMd === undefined ? {} : { noteMd }),
    ...(pageIndex === undefined ? {} : { pageIndex }),
    quote: requireSnippetText(input.quote, "Snippet quote", MAX_SNIPPET_QUOTE_LENGTH),
    ...(tag === undefined ? {} : { tag }),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

function parseSnippetUpdateNoteInput(value: unknown): SnippetUpdateNoteCommandInput {
  const input = requireExactSnippetInput(value, "snippet.updateNote", ["snippetId", "noteMd"]);
  if (input.noteMd !== null && typeof input.noteMd !== "string") {
    throw new Error("Snippet note is invalid");
  }
  return {
    noteMd:
      input.noteMd === null
        ? null
        : requireSnippetText(input.noteMd, "Snippet note", MAX_SNIPPET_NOTE_LENGTH),
    snippetId: requireRecordId(input.snippetId, "Snippet id"),
  };
}

function parseSnippetMutationInput(
  value: unknown,
  commandName: "snippet.delete" | "snippet.restore",
): SnippetMutationCommandInput {
  const input = requireExactSnippetInput(value, commandName, ["snippetId"]);
  return { snippetId: requireRecordId(input.snippetId, "Snippet id") };
}

function requireExactSnippetInput(
  value: unknown,
  commandName: SnippetCommandName,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  const allowedFields = [...requiredFields, ...optionalFields];
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowedFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function optionalSnippetPageIndex(
  input: Record<string, unknown>,
  field: string,
): number | null | undefined {
  if (!Object.hasOwn(input, field) || input[field] === undefined) return undefined;
  if (input[field] === null) return null;
  if (!Number.isSafeInteger(input[field]) || (input[field] as number) < 0) {
    throw new Error("Snippet page index is invalid");
  }
  return input[field] as number;
}

function optionalNullableSnippetText(
  input: Record<string, unknown>,
  field: string,
  label: string,
  maxLength: number,
): string | null | undefined {
  if (!Object.hasOwn(input, field) || input[field] === undefined) return undefined;
  if (input[field] === null) return null;
  return requireSnippetText(input[field], label, maxLength);
}

function requireSnippetText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  if (value.length > maxLength) throw new Error(`${label} is too long`);
  return value;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function listAllSnippets(
  database: Database,
  libraryId: string,
): Promise<SnippetListAllCommandResult> {
  const rows = await database.query<SnippetWithWork>(
    `SELECT s.id, s.work_id, s.page_index, s.quote, s.note_md, s.tag,
            s.created_at, s.updated_at, w.title AS work_title
     FROM snippets s
     JOIN works w
       ON w.id = s.work_id
      AND w.library_id = ?
      AND w.deleted_at IS NULL
     WHERE s.deleted_at IS NULL
     ORDER BY s.created_at DESC
     LIMIT ?`,
    [libraryId, MAX_SNIPPET_ROWS + 1],
  );
  if (rows.length > MAX_SNIPPET_ROWS) {
    throw new Error(`Snippet rows are limited to ${MAX_SNIPPET_ROWS}`);
  }
  return requireBoundedSnippetOutput({ snippets: rows });
}

async function createSnippet(
  database: Database,
  libraryId: string,
  input: SnippetCreateCommandInput,
): Promise<SnippetCreateCommandResult> {
  return { snippetId: await new SnippetsRepo(database, libraryId).create(input) };
}

async function updateSnippetNote(
  database: Database,
  libraryId: string,
  input: SnippetUpdateNoteCommandInput,
): Promise<SnippetMutationCommandResult> {
  await new SnippetsRepo(database, libraryId).updateNote(input.snippetId, input.noteMd);
  return { updated: 1 };
}

async function deleteSnippet(
  database: Database,
  libraryId: string,
  input: SnippetMutationCommandInput,
): Promise<SnippetMutationCommandResult> {
  await new SnippetsRepo(database, libraryId).softDelete(input.snippetId);
  return { updated: 1 };
}

async function restoreSnippet(
  database: Database,
  libraryId: string,
  input: SnippetMutationCommandInput,
): Promise<SnippetMutationCommandResult> {
  await new SnippetsRepo(database, libraryId).restore(input.snippetId);
  return { updated: 1 };
}

function requireBoundedSnippetOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Snippet output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SNIPPET_OUTPUT_BYTES) {
    throw new Error(`Snippet output is limited to ${MAX_SNIPPET_OUTPUT_BYTES} bytes`);
  }
  return output;
}
