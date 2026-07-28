// Folders for the library. UX is single-folder-per-work (like a file system),
// enforced by delete-then-insert even though the join table allows many.
import type { Database } from "../database.js";
import { newId } from "../ids.js";
import {
  restoreCollectionMemberships,
  type RestoreCollectionMembershipResult,
} from "./collection-membership.js";
import { withDatabaseWriteLock } from "./write-lock.js";

export interface CollectionRow {
  id: string;
  library_id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  count: number;
}

export interface DeleteCollectionResult {
  workIds: string[];
}

export type RestoreCollectionResult = RestoreCollectionMembershipResult;

export class CollectionsRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    if (!libraryId.trim()) throw new Error("libraryId must be a non-empty string");
  }

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
    return withDatabaseWriteLock(this.db, fn);
  }

  private async assertActiveWork(workId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id
       FROM works
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [workId, this.libraryId],
    );
    if (!rows[0]) throw new Error(`Work ${workId} is missing or removed`);
  }

  private async assertActiveCollection(collectionId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id
       FROM collections
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [collectionId, this.libraryId],
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
    const nextOrderRows = await this.db.query<{ next_order: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
       FROM collections
       WHERE library_id = ? AND deleted_at IS NULL AND parent_id IS ?`,
      [this.libraryId, parentId ?? null],
    );
    const changed = await this.db.run(
      `INSERT INTO collections
         (id, library_id, name, parent_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, this.libraryId, trimmed, parentId ?? null, nextOrderRows[0]?.next_order ?? 0, now, now],
    );
    this.assertChanged(changed, `Collection "${trimmed}" was not created`);
    return id;
  }

  async list(): Promise<CollectionRow[]> {
    return this.db.query<CollectionRow>(
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
      [this.libraryId],
    );
  }

  /** Moves a folder within the tree. position is zero-based among the target siblings. */
  async move(id: string, parentId: string | null, position: number): Promise<void> {
    return this.withWriteLock(() => this.moveUnlocked(id, parentId, position));
  }

  private async moveUnlocked(id: string, parentId: string | null, position: number): Promise<void> {
    await this.withSavepoint(`collections_move_${newId().replace(/-/g, "_")}`, async () => {
      const rows = await this.db.query<{
        id: string;
        name: string;
        parent_id: string | null;
        sort_order: number;
      }>(
        `SELECT id, name, parent_id, sort_order
         FROM collections
         WHERE library_id = ? AND deleted_at IS NULL
         ORDER BY sort_order, name, id`,
        [this.libraryId],
      );
      const byId = new Map(rows.map((row) => [row.id, row]));
      const moving = byId.get(id);
      if (!moving) throw new Error(`Collection ${id} is missing or removed`);
      if (parentId === id) throw new Error("文件夹不能移动到自身");
      if (parentId && !byId.has(parentId)) {
        throw new Error(`Collection ${parentId} is missing or removed`);
      }

      let cursor = parentId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) throw new Error("文件夹不能移动到自己的子文件夹中");
        if (seen.has(cursor)) throw new Error("文件夹层级存在循环");
        seen.add(cursor);
        cursor = byId.get(cursor)?.parent_id ?? null;
      }

      const targetSiblings = rows.filter((row) => row.id !== id && row.parent_id === parentId);
      const targetPosition = Math.max(
        0,
        Math.min(
          Number.isFinite(position) ? Math.trunc(position) : targetSiblings.length,
          targetSiblings.length,
        ),
      );
      targetSiblings.splice(targetPosition, 0, { ...moving, parent_id: parentId });

      const previousSiblings =
        moving.parent_id === parentId
          ? []
          : rows.filter((row) => row.id !== id && row.parent_id === moving.parent_id);
      const now = Date.now();
      for (const [index, row] of previousSiblings.entries()) {
        const changed = await this.db.run(
          `UPDATE collections
           SET sort_order = ?, updated_at = ?
           WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
          [index, now, row.id, this.libraryId],
        );
        this.assertChanged(changed, `Collection ${row.id} was not reordered`);
      }
      for (const [index, row] of targetSiblings.entries()) {
        const changed = await this.db.run(
          `UPDATE collections
           SET parent_id = ?, sort_order = ?, updated_at = ?
           WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
          [parentId, index, now, row.id, this.libraryId],
        );
        this.assertChanged(changed, `Collection ${row.id} was not moved`);
      }
    });
  }

  async rename(id: string, name: string): Promise<void> {
    return this.withWriteLock(() => this.renameUnlocked(id, name));
  }

  private async renameUnlocked(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("分组名称不能为空");
    const changed = await this.db.run(
      `UPDATE collections
       SET name = ?, updated_at = ?
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
      [trimmed, Date.now(), id, this.libraryId],
    );
    this.assertChanged(changed, `Collection ${id} is missing or removed`);
  }

  /** Folder is removed; its works fall back to 全部文献 (items cleared). */
  async softDelete(id: string): Promise<DeleteCollectionResult> {
    return this.withWriteLock(() => this.softDeleteUnlocked(id));
  }

  private async softDeleteUnlocked(id: string): Promise<DeleteCollectionResult> {
    return this.withSavepoint(`collections_soft_delete_${newId().replace(/-/g, "_")}`, async () => {
      const targetRows = await this.db.query<{ parent_id: string | null }>(
        `SELECT parent_id
           FROM collections
           WHERE id = ? AND library_id = ? AND deleted_at IS NULL
           LIMIT 1`,
        [id, this.libraryId],
      );
      const target = targetRows[0];
      if (!target) throw new Error(`Collection ${id} is missing or already removed`);
      const children = await this.db.query<{ id: string }>(
        `SELECT id
           FROM collections
           WHERE library_id = ? AND parent_id = ? AND deleted_at IS NULL
           ORDER BY sort_order, name, id`,
        [this.libraryId, id],
      );
      if (children.length > 0) {
        throw new Error("请先移动或删除此文件夹中的子文件夹");
      }
      const workRows = await this.db.query<{ work_id: string }>(
        `SELECT ci.work_id
           FROM collection_items ci
           JOIN collections c
             ON c.id = ci.collection_id
            AND c.library_id = ?
            AND c.deleted_at IS NULL
           JOIN works w
             ON w.id = ci.work_id
            AND w.library_id = c.library_id
           WHERE ci.collection_id = ?
           ORDER BY ci.work_id`,
        [this.libraryId, id],
      );
      const changed = await this.db.run(
        `UPDATE collections SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
        [Date.now(), Date.now(), id, this.libraryId],
      );
      this.assertChanged(changed, `Collection ${id} is missing or already removed`);
      await this.db.run(
        `DELETE FROM collection_items
         WHERE collection_id = ?
           AND EXISTS (
             SELECT 1 FROM collections
             WHERE id = ? AND library_id = ?
           )`,
        [id, id, this.libraryId],
      );
      const remainingItems = await this.db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?`,
        [id],
      );
      if ((remainingItems[0]?.n ?? 0) !== 0) {
        throw new Error("Collection deletion did not remove every work association");
      }
      const remainingSiblings = await this.db.query<{ id: string }>(
        `SELECT id
           FROM collections
           WHERE library_id = ? AND deleted_at IS NULL AND parent_id IS ?
           ORDER BY sort_order, name, id`,
        [this.libraryId, target.parent_id],
      );
      const now = Date.now();
      for (const [index, sibling] of remainingSiblings.entries()) {
        const reordered = await this.db.run(
          `UPDATE collections
             SET sort_order = ?, updated_at = ?
             WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
          [index, now, sibling.id, this.libraryId],
        );
        this.assertChanged(reordered, `Collection ${sibling.id} was not reordered after deletion`);
      }
      return { workIds: workRows.map((row) => row.work_id) };
    });
  }

  async workIds(id: string): Promise<string[]> {
    const rows = await this.db.query<{ work_id: string }>(
      `SELECT ci.work_id
       FROM collection_items ci
       JOIN collections c
         ON c.id = ci.collection_id
        AND c.library_id = ?
        AND c.deleted_at IS NULL
       JOIN works w
         ON w.id = ci.work_id
        AND w.library_id = c.library_id
        AND w.deleted_at IS NULL
       WHERE ci.collection_id = ?
       ORDER BY ci.work_id`,
      [this.libraryId, id],
    );
    return rows.map((row) => row.work_id);
  }

  async restore(id: string, workIds: string[] = []): Promise<RestoreCollectionResult> {
    return this.withWriteLock(() => this.restoreUnlocked(id, workIds));
  }

  private async restoreUnlocked(
    id: string,
    workIds: string[] = [],
  ): Promise<RestoreCollectionResult> {
    return this.withSavepoint(`collections_restore_${newId().replace(/-/g, "_")}`, async () => {
      const targetRows = await this.db.query<{ parent_id: string | null }>(
        `SELECT parent_id
         FROM collections
         WHERE id = ? AND library_id = ? AND deleted_at IS NOT NULL
         LIMIT 1`,
        [id, this.libraryId],
      );
      const target = targetRows[0];
      if (!target) throw new Error(`Collection ${id} is missing or already active`);
      const parentRows = target.parent_id
        ? await this.db.query<{ id: string }>(
            `SELECT id
             FROM collections
             WHERE id = ? AND library_id = ? AND deleted_at IS NULL
             LIMIT 1`,
            [target.parent_id, this.libraryId],
          )
        : [];
      const parentId = parentRows[0] ? target.parent_id : null;
      const nextOrderRows = await this.db.query<{ next_order: number }>(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
         FROM collections
         WHERE library_id = ? AND deleted_at IS NULL AND parent_id IS ?`,
        [this.libraryId, parentId],
      );
      const changed = await this.db.run(
        `UPDATE collections
         SET deleted_at = NULL, parent_id = ?, sort_order = ?, updated_at = ?
         WHERE id = ? AND library_id = ? AND deleted_at IS NOT NULL`,
        [parentId, nextOrderRows[0]?.next_order ?? 0, Date.now(), id, this.libraryId],
      );
      this.assertChanged(changed, `Collection ${id} is missing or already active`);
      return restoreCollectionMemberships(this.db, this.libraryId, id, workIds);
    });
  }

  /** Moves a work to a folder (null = remove from all folders). */
  async setWorkCollection(workId: string, collectionId: string | null): Promise<void> {
    return this.withWriteLock(() => this.setWorkCollectionInSavepoint(workId, collectionId));
  }

  async setWorksCollection(workIds: string[], collectionId: string | null): Promise<number> {
    return this.withWriteLock(() => this.setWorksCollectionUnlocked(workIds, collectionId));
  }

  private async setWorksCollectionUnlocked(
    workIds: string[],
    collectionId: string | null,
  ): Promise<number> {
    const uniqueWorkIds = [...new Set(workIds)];
    if (uniqueWorkIds.length === 0) return 0;
    await this.withSavepoint(`collections_set_works_${newId().replace(/-/g, "_")}`, async () => {
      if (collectionId) await this.assertActiveCollection(collectionId);
      for (const workId of uniqueWorkIds) {
        await this.setWorkCollectionUnlocked(workId, collectionId, { collectionChecked: true });
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
    const assignments = await this.db.query<{ collection_id: string }>(
      `SELECT collection_id
       FROM collection_items
       WHERE work_id = ?
       ORDER BY collection_id`,
      [workId],
    );
    const expected = collectionId ? [collectionId] : [];
    if (
      assignments.length !== expected.length ||
      assignments.some((row, index) => row.collection_id !== expected[index])
    ) {
      throw new Error(`Work ${workId} did not reach the requested collection state`);
    }
  }

  async collectionOf(workId: string): Promise<string | null> {
    const rows = await this.db.query<{ collection_id: string }>(
      `SELECT ci.collection_id
       FROM collection_items ci
       JOIN collections c
         ON c.id = ci.collection_id
        AND c.library_id = ?
        AND c.deleted_at IS NULL
       JOIN works w
         ON w.id = ci.work_id
        AND w.library_id = c.library_id
        AND w.deleted_at IS NULL
       WHERE ci.work_id = ?
       LIMIT 1`,
      [this.libraryId, workId],
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
       JOIN collections c
         ON c.id = ci.collection_id
        AND c.library_id = ?
        AND c.deleted_at IS NULL
       JOIN works w
         ON w.id = ci.work_id
        AND w.library_id = c.library_id
        AND w.deleted_at IS NULL
       WHERE ci.work_id IN (${placeholders})`,
      [this.libraryId, ...workIds],
    );
    return new Map(rows.map((r) => [r.work_id, r.collection_id]));
  }
}
