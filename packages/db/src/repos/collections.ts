// Folders for the library. UX is single-folder-per-work (like a file system),
// enforced by delete-then-insert even though the join table allows many.
import type { Database } from "../database";
import { newId } from "../ids";

export interface CollectionRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

export class CollectionsRepo {
  constructor(private readonly db: Database) {}

  async create(name: string, parentId?: string): Promise<string> {
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO collections (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      [id, name, parentId ?? null, now, now],
    );
    return id;
  }

  async list(): Promise<CollectionRow[]> {
    return this.db.query<CollectionRow>(
      `SELECT id, name, parent_id, sort_order FROM collections WHERE deleted_at IS NULL ORDER BY name`,
    );
  }

  async rename(id: string, name: string): Promise<void> {
    await this.db.run(`UPDATE collections SET name = ?, updated_at = ? WHERE id = ?`, [
      name,
      Date.now(),
      id,
    ]);
  }

  /** Folder is removed; its works fall back to 全部文献 (items cleared). */
  async softDelete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM collection_items WHERE collection_id = ?`, [id]);
    await this.db.run(`UPDATE collections SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      id,
    ]);
  }

  /** Moves a work to a folder (null = remove from all folders). */
  async setWorkCollection(workId: string, collectionId: string | null): Promise<void> {
    await this.db.run(`DELETE FROM collection_items WHERE work_id = ?`, [workId]);
    if (collectionId) {
      await this.db.run(
        `INSERT INTO collection_items (collection_id, work_id) VALUES (?, ?)`,
        [collectionId, workId],
      );
    }
  }

  async collectionOf(workId: string): Promise<string | null> {
    const rows = await this.db.query<{ collection_id: string }>(
      `SELECT collection_id FROM collection_items WHERE work_id = ? LIMIT 1`,
      [workId],
    );
    return rows[0]?.collection_id ?? null;
  }

  /** workId → collectionId for a batch (library list rendering). */
  async collectionsOf(workIds: string[]): Promise<Map<string, string>> {
    if (workIds.length === 0) return new Map();
    const placeholders = workIds.map(() => "?").join(",");
    const rows = await this.db.query<{ work_id: string; collection_id: string }>(
      `SELECT work_id, collection_id FROM collection_items WHERE work_id IN (${placeholders})`,
      workIds,
    );
    return new Map(rows.map((r) => [r.work_id, r.collection_id]));
  }
}
