import type { Database } from "./database";
import type { WorkRow, WorkWithAuthors } from "./repos/works";

export interface WorkListOptions {
  search?: string;
  limit?: number;
  collectionId?: string;
}

function ftsQuery(search: string): string {
  return search
    .trim()
    .split(/\s+/)
    .map((token) => `"${token.replace(/"/g, "")}"*`)
    .join(" ");
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
    ? `JOIN collection_items ci ON ci.work_id = w.id AND ci.collection_id = ?`
    : "";
  const collectionParams = options.collectionId ? [options.collectionId] : [];
  const rows = options.search?.trim()
    ? await db.query<WorkRow>(
        `SELECT w.* FROM works w
         JOIN works_fts f ON f.rowid = w.rowid
         ${collectionJoin}
         WHERE works_fts MATCH ? AND w.deleted_at IS NULL
         ORDER BY rank LIMIT ?`,
        [...collectionParams, ftsQuery(options.search), limit],
      )
    : await db.query<WorkRow>(
        `SELECT w.* FROM works w
         ${collectionJoin}
         WHERE w.deleted_at IS NULL ORDER BY w.created_at DESC LIMIT ?`,
        [...collectionParams, limit],
      );
  return attachAuthors(db, rows);
}

export async function listDeletedWorks(
  db: Database,
  options: Pick<WorkListOptions, "search" | "limit"> = {},
): Promise<WorkWithAuthors[]> {
  const limit = options.limit ?? 200;
  const rows = options.search?.trim()
    ? await db.query<WorkRow>(
        `SELECT w.* FROM works w
         JOIN works_fts f ON f.rowid = w.rowid
         WHERE works_fts MATCH ? AND w.deleted_at IS NOT NULL
         ORDER BY rank LIMIT ?`,
        [ftsQuery(options.search), limit],
      )
    : await db.query<WorkRow>(
        `SELECT w.* FROM works w
         WHERE w.deleted_at IS NOT NULL ORDER BY w.deleted_at DESC, w.updated_at DESC LIMIT ?`,
        [limit],
      );
  return attachAuthors(db, rows);
}

export type { WorkRow, WorkWithAuthors };
