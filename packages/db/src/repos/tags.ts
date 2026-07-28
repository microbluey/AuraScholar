// Tags for the library. Unlike collections (single-folder-per-work), a work can
// carry many tags. Tag names are unique (tags_name_uq); create() upserts by name
// so the same label never splits into two rows.
import type { Database } from "../database.js";
import { newId } from "../ids.js";
import { withDatabaseWriteLock } from "./write-lock.js";

export interface TagRow {
  id: string;
  library_id: string;
  name: string;
  color: string | null;
  count: number;
}

interface TagIdentityRow {
  id: string;
  deleted_at: number | null;
}

export class TagsRepo {
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
          // Keep the original write error if cleanup has already been unwound.
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

  private async assertActive(id: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id
       FROM tags
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [id, this.libraryId],
    );
    if (!rows[0]) throw new Error(`Tag ${id} is missing or removed`);
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

  /** All tags with how many (non-deleted) works carry each. */
  async list(): Promise<TagRow[]> {
    return this.db.query<TagRow>(
      `SELECT t.id, t.library_id, t.name, t.color, COUNT(w.id) AS count
       FROM tags t
       LEFT JOIN work_tags wt ON wt.tag_id = t.id
       LEFT JOIN works w
         ON w.id = wt.work_id
        AND w.library_id = t.library_id
        AND w.deleted_at IS NULL
       WHERE t.library_id = ? AND t.deleted_at IS NULL
       GROUP BY t.id, t.library_id, t.name, t.color
       ORDER BY count DESC, t.name`,
      [this.libraryId],
    );
  }

  /** Upsert by name: returns the existing tag id, or creates a fresh one. */
  async ensure(name: string, color?: string): Promise<string> {
    return this.withWriteLock(() => this.ensureUnlocked(name, color));
  }

