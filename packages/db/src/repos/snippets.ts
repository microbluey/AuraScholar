// Writing snippets: excerpts collected while reading, for reuse when writing.
// Traceable back to (work, page). Soft-deleted like everything else for sync.
import type { Database } from "../database.js";
import { newId } from "../ids.js";

export interface SnippetRow {
  id: string;
  work_id: string;
  page_index: number | null;
  quote: string;
  note_md: string | null;
  tag: string | null;
  created_at: number;
  updated_at: number;
}

export interface SnippetInput {
  workId: string;
  pageIndex?: number | null;
  quote: string;
  noteMd?: string | null;
  tag?: string | null;
}

/** A snippet joined with its source work's title, for the cross-library view. */
export interface SnippetWithWork extends SnippetRow {
  work_title: string;
}

export class SnippetsRepo {
  constructor(private readonly db: Database) {}

  private assertChanged(changed: number, message: string): void {
    if (changed === 0) throw new Error(message);
  }

  private async assertActiveWork(workId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM works WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [workId],
    );
    if (!rows[0]) throw new Error(`Work ${workId} is missing or removed`);
  }

  async create(input: SnippetInput): Promise<string> {
    await this.assertActiveWork(input.workId);
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO snippets (id, work_id, page_index, quote, note_md, tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.workId,
        input.pageIndex ?? null,
        input.quote,
        input.noteMd ?? null,
        input.tag ?? null,
        now,
        now,
      ],
    );
    return id;
  }

  async updateNote(id: string, noteMd: string | null): Promise<void> {
    const changed = await this.db.run(
      `UPDATE snippets SET note_md = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM works WHERE id = snippets.work_id AND deleted_at IS NULL)`,
      [noteMd, Date.now(), id],
    );
    this.assertChanged(changed, `Snippet ${id} is missing or removed`);
  }

  async softDelete(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE snippets SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM works WHERE id = snippets.work_id AND deleted_at IS NULL)`,
      [Date.now(), Date.now(), id],
    );
    this.assertChanged(changed, `Snippet ${id} is missing or already removed`);
  }

  async restore(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE snippets SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM works WHERE id = snippets.work_id AND deleted_at IS NULL)`,
      [Date.now(), id],
    );
    this.assertChanged(changed, `Snippet ${id} is missing or already active`);
  }

  async forWork(workId: string): Promise<SnippetRow[]> {
    return this.db.query<SnippetRow>(
      `SELECT s.id, s.work_id, s.page_index, s.quote, s.note_md, s.tag, s.created_at, s.updated_at
       FROM snippets s
       JOIN works w ON w.id = s.work_id AND w.deleted_at IS NULL
       WHERE s.work_id = ? AND s.deleted_at IS NULL
       ORDER BY s.created_at`,
      [workId],
    );
  }

  /** All snippets across the library, joined with work title (newest first). */
  async listAll(): Promise<SnippetWithWork[]> {
    return this.db.query<SnippetWithWork>(
      `SELECT s.id, s.work_id, s.page_index, s.quote, s.note_md, s.tag,
              s.created_at, s.updated_at, w.title AS work_title
       FROM snippets s
       JOIN works w ON w.id = s.work_id AND w.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
       ORDER BY s.created_at DESC`,
    );
  }

  async count(): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM snippets s
       JOIN works w ON w.id = s.work_id AND w.deleted_at IS NULL
       WHERE s.deleted_at IS NULL`,
    );
    return rows[0]?.n ?? 0;
  }
}
