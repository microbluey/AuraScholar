import type { Database } from "../database.js";
import { newId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { appendKnowledgeChangeInTransaction, type KnowledgeChangeKind } from "./knowledge.js";
import { withDatabaseWriteLock } from "./write-lock.js";

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
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    if (!libraryId.trim()) throw new Error("libraryId must be a non-empty string");
  }

  private assertChanged(changed: number, message: string): void {
    if (changed === 0) throw new Error(message);
  }

  private async assertWritableTarget(input: AnnotationInput): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT a.id
       FROM attachments a
       JOIN works w
         ON w.id = a.work_id
        AND w.library_id = ?
        AND w.deleted_at IS NULL
       WHERE a.id = ? AND a.work_id = ? AND a.deleted_at IS NULL
       LIMIT 1`,
      [this.libraryId, input.attachmentId, input.workId],
    );
    if (!rows[0]) {
      throw new Error(
        `Attachment ${input.attachmentId} is missing, removed, or not active for work ${input.workId}`,
      );
    }
  }

  async create(input: AnnotationInput): Promise<string> {
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "annotation_create", async () => {
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
        await this.appendKnowledgeChange(id, "upsert");
        return id;
      }),
    );
  }

  async listForAttachment(attachmentId: string): Promise<AnnotationRow[]> {
    return this.db.query<AnnotationRow>(
      `SELECT an.*
       FROM annotations an
       JOIN attachments a ON a.id = an.attachment_id AND a.deleted_at IS NULL
       JOIN works w
         ON w.id = an.work_id
        AND w.id = a.work_id
        AND w.library_id = ?
        AND w.deleted_at IS NULL
       WHERE an.attachment_id = ? AND an.deleted_at IS NULL
       ORDER BY an.sort_key`,
      [this.libraryId, attachmentId],
    );
  }

  async updateContent(id: string, contentMd: string): Promise<void> {
    await this.mutateAndAppend(
      id,
      `UPDATE annotations SET content_md = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM attachments a
           JOIN works w
             ON w.id = a.work_id
            AND w.library_id = ?
            AND w.deleted_at IS NULL
           WHERE a.id = annotations.attachment_id
             AND a.work_id = annotations.work_id
             AND a.deleted_at IS NULL
         )`,
      (now) => [contentMd, now, id, this.libraryId],
      `Annotation ${id} is missing or removed`,
      "upsert",
    );
  }

  async setOrphaned(id: string, orphaned: boolean): Promise<void> {
    await this.mutateAndAppend(
      id,
      `UPDATE annotations SET orphaned = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM attachments a
           JOIN works w
             ON w.id = a.work_id
            AND w.library_id = ?
            AND w.deleted_at IS NULL
           WHERE a.id = annotations.attachment_id
             AND a.work_id = annotations.work_id
             AND a.deleted_at IS NULL
         )`,
      (now) => [orphaned ? 1 : 0, now, id, this.libraryId],
      `Annotation ${id} is missing or removed`,
      "upsert",
    );
  }

  async softDelete(id: string): Promise<void> {
    await this.mutateAndAppend(
      id,
      `UPDATE annotations SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM attachments a
           JOIN works w
             ON w.id = a.work_id
            AND w.library_id = ?
            AND w.deleted_at IS NULL
           WHERE a.id = annotations.attachment_id
             AND a.work_id = annotations.work_id
             AND a.deleted_at IS NULL
         )`,
      (now) => [now, now, id, this.libraryId],
      `Annotation ${id} is missing or already removed`,
      "delete",
    );
  }

  async restore(id: string): Promise<void> {
    await this.mutateAndAppend(
      id,
      `UPDATE annotations SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM attachments a
           JOIN works w
             ON w.id = a.work_id
            AND w.library_id = ?
            AND w.deleted_at IS NULL
           WHERE a.id = annotations.attachment_id
             AND a.work_id = annotations.work_id
             AND a.deleted_at IS NULL
         )`,
      (now) => [now, id, this.libraryId],
      `Annotation ${id} is missing or already active`,
      "upsert",
    );
  }

  private async mutateAndAppend(
    id: string,
    statement: string,
    params: (now: number) => unknown[],
    errorMessage: string,
    changeKind: KnowledgeChangeKind,
  ): Promise<void> {
    await withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "annotation_mutation", async () => {
        const changed = await this.db.run(statement, params(Date.now()));
        this.assertChanged(changed, errorMessage);
        await this.appendKnowledgeChange(id, changeKind);
      }),
    );
  }

  private async appendKnowledgeChange(id: string, changeKind: KnowledgeChangeKind): Promise<void> {
    const rows = await this.db.query<{
      revision_id: string | null;
      blob_sha256: string | null;
    }>(
      `SELECT CASE WHEN asset.id IS NULL THEN NULL ELSE revision.id END AS revision_id,
              CASE WHEN asset.id IS NULL THEN NULL ELSE revision.blob_sha256 END AS blob_sha256
       FROM annotations annotation
       JOIN attachments attachment ON attachment.id = annotation.attachment_id
       JOIN works work
         ON work.id = annotation.work_id
        AND work.id = attachment.work_id
        AND work.library_id = ?
       LEFT JOIN document_revisions revision
         ON revision.attachment_id = attachment.id
        AND revision.deleted_at IS NULL
       LEFT JOIN document_assets asset
         ON asset.id = revision.asset_id
        AND asset.library_id = work.library_id
        AND asset.deleted_at IS NULL
       WHERE annotation.id = ?
       LIMIT 1`,
      [this.libraryId, id],
    );
    const source = rows[0];
    if (!source) throw new Error(`Annotation ${id} is outside this Library`);
    await appendKnowledgeChangeInTransaction(this.db, {
      libraryId: this.libraryId,
      sourceType: "annotation",
      sourceId: id,
      changeKind,
      expectedRevisionId: source.revision_id,
      expectedContentHash: isCanonicalSha256(source.blob_sha256) ? source.blob_sha256 : null,
    });
  }
}

function isCanonicalSha256(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{64}$/.test(value);
}
