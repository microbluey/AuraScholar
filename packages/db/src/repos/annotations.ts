import type { Database } from "../database.js";
import { newId } from "../ids.js";

export interface AnnotationInput {
  attachmentId: string;
  workId: string;
  type: string;
  color?: string;
  pageIndex: number;
  anchor?: unknown;
  contentMd?: string;
  inkPaths?: unknown;
}

export interface AnnotationRow {
  id: string;
  attachment_id: string;
  work_id: string;
  type: string;
  color: string | null;
  page_index: number;
  anchor_json: string | null;
  content_md: string | null;
  ink_paths_json: string | null;
  sort_key: number;
  orphaned: number;
  created_at: number;
  updated_at: number;
}

export class AnnotationsRepo {
  constructor(private readonly db: Database) {}

  private assertChanged(changed: number, message: string): void {
    if (changed === 0) throw new Error(message);
  }

  private async assertWritableTarget(input: AnnotationInput): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT a.id
       FROM attachments a
       JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
       WHERE a.id = ? AND a.work_id = ? AND a.deleted_at IS NULL
       LIMIT 1`,
      [input.attachmentId, input.workId],
    );
    if (!rows[0]) {
      throw new Error(
        `Attachment ${input.attachmentId} is missing, removed, or not active for work ${input.workId}`,
      );
    }
  }

  async create(input: AnnotationInput): Promise<string> {
    await this.assertWritableTarget(input);
    const id = newId();
    const now = Date.now();
    // sort_key: page-major ordering; y position refinement happens on update
    // when the renderer knows the resolved rects.
    const anchor = input.anchor as { quads?: { rects?: Array<{ y2: number }> } } | undefined;
    const firstRectY = anchor?.quads?.rects?.[0]?.y2 ?? 0;
    const sortKey = input.pageIndex * 1e6 - firstRectY;
    await this.db.run(
      `INSERT INTO annotations (id, attachment_id, work_id, type, color, page_index,
                                anchor_json, content_md, ink_paths_json, sort_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.attachmentId,
        input.workId,
        input.type,
        input.color ?? null,
        input.pageIndex,
        input.anchor ? JSON.stringify(input.anchor) : null,
        input.contentMd ?? null,
        input.inkPaths ? JSON.stringify(input.inkPaths) : null,
        sortKey,
        now,
        now,
      ],
    );
    return id;
  }

  async listForAttachment(attachmentId: string): Promise<AnnotationRow[]> {
    return this.db.query<AnnotationRow>(
      `SELECT an.*
       FROM annotations an
       JOIN attachments a ON a.id = an.attachment_id AND a.deleted_at IS NULL
       JOIN works w ON w.id = an.work_id AND w.id = a.work_id AND w.deleted_at IS NULL
       WHERE an.attachment_id = ? AND an.deleted_at IS NULL
       ORDER BY an.sort_key`,
      [attachmentId],
    );
  }

  async updateContent(id: string, contentMd: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE annotations SET content_md = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM attachments a
           JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
           WHERE a.id = annotations.attachment_id
             AND a.work_id = annotations.work_id
             AND a.deleted_at IS NULL
         )`,
      [contentMd, Date.now(), id],
    );
    this.assertChanged(changed, `Annotation ${id} is missing or removed`);
  }

  async setOrphaned(id: string, orphaned: boolean): Promise<void> {
    const changed = await this.db.run(
      `UPDATE annotations SET orphaned = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM attachments a
           JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
           WHERE a.id = annotations.attachment_id
             AND a.work_id = annotations.work_id
             AND a.deleted_at IS NULL
         )`,
      [orphaned ? 1 : 0, Date.now(), id],
    );
    this.assertChanged(changed, `Annotation ${id} is missing or removed`);
  }

  async softDelete(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE annotations SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM attachments a
           JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
           WHERE a.id = annotations.attachment_id
             AND a.work_id = annotations.work_id
             AND a.deleted_at IS NULL
         )`,
      [Date.now(), Date.now(), id],
    );
    this.assertChanged(changed, `Annotation ${id} is missing or already removed`);
  }

  async restore(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE annotations SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM attachments a
           JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
           WHERE a.id = annotations.attachment_id
             AND a.work_id = annotations.work_id
             AND a.deleted_at IS NULL
         )`,
      [Date.now(), id],
    );
    this.assertChanged(changed, `Annotation ${id} is missing or already active`);
  }
}
