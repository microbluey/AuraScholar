import type { Database } from "./database.js";
import { buildWorksFtsQuery } from "./fts.js";
import type { ReadingStatus } from "./repos/works.js";
/** Which side of the soft-delete boundary a Library page reads. */
export type WorkPageDeletedScope = "active" | "deleted";
/** The Library's primary status facets. */
export type WorkPageFilter = "all" | "reading" | "unread" | "noted" | "starred";
export type WorkPagePdfFilter = "with-pdf" | "without-pdf";
export type WorkPageSort = "added" | "year";
/**
 * A database-backed Library page query.
 *
 * `filter` mirrors the Library UI while `status` is available to callers that
 * need the underlying reading-status filter directly. An explicit `status`
 * takes precedence over the reading/unread shorthand in `filter`.
 */
export interface WorkPageQuery {
  collectionId?: string;
  deleted?: WorkPageDeletedScope;
  filter?: WorkPageFilter;
  limit?: number;
  offset?: number;
  pdf?: WorkPagePdfFilter;
  search?: string;
  source?: string;
  sort?: WorkPageSort;
  status?: ReadingStatus;
  tag?: string;
}
/** Facet data for the same base Library scope, before active facet filters. */
export interface WorkPageBrowseSummary {
  availableSources: string[];
  availableSourcesTruncated: boolean;
  availableTags: string[];
  availableTagsTruncated: boolean;
  baseTotal: number;
  notedTotal: number;
  readingTotal: number;
  starredTotal: number;
  unreadTotal: number;
  withPdfTotal: number;
  withoutPdfTotal: number;
}
/**
 * A bounded projection for the Library table and its selected-work header.
 * Complete metadata stays behind the explicit, on-demand work-metadata read.
 */
export interface WorkPageWork {
  arxiv_id: string | null;
  authorNames: string[];
  created_at: number;
  deleted_at: number | null;
  doi: string | null;
  id: string;
  reading_status: string;
  starred: number;
  title: string;
  type: string;
  url: string | null;
  venue_name: string | null;
  year: number | null;
}
export interface WorkPageResult {
  browseSummary: WorkPageBrowseSummary;
  limit: number;
  offset: number;
  total: number;
  works: WorkPageWork[];
}

const DEFAULT_PAGE_LIMIT = 30;
const MAX_PAGE_LIMIT = 200;
const MAX_WORK_PAGE_BROWSE_FACET_VALUES = 500;
const MAX_WORK_PAGE_BROWSE_FACET_VALUE_BYTES = 1_024;
const MAX_WORK_PAGE_AUTHOR_NAME_LENGTH = 64;
const MAX_WORK_PAGE_AUTHORS = 5;
const MAX_WORK_PAGE_IDENTIFIER_BYTES = 256;
const MAX_WORK_PAGE_SHORT_TEXT_LENGTH = 256;

type WorkPageRow = Omit<WorkPageWork, "authorNames">;

interface WorkQueryPlan {
  ftsQuery: string | null;
  fromSql: string;
  orderBySql: string;
  params: unknown[];
  whereSql: string;
}

interface SummaryRow {
  base_total: number;
  noted_total: number;
  reading_total: number;
  starred_total: number;
  unread_total: number;
  with_pdf_total: number;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset ?? 0));
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_PAGE_LIMIT;
  return Math.min(MAX_PAGE_LIMIT, Math.trunc(limit));
}

function normalizedOptional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveSort(
  query: WorkPageQuery,
  hasSearch: boolean,
  deleted: WorkPageDeletedScope,
): string {
  if (query.sort === "year") {
    // SQLite orders NULL after numeric values in DESC order. Avoiding a CASE
    // expression keeps this sort eligible for the v23 page index.
    return `w.year DESC,
            w.created_at DESC,
            w.id DESC`;
  }
  if (query.sort === "added") return "w.created_at DESC, w.id DESC";
  if (hasSearch) return "bm25(works_fts) ASC, w.id ASC";
  return deleted === "deleted"
    ? "w.deleted_at DESC, w.updated_at DESC, w.id DESC"
    : "w.created_at DESC, w.id DESC";
}

