import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryGetWorkInspectorDetailCommandInput,
  LibraryGetWorkInspectorDetailCommandResult,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_LIBRARY_INSPECTOR_DETAIL_OUTPUT_BYTES = 256 * 1024;
const MAX_LIBRARY_INSPECTOR_DETAIL_IDENTIFIER_BYTES = 256;
const MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH = 512;

type LibraryInspectorDetailCommandName = "library.getWorkInspectorDetail";

export type LibraryInspectorDetailCommandRequest = Extract<
  DataCommandRequest,
  { name: LibraryInspectorDetailCommandName }
>;

/**
 * Reads the non-editor Library inspector fields through an explicit, bounded
 * projection. Full metadata remains an editor-only command.
 */
export async function executeLibraryInspectorDetailCommand(
  request: LibraryInspectorDetailCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryInspectorDetailCommandName>> {
  const input = parseInspectorDetailInput(request.input);
  if (!dependencies.execute) {
    throw new Error("Main-process Library inspector query execution is unavailable");
  }
  return dependencies.execute(request.name, async (database) => {
    const libraryId = await requireLocalLibraryId(database);
    await assertActiveLocalLibrary(database, libraryId);
    return loadInspectorDetail(database, libraryId, input);
  });
}

function parseInspectorDetailInput(value: unknown): LibraryGetWorkInspectorDetailCommandInput {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "workId")
  ) {
    throw new Error("Invalid library.getWorkInspectorDetail input");
  }
  return { workId: requireRecordId(value.workId, "Work id") };
}

async function loadInspectorDetail(
  database: Database,
  libraryId: string,
  input: LibraryGetWorkInspectorDetailCommandInput,
): Promise<LibraryGetWorkInspectorDetailCommandResult> {
  const rows = await database.query<LibraryGetWorkInspectorDetailCommandResult["detail"]>(
    `SELECT
       substr(w.abstract, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS abstract,
       CASE
         WHEN length(CAST(w.doi AS BLOB)) <= ${MAX_LIBRARY_INSPECTOR_DETAIL_IDENTIFIER_BYTES}
           THEN w.doi
         ELSE NULL
       END AS doi,
       substr(w.edition, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS edition,
       substr(w.isbn, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS isbn,
       substr(w.issn, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS issn,
       substr(w.issue, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS issue,
       substr(w.language, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS language,
       substr(w.pages, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS pages,
       substr(w.place_published, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS place_published,
       substr(w.publisher, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS publisher,
       substr(w.volume, 1, ${MAX_LIBRARY_INSPECTOR_DETAIL_TEXT_LENGTH}) AS volume
     FROM works w
     WHERE w.id = ? AND w.library_id = ?
     LIMIT 1`,
    [input.workId, libraryId],
  );
  return requireBoundedInspectorDetailOutput({ detail: rows[0] ?? null });
}

function requireBoundedInspectorDetailOutput<T extends LibraryGetWorkInspectorDetailCommandResult>(
  output: T,
): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Library inspector detail output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_LIBRARY_INSPECTOR_DETAIL_OUTPUT_BYTES) {
    throw new Error(
      `Library inspector detail output is limited to ${MAX_LIBRARY_INSPECTOR_DETAIL_OUTPUT_BYTES} bytes`,
    );
  }
  return output;
}
