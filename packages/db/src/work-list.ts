import type { Database } from "./database.js";
import { buildWorksFtsQuery } from "./fts.js";
import type { WorkRow, WorkWithAuthors } from "./repos/works.js";

export interface WorkListOptions {
  search?: string;
  limit?: number;
  collectionId?: string;
}

export interface WorkCitationCounts {
  references: number;
  citedBy: number;
}

export interface WorkWithAuthorsAndTags extends WorkWithAuthors {
  tagNames: string[];
}

async function attachAuthors(db: Database, rows: WorkRow[]): Promise<WorkWithAuthors[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const authorRows = await db.query<{
    work_id: string;
    display_name: string;
  }>(
    `SELECT wa.work_id, a.display_name
     FROM work_authors wa JOIN authors a ON a.id = wa.author_id
     WHERE wa.work_id IN (${placeholders})
     ORDER BY wa.position`,
    ids,
  );
  const byWork = new Map<string, string[]>();
  for (const author of authorRows) {
    const list = byWork.get(author.work_id) ?? [];
    list.push(author.display_name);
    byWork.set(author.work_id, list);
  }
  return rows.map((row) => ({ ...row, authorNames: byWork.get(row.id) ?? [] }));
}

async function attachAuthorsAndTags(
  db: Database,
  rows: WorkRow[],
): Promise<WorkWithAuthorsAndTags[]> {
  if (rows.length === 0) return [];
  const withAuthors = await attachAuthors(db, rows);
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const tagRows = await db.query<{ name: string; work_id: string }>(
    `SELECT wt.work_id, t.name
     FROM work_tags wt
     JOIN tags t ON t.id = wt.tag_id AND t.deleted_at IS NULL
     WHERE wt.work_id IN (${placeholders})
     ORDER BY t.name COLLATE NOCASE`,
    ids,
  );
  const tagsByWork = new Map<string, string[]>();
  for (const tag of tagRows) {
    const names = tagsByWork.get(tag.work_id) ?? [];
    names.push(tag.name);
    tagsByWork.set(tag.work_id, names);
  }
  return withAuthors.map((row) => ({
    ...row,
    tagNames: tagsByWork.get(row.id) ?? [],
  }));
}

const METADATA_SEARCH_TOKEN_RE = /[\p{L}\p{N}]+/gu;
const METADATA_SEARCH_QUERY_LIMIT = 512;
const METADATA_SEARCH_TOKEN_LIMIT = 12;

export interface WorkMetadataSearchTerms {
  normalized: string;
  tokens: string[];
}

export function parseWorkMetadataSearch(search: string): WorkMetadataSearchTerms {
  const normalized = search.trim().slice(0, METADATA_SEARCH_QUERY_LIMIT).toLocaleLowerCase();
  return {
    normalized,
    tokens: (normalized.match(METADATA_SEARCH_TOKEN_RE) ?? []).slice(
      0,
      METADATA_SEARCH_TOKEN_LIMIT,
    ),
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function searchWorksByMetadata(
  db: Database,
  search: string,
  limit = 40,
): Promise<WorkWithAuthorsAndTags[]> {
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 40));
  const { normalized, tokens } = parseWorkMetadataSearch(search);
  if (!normalized) {
    const recent = await db.query<WorkRow>(
      `SELECT w.* FROM works w
       WHERE w.deleted_at IS NULL
       ORDER BY w.starred DESC, w.updated_at DESC
       LIMIT ?`,
      [boundedLimit],
    );
    return attachAuthorsAndTags(db, recent);
  }
  if (tokens.length === 0) return [];

  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const token of tokens) {
    const pattern = `%${escapeLikePattern(token)}%`;
    clauses.push(`(
      LOWER(w.title) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(w.abstract, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(w.venue_name, '')) LIKE ? ESCAPE '\\'
      OR CAST(w.year AS TEXT) LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM work_authors swa
        JOIN authors sa ON sa.id = swa.author_id
        WHERE swa.work_id = w.id
          AND LOWER(sa.display_name) LIKE ? ESCAPE '\\'
      )
      OR EXISTS (
        SELECT 1
        FROM work_tags swt
        JOIN tags st ON st.id = swt.tag_id AND st.deleted_at IS NULL
        WHERE swt.work_id = w.id
          AND LOWER(st.name) LIKE ? ESCAPE '\\'
      )
    )`);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const phrase = escapeLikePattern(normalized);
  const prefix = `${phrase}%`;
  const rows = await db.query<WorkRow>(
    `SELECT w.* FROM works w
     WHERE w.deleted_at IS NULL
       AND ${clauses.join(" AND ")}
     ORDER BY
       CASE
         WHEN LOWER(w.title) = ? THEN 0
         WHEN LOWER(w.title) LIKE ? ESCAPE '\\' THEN 1
         WHEN EXISTS (
           SELECT 1
           FROM work_authors owa
           JOIN authors oa ON oa.id = owa.author_id
           WHERE owa.work_id = w.id
             AND LOWER(oa.display_name) LIKE ? ESCAPE '\\'
         ) THEN 2
         WHEN EXISTS (
           SELECT 1
           FROM work_tags owt
           JOIN tags ot ON ot.id = owt.tag_id AND ot.deleted_at IS NULL
           WHERE owt.work_id = w.id
             AND LOWER(ot.name) LIKE ? ESCAPE '\\'
         ) THEN 3
         WHEN LOWER(COALESCE(w.venue_name, '')) LIKE ? ESCAPE '\\' THEN 4
         WHEN CAST(w.year AS TEXT) LIKE ? ESCAPE '\\' THEN 5
         ELSE 6
       END,
       w.starred DESC,
       w.updated_at DESC
     LIMIT ?`,
    [...params, normalized, prefix, prefix, prefix, prefix, prefix, boundedLimit],
  );
  return attachAuthorsAndTags(db, rows);
}

