import { Buffer } from "node:buffer";
import type { CollectionRow, Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { citationCountsForWorks } from "@aurascholar/db/work-list";
import { locateWorkPageOffset, queryWorkPage } from "@aurascholar/db/work-page";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryGetPageCommandInput,
  LibraryGetPageCommandResult,
  LibraryGetWorkRuntimeMetaCommandInput,
  LibraryGetWorkRuntimeMetaCommandResult,
  LibraryPageFilter,
  LibraryWorkPdfPreview,
  LibraryWorkTableMeta,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  type DataCommandDependencies,
} from "./data-command-runtime";
import {
  MAX_LIBRARY_PAGE_FACET_VALUE_BYTES,
  parseLibraryGetPageInput,
  parseLibraryGetWorkRuntimeMetaInput,
} from "./library-page-command-input";

const MAX_LIBRARY_PAGE_COLLECTIONS = 500;
const MAX_LIBRARY_PAGE_LABEL_CHARACTERS = 32;
const MAX_LIBRARY_PAGE_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_LIBRARY_PAGE_TEXT_BYTES = 256;
const MAX_LIBRARY_PAGE_WORK_TAGS = 4;
const MAX_LIBRARY_WORK_RUNTIME_META_NOTE_BYTES = 8 * 1024;
const MAX_LIBRARY_WORK_RUNTIME_META_NOTE_PREVIEWS = 3;
const MAX_LIBRARY_WORK_RUNTIME_META_OUTPUT_BYTES = 256 * 1024;

type LibraryPageCommandName = "library.getPage" | "library.getWorkRuntimeMeta";
type LibraryPageQueryCommandName = LibraryPageCommandName;

export type LibraryPageCommandRequest = Extract<
  DataCommandRequest,
  { name: LibraryPageCommandName }
>;

interface WorkTagRow {
  name: string;
  work_id: string;
}

interface WorkCountRow {
  count: number;
  work_id: string;
}

interface WorkSentinelRow {
  current_state: string | null;
  status: string | null;
  task_count: number;
  work_id: string;
}

/**
 * Main-process implementation for the bounded Library list and inspector
 * reads. Renderer callers receive DTOs only; neither SQL nor a database
 * capability crosses the preload bridge.
 */
export async function executeLibraryPageCommand(
  request: LibraryPageCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryPageCommandName>> {
  switch (request.name) {
    case "library.getPage": {
      const input = parseLibraryGetPageInput(request.input);
      return executeLibraryPageQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireLocalLibraryId(database);
        await assertActiveLocalLibrary(database, libraryId);
        return requireBoundedLibraryPageOutput(await loadLibraryPage(database, libraryId, input));
      });
    }
    case "library.getWorkRuntimeMeta": {
      const input = parseLibraryGetWorkRuntimeMetaInput(request.input);
      return executeLibraryPageQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireLocalLibraryId(database);
        await assertActiveLocalLibrary(database, libraryId);
        await assertLibraryWorkBelongsToLocalLibrary(database, libraryId, input.workId);
        return requireBoundedLibraryWorkRuntimeMetaOutput(
          await loadLibraryWorkRuntimeMeta(database, libraryId, input),
        );
      });
    }
  }
}

function executeLibraryPageQuery<K extends LibraryPageQueryCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function emptyWorkMeta(): LibraryWorkTableMeta {
  return {
    annotations: 0,
    citedBy: 0,
    pdfs: 0,
    references: 0,
    sentinelState: null,
    sentinelStatus: null,
    sentinelTaskCount: 0,
    tags: [],
  };
}

