import { normalizeDoi } from "@aurascholar/db/ids";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryFindIngestDedupCommandInput,
  LibraryFindIngestDedupCommandResult,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_DOI_LENGTH = 2_048;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
type LibraryIngestDedupCommandName = "library.findIngestDedup";

export type LibraryIngestDedupCommandRequest = Extract<
  DataCommandRequest,
  { name: LibraryIngestDedupCommandName }
>;

/**
 * Looks up only active rows in the locally selected Library while an import is
 * still being analyzed. The result is intentionally smaller than a work or
 * attachment row, and no renderer-supplied Library scope is accepted.
 */
export async function executeLibraryIngestDedupCommand(
  request: LibraryIngestDedupCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryIngestDedupCommandName>> {
  const input = parseLibraryFindIngestDedupInput(request.input);
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(request.name, async (database) => {
    const libraryId = await requireActiveLocalLibraryId(database);
    return input.kind === "attachmentSha"
      ? findActiveAttachmentHashDedup(database, libraryId, input.sha256)
      : findActiveDoiDedup(database, libraryId, input.doi);
  });
}

function parseLibraryFindIngestDedupInput(value: unknown): LibraryFindIngestDedupCommandInput {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Invalid library.findIngestDedup input");
  }
  if (value.kind === "attachmentSha") {
    if (
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "sha256") ||
      typeof value.sha256 !== "string" ||
      !SHA256_PATTERN.test(value.sha256)
    ) {
      throw new Error("PDF SHA-256 is invalid");
    }
    return { kind: "attachmentSha", sha256: value.sha256.toLowerCase() };
  }
  if (value.kind === "doi") {
    if (
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "doi") ||
      typeof value.doi !== "string" ||
      value.doi.length > MAX_DOI_LENGTH
    ) {
      throw new Error("Work DOI is invalid");
    }
    const doi = normalizeDoi(value.doi) ?? value.doi.trim().toLowerCase();
    if (!doi) throw new Error("Work DOI is required");
    return { doi, kind: "doi" };
  }
  throw new Error("Ingest dedup kind is invalid");
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function findActiveAttachmentHashDedup(
  database: Database,
  libraryId: string,
  sha256: string,
): Promise<LibraryFindIngestDedupCommandResult> {
  const rows = await database.query<{
    pageCount: number | null;
    title: string;
    workId: string;
  }>(
    `SELECT a.page_count AS pageCount, w.id AS workId, w.title
     FROM attachments a
     JOIN works w
       ON w.id = a.work_id
      AND w.library_id = ?
      AND w.deleted_at IS NULL
     WHERE a.sha256 = ? AND a.kind = 'pdf' AND a.deleted_at IS NULL
     LIMIT 1`,
    [libraryId, sha256],
  );
  const hit = rows[0];
  return {
    hit: hit
      ? {
          pageCount: hit.pageCount,
          reason: "exact-file",
          title: hit.title,
          workId: hit.workId,
        }
      : null,
  };
}

async function findActiveDoiDedup(
  database: Database,
  libraryId: string,
  doi: string,
): Promise<LibraryFindIngestDedupCommandResult> {
  const rows = await database.query<{ title: string; workId: string }>(
    `SELECT id AS workId, title
     FROM works
     WHERE library_id = ? AND doi = ? AND deleted_at IS NULL
     LIMIT 1`,
    [libraryId, doi],
  );
  const hit = rows[0];
  return {
    hit: hit ? { reason: "doi", title: hit.title, workId: hit.workId } : null,
  };
}
