import {
  documentAssetIdFromAttachment,
  documentRevisionIdFromAttachment,
  type Database,
} from "@aurascholar/db";
import {
  documentAssetCurrentRevisionPatches,
  type KnowledgeBackupIdMaps,
} from "../shared/library-backup-evidence";

interface UnmappedAttachment {
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
}

export async function finalizeImportedDocumentEvidence(
  db: Database,
  input: {
    assetRows: readonly Record<string, unknown>[];
    libraryId: string;
    maps: KnowledgeBackupIdMaps;
    version: number;
  },
): Promise<void> {
  if (input.version >= 4) {
    for (const patch of documentAssetCurrentRevisionPatches(input.assetRows, input.maps)) {
      const changed = await db.run(
        `UPDATE document_assets
         SET current_revision_id = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ?`,
        [patch.revisionId, Date.now(), patch.assetId, input.libraryId],
      );
      if (changed !== 1) {
        throw new Error(`无法恢复导入文档 ${patch.assetId} 的当前版本。`);
      }
    }
  }
  await backfillUnmappedAttachments(db, input.libraryId);
}

async function backfillUnmappedAttachments(db: Database, libraryId: string): Promise<void> {
  const rows = await db.query<UnmappedAttachment>(
    `SELECT attachment.id, work.library_id, attachment.work_id,
            work.title AS work_title, attachment.kind, attachment.sha256,
            attachment.byte_size, attachment.original_filename, attachment.source_url,
            attachment.text_extracted_at, attachment.created_at, attachment.updated_at,
            attachment.deleted_at
     FROM attachments attachment
     JOIN works work ON work.id = attachment.work_id AND work.library_id = ?
     LEFT JOIN document_revisions revision ON revision.attachment_id = attachment.id
     WHERE revision.id IS NULL
     ORDER BY attachment.created_at, attachment.id`,
    [libraryId],
  );
  for (const attachment of rows) {
    const assetId = documentAssetIdFromAttachment(attachment.id);
    const revisionId = documentRevisionIdFromAttachment(attachment.id);
    const canonical = await db.query<{ library_id: string }>(
      `SELECT library_id FROM document_assets WHERE id = ? LIMIT 1`,
      [assetId],
    );
    if (canonical[0]) {
      if (canonical[0].library_id !== libraryId) {
        throw new Error(`Document asset ${assetId} is outside the imported Library`);
      }
      // A canonical revision may intentionally detach from a retired legacy
      // attachment (for example after Work deduplication). Compatibility
      // backfill must never overwrite or duplicate that canonical identity.
      continue;
    }
    const kind =
      attachment.kind === "pdf" ? "pdf" : attachment.kind === "supplement" ? "supplement" : "other";
    await db.run(
      `INSERT INTO document_assets
         (id, library_id, work_id, kind, title, current_revision_id,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        assetId,
        attachment.library_id,
        attachment.work_id,
        kind,
        attachment.original_filename?.trim() || attachment.work_title,
        attachment.created_at,
        attachment.updated_at,
        attachment.deleted_at,
      ],
    );
    await db.run(
      `INSERT INTO document_revisions
         (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256,
          byte_size, source_url, extractor_profile, extraction_status,
          availability_status, availability_checked_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, 'relink-required', ?, ?, ?, ?)`,
      [
        revisionId,
        assetId,
        attachment.id,
        kind === "pdf" ? "application/pdf" : "application/octet-stream",
        attachment.sha256,
        attachment.byte_size,
        attachment.source_url,
        attachment.text_extracted_at === null ? "pending" : "ready",
        Date.now(),
        attachment.created_at,
        attachment.updated_at,
        attachment.deleted_at,
      ],
    );
    if (attachment.deleted_at === null) {
      await db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
        revisionId,
        assetId,
      ]);
    }
  }
}