export async function listWorks(
  db: Database,
  options: WorkListOptions = {},
): Promise<WorkWithAuthors[]> {
  const limit = options.limit ?? 200;
  const collectionJoin = options.collectionId
    ? `JOIN collection_items ci ON ci.work_id = w.id AND ci.collection_id = ?
       JOIN collections c ON c.id = ci.collection_id AND c.deleted_at IS NULL`
    : "";
  const collectionParams = options.collectionId ? [options.collectionId] : [];
  const searchQuery = options.search?.trim() ? buildWorksFtsQuery(options.search) : null;
  const rows = options.search?.trim()
    ? searchQuery
      ? await db.query<WorkRow>(
          `SELECT w.* FROM works w
           JOIN works_fts f ON f.rowid = w.rowid
           ${collectionJoin}
           WHERE works_fts MATCH ? AND w.deleted_at IS NULL
           ORDER BY rank LIMIT ?`,
          [...collectionParams, searchQuery, limit],
        )
      : []
    : await db.query<WorkRow>(
        `SELECT w.* FROM works w
         ${collectionJoin}
         WHERE w.deleted_at IS NULL ORDER BY w.created_at DESC LIMIT ?`,
        [...collectionParams, limit],
      );
  return attachAuthors(db, rows);
}

export async function citationCountsForWorks(
  db: Database,
  workIds: string[],
): Promise<Map<string, WorkCitationCounts>> {
  const ids = [...new Set(workIds)];
  const counts = new Map<string, WorkCitationCounts>(
    ids.map((id) => [id, { references: 0, citedBy: 0 }]),
  );
  if (ids.length === 0) return counts;

  const placeholders = ids.map(() => "?").join(",");
  const [referenceRows, citedByRows] = await Promise.all([
    db.query<{ work_id: string; count: number }>(
      `SELECT c.citing_work_id AS work_id, COUNT(*) AS count
       FROM citations c
       JOIN works source ON source.id = c.citing_work_id AND source.deleted_at IS NULL
       JOIN works target ON target.id = c.cited_work_id AND target.deleted_at IS NULL
       WHERE c.citing_work_id IN (${placeholders})
       GROUP BY c.citing_work_id`,
      ids,
    ),
    db.query<{ work_id: string; count: number }>(
      `SELECT c.cited_work_id AS work_id, COUNT(*) AS count
       FROM citations c
       JOIN works source ON source.id = c.citing_work_id AND source.deleted_at IS NULL
       JOIN works target ON target.id = c.cited_work_id AND target.deleted_at IS NULL
       WHERE c.cited_work_id IN (${placeholders})
       GROUP BY c.cited_work_id`,
      ids,
    ),
  ]);

  for (const row of referenceRows) {
    const count = counts.get(row.work_id);
    if (count) count.references = Number(row.count);
  }
  for (const row of citedByRows) {
    const count = counts.get(row.work_id);
    if (count) count.citedBy = Number(row.count);
  }
  return counts;
}

export async function listDeletedWorks(
  db: Database,
  options: Pick<WorkListOptions, "search" | "limit"> = {},
): Promise<WorkWithAuthors[]> {
  const limit = options.limit ?? 200;
  const searchQuery = options.search?.trim() ? buildWorksFtsQuery(options.search) : null;
  const rows = options.search?.trim()
    ? searchQuery
      ? await db.query<WorkRow>(
          `SELECT w.* FROM works w
           JOIN works_fts f ON f.rowid = w.rowid
           WHERE works_fts MATCH ? AND w.deleted_at IS NOT NULL
           ORDER BY rank LIMIT ?`,
          [searchQuery, limit],
        )
      : []
    : await db.query<WorkRow>(
        `SELECT w.* FROM works w
         WHERE w.deleted_at IS NOT NULL ORDER BY w.deleted_at DESC, w.updated_at DESC LIMIT ?`,
        [limit],
      );
  return attachAuthors(db, rows);
}

export type { WorkRow, WorkWithAuthors };
