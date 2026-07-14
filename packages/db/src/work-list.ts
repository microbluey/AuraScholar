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
