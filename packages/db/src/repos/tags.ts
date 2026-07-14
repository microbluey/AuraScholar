// Tags for the library. Unlike collections (single-folder-per-work), a work can
// carry many tags. Tag names are unique (tags_name_uq); create() upserts by name
// so the same label never splits into two rows.
import type { Database } from "../database.js";
import { newId } from "../ids.js";

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

interface TagIdentityRow {
  id: string;
  deleted_at: number | null;
}

export interface AddTagToWorksOptions {
  afterEach?: (workId: string, index: number) => void | Promise<void>;
}

export class TagsRepo {
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
          // Keep the original write error if cleanup has already been unwound.
        }
      }
      throw e;
    }
  }

  private assertChanged(changed: number, message: string): void {
    if (changed === 0) throw new Error(message);
  }

  private async assertActive(id: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM tags WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new Error(`Tag ${id} is missing or removed`);
  }

  private async assertActiveWork(workId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM works WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [workId],
    );
    if (!rows[0]) throw new Error(`Work ${workId} is missing or removed`);
  }

  /** All tags with how many (non-deleted) works carry each. */
  async list(): Promise<TagRow[]> {
    return this.db.query<TagRow>(
      `SELECT t.id, t.name, t.color, COUNT(w.id) AS count
       FROM tags t
       LEFT JOIN work_tags wt ON wt.tag_id = t.id
       LEFT JOIN works w ON w.id = wt.work_id AND w.deleted_at IS NULL
       WHERE t.deleted_at IS NULL
       GROUP BY t.id, t.name, t.color
       ORDER BY count DESC, t.name`,
    );
  }

  /** Upsert by name: returns the existing tag id, or creates a fresh one. */
  async ensure(name: string, color?: string): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("标签名称不能为空");
    const existing = await this.db.query<TagIdentityRow>(
      `SELECT id, deleted_at FROM tags WHERE name = ? LIMIT 1`,
      [trimmed],
    );
    if (existing[0]) {
      if (existing[0].deleted_at !== null) {
        const changed = await this.db.run(
          `UPDATE tags
           SET deleted_at = NULL, color = COALESCE(?, color), updated_at = ?
           WHERE id = ? AND deleted_at IS NOT NULL`,
          [color ?? null, Date.now(), existing[0].id],
        );
        this.assertChanged(changed, `Tag ${existing[0].id} is missing or already active`);
      }
      return existing[0].id;
    }
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, trimmed, color ?? null, now, now],
    );
    return id;
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("标签名称不能为空");
    const now = Date.now();
    const conflict = await this.db.query<TagIdentityRow>(
      `SELECT id, deleted_at FROM tags WHERE name = ? LIMIT 1`,
      [trimmed],
    );
    const mergeTarget = conflict[0];
    if (mergeTarget && mergeTarget.id !== id) {
      await this.withSavepoint("tags_rename_merge", async () => {
        await this.assertActive(id);
        if (mergeTarget.deleted_at !== null) {
          const restored = await this.db.run(
            `UPDATE tags SET deleted_at = NULL, updated_at = ?
             WHERE id = ? AND deleted_at IS NOT NULL`,
            [now, mergeTarget.id],
          );
          this.assertChanged(restored, `Tag ${mergeTarget.id} is missing or already active`);
        }
        await this.db.run(
          `INSERT OR IGNORE INTO work_tags (work_id, tag_id)
           SELECT work_id, ? FROM work_tags WHERE tag_id = ?`,
          [mergeTarget.id, id],
        );
        await this.db.run(`DELETE FROM work_tags WHERE tag_id = ?`, [id]);
        const retired = await this.db.run(
          `UPDATE tags SET deleted_at = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [now, now, id],
        );
        this.assertChanged(retired, `Tag ${id} is missing or removed`);
      });
      return;
    }
    const changed = await this.db.run(
      `UPDATE tags SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [trimmed, now, id],
    );
    this.assertChanged(changed, `Tag ${id} is missing or removed`);
  }

  async setColor(id: string, color: string | null): Promise<void> {
    const changed = await this.db.run(
      `UPDATE tags SET color = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [color, Date.now(), id],
    );
    this.assertChanged(changed, `Tag ${id} is missing or removed`);
  }

  /** Removes the tag and all its work associations. */
  async softDelete(id: string): Promise<void> {
    await this.withSavepoint("tags_soft_delete", async () => {
      const changed = await this.db.run(
        `UPDATE tags SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [Date.now(), Date.now(), id],
      );
      this.assertChanged(changed, `Tag ${id} is missing or already removed`);
      await this.db.run(`DELETE FROM work_tags WHERE tag_id = ?`, [id]);
    });
  }

  async workIds(id: string): Promise<string[]> {
    const rows = await this.db.query<{ work_id: string }>(
      `SELECT wt.work_id
       FROM work_tags wt
       JOIN works w ON w.id = wt.work_id AND w.deleted_at IS NULL
       WHERE wt.tag_id = ?
       ORDER BY wt.work_id`,
      [id],
    );
    return rows.map((row) => row.work_id);
  }

  async restore(id: string, workIds: string[] = []): Promise<void> {
    await this.withSavepoint("tags_restore", async () => {
      const changed = await this.db.run(
        `UPDATE tags SET deleted_at = NULL, updated_at = ?
         WHERE id = ? AND deleted_at IS NOT NULL`,
        [Date.now(), id],
      );
      this.assertChanged(changed, `Tag ${id} is missing or already active`);
      for (const workId of new Set(workIds)) {
        await this.assertActiveWork(workId);
        await this.db.run(`INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)`, [
          workId,
          id,
        ]);
      }
    });
  }

  /** Attaches a tag (by name, upserting) to many works. Idempotent. */
  async addToWorks(
    workIds: string[],
    tagName: string,
    options: AddTagToWorksOptions = {},
  ): Promise<void> {
    if (workIds.length === 0) return;
    await this.withSavepoint("tags_add_to_works", async () => {
      const tagId = await this.ensure(tagName);
      const uniqueWorkIds = [...new Set(workIds)];
      for (let index = 0; index < uniqueWorkIds.length; index += 1) {
        const workId = uniqueWorkIds[index]!;
        await this.assertActiveWork(workId);
        await this.db.run(
          `INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)`,
          [workId, tagId],
        );
        await options.afterEach?.(workId, index);
      }
    });
  }

  async removeFromWork(workId: string, tagId: string): Promise<void> {
    await this.assertActive(tagId);
    await this.assertActiveWork(workId);
    await this.db.run(`DELETE FROM work_tags WHERE work_id = ? AND tag_id = ?`, [workId, tagId]);
  }
}
