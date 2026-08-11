import type { AttachmentRow, CollectionRow, Database, WorkWithAuthors } from "@aurascholar/db";
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
  LibraryPageExtraFilter,
  LibraryPageFilter,
  LibraryPageSort,
  LibraryWorkTableMeta,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_ANNOTATION_COUNT = 1_000_000_000;
const MAX_FACET_LENGTH = 256;
const MAX_PAGE_LIMIT = 200;
const MAX_PAGE_OFFSET = 1_000_000_000;
const MAX_SEARCH_LENGTH = 512;

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
  status: string;
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
        return loadLibraryPage(database, libraryId, input);
      });
    }
    case "library.getWorkRuntimeMeta": {
      const input = parseLibraryGetWorkRuntimeMetaInput(request.input);
      return executeLibraryPageQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireLocalLibraryId(database);
        await assertActiveLocalLibrary(database, libraryId);
        await assertLibraryWorkBelongsToLocalLibrary(database, libraryId, input.workId);
        return loadLibraryWorkRuntimeMeta(database, libraryId, input);
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

function parseLibraryGetPageInput(
  value: unknown,
): Required<Pick<LibraryGetPageCommandInput, "limit" | "offset" | "showTrash" | "sort">> &
  Omit<LibraryGetPageCommandInput, "limit" | "offset" | "showTrash" | "sort"> {
  if (!isRecord(value)) throw new Error("Invalid library.getPage input");
  const filter = requireOptionalPageFilter(value.filter);
  const showTrash = requireOptionalBoolean(value.showTrash, "Show trash") ?? false;
  return {
    collectionId: requireOptionalRecordId(value.collectionId, "Collection id"),
    extraFilter: requireOptionalExtraFilter(value.extraFilter),
    filter,
    focusWorkId: requireOptionalRecordId(value.focusWorkId, "Focused work id"),
    limit: requirePageInteger(value.limit, "Page size", 1, MAX_PAGE_LIMIT),
    offset: requirePageInteger(value.offset, "Page offset", 0, MAX_PAGE_OFFSET, 0),
    search: requireOptionalText(value.search, "Search", MAX_SEARCH_LENGTH),
    showTrash,
    sort: requireOptionalPageSort(value.sort) ?? "added",
    source: requireOptionalNullableText(value.source, "Source", MAX_FACET_LENGTH),
    status: requireOptionalReadingStatus(value.status),
    tag: requireOptionalNullableText(value.tag, "Tag", MAX_FACET_LENGTH),
  };
}

function parseLibraryGetWorkRuntimeMetaInput(
  value: unknown,
): LibraryGetWorkRuntimeMetaCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.getWorkRuntimeMeta input");
  return {
    annotationCount: requirePageInteger(
      value.annotationCount,
      "Annotation count",
      0,
      MAX_ANNOTATION_COUNT,
    ),
    workId: requireRecordId(value.workId, "Work id"),
  };
}

function requireOptionalRecordId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireRecordId(value, label);
}

function requireOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function requirePageInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireOptionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`${label} is too long`);
  return normalized || undefined;
}

function requireOptionalNullableText(
  value: unknown,
  label: string,
  maximum: number,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return requireOptionalText(value, label, maximum) ?? null;
}

function requireOptionalPageFilter(value: unknown): LibraryPageFilter | undefined {
  if (value === undefined) return undefined;
  if (
    value === "all" ||
    value === "reading" ||
    value === "unread" ||
    value === "noted" ||
    value === "starred" ||
    value === "trash"
  ) {
    return value;
  }
  throw new Error("Library filter is invalid");
}

function requireOptionalExtraFilter(value: unknown): LibraryPageExtraFilter | null | undefined {
  if (value === undefined || value === null) return value;
  if (value === "with-pdf" || value === "without-pdf") return value;
  throw new Error("Library PDF filter is invalid");
}

function requireOptionalPageSort(value: unknown): LibraryPageSort | undefined {
  if (value === undefined) return undefined;
  if (value === "added" || value === "year") return value;
  throw new Error("Library sort is invalid");
}

function requireOptionalReadingStatus(value: unknown): "unread" | "reading" | "read" | undefined {
  if (value === undefined) return undefined;
  if (value === "unread" || value === "reading" || value === "read") return value;
  throw new Error("Reading status is invalid");
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
      `SELECT c.id, c.library_id, c.name, c.parent_id, c.sort_order, COUNT(w.id) AS count
       FROM collections c
       LEFT JOIN collection_items ci ON ci.collection_id = c.id
       LEFT JOIN works w
         ON w.id = ci.work_id
        AND w.library_id = c.library_id
        AND w.deleted_at IS NULL
       WHERE c.library_id = ? AND c.deleted_at IS NULL
       GROUP BY c.id, c.library_id, c.name, c.parent_id, c.sort_order
       ORDER BY c.sort_order, c.name, c.id`,
      [libraryId],
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
  const [[collections, trashRows], initialPage] = await Promise.all([
    sidebarPromise,
    queryWorkPage(database, libraryId, query),
  ]);
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
        `SELECT wt.work_id, t.name
       FROM work_tags wt
       JOIN tags t ON t.id = wt.tag_id
       WHERE wt.work_id IN (${placeholders})
         AND t.library_id = ?
         AND t.deleted_at IS NULL
       ORDER BY t.name`,
        [...ids, libraryId],
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
        `SELECT st.work_id, st.status, st.current_state, latest.task_count
       FROM sentinel_tasks st
       JOIN (
         SELECT work_id, MAX(created_at) AS created_at, COUNT(*) AS task_count
         FROM sentinel_tasks
         WHERE work_id IN (${placeholders})
           AND library_id = ?
           AND deleted_at IS NULL
         GROUP BY work_id
       ) latest ON latest.work_id = st.work_id AND latest.created_at = st.created_at
       WHERE st.library_id = ? AND st.deleted_at IS NULL`,
        [...ids, libraryId, libraryId],
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
    works: works as WorkWithAuthors[],
  };
}

async function loadLibraryWorkRuntimeMeta(
  database: Database,
  libraryId: string,
  input: LibraryGetWorkRuntimeMetaCommandInput,
): Promise<LibraryGetWorkRuntimeMetaCommandResult> {
  const [attachments, notes, sentinelTasks] = await Promise.all([
    database.query<AttachmentRow>(
      `SELECT * FROM attachments
       WHERE work_id = ?
         AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM works
           WHERE id = ? AND library_id = ?
         )
       ORDER BY created_at DESC`,
      [input.workId, input.workId, libraryId],
    ),
    database.query<LibraryGetWorkRuntimeMetaCommandResult["notePreviews"][number]>(
      `SELECT id, type, page_index, content_md, updated_at
       FROM annotations
       WHERE work_id = ?
         AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM works
           WHERE id = ? AND library_id = ?
         )
       ORDER BY updated_at DESC
       LIMIT 3`,
      [input.workId, input.workId, libraryId],
    ),
    database.query<{ current_state: string | null; status: string }>(
      `SELECT status, current_state
       FROM sentinel_tasks
       WHERE work_id = ? AND library_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [input.workId, libraryId],
    ),
  ]);
  const pdfAttachments = attachments.filter((attachment) => attachment.kind === "pdf");

  return {
    annotationCount: input.annotationCount,
    notePreviews: notes,
    pdfCount: pdfAttachments.length,
    pdfPreview: pdfAttachments[0] ?? null,
    sentinelState: sentinelTasks[0]?.current_state ?? null,
    sentinelStatus: sentinelTasks[0]?.status ?? null,
    sentinelTaskCount: sentinelTasks.length,
  };
}
