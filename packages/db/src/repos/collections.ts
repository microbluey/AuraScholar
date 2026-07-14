// Folders for the library. UX is single-folder-per-work (like a file system),
// enforced by delete-then-insert even though the join table allows many.
import type { Database } from "../database.js";
import { newId } from "../ids.js";

export interface CollectionRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  count: number;
}

export interface SetWorksCollectionOptions {
  afterEach?: (workId: string, index: number) => void | Promise<void>;
}

const collectionWriteQueues = new WeakMap<Database, Promise<void>>();

export class CollectionsRepo {
  constructor(private readonly db: Database) {}

  private async withSavepoint<T>(name: string, fn: () => Promise<T>): Promise<T> {
    await this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await this.db.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (e) {
      try {
        await this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      } finally {
        try {
          await this.db.exec(`RELEASE SAVEPOINT ${name}`);
        } catch {
          // Keep the original write error; cleanup can fail if SQLite already
          // unwound the savepoint.
        }
      }
      throw e;
    }
  }

  private assertChanged(changed: number, message: string): void {
    if (changed === 0) throw new Error(message);
  }

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = collectionWriteQueues.get(this.db) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    collectionWriteQueues.set(
      this.db,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async assertActiveWork(workId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM works WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [workId],
    );
    if (!rows[0]) throw new Error(`Work ${workId} is missing or removed`);
  }