function createWorkQueryPlan(
  libraryId: string,
  query: WorkPageQuery,
  options: { includeFacets: boolean },
): WorkQueryPlan {
  const deleted = query.deleted ?? "active";
  const search = normalizedOptional(query.search);
  const ftsQuery = search ? buildWorksFtsQuery(search) : null;
  const fromSql = ftsQuery ? "works w JOIN works_fts f ON f.rowid = w.rowid" : "works w";
  const where: string[] = [
    "w.library_id = ?",
    `w.deleted_at IS ${deleted === "active" ? "NULL" : "NOT NULL"}`,
  ];
  const params: unknown[] = [libraryId];

  if (search && !ftsQuery) {
    // A punctuation-only FTS input has no searchable token. Keep the plan
    // explicitly empty instead of passing untrusted syntax to SQLite FTS.
    where.push("0");
  } else if (ftsQuery) {
    where.push("works_fts MATCH ?");
    params.push(ftsQuery);
  }

  const collectionId = normalizedOptional(query.collectionId);
  if (collectionId) {
    where.push(`EXISTS (
      SELECT 1
      FROM collection_items ci
      JOIN collections c
        ON c.id = ci.collection_id
       AND c.library_id = w.library_id
       AND c.deleted_at IS NULL
      WHERE ci.work_id = w.id
        AND ci.collection_id = ?
    )`);
    params.push(collectionId);
  }

  if (options.includeFacets) {
    const tag = normalizedOptional(query.tag);
    if (tag) {
      where.push(`EXISTS (
        SELECT 1
        FROM work_tags wt
        JOIN tags t
          ON t.id = wt.tag_id
         AND t.library_id = w.library_id
         AND t.deleted_at IS NULL
        WHERE wt.work_id = w.id
          AND t.name = ? COLLATE NOCASE
      )`);
      params.push(tag);
    }

    const source = normalizedOptional(query.source);
    if (source) {
      where.push(`LOWER(
        COALESCE(w.venue_name, '') || ' ' || COALESCE(w.type, '') ||
        CASE WHEN TRIM(COALESCE(w.arxiv_id, '')) <> '' THEN ' arxiv' ELSE '' END
      ) LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLikePattern(source.toLocaleLowerCase())}%`);
    }

    const hasPdfSql = `EXISTS (
      SELECT 1
      FROM attachments attachment
      WHERE attachment.work_id = w.id
        AND attachment.kind = 'pdf'
        AND attachment.deleted_at IS NULL
    )`;
    if (query.pdf === "with-pdf") where.push(hasPdfSql);
    if (query.pdf === "without-pdf") where.push(`NOT ${hasPdfSql}`);

    const selectedStatus =
      query.status ??
      (query.filter === "reading" || query.filter === "unread" ? query.filter : null);
    if (selectedStatus) {
      where.push("w.reading_status = ?");
      params.push(selectedStatus);
    }
    if (query.filter === "noted") {
      where.push(`EXISTS (
        SELECT 1
        FROM annotations annotation
        WHERE annotation.work_id = w.id
          AND annotation.deleted_at IS NULL
      )`);
    }
    if (query.filter === "starred") where.push("w.starred = 1");
  }

  return {
    ftsQuery,
    fromSql,
    orderBySql: resolveSort(query, Boolean(ftsQuery), deleted),
    params,
    whereSql: where.join("\n AND "),
  };
}

async function attachAuthors(
  db: Database,
  libraryId: string,
  rows: WorkPageRow[],
): Promise<WorkPageWork[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const authorRows = await db.query<{ display_name: string; work_id: string }>(
    `WITH ranked_authors AS (
       SELECT
         wa.work_id,
         a.id AS author_id,
         ROW_NUMBER() OVER (
           PARTITION BY wa.work_id
           ORDER BY wa.position, a.id
         ) AS author_position
       FROM work_authors wa
       JOIN authors a ON a.id = wa.author_id
       WHERE wa.work_id IN (${placeholders})
         AND a.library_id = ?
     )
     SELECT
       ranked_authors.work_id,
       substr(a.display_name, 1, ?) AS display_name
     FROM ranked_authors
     JOIN authors a ON a.id = ranked_authors.author_id
     WHERE ranked_authors.author_position <= ?
     ORDER BY ranked_authors.work_id, ranked_authors.author_position`,
    [...ids, libraryId, MAX_WORK_PAGE_AUTHOR_NAME_LENGTH, MAX_WORK_PAGE_AUTHORS],
  );
  const namesByWork = new Map<string, string[]>();
  for (const author of authorRows) {
    const names = namesByWork.get(author.work_id) ?? [];
    names.push(author.display_name);
    namesByWork.set(author.work_id, names);
  }
  return rows.map((row) => ({ ...row, authorNames: namesByWork.get(row.id) ?? [] }));
}

