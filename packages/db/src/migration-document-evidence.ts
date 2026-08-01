import { documentAssetIdFromAttachment, documentRevisionIdFromAttachment } from "./ids.js";
import type { SqlExecutor } from "./migrations.js";

interface LegacyAttachmentRow {
  id: string;
  work_id: string;
  library_id: string | null;
  work_title: string | null;
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

export async function applyDocumentEvidenceV19(db: SqlExecutor): Promise<void> {
  await db.exec(`
    CREATE TABLE document_assets (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id),
      work_id TEXT REFERENCES works(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN (
        'pdf', 'html', 'docx', 'markdown', 'epub', 'notebook', 'supplement', 'other'
      )),
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      current_revision_id TEXT REFERENCES document_revisions(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX document_assets_library_active_idx
      ON document_assets(library_id, deleted_at, updated_at);
    CREATE INDEX document_assets_work_active_idx
      ON document_assets(work_id, deleted_at, updated_at);

    CREATE TABLE document_revisions (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES document_assets(id) ON DELETE CASCADE,
      attachment_id TEXT UNIQUE REFERENCES attachments(id) ON DELETE SET NULL,
      revision_no INTEGER NOT NULL CHECK (revision_no > 0),
      mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
      blob_sha256 TEXT NOT NULL CHECK (length(trim(blob_sha256)) > 0),
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      source_url TEXT,
      extractor_profile TEXT,
      extraction_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (extraction_status IN ('pending', 'running', 'ready', 'failed', 'unsupported')),
      availability_status TEXT NOT NULL DEFAULT 'unchecked'
        CHECK (availability_status IN ('unchecked', 'available', 'missing', 'relink-required')),
      availability_checked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX document_revisions_asset_active_idx
      ON document_revisions(asset_id, deleted_at, revision_no, created_at, id);
    CREATE INDEX document_revisions_blob_idx
      ON document_revisions(blob_sha256);

    CREATE TABLE project_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES document_assets(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'source' CHECK (length(trim(role)) > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      UNIQUE(project_id, asset_id)
    );
    CREATE INDEX project_assets_project_active_idx
      ON project_assets(project_id, deleted_at, updated_at);
    CREATE INDEX project_assets_asset_active_idx
      ON project_assets(asset_id, deleted_at);

    CREATE TABLE evidence_items (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id),
      work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES document_assets(id) ON DELETE CASCADE,
      revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('document', 'annotation')),
      evidence_kind TEXT NOT NULL CHECK (
        evidence_kind IN ('method', 'data', 'limitation', 'definition', 'context')
      ),
      anchor_json TEXT NOT NULL CHECK (
        CASE WHEN json_valid(anchor_json)
          THEN COALESCE(
            json_type(anchor_json, '$') = 'object'
            AND json_extract(anchor_json, '$.revisionId') = revision_id,
            0
          )
          ELSE 0
        END
      ),
      payload_kind TEXT NOT NULL CHECK (payload_kind = 'text'),
      payload_json TEXT NOT NULL CHECK (
        CASE WHEN json_valid(payload_json)
          THEN COALESCE(
            json_type(payload_json, '$') = 'object'
            AND json_type(payload_json, '$.text') = 'text'
            AND length(trim(json_extract(payload_json, '$.text'))) > 0,
            0
          )
          ELSE 0
        END
      ),
      title TEXT,
      note_md TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]' CHECK (
        CASE WHEN json_valid(tags_json)
          THEN COALESCE(json_type(tags_json, '$') = 'array', 0)
          ELSE 0
        END
      ),
      source_content_hash TEXT NOT NULL CHECK (
        length(source_content_hash) = 64
        AND source_content_hash NOT GLOB '*[^0-9a-f]*'
      ),
      provenance_json TEXT NOT NULL CHECK (
        CASE WHEN json_valid(provenance_json)
          THEN COALESCE(json_type(provenance_json, '$') = 'object', 0)
          ELSE 0
        END
      ),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX evidence_items_library_active_idx
      ON evidence_items(library_id, deleted_at, updated_at);
    CREATE INDEX evidence_items_work_active_idx
      ON evidence_items(work_id, deleted_at, updated_at);
    CREATE INDEX evidence_items_revision_idx
      ON evidence_items(revision_id, deleted_at);

    CREATE TABLE project_evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'evidence' CHECK (length(trim(role)) > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      UNIQUE(project_id, evidence_id)
    );
    CREATE INDEX project_evidence_project_active_idx
      ON project_evidence(project_id, deleted_at, updated_at);
    CREATE INDEX project_evidence_evidence_active_idx
      ON project_evidence(evidence_id, deleted_at);

    CREATE TRIGGER document_assets_library_immutable
    BEFORE UPDATE OF library_id ON document_assets
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'document asset library ownership is immutable');
    END;

    CREATE TRIGGER document_assets_work_insert
    BEFORE INSERT ON document_assets
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM works work
      WHERE work.id = NEW.work_id AND work.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'document asset work must stay within its library');
    END;

    CREATE TRIGGER document_assets_work_update
    BEFORE UPDATE OF work_id, library_id ON document_assets
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM works work
      WHERE work.id = NEW.work_id AND work.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'document asset work must stay within its library');
    END;

    CREATE TRIGGER document_assets_current_revision_insert
    BEFORE INSERT ON document_assets
    WHEN NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM document_revisions revision
      WHERE revision.id = NEW.current_revision_id
        AND revision.asset_id = NEW.id
        AND (NEW.deleted_at IS NOT NULL OR revision.deleted_at IS NULL)
    )
    BEGIN
      SELECT RAISE(ABORT, 'current revision must belong to its document asset');
    END;

    CREATE TRIGGER document_assets_current_revision_update
    BEFORE UPDATE OF current_revision_id, deleted_at ON document_assets
    WHEN NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM document_revisions revision
      WHERE revision.id = NEW.current_revision_id
        AND revision.asset_id = NEW.id
        AND (NEW.deleted_at IS NOT NULL OR revision.deleted_at IS NULL)
    )
    BEGIN
      SELECT RAISE(ABORT, 'current revision must belong to its document asset');
    END;

    CREATE TRIGGER document_revisions_attachment_insert
    BEFORE INSERT ON document_revisions
    WHEN NEW.attachment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM attachments attachment
      JOIN works work ON work.id = attachment.work_id
      JOIN document_assets asset ON asset.id = NEW.asset_id
      WHERE attachment.id = NEW.attachment_id
        AND attachment.work_id = asset.work_id
        AND work.library_id = asset.library_id
        AND attachment.sha256 = NEW.blob_sha256
        AND attachment.byte_size = NEW.byte_size
    )
    BEGIN
      SELECT RAISE(ABORT, 'document revision attachment identity is inconsistent');
    END;

    CREATE TRIGGER document_revisions_attachment_update
    BEFORE UPDATE OF attachment_id ON document_revisions
    WHEN NEW.attachment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM attachments attachment
      JOIN works work ON work.id = attachment.work_id
      JOIN document_assets asset ON asset.id = NEW.asset_id
      WHERE attachment.id = NEW.attachment_id
        AND attachment.work_id = asset.work_id
        AND work.library_id = asset.library_id
        AND attachment.sha256 = NEW.blob_sha256
        AND attachment.byte_size = NEW.byte_size
    )
    BEGIN
      SELECT RAISE(ABORT, 'document revision attachment identity is inconsistent');
    END;

    CREATE TRIGGER document_revisions_identity_immutable
    BEFORE UPDATE OF asset_id, revision_no, mime_type, blob_sha256, byte_size, source_url, created_at
      ON document_revisions
    WHEN OLD.asset_id IS NOT NEW.asset_id
      OR OLD.revision_no IS NOT NEW.revision_no
      OR OLD.mime_type IS NOT NEW.mime_type
      OR OLD.blob_sha256 IS NOT NEW.blob_sha256
      OR OLD.byte_size IS NOT NEW.byte_size
      OR OLD.source_url IS NOT NEW.source_url
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN
      SELECT RAISE(ABORT, 'document revision source identity is immutable');
    END;

    CREATE TRIGGER project_assets_scope_insert
    BEFORE INSERT ON project_assets
    WHEN NOT EXISTS (
      SELECT 1 FROM research_projects project
      JOIN document_assets asset ON asset.library_id = project.library_id
      WHERE project.id = NEW.project_id AND asset.id = NEW.asset_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'project asset must stay within its library');
    END;

    CREATE TRIGGER project_assets_scope_update
    BEFORE UPDATE OF project_id, asset_id ON project_assets
    WHEN NOT EXISTS (
      SELECT 1 FROM research_projects project
      JOIN document_assets asset ON asset.library_id = project.library_id
      WHERE project.id = NEW.project_id AND asset.id = NEW.asset_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'project asset must stay within its library');
    END;

    CREATE TRIGGER evidence_items_library_immutable
    BEFORE UPDATE OF library_id ON evidence_items
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'evidence library ownership is immutable');
    END;

    CREATE TRIGGER evidence_items_source_insert
    BEFORE INSERT ON evidence_items
    WHEN NOT EXISTS (
      SELECT 1
      FROM works work
      JOIN document_assets asset
        ON asset.id = NEW.asset_id
       AND asset.library_id = work.library_id
       AND asset.work_id = work.id
      JOIN document_revisions revision
        ON revision.id = NEW.revision_id
       AND revision.asset_id = asset.id
      WHERE work.id = NEW.work_id AND work.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'evidence source must stay within its library and revision');
    END;

    CREATE TRIGGER evidence_items_source_update
    BEFORE UPDATE OF work_id, asset_id, revision_id ON evidence_items
    WHEN NOT EXISTS (
      SELECT 1
      FROM works work
      JOIN document_assets asset
        ON asset.id = NEW.asset_id
       AND asset.library_id = work.library_id
       AND asset.work_id = work.id
      JOIN document_revisions revision
        ON revision.id = NEW.revision_id
       AND revision.asset_id = asset.id
      WHERE work.id = NEW.work_id AND work.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'evidence source must stay within its library and revision');
    END;

    CREATE TRIGGER evidence_items_source_immutable
    BEFORE UPDATE OF asset_id, revision_id, source_kind, anchor_json,
      payload_kind, payload_json, source_content_hash, provenance_json ON evidence_items
    WHEN OLD.asset_id IS NOT NEW.asset_id
      OR OLD.revision_id IS NOT NEW.revision_id
      OR OLD.source_kind IS NOT NEW.source_kind
      OR OLD.anchor_json IS NOT NEW.anchor_json
      OR OLD.payload_kind IS NOT NEW.payload_kind
      OR OLD.payload_json IS NOT NEW.payload_json
      OR OLD.source_content_hash IS NOT NEW.source_content_hash
      OR OLD.provenance_json IS NOT NEW.provenance_json
    BEGIN
      SELECT RAISE(ABORT, 'evidence source and captured payload are immutable');
    END;

    CREATE TRIGGER project_evidence_scope_insert
    BEFORE INSERT ON project_evidence
    WHEN NOT EXISTS (
      SELECT 1 FROM research_projects project
      JOIN evidence_items evidence ON evidence.library_id = project.library_id
      WHERE project.id = NEW.project_id AND evidence.id = NEW.evidence_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'project evidence must stay within its library');
    END;

    CREATE TRIGGER project_evidence_scope_update
    BEFORE UPDATE OF project_id, evidence_id ON project_evidence
    WHEN NOT EXISTS (
      SELECT 1 FROM research_projects project
      JOIN evidence_items evidence ON evidence.library_id = project.library_id
      WHERE project.id = NEW.project_id AND evidence.id = NEW.evidence_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'project evidence must stay within its library');
    END;
  `);

  const attachments = await db.query<LegacyAttachmentRow>(`
    SELECT attachment.id, attachment.work_id, work.library_id,
      work.title AS work_title, attachment.kind, attachment.sha256,
      attachment.byte_size, attachment.original_filename, attachment.source_url,
      attachment.text_extracted_at, attachment.created_at, attachment.updated_at,
      attachment.deleted_at
    FROM attachments attachment
    LEFT JOIN works work ON work.id = attachment.work_id
    ORDER BY attachment.created_at, attachment.id
  `);

  for (const attachment of attachments) {
    if (!attachment.library_id || !attachment.work_title) {
      throw new Error(`Migration v19 found attachment ${attachment.id} without an owning Work`);
    }
    const assetId = documentAssetIdFromAttachment(attachment.id);
    const revisionId = documentRevisionIdFromAttachment(attachment.id);
    const title = attachment.original_filename?.trim() || attachment.work_title.trim();
    const kind = normalizedAssetKind(attachment.kind);
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
        title,
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
    if (attachment.deleted_at === null) {
      await db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
        revisionId,
        assetId,
      ]);
    }
  }
}

function normalizedAssetKind(kind: string): "pdf" | "supplement" | "other" {
  if (kind === "pdf") return "pdf";
  if (kind === "supplement") return "supplement";
  return "other";
}