  private async assertActiveCollection(collectionId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM collections WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [collectionId],
    );
    if (!rows[0]) throw new Error(`Collection ${collectionId} is missing or removed`);
  }

  async create(name: string, parentId?: string): Promise<string> {
    return this.withWriteLock(() => this.createUnlocked(name, parentId));
  }

  private async createUnlocked(name: string, parentId?: string): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("分组名称不能为空");
    if (parentId) await this.assertActiveCollection(parentId);
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO collections (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      [id, trimmed, parentId ?? null, now, now],
    );
    return id;
  }

  async list(): Promise<CollectionRow[]> {
    return this.db.query<CollectionRow>(
      `SELECT c.id, c.name, c.parent_id, c.sort_order, COUNT(w.id) AS count
       FROM collections c
       LEFT JOIN collection_items ci ON ci.collection_id = c.id
       LEFT JOIN works w ON w.id = ci.work_id AND w.deleted_at IS NULL
       WHERE c.deleted_at IS NULL
       GROUP BY c.id, c.name, c.parent_id, c.sort_order
       ORDER BY c.name`,
    );
  }

  async rename(id: string, name: string): Promise<void> {
    return this.withWriteLock(() => this.renameUnlocked(id, name));
  }

  private async renameUnlocked(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("分组名称不能为空");
    const changed = await this.db.run(
      `UPDATE collections SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [trimmed, Date.now(), id],
    );
    this.assertChanged(changed, `Collection ${id} is missing or removed`);
  }

  /** Folder is removed; its works fall back to 全部文献 (items cleared). */
  async softDelete(id: string): Promise<void> {
    return this.withWriteLock(() => this.softDeleteUnlocked(id));
  }

  private async softDeleteUnlocked(id: string): Promise<void> {
    await this.withSavepoint(`collections_soft_delete_${newId().replace(/-/g, "_")}`, async () => {
      const changed = await this.db.run(
        `UPDATE collections SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [Date.now(), Date.now(), id],
      );
      this.assertChanged(changed, `Collection ${id} is missing or already removed`);
      await this.db.run(`DELETE FROM collection_items WHERE collection_id = ?`, [id]);
    });
  }

  async workIds(id: string): Promise<string[]> {
    const rows = await this.db.query<{ work_id: string }>(
      `SELECT ci.work_id
       FROM collection_items ci
       JOIN collections c ON c.id = ci.collection_id AND c.deleted_at IS NULL
       JOIN works w ON w.id = ci.work_id AND w.deleted_at IS NULL
       WHERE ci.collection_id = ?
       ORDER BY ci.work_id`,
      [id],
    );
    return rows.map((row) => row.work_id);
  }

  async restore(id: string, workIds: string[] = []): Promise<void> {
    return this.withWriteLock(() => this.restoreUnlocked(id, workIds));
  }

  private async restoreUnlocked(id: string, workIds: string[] = []): Promise<void> {
    await this.withSavepoint(`collections_restore_${newId().replace(/-/g, "_")}`, async () => {
      const changed = await this.db.run(
        `UPDATE collections SET deleted_at = NULL, updated_at = ?
         WHERE id = ? AND deleted_at IS NOT NULL`,
        [Date.now(), id],
      );
      this.assertChanged(changed, `Collection ${id} is missing or already active`);
      for (const workId of new Set(workIds)) {
        await this.assertActiveWork(workId);
        await this.db.run(`DELETE FROM collection_items WHERE work_id = ?`, [workId]);
        await this.db.run(
          `INSERT OR IGNORE INTO collection_items (collection_id, work_id) VALUES (?, ?)`,
          [id, workId],
        );
      }
    });
  }

  /** Moves a work to a folder (null = remove from all folders). */
  async setWorkCollection(workId: string, collectionId: string | null): Promise<void> {
    return this.withWriteLock(() => this.setWorkCollectionInSavepoint(workId, collectionId));
  }

  async setWorksCollection(
    workIds: string[],
    collectionId: string | null,
    options: SetWorksCollectionOptions = {},
  ): Promise<number> {
    return this.withWriteLock(() => this.setWorksCollectionUnlocked(workIds, collectionId, options));
  }

  private async setWorksCollectionUnlocked(
    workIds: string[],
    collectionId: string | null,
    options: SetWorksCollectionOptions = {},
  ): Promise<number> {
    const uniqueWorkIds = [...new Set(workIds)];
    if (uniqueWorkIds.length === 0) return 0;
    await this.withSavepoint(`collections_set_works_${newId().replace(/-/g, "_")}`, async () => {
      if (collectionId) await this.assertActiveCollection(collectionId);
      for (let index = 0; index < uniqueWorkIds.length; index += 1) {
        const workId = uniqueWorkIds[index]!;
        await this.setWorkCollectionUnlocked(workId, collectionId, { collectionChecked: true });
        await options.afterEach?.(workId, index);
      }
    });
    return uniqueWorkIds.length;
  }

  private async setWorkCollectionInSavepoint(
    workId: string,
    collectionId: string | null,
  ): Promise<void> {
    await this.withSavepoint(`collections_set_work_${newId().replace(/-/g, "_")}`, async () => {
      await this.setWorkCollectionUnlocked(workId, collectionId);
    });
  }

  private async setWorkCollectionUnlocked(
    workId: string,
    collectionId: string | null,
    options: { collectionChecked?: boolean } = {},
  ): Promise<void> {
    await this.assertActiveWork(workId);
    if (collectionId && !options.collectionChecked) await this.assertActiveCollection(collectionId);
    await this.db.run(`DELETE FROM collection_items WHERE work_id = ?`, [workId]);
    if (collectionId) {
      await this.db.run(`INSERT INTO collection_items (collection_id, work_id) VALUES (?, ?)`, [
        collectionId,
        workId,
      ]);
    }
  }

  async collectionOf(workId: string): Promise<string | null> {
    const rows = await this.db.query<{ collection_id: string }>(
      `SELECT ci.collection_id
       FROM collection_items ci
       JOIN collections c ON c.id = ci.collection_id AND c.deleted_at IS NULL
       JOIN works w ON w.id = ci.work_id AND w.deleted_at IS NULL
       WHERE ci.work_id = ?
       LIMIT 1`,
      [workId],
    );
    return rows[0]?.collection_id ?? null;
  }

  /** workId → collectionId for a batch (library list rendering). */
  async collectionsOf(workIds: string[]): Promise<Map<string, string>> {
    if (workIds.length === 0) return new Map();
    const placeholders = workIds.map(() => "?").join(",");
    const rows = await this.db.query<{ work_id: string; collection_id: string }>(
      `SELECT ci.work_id, ci.collection_id
       FROM collection_items ci
       JOIN collections c ON c.id = ci.collection_id AND c.deleted_at IS NULL
       JOIN works w ON w.id = ci.work_id AND w.deleted_at IS NULL
       WHERE ci.work_id IN (${placeholders})`,
      workIds,
    );
    return new Map(rows.map((r) => [r.work_id, r.collection_id]));
  }
}