function emptyBrowseSummary(): WorkPageBrowseSummary {
  return {
    availableSources: [],
    availableSourcesTruncated: false,
    availableTags: [],
    availableTagsTruncated: false,
    baseTotal: 0,
    notedTotal: 0,
    readingTotal: 0,
    starredTotal: 0,
    unreadTotal: 0,
    withPdfTotal: 0,
    withoutPdfTotal: 0,
  };
}

function boundedFacetValues(rows: readonly { value: string }[]): {
  truncated: boolean;
  values: string[];
} {
  return {
    truncated: rows.length > MAX_WORK_PAGE_BROWSE_FACET_VALUES,
    values: rows.slice(0, MAX_WORK_PAGE_BROWSE_FACET_VALUES).map((row) => row.value),
  };
}

async function loadBrowseSummary(
  db: Database,
  basePlan: WorkQueryPlan,
): Promise<WorkPageBrowseSummary> {
  const hasPdfSql = `EXISTS (
    SELECT 1
    FROM attachments attachment
    WHERE attachment.work_id = w.id
      AND attachment.kind = 'pdf'
      AND attachment.deleted_at IS NULL
  )`;
  const notedSql = `EXISTS (
    SELECT 1
    FROM annotations annotation
    WHERE annotation.work_id = w.id
      AND annotation.deleted_at IS NULL
  )`;
  const [summaryRows, tagRows, sourceRows] = await Promise.all([
    db.query<SummaryRow>(
      `SELECT
         COUNT(*) AS base_total,
         SUM(CASE WHEN w.reading_status = 'reading' THEN 1 ELSE 0 END) AS reading_total,
         SUM(CASE WHEN w.reading_status = 'unread' THEN 1 ELSE 0 END) AS unread_total,
         SUM(CASE WHEN ${notedSql} THEN 1 ELSE 0 END) AS noted_total,
         SUM(CASE WHEN w.starred = 1 THEN 1 ELSE 0 END) AS starred_total,
         SUM(CASE WHEN ${hasPdfSql} THEN 1 ELSE 0 END) AS with_pdf_total
       FROM ${basePlan.fromSql}
       WHERE ${basePlan.whereSql}`,
      basePlan.params,
    ),
    db.query<{ value: string }>(
      `SELECT DISTINCT tag.name AS value
       FROM ${basePlan.fromSql}
       JOIN work_tags wt ON wt.work_id = w.id
       JOIN tags tag
         ON tag.id = wt.tag_id
        AND tag.library_id = w.library_id
        AND tag.deleted_at IS NULL
       WHERE ${basePlan.whereSql}
         AND length(CAST(tag.name AS BLOB)) <= ?
       ORDER BY tag.name COLLATE NOCASE, tag.name
       LIMIT ?`,
      [
        ...basePlan.params,
        MAX_WORK_PAGE_BROWSE_FACET_VALUE_BYTES,
        MAX_WORK_PAGE_BROWSE_FACET_VALUES + 1,
      ],
    ),
    db.query<{ value: string }>(
      `WITH scoped AS (
         SELECT
           CASE
             WHEN length(CAST(w.venue_name AS BLOB)) <= ${MAX_WORK_PAGE_BROWSE_FACET_VALUE_BYTES}
               THEN w.venue_name
             ELSE NULL
           END AS venue_name,
           CASE
             WHEN length(CAST(w.type AS BLOB)) <= ${MAX_WORK_PAGE_BROWSE_FACET_VALUE_BYTES}
               THEN w.type
             ELSE NULL
           END AS type,
           CASE
             WHEN TRIM(COALESCE(w.arxiv_id, '')) <> '' THEN 1
             ELSE 0
           END AS has_arxiv
         FROM ${basePlan.fromSql}
         WHERE ${basePlan.whereSql}
       ), candidates AS (
         SELECT venue_name AS source FROM scoped WHERE TRIM(COALESCE(venue_name, '')) <> ''
         UNION
         SELECT type AS source FROM scoped WHERE TRIM(COALESCE(type, '')) <> ''
         UNION
         SELECT 'arXiv' AS source FROM scoped WHERE has_arxiv = 1
       )
       SELECT source AS value
       FROM candidates
       WHERE length(CAST(source AS BLOB)) <= ?
       ORDER BY source COLLATE NOCASE, source
       LIMIT ?`,
      [
        ...basePlan.params,
        MAX_WORK_PAGE_BROWSE_FACET_VALUE_BYTES,
        MAX_WORK_PAGE_BROWSE_FACET_VALUES + 1,
      ],
    ),
  ]);
  const row = summaryRows[0];
  if (!row) return emptyBrowseSummary();
  const baseTotal = Number(row.base_total) || 0;
  const withPdfTotal = Number(row.with_pdf_total) || 0;
  const sources = boundedFacetValues(sourceRows);
  const tags = boundedFacetValues(tagRows);
  return {
    availableSources: sources.values,
    availableSourcesTruncated: sources.truncated,
    availableTags: tags.values,
    availableTagsTruncated: tags.truncated,
    baseTotal,
    notedTotal: Number(row.noted_total) || 0,
    readingTotal: Number(row.reading_total) || 0,
    starredTotal: Number(row.starred_total) || 0,
    unreadTotal: Number(row.unread_total) || 0,
    withPdfTotal,
    withoutPdfTotal: Math.max(0, baseTotal - withPdfTotal),
  };
}

