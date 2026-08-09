import type { Database } from "../database.js";
import { documentAssetIdFromAttachment, documentRevisionIdFromAttachment, newId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { appendKnowledgeChangeInTransaction } from "./knowledge.js";
import { withDatabaseWriteLock } from "./write-lock.js";

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
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    if (!libraryId.trim()) throw new Error("libraryId must be a non-empty string");
  }

  private async assertActiveWork(workId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM works
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [workId, this.libraryId],
    );
    if (!rows[0]) throw new Error(`Work ${workId} is missing or removed`);
  }

  /** Returns existing attachment id if this exact file (sha256) is already linked to the work. */
  async create(input: AttachmentInput): Promise<{ id: string; deduped: boolean }> {
    return withDatabaseWriteLock(this.db, async () => {
      await this.assertActiveWork(input.workId);
      const existing = await this.db.query<{ id: string }>(
        `SELECT id FROM attachments WHERE work_id = ? AND sha256 = ? AND deleted_at IS NULL`,
        [input.workId, input.sha256],
      );
      if (existing[0]) {
        return withDatabaseSavepoint(this.db, "attachment_map", async () => {
          const mapping = await this.ensureDocumentMapping(existing[0]!.id);
          if (mapping.changed) await this.appendRevisionInvalidation(mapping);
          return { id: existing[0]!.id, deduped: true };
        });
      }

      return withDatabaseSavepoint(this.db, "attachment_create", async () => {
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
        const mapping = await this.ensureDocumentMapping(id);
        await this.appendRevisionInvalidation(mapping);
        return { id, deduped: false };
      });
    });
  }

  async forWork(workId: string): Promise<AttachmentRow[]> {
    return this.db.query<AttachmentRow>(
      `SELECT a.*
       FROM attachments a
       JOIN works w
         ON w.id = a.work_id
        AND w.library_id = ?
        AND w.deleted_at IS NULL
       WHERE a.work_id = ? AND a.deleted_at IS NULL
       ORDER BY CASE WHEN EXISTS (
         SELECT 1
         FROM document_revisions revision
         JOIN document_assets asset
           ON asset.id = revision.asset_id
          AND asset.current_revision_id = revision.id
          AND asset.library_id = w.library_id
          AND asset.work_id = a.work_id
          AND asset.deleted_at IS NULL
         WHERE revision.attachment_id = a.id
           AND revision.deleted_at IS NULL
       ) THEN 0 ELSE 1 END,
       a.created_at DESC, a.id ASC`,
      [this.libraryId, workId],
    );
  }

  /** Find any attachment with this content hash (cross-work duplicate check). */
  async bySha(sha256: string): Promise<AttachmentRow | null> {
    const rows = await this.db.query<AttachmentRow>(
      `SELECT a.*
       FROM attachments a
       JOIN works w
         ON w.id = a.work_id
        AND w.library_id = ?
        AND w.deleted_at IS NULL
       WHERE a.sha256 = ? AND a.deleted_at IS NULL
       LIMIT 1`,
      [this.libraryId, sha256],
    );
    return rows[0] ?? null;
  }

  private async ensureDocumentMapping(attachmentId: string): Promise<DocumentMapping> {
    const rows = await this.db.query<{
      id: string;
      library_id: string;
      work_id: string;
      work_title: string;
      kind: string;
      sha256: string;
      byte_size: number;
      original_filename: string | null;
      source_url: string | null;
      text_extracted_at: number | null;
      created_at: number;
      updated_at: number;
      deleted_at: number | null;
    }>(
      `SELECT attachment.id, work.library_id, attachment.work_id,
              work.title AS work_title, attachment.kind, attachment.sha256,
              attachment.byte_size, attachment.original_filename, attachment.source_url,
              attachment.text_extracted_at, attachment.created_at, attachment.updated_at,
              attachment.deleted_at
       FROM attachments attachment
       JOIN works work ON work.id = attachment.work_id AND work.library_id = ?
       WHERE attachment.id = ?
       LIMIT 1`,
      [this.libraryId, attachmentId],
    );
    const attachment = rows[0];
    if (!attachment) throw new Error(`Attachment ${attachmentId} is outside this Library`);

    // A source-recovery bridge may intentionally bind this local Attachment to
    // an existing historical revision. Accept that exact canonical mapping
    // instead of manufacturing a second deterministic Asset/Revision pair.
    const existingBridge = await this.db.query<{
      id: string;
      asset_deleted_at: number | null;
      blob_sha256: string;
      byte_size: number;
      library_id: string;
      revision_deleted_at: number | null;
      work_id: string | null;
    }>(
      `SELECT revision.id, asset.library_id, asset.work_id, asset.deleted_at AS asset_deleted_at,
              revision.blob_sha256, revision.byte_size,
              revision.deleted_at AS revision_deleted_at
       FROM document_revisions revision
       JOIN document_assets asset ON asset.id = revision.asset_id
       WHERE revision.attachment_id = ?
       LIMIT 1`,
      [attachment.id],
    );
    if (existingBridge[0]) {
      const bridge = existingBridge[0];
      if (
        bridge.library_id !== attachment.library_id ||
        bridge.work_id !== attachment.work_id ||
        bridge.blob_sha256 !== attachment.sha256 ||
        bridge.byte_size !== attachment.byte_size ||
        bridge.asset_deleted_at !== null ||
        bridge.revision_deleted_at !== null
      ) {
        throw new Error(`Attachment ${attachment.id} has an inconsistent document revision`);
      }
      return {
        revisionId: bridge.id,
        blobSha256: bridge.blob_sha256,
        changed: false,
      };
    }

    const assetId = documentAssetIdFromAttachment(attachment.id);
    const revisionId = documentRevisionIdFromAttachment(attachment.id);
    const kind = normalizeAssetKind(attachment.kind);
    const title = attachment.original_filename?.trim() || attachment.work_title.trim();
    await this.db.run(
      `INSERT OR IGNORE INTO document_assets
         (id, library_id, work_id, kind, title, current_revision_id,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        assetId,
        attachment.library_id,
        attachment.work_id,
        kind,
        title,
        attachment.created_at,
        attachment.updated_at,
        attachment.deleted_at,
      ],
    );
    await this.db.run(
      `INSERT OR IGNORE INTO document_revisions
         (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256,
          byte_size, source_url, extractor_profile, extraction_status,
          availability_status, availability_checked_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, 'unchecked', NULL, ?, ?, ?)`,
      [
        revisionId,
        assetId,
        attachment.id,
        kind === "pdf" ? "application/pdf" : "application/octet-stream",
        attachment.sha256,
        attachment.byte_size,
        attachment.source_url,
        attachment.text_extracted_at === null ? "pending" : "ready",
        attachment.created_at,
        attachment.updated_at,
        attachment.deleted_at,
      ],
    );

    const mapped = await this.db.query<{
      asset_id: string;
      attachment_id: string | null;
      blob_sha256: string;
      byte_size: number;
    }>(
      `SELECT asset_id, attachment_id, blob_sha256, byte_size
       FROM document_revisions WHERE id = ? LIMIT 1`,
      [revisionId],
    );
    const revision = mapped[0];
    if (
      !revision ||
      revision.asset_id !== assetId ||
      revision.attachment_id !== attachment.id ||
      revision.blob_sha256 !== attachment.sha256 ||
      revision.byte_size !== attachment.byte_size
    ) {
      throw new Error(`Attachment ${attachment.id} has an inconsistent document revision`);
    }
    if (attachment.deleted_at === null) {
      await this.db.run(
        `UPDATE document_revisions
         SET deleted_at = NULL, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ?`,
        [Date.now(), revisionId],
      );
      await this.db.run(
        `UPDATE document_assets
         SET current_revision_id = COALESCE(current_revision_id, ?),
             deleted_at = NULL, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ?`,
        [revisionId, Date.now(), assetId],
      );
    }
    return {
      revisionId,
      blobSha256: revision.blob_sha256,
      changed: true,
    };
  }

  private async appendRevisionInvalidation(mapping: DocumentMapping): Promise<void> {
    await appendKnowledgeChangeInTransaction(this.db, {
      libraryId: this.libraryId,
      sourceType: "revision",
      sourceId: mapping.revisionId,
      changeKind: "upsert",
      expectedRevisionId: mapping.revisionId,
      expectedContentHash: isCanonicalSha256(mapping.blobSha256) ? mapping.blobSha256 : null,
    });
  }
}

interface DocumentMapping {
  revisionId: string;
  blobSha256: string;
  changed: boolean;
}

function normalizeAssetKind(kind: string): "pdf" | "supplement" | "other" {
  if (kind === "pdf") return "pdf";
  if (kind === "supplement") return "supplement";
  return "other";
}

function isCanonicalSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