async function assertLibraryWorkBelongsToLocalLibrary(
  database: Database,
  libraryId: string,
  workId: string,
): Promise<void> {
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM works
     WHERE id = ? AND library_id = ?
     LIMIT 1`,
    [workId, libraryId],
  );
  if (!rows[0]) throw new Error("Work is missing or outside the active Library");
}

function resolvePageQuery(
  input: LibraryGetPageCommandInput,
): NonNullable<Parameters<typeof queryWorkPage>[2]> {
  const isTrash = input.showTrash === true || input.filter === "trash";
  const filter: Exclude<LibraryPageFilter, "trash"> =
    input.filter === "trash" ? "all" : (input.filter ?? "all");
  const query: NonNullable<Parameters<typeof queryWorkPage>[2]> = {
    deleted: isTrash ? "deleted" : "active",
    filter: isTrash ? "all" : filter,
    limit: input.limit,
    offset: input.offset ?? 0,
    sort: input.sort ?? "added",
  };

  if (input.search?.trim()) query.search = input.search;
  if (!isTrash && input.collectionId) query.collectionId = input.collectionId;
  if (!isTrash) {
    if (input.tag) query.tag = input.tag;
    if (input.source) query.source = input.source;
    if (input.extraFilter) query.pdf = input.extraFilter;
    if (input.status) query.status = input.status;
  }
  return query;
}

async function loadLibraryPage(
  database: Database,
  libraryId: string,
  input: LibraryGetPageCommandInput,
): Promise<LibraryGetPageCommandResult> {
  const sidebarPromise = Promise.all([
    database.query<CollectionRow>(
      `SELECT
         c.id,
         c.library_id,
         CASE
           WHEN length(c.name) <= ? THEN c.name
           ELSE substr(c.name, 1, ?) || '…'
         END AS name,
         c.parent_id,
         c.sort_order,
         COUNT(w.id) AS count
       FROM collections c
       LEFT JOIN collection_items ci ON ci.collection_id = c.id
       LEFT JOIN works w
         ON w.id = ci.work_id
        AND w.library_id = c.library_id
        AND w.deleted_at IS NULL
       WHERE c.library_id = ? AND c.deleted_at IS NULL
       GROUP BY c.id, c.library_id, c.name, c.parent_id, c.sort_order
       ORDER BY c.sort_order, c.name, c.id
      LIMIT ?`,
      [
        MAX_LIBRARY_PAGE_LABEL_CHARACTERS,
        MAX_LIBRARY_PAGE_LABEL_CHARACTERS,
        libraryId,
        MAX_LIBRARY_PAGE_COLLECTIONS + 1,
      ],
    ),
    database.query<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM works
       WHERE library_id = ? AND deleted_at IS NOT NULL`,
      [libraryId],
    ),
  ]);
  const pageQuery = resolvePageQuery(input);
  const focusWorkId = input.focusWorkId?.trim();
  const focusedOffset = focusWorkId
    ? await locateWorkPageOffset(database, libraryId, focusWorkId, pageQuery)
    : null;
  const pageLimit = pageQuery.limit ?? input.limit;
  const query =
    focusedOffset === null
      ? pageQuery
      : { ...pageQuery, offset: Math.floor(focusedOffset / pageLimit) * pageLimit };
  const [[collectionRows, trashRows], initialPage] = await Promise.all([
    sidebarPromise,
    queryWorkPage(database, libraryId, query),
  ]);
  const collections = requireBoundedLibraryPageRows(
    collectionRows,
    MAX_LIBRARY_PAGE_COLLECTIONS,
    "Library page collections",
  );
  const lastPageOffset =
    initialPage.works.length === 0 &&
    initialPage.total > 0 &&
    initialPage.offset >= initialPage.total &&
    initialPage.limit > 0
      ? Math.floor((initialPage.total - 1) / initialPage.limit) * initialPage.limit
      : null;
  const page =
    lastPageOffset === null || lastPageOffset === initialPage.offset
      ? initialPage
      : await queryWorkPage(database, libraryId, { ...query, offset: lastPageOffset });
  const { works } = page;
  if (works.length === 0) {
    return {
      browseSummary: page.browseSummary,
      collections,
      limit: page.limit,
      offset: page.offset,
      total: page.total,
      trashCount: trashRows[0]?.n ?? 0,
      workMeta: {},
      works,
    };
  }

  const ids = works.map((work) => work.id);
  const placeholders = ids.map(() => "?").join(",");
  const [tagRows, citationCounts, annotationRows, attachmentRows, sentinelRows] = await Promise.all(
    [
      database.query<WorkTagRow>(
        `WITH ranked_tags AS (
           SELECT
             wt.work_id,
             t.id AS tag_id,
             ROW_NUMBER() OVER (
               PARTITION BY wt.work_id
               ORDER BY t.name COLLATE NOCASE, t.name, t.id
             ) AS tag_position
           FROM work_tags wt
           JOIN tags t ON t.id = wt.tag_id
           WHERE wt.work_id IN (${placeholders})
             AND t.library_id = ?
             AND t.deleted_at IS NULL
             AND length(CAST(t.name AS BLOB)) <= ?
         )
         SELECT
           ranked_tags.work_id,
           t.name
         FROM ranked_tags
         JOIN tags t ON t.id = ranked_tags.tag_id
         WHERE ranked_tags.tag_position <= ?
         ORDER BY ranked_tags.work_id, ranked_tags.tag_position`,
        [
          ...ids,
          libraryId,
          MAX_LIBRARY_PAGE_FACET_VALUE_BYTES,
          MAX_LIBRARY_PAGE_WORK_TAGS,
        ],
      ),
      citationCountsForWorks(database, libraryId, ids),
      database.query<WorkCountRow>(
        `SELECT work_id, COUNT(*) AS count
       FROM annotations
       WHERE work_id IN (${placeholders}) AND deleted_at IS NULL
       GROUP BY work_id`,
        ids,
      ),
      database.query<WorkCountRow>(
        `SELECT work_id, COUNT(*) AS count
       FROM attachments
       WHERE work_id IN (${placeholders}) AND deleted_at IS NULL AND kind = 'pdf'
       GROUP BY work_id`,
        ids,
      ),
      database.query<WorkSentinelRow>(
        `WITH ranked_sentinel_tasks AS (
           SELECT
             st.work_id,
             CASE WHEN length(CAST(st.current_state AS BLOB)) <= ? THEN st.current_state ELSE NULL END AS current_state,
             CASE WHEN length(CAST(st.status AS BLOB)) <= ? THEN st.status ELSE NULL END AS status,
             COUNT(*) OVER (PARTITION BY st.work_id) AS task_count,
             ROW_NUMBER() OVER (
               PARTITION BY st.work_id
               ORDER BY st.created_at DESC, st.updated_at DESC, st.id DESC
             ) AS task_position
           FROM sentinel_tasks st
           WHERE st.work_id IN (${placeholders})
             AND st.library_id = ?
             AND st.deleted_at IS NULL
         )
         SELECT work_id, status, current_state, task_count
         FROM ranked_sentinel_tasks
         WHERE task_position = 1
         ORDER BY work_id
         LIMIT ?`,
        [
          MAX_LIBRARY_PAGE_TEXT_BYTES,
          MAX_LIBRARY_PAGE_TEXT_BYTES,
          ...ids,
          libraryId,
          ids.length,
        ],
      ),
    ],
  );

  const workMeta = Object.fromEntries(works.map((work) => [work.id, emptyWorkMeta()])) as Record<
    string,
    LibraryWorkTableMeta
  >;
  for (const row of tagRows) {
    workMeta[row.work_id]?.tags.push(row.name);
  }
  for (const [workId, counts] of citationCounts) {
    const meta = workMeta[workId];
    if (meta) {
      meta.references = counts.references;
      meta.citedBy = counts.citedBy;
    }
  }
  for (const row of annotationRows) {
    const meta = workMeta[row.work_id];
    if (meta) meta.annotations = Number(row.count);
  }
  for (const row of attachmentRows) {
    const meta = workMeta[row.work_id];
    if (meta) meta.pdfs = Number(row.count);
  }
  for (const row of sentinelRows) {
    const meta = workMeta[row.work_id];
    if (meta) {
      meta.sentinelTaskCount = Number(row.task_count);
      meta.sentinelStatus = row.status;
      meta.sentinelState = row.current_state;
    }
  }

  return {
    browseSummary: page.browseSummary,
    collections,
    limit: page.limit,
    offset: page.offset,
    total: page.total,
    trashCount: trashRows[0]?.n ?? 0,
    workMeta,
    works,
  };
}

