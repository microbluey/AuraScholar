import { getLibraryDb } from "./aura-db";

export interface LibraryShellCollection {
  count: number;
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

export interface LibraryShellStats {
  annotations: number;
  canvasNodes: number;
  collections: LibraryShellCollection[];
  snippets: number;
  total: number;
  trash: number;
}

interface CollectionStatsRow {
  count: number;
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

export async function loadLibraryShellStats(): Promise<LibraryShellStats> {
  const { db, libraryId } = await getLibraryDb();
  const [totalRows, trashRows, annotationRows, canvasNodeRows, snippetRows, collectionRows] =
    await Promise.all([
      db.query<{ n: number }>(
        `SELECT COUNT(*) AS n
       FROM works
       WHERE library_id = ? AND deleted_at IS NULL`,
        [libraryId],
      ),
      db.query<{ n: number }>(
        `SELECT COUNT(*) AS n
       FROM works
       WHERE library_id = ? AND deleted_at IS NOT NULL`,
        [libraryId],
      ),
      db.query<{ n: number }>(
        `SELECT COUNT(*) AS n
       FROM annotations a
       JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
       WHERE w.library_id = ? AND a.deleted_at IS NULL`,
        [libraryId],
      ),
      db.query<{ n: number }>(
        `SELECT COUNT(*) AS n
       FROM canvas_nodes n
       JOIN canvas_workspaces cw ON cw.id = n.workspace_id
       WHERE cw.library_id = ?`,
        [libraryId],
      ),
      db.query<{ n: number }>(
        `SELECT COUNT(*) AS n
       FROM snippets s
       JOIN works w ON w.id = s.work_id AND w.deleted_at IS NULL
       WHERE w.library_id = ? AND s.deleted_at IS NULL`,
        [libraryId],
      ),
      db.query<CollectionStatsRow>(
        `SELECT c.id, c.name, c.parent_id, c.sort_order, COUNT(w.id) AS count
       FROM collections c
       LEFT JOIN collection_items ci ON ci.collection_id = c.id
       LEFT JOIN works w
         ON w.id = ci.work_id
        AND w.library_id = c.library_id
        AND w.deleted_at IS NULL
       WHERE c.library_id = ? AND c.deleted_at IS NULL
       GROUP BY c.id, c.name, c.parent_id, c.sort_order
       ORDER BY c.sort_order, c.name, c.id`,
        [libraryId],
      ),
    ]);

  return {
    annotations: annotationRows[0]?.n ?? 0,
    canvasNodes: canvasNodeRows[0]?.n ?? 0,
    collections: collectionRows.map((collection) => ({
      count: collection.count,
      id: collection.id,
      name: collection.name,
      parentId: collection.parent_id,
      sortOrder: collection.sort_order,
    })),
    snippets: snippetRows[0]?.n ?? 0,
    total: totalRows[0]?.n ?? 0,
    trash: trashRows[0]?.n ?? 0,
  };
}