  private async ensureUnlocked(name: string, color?: string): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("标签名称不能为空");
    const existing = await this.db.query<TagIdentityRow>(
      `SELECT id, deleted_at
       FROM tags
       WHERE library_id = ? AND name = ?
       LIMIT 1`,
      [this.libraryId, trimmed],
    );
    if (existing[0]) {
      if (existing[0].deleted_at !== null) {
        const changed = await this.db.run(
          `UPDATE tags
           SET deleted_at = NULL, color = COALESCE(?, color), updated_at = ?
           WHERE id = ? AND library_id = ? AND deleted_at IS NOT NULL`,
          [color ?? null, Date.now(), existing[0].id, this.libraryId],
        );
        this.assertChanged(changed, `Tag ${existing[0].id} is missing or already active`);
      }
      return existing[0].id;
    }
    const id = newId();
    const now = Date.now();
    const changed = await this.db.run(
      `INSERT INTO tags (id, library_id, name, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, this.libraryId, trimmed, color ?? null, now, now],
    );
    this.assertChanged(changed, `Tag "${trimmed}" was not created`);
    return id;
  }

  async rename(id: string, name: string): Promise<string> {
    return this.withWriteLock(() => this.renameUnlocked(id, name));
  }

  private async renameUnlocked(id: string, name: string): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("标签名称不能为空");
    const now = Date.now();
    const conflict = await this.db.query<TagIdentityRow>(
      `SELECT id, deleted_at
       FROM tags
       WHERE library_id = ? AND name = ?
       LIMIT 1`,
      [this.libraryId, trimmed],
    );
    const mergeTarget = conflict[0];
    if (mergeTarget && mergeTarget.id !== id) {
      await this.withSavepoint(`tags_rename_merge_${newId().replace(/-/g, "_")}`, async () => {
        await this.assertActive(id);
        if (mergeTarget.deleted_at !== null) {
          const restored = await this.db.run(
            `UPDATE tags SET deleted_at = NULL, updated_at = ?
             WHERE id = ? AND library_id = ? AND deleted_at IS NOT NULL`,
            [now, mergeTarget.id, this.libraryId],
          );
          this.assertChanged(restored, `Tag ${mergeTarget.id} is missing or already active`);
        }
        await this.db.run(
          `INSERT OR IGNORE INTO work_tags (work_id, tag_id)
           SELECT wt.work_id, ?
           FROM work_tags wt
           JOIN works w
             ON w.id = wt.work_id
            AND w.library_id = ?
           WHERE wt.tag_id = ?`,
          [mergeTarget.id, this.libraryId, id],
        );
        const missingLinks = await this.db.query<{ n: number }>(
          `SELECT COUNT(*) AS n
           FROM work_tags source
           JOIN works w
             ON w.id = source.work_id
            AND w.library_id = ?
           WHERE source.tag_id = ?
             AND NOT EXISTS (
               SELECT 1
               FROM work_tags target
               WHERE target.work_id = source.work_id
                 AND target.tag_id = ?
             )`,
          [this.libraryId, id, mergeTarget.id],
        );
        if ((missingLinks[0]?.n ?? 0) !== 0) {
          throw new Error("Tag merge did not preserve every work association");
        }
        await this.db.run(
          `DELETE FROM work_tags
           WHERE tag_id = ?
             AND EXISTS (
               SELECT 1 FROM tags
               WHERE id = ? AND library_id = ?
             )`,
          [id, id, this.libraryId],
        );
        const remainingLinks = await this.db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM work_tags WHERE tag_id = ?`,
          [id],
        );
        if ((remainingLinks[0]?.n ?? 0) !== 0) {
          throw new Error("Tag merge did not retire every source association");
        }
        const retired = await this.db.run(
          `UPDATE tags SET deleted_at = ?, updated_at = ?
           WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
          [now, now, id, this.libraryId],
        );
        this.assertChanged(retired, `Tag ${id} is missing or removed`);
      });
      return mergeTarget.id;
    }
    const changed = await this.db.run(
      `UPDATE tags
       SET name = ?, updated_at = ?
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
      [trimmed, now, id, this.libraryId],
    );
    this.assertChanged(changed, `Tag ${id} is missing or removed`);
    return id;
  }

  async setColor(id: string, color: string | null): Promise<void> {
    return this.withWriteLock(() => this.setColorUnlocked(id, color));
  }

  private async setColorUnlocked(id: string, color: string | null): Promise<void> {
    const changed = await this.db.run(
      `UPDATE tags
       SET color = ?, updated_at = ?
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
      [color, Date.now(), id, this.libraryId],
    );
    this.assertChanged(changed, `Tag ${id} is missing or removed`);
  }

  /** Removes the tag and all its work associations. */
  async softDelete(id: string): Promise<string[]> {
    return this.withWriteLock(() => this.softDeleteUnlocked(id));
  }

  private async softDeleteUnlocked(id: string): Promise<string[]> {
    return this.withSavepoint(`tags_soft_delete_${newId().replace(/-/g, "_")}`, async () => {
      const workRows = await this.db.query<{ work_id: string }>(
        `SELECT wt.work_id
         FROM work_tags wt
         JOIN tags t
           ON t.id = wt.tag_id
          AND t.library_id = ?
          AND t.deleted_at IS NULL
         JOIN works w
           ON w.id = wt.work_id
          AND w.library_id = t.library_id
         WHERE wt.tag_id = ?
         ORDER BY wt.work_id`,
        [this.libraryId, id],
      );
      const workIds = workRows.map((row) => row.work_id);
      const changed = await this.db.run(
        `UPDATE tags SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
        [Date.now(), Date.now(), id, this.libraryId],
      );
      this.assertChanged(changed, `Tag ${id} is missing or already removed`);
      await this.db.run(
        `DELETE FROM work_tags
         WHERE tag_id = ?
           AND EXISTS (
             SELECT 1 FROM tags
             WHERE id = ? AND library_id = ?
           )`,
        [id, id, this.libraryId],
      );
      const remainingLinks = await this.db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM work_tags WHERE tag_id = ?`,
        [id],
      );
      if ((remainingLinks[0]?.n ?? 0) !== 0) {
        throw new Error("Tag deletion did not remove every work association");
      }
      return workIds;
    });
  }

  async workIds(id: string): Promise<string[]> {
    const rows = await this.db.query<{ work_id: string }>(
      `SELECT wt.work_id
       FROM work_tags wt
       JOIN tags t ON t.id = wt.tag_id AND t.library_id = ? AND t.deleted_at IS NULL
       JOIN works w
         ON w.id = wt.work_id
        AND w.library_id = t.library_id
        AND w.deleted_at IS NULL
       WHERE wt.tag_id = ?
       ORDER BY wt.work_id`,
      [this.libraryId, id],
    );
    return rows.map((row) => row.work_id);
  }

  async restore(id: string, workIds: string[] = []): Promise<number> {
    return this.withWriteLock(() => this.restoreUnlocked(id, workIds));
  }

  private async restoreUnlocked(id: string, workIds: string[] = []): Promise<number> {
    return this.withSavepoint(`tags_restore_${newId().replace(/-/g, "_")}`, async () => {
      const changed = await this.db.run(
        `UPDATE tags SET deleted_at = NULL, updated_at = ?
         WHERE id = ? AND library_id = ? AND deleted_at IS NOT NULL`,
        [Date.now(), id, this.libraryId],
      );
      this.assertChanged(changed, `Tag ${id} is missing or already active`);
      let restored = 0;
      for (const workId of new Set(workIds)) {
        const workRows = await this.db.query<{ library_id: string }>(
          `SELECT library_id
           FROM works
           WHERE id = ?
           LIMIT 1`,
          [workId],
        );
        const work = workRows[0];
        if (!work) continue;
        if (work.library_id !== this.libraryId) {
          throw new Error(`Work ${workId} belongs to another Library`);
        }
        await this.db.run(`INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)`, [
          workId,
          id,
        ]);
        const link = await this.db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM work_tags WHERE work_id = ? AND tag_id = ?`,
          [workId, id],
        );
        if ((link[0]?.n ?? 0) !== 1) {
          throw new Error(`Tag ${id} was not restored to work ${workId}`);
        }
        restored += 1;
      }
      return restored;
    });
  }

  /** Attaches a tag (by name, upserting) to many works. Idempotent. */
  async addToWorks(workIds: string[], tagName: string): Promise<string | null> {
    if (workIds.length === 0) return null;
    return this.withWriteLock(() => this.addToWorksUnlocked(workIds, tagName));
  }

  private async addToWorksUnlocked(workIds: string[], tagName: string): Promise<string> {
    return this.withSavepoint(`tags_add_to_works_${newId().replace(/-/g, "_")}`, async () => {
      const tagId = await this.ensureUnlocked(tagName);
      const uniqueWorkIds = [...new Set(workIds)];
      for (const workId of uniqueWorkIds) {
        await this.assertActiveWork(workId);
        await this.db.run(`INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)`, [
          workId,
          tagId,
        ]);
        const link = await this.db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM work_tags WHERE work_id = ? AND tag_id = ?`,
          [workId, tagId],
        );
        if ((link[0]?.n ?? 0) !== 1) {
          throw new Error(`Tag ${tagId} was not assigned to work ${workId}`);
        }
      }
      return tagId;
    });
  }

  async removeFromWork(workId: string, tagId: string): Promise<void> {
    return this.withWriteLock(() => this.removeFromWorkUnlocked(workId, tagId));
  }

  private async removeFromWorkUnlocked(workId: string, tagId: string): Promise<void> {
    await this.assertActive(tagId);
    await this.assertActiveWork(workId);
    await this.db.run(`DELETE FROM work_tags WHERE work_id = ? AND tag_id = ?`, [workId, tagId]);
    const link = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM work_tags WHERE work_id = ? AND tag_id = ?`,
      [workId, tagId],
    );
    if ((link[0]?.n ?? 0) !== 0) {
      throw new Error(`Tag ${tagId} was not removed from work ${workId}`);
    }
  }
}
