import { Buffer } from "node:buffer";
import { toCslItem, type CslItem, type WorkLike } from "@aurascholar/cite";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryGetCslItemsCommandInput,
  LibraryGetCslItemsCommandResult,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_CSL_ITEM_WORK_IDS = 500;
const MAX_CSL_ITEMS_OUTPUT_BYTES = 8 * 1024 * 1024;

type LibraryCslCommandName = "library.getCslItems";

export type LibraryCslCommandRequest = Extract<DataCommandRequest, { name: LibraryCslCommandName }>;

interface CslWorkRow {
  csl_json: unknown;
  doi: string | null;
  edition: string | null;
  id: string;
  isbn: string | null;
  issn: string | null;
  issue: string | null;
  language: string | null;
  pages: string | null;
  place_published: string | null;
  pmid: string | null;
  publication_date: string | null;
  publisher: string | null;
  title: string;
  type: string;
  url: string | null;
  venue_name: string | null;
  volume: string | null;
  year: number | null;
}

interface CslAuthorRow {
  display_name: string;
  role: string | null;
  work_id: string;
}

/**
 * Formatting-only reads. Main resolves the durable local Library and turns
 * stored rows into CSL items, so the renderer cannot query arbitrary works or
 * receive raw database rows just to export a bibliography.
 */
export async function executeLibraryCslCommand(
  request: LibraryCslCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryCslCommandName>> {
  const input = parseLibraryGetCslItemsInput(request.input);
  // Preserve the existing renderer API: an empty selection is a local no-op,
  // so it neither obtains a database lease nor requires Library initialization.
  if (input.workIds.length === 0) return { items: [] };

  if (!dependencies.execute) {
    throw new Error("Main-process CSL command execution is unavailable");
  }
  return dependencies.execute(request.name, async (database) => {
    const libraryId = await requireActiveLocalLibraryId(database);
    return loadCslItems(database, libraryId, input.workIds);
  });
}

function parseLibraryGetCslItemsInput(value: unknown): LibraryGetCslItemsCommandInput {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "workIds") ||
    !Array.isArray(value.workIds) ||
    value.workIds.length > MAX_CSL_ITEM_WORK_IDS
  ) {
    throw new Error("Invalid library.getCslItems input");
  }
  // Deliberately allow duplicates: callers may request a repeated item, and
  // the result must retain the exact requested order.
  return {
    workIds: value.workIds.map((workId, index) =>
      requireRecordId(workId, `Work id at index ${index}`),
    ),
  };
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function loadCslItems(
  database: Database,
  libraryId: string,
  requestedWorkIds: readonly string[],
): Promise<LibraryGetCslItemsCommandResult> {
  const uniqueWorkIds = [...new Set(requestedWorkIds)];
  const placeholders = uniqueWorkIds.map(() => "?").join(",");
  const [works, authors] = await Promise.all([
    database.query<CslWorkRow>(
      `SELECT id, title, doi, pmid, year, publication_date, venue_name, type, csl_json,
              volume, issue, pages, publisher, place_published, edition, issn, isbn, language, url
       FROM works
       WHERE library_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
      [libraryId, ...uniqueWorkIds],
    ),
    database.query<CslAuthorRow>(
      `SELECT wa.work_id, a.display_name, wa.role
       FROM work_authors wa
       JOIN works w
         ON w.id = wa.work_id
        AND w.library_id = ?
        AND w.deleted_at IS NULL
       JOIN authors a
         ON a.id = wa.author_id
        AND a.library_id = w.library_id
       WHERE wa.work_id IN (${placeholders})
       ORDER BY wa.work_id, wa.position, wa.author_id`,
      [libraryId, ...uniqueWorkIds],
    ),
  ]);

  const authorsByWork = new Map<string, Array<{ displayName: string; role?: string }>>();
  for (const author of authors) {
    const detail = authorsByWork.get(author.work_id) ?? [];
    detail.push({
      displayName: author.display_name,
      ...(author.role === null ? {} : { role: author.role }),
    });
    authorsByWork.set(author.work_id, detail);
  }

  const itemsByWorkId = new Map<string, CslItem>();
  for (const work of works) {
    itemsByWorkId.set(work.id, toCslItem(toWorkLike(work, authorsByWork.get(work.id) ?? [])));
  }

  return requireBoundedCslItemsOutput({
    items: requestedWorkIds
      .map((workId) => itemsByWorkId.get(workId))
      .filter((item): item is CslItem => item !== undefined),
  });
}

function toWorkLike(
  work: CslWorkRow,
  authorsDetail: Array<{ displayName: string; role?: string }>,
): WorkLike {
  return {
    id: work.id,
    title: work.title,
    doi: work.doi,
    pmid: work.pmid,
    year: work.year,
    publicationDate: work.publication_date,
    venueName: work.venue_name,
    type: work.type,
    authorNames: authorsDetail.map((author) => author.displayName),
    authorsDetail,
    volume: work.volume,
    issue: work.issue,
    pages: work.pages,
    publisher: work.publisher,
    placePublished: work.place_published,
    edition: work.edition,
    issn: work.issn,
    isbn: work.isbn,
    language: work.language,
    url: work.url,
    cslJson: parseCslJson(work.csl_json),
  };
}

// csl_json may be a raw string or an already-parsed Drizzle value. Bad legacy
// JSON must remain exportable through normalized work columns.
function parseCslJson(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function requireBoundedCslItemsOutput(
  output: LibraryGetCslItemsCommandResult,
): LibraryGetCslItemsCommandResult {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("CSL item output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_CSL_ITEMS_OUTPUT_BYTES) {
    throw new Error(`CSL item output is limited to ${MAX_CSL_ITEMS_OUTPUT_BYTES} bytes`);
  }
  return output;
}