function requireBoundedLibraryPageRows<T>(rows: T[], maximum: number, label: string): T[] {
  if (rows.length > maximum) throw new Error(`${label} are limited to ${maximum}`);
  return rows;
}

function requireBoundedSerializedOutput<T>(output: T, maximum: number, label: string): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error(`${label} cannot be serialized`);
  }
  if (Buffer.byteLength(serialized, "utf8") > maximum) {
    throw new Error(`${label} is limited to ${maximum} bytes`);
  }
  return output;
}

function requireBoundedLibraryPageOutput<T extends LibraryGetPageCommandResult>(output: T): T {
  return requireBoundedSerializedOutput(output, MAX_LIBRARY_PAGE_OUTPUT_BYTES, "Library page output");
}

function requireBoundedLibraryWorkRuntimeMetaOutput<T extends LibraryGetWorkRuntimeMetaCommandResult>(
  output: T,
): T {
  return requireBoundedSerializedOutput(
    output,
    MAX_LIBRARY_WORK_RUNTIME_META_OUTPUT_BYTES,
    "Library work runtime metadata output",
  );
}

async function loadLibraryWorkRuntimeMeta(
  database: Database,
  libraryId: string,
  input: LibraryGetWorkRuntimeMetaCommandInput,
): Promise<LibraryGetWorkRuntimeMetaCommandResult> {
  const [pdfCountRows, pdfPreviewRows, noteRows, sentinelRows] = await Promise.all([
    database.query<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM attachments a
       JOIN works w ON w.id = a.work_id AND w.library_id = ?
       WHERE a.work_id = ? AND a.kind = 'pdf' AND a.deleted_at IS NULL
       LIMIT 1`,
      [libraryId, input.workId],
    ),
    database.query<LibraryWorkPdfPreview>(
      `SELECT
         a.byte_size,
         CASE WHEN length(CAST(a.original_filename AS BLOB)) <= ? THEN a.original_filename ELSE NULL END AS original_filename,
         CASE WHEN length(CAST(a.fetched_via AS BLOB)) <= ? THEN a.fetched_via ELSE NULL END AS fetched_via,
         a.page_count
       FROM attachments a
       JOIN works w ON w.id = a.work_id AND w.library_id = ?
       WHERE a.work_id = ? AND a.kind = 'pdf' AND a.deleted_at IS NULL
       ORDER BY a.created_at DESC, a.id ASC
       LIMIT 1`,
      [MAX_LIBRARY_PAGE_TEXT_BYTES, MAX_LIBRARY_PAGE_TEXT_BYTES, libraryId, input.workId],
    ),
    database.query<LibraryGetWorkRuntimeMetaCommandResult["notePreviews"][number]>(
      `SELECT
         a.id,
         CASE WHEN length(CAST(a.type AS BLOB)) <= ? THEN a.type ELSE 'note' END AS type,
         a.page_index,
         CASE
           WHEN a.content_md IS NULL THEN NULL
           WHEN length(CAST(a.content_md AS BLOB)) <= ? THEN a.content_md
           ELSE NULL
         END AS content_md,
         a.updated_at
       FROM annotations a
       JOIN works w ON w.id = a.work_id AND w.library_id = ?
       WHERE a.work_id = ?
         AND a.deleted_at IS NULL
         AND length(CAST(a.id AS BLOB)) <= ?
       ORDER BY a.updated_at DESC, a.id ASC
       LIMIT ?`,
      [
        MAX_LIBRARY_PAGE_TEXT_BYTES,
        MAX_LIBRARY_WORK_RUNTIME_META_NOTE_BYTES,
        libraryId,
        input.workId,
        MAX_LIBRARY_PAGE_TEXT_BYTES,
        MAX_LIBRARY_WORK_RUNTIME_META_NOTE_PREVIEWS,
      ],
    ),
    database.query<{ current_state: string | null; status: string | null; task_count: number }>(
      `WITH ranked_sentinel_tasks AS (
         SELECT
           CASE WHEN length(CAST(st.current_state AS BLOB)) <= ? THEN st.current_state ELSE NULL END AS current_state,
           CASE WHEN length(CAST(st.status AS BLOB)) <= ? THEN st.status ELSE NULL END AS status,
           COUNT(*) OVER () AS task_count,
           ROW_NUMBER() OVER (
             ORDER BY st.created_at DESC, st.updated_at DESC, st.id DESC
           ) AS task_position
         FROM sentinel_tasks st
         WHERE st.work_id = ? AND st.library_id = ? AND st.deleted_at IS NULL
       )
       SELECT status, current_state, task_count
       FROM ranked_sentinel_tasks
       WHERE task_position = 1
       LIMIT 1`,
      [
        MAX_LIBRARY_PAGE_TEXT_BYTES,
        MAX_LIBRARY_PAGE_TEXT_BYTES,
        input.workId,
        libraryId,
      ],
    ),
  ]);
  const pdfCounts = requireBoundedLibraryPageRows(pdfCountRows, 1, "Library runtime PDF counts");
  const pdfPreviews = requireBoundedLibraryPageRows(pdfPreviewRows, 1, "Library runtime PDF previews");
  const notes = requireBoundedLibraryPageRows(
    noteRows,
    MAX_LIBRARY_WORK_RUNTIME_META_NOTE_PREVIEWS,
    "Library runtime note previews",
  );
  const sentinels = requireBoundedLibraryPageRows(sentinelRows, 1, "Library runtime Sentinel tasks");
  const sentinel = sentinels[0];

  return {
    annotationCount: input.annotationCount,
    notePreviews: notes,
    pdfCount: Number(pdfCounts[0]?.count ?? 0),
    pdfPreview: pdfPreviews[0] ?? null,
    sentinelState: sentinel?.current_state ?? null,
    sentinelStatus: sentinel?.status ?? null,
    sentinelTaskCount: Number(sentinel?.task_count ?? 0),
  };
}
