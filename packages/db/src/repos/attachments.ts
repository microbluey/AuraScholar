import type { Database } from "../database.js";
import { newId } from "../ids.js";

export interface AttachmentInput {
  workId: string;
  kind?: string;
  sha256: string;
  byteSize: number;
  originalFilename?: string;
  sourceUrl?: string;
  fetchedVia?: string;
  pageCount?: number;
}

export interface AttachmentRow {
  id: string;
  work_id: string;
  kind: string;
  sha256: string;
  byte_size: number;
  original_filename: string | null;
  fetched_via: string | null;
  page_count: number | null;
  created_at: number;
}

export class AttachmentsRepo {
  constructor(private readonly db: Database) {}

  private async assertActiveWork(workId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM works WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [workId],
    );
    if (!rows[0]) throw new Error(`Work ${workId} is missing or removed`);
  }

  /** Returns existing attachment id if this exact file (sha256) is already linked to the work. */
  async create(input: AttachmentInput): Promise<{ id: string; deduped: boolean }> {
    await this.assertActiveWork(input.workId);
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM attachments WHERE work_id = ? AND sha256 = ? AND deleted_at IS NULL`,
      [input.workId, input.sha256],
    );
    if (existing.length > 0) return { id: existing[0]!.id, deduped: true };

    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO attachments (id, work_id, kind, sha256, byte_size, original_filename,
                                source_url, fetched_via, page_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.workId,
        input.kind ?? "pdf",
        input.sha256,
        input.byteSize,
        input.originalFilename ?? null,
        input.sourceUrl ?? null,
        input.fetchedVia ?? null,
        input.pageCount ?? null,
        now,
        now,
      ],
    );
    return { id, deduped: false };
  }

  async forWork(workId: string): Promise<AttachmentRow[]> {
    return this.db.query<AttachmentRow>(
      `SELECT a.*
       FROM attachments a
       JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
       WHERE a.work_id = ? AND a.deleted_at IS NULL`,
      [workId],
    );
  }

  /** Find any attachment with this content hash (cross-work duplicate check). */
  async bySha(sha256: string): Promise<AttachmentRow | null> {
    const rows = await this.db.query<AttachmentRow>(
      `SELECT a.*
       FROM attachments a
       JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
       WHERE a.sha256 = ? AND a.deleted_at IS NULL
       LIMIT 1`,
      [sha256],
    );
    return rows[0] ?? null;
  }
}
