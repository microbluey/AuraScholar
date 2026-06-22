// Tags for the library. Unlike collections (single-folder-per-work), a work can
// carry many tags. Tag names are unique (tags_name_uq); create() upserts by name
// so the same label never splits into two rows.
import type { Database } from "../database";
import { newId } from "../ids";

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

export class TagsRepo {
  constructor(private readonly db: Database) {}

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
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM tags WHERE name = ? AND deleted_at IS NULL LIMIT 1`,
      [trimmed],
    );
    if (existing[0]) return existing[0].id;
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, trimmed, color ?? null, now, now],
    );
    return id;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.db.run(`UPDATE tags SET name = ?, updated_at = ? WHERE id = ?`, [
      name.trim(),
      Date.now(),
      id,
    ]);
  }

  async setColor(id: string, color: string | null): Promise<void> {
    await this.db.run(`UPDATE tags SET color = ?, updated_at = ? WHERE id = ?`, [
      color,
      Date.now(),
      id,
    ]);
  }

  /** Removes the tag and all its work associations. */
  async softDelete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM work_tags WHERE tag_id = ?`, [id]);
    await this.db.run(`UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      id,
    ]);
  }

  /** Attaches a tag (by name, upserting) to many works. Idempotent. */
  async addToWorks(workIds: string[], tagName: string): Promise<void> {
    if (workIds.length === 0) return;
    const tagId = await this.ensure(tagName);
    for (const workId of workIds) {
      await this.db.run(
        `INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)`,
        [workId, tagId],
      );
    }
  }

  async removeFromWork(workId: string, tagId: string): Promise<void> {
    await this.db.run(`DELETE FROM work_tags WHERE work_id = ? AND tag_id = ?`, [workId, tagId]);
  }
}
