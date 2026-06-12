import type { Database } from "../database";
import { newId } from "../ids";

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

  async create(input: AnnotationInput): Promise<string> {
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
      `SELECT * FROM annotations WHERE attachment_id = ? AND deleted_at IS NULL ORDER BY sort_key`,
      [attachmentId],
    );
  }

  async updateContent(id: string, contentMd: string): Promise<void> {
    await this.db.run(`UPDATE annotations SET content_md = ?, updated_at = ? WHERE id = ?`, [
      contentMd,
      Date.now(),
      id,
    ]);
  }

  async setOrphaned(id: string, orphaned: boolean): Promise<void> {
    await this.db.run(`UPDATE annotations SET orphaned = ?, updated_at = ? WHERE id = ?`, [
      orphaned ? 1 : 0,
      Date.now(),
      id,
    ]);
  }

  async softDelete(id: string): Promise<void> {
    await this.db.run(`UPDATE annotations SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      id,
    ]);
  }
}