/**
 * Reads one exact, database-paginated Library page. The count and rows share
 * the same scoped predicate, so a page cannot silently report a partial total.
 */
export async function queryWorkPage(
  db: Database,
  libraryId: string,
  query: WorkPageQuery = {},
): Promise<WorkPageResult> {
  const offset = normalizeOffset(query.offset);
  const limit = normalizeLimit(query.limit);
  const pagePlan = createWorkQueryPlan(libraryId, query, { includeFacets: true });
  const basePlan = createWorkQueryPlan(libraryId, query, { includeFacets: false });
  const [countRows, rows, browseSummary] = await Promise.all([
    db.query<{ total: number }>(
      `SELECT COUNT(*) AS total
       FROM ${pagePlan.fromSql}
       WHERE ${pagePlan.whereSql}`,
      pagePlan.params,
    ),
    db.query<WorkPageRow>(
       `SELECT
         w.id,
         CASE
           WHEN length(CAST(w.doi AS BLOB)) <= ${MAX_WORK_PAGE_IDENTIFIER_BYTES}
             THEN w.doi
           ELSE NULL
         END AS doi,
         substr(w.title, 1, ${MAX_WORK_PAGE_SHORT_TEXT_LENGTH}) AS title,
         w.year,
         substr(w.venue_name, 1, ${MAX_WORK_PAGE_SHORT_TEXT_LENGTH}) AS venue_name,
         substr(w.type, 1, ${MAX_WORK_PAGE_SHORT_TEXT_LENGTH}) AS type,
         CASE
           WHEN length(CAST(w.arxiv_id AS BLOB)) <= ${MAX_WORK_PAGE_IDENTIFIER_BYTES}
             THEN w.arxiv_id
           ELSE NULL
         END AS arxiv_id,
         CASE
           WHEN length(CAST(w.url AS BLOB)) <= ${MAX_WORK_PAGE_IDENTIFIER_BYTES}
             THEN w.url
           ELSE NULL
         END AS url,
         w.reading_status,
         w.starred,
         w.created_at,
         w.deleted_at
       FROM ${pagePlan.fromSql}
       WHERE ${pagePlan.whereSql}
       ORDER BY ${pagePlan.orderBySql}
       LIMIT ? OFFSET ?`,
      [...pagePlan.params, limit, offset],
    ),
    loadBrowseSummary(db, basePlan),
  ]);
  return {
    browseSummary,
    limit,
    offset,
    total: Number(countRows[0]?.total) || 0,
    works: await attachAuthors(db, libraryId, rows),
  };
}

/**
 * Finds a matching Work's zero-based offset under the same filter and sort as
 * `queryWorkPage`. Page limit and requested offset do not affect its result.
 */
export async function locateWorkPageOffset(
  db: Database,
  libraryId: string,
  workId: string,
  query: WorkPageQuery = {},
): Promise<number | null> {
  const plan = createWorkQueryPlan(libraryId, query, { includeFacets: true });
  const rows = await db.query<{ page_offset: number }>(
    `WITH ranked AS (
       SELECT w.id,
              ROW_NUMBER() OVER (ORDER BY ${plan.orderBySql}) - 1 AS page_offset
       FROM ${plan.fromSql}
       WHERE ${plan.whereSql}
     )
     SELECT page_offset
     FROM ranked
     WHERE id = ?
     LIMIT 1`,
    [...plan.params, workId],
  );
  const offset = rows[0]?.page_offset;
  return typeof offset === "number" ? offset : null;
}
