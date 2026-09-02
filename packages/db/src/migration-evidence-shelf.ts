import type { SqlExecutor } from "./migrations.js";

/**
 * Project-local, non-authoritative staging for retrieved Evidence candidates.
 * The row deliberately stores a source snapshot rather than a polymorphic
 * pointer so a later source replacement can be surfaced as stale and never
 * silently redirected to a newer revision.
 */
export async function applyEvidenceShelfV29(db: SqlExecutor): Promise<void> {
  await db.exec(`
    CREATE TABLE evidence_shelf_items (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      work_id TEXT REFERENCES works(id) ON DELETE CASCADE,
      asset_id TEXT REFERENCES document_assets(id) ON DELETE CASCADE,
      revision_id TEXT REFERENCES document_revisions(id) ON DELETE CASCADE,
      anchor_snapshot_json TEXT NOT NULL CHECK (
        json_valid(anchor_snapshot_json) AND json_type(anchor_snapshot_json) = 'object'
      ),
      preview_payload_json TEXT NOT NULL CHECK (
        json_valid(preview_payload_json) AND json_type(preview_payload_json) = 'object'
      ),
      source_content_hash TEXT NOT NULL CHECK (
        length(source_content_hash) = 64
        AND source_content_hash NOT GLOB '*[^0-9a-f]*'
      ),
      status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'stale')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      CHECK (
        (work_id IS NOT NULL AND length(trim(work_id)) > 0)
        OR (asset_id IS NOT NULL AND length(trim(asset_id)) > 0)
        OR (revision_id IS NOT NULL AND length(trim(revision_id)) > 0)
      )
    );

    CREATE INDEX evidence_shelf_project_active_idx
      ON evidence_shelf_items(project_id, deleted_at, updated_at, id);
    CREATE INDEX evidence_shelf_library_source_idx
      ON evidence_shelf_items(library_id, work_id, asset_id, revision_id);
    -- SQLite UNIQUE treats NULLs as distinct. COALESCE keeps detached/legacy
    -- rows deduplicated too. Source type/id are extracted from the canonical
    -- preview because the table keeps the polymorphic source identity there;
    -- without them a PDF, Annotation, and Evidence row sharing a revision,
    -- hash, and anchor could return the first row's (wrong) preview. The
    -- anchor is also part of the identity so two chunks from one revision
    -- with the same hash remain separate shelf candidates. The partial
    -- predicate lets a removed row be staged again.
    CREATE UNIQUE INDEX evidence_shelf_project_source_uq
      ON evidence_shelf_items(
        project_id,
        COALESCE(work_id, ''),
        COALESCE(asset_id, ''),
        COALESCE(revision_id, ''),
        COALESCE(
          json_extract(preview_payload_json, '$.sourceType'),
          json_extract(preview_payload_json, '$.source_type'),
          ''
        ),
        COALESCE(
          json_extract(preview_payload_json, '$.sourceId'),
          json_extract(preview_payload_json, '$.source_id'),
          ''
        ),
        source_content_hash,
        anchor_snapshot_json
      )
      WHERE deleted_at IS NULL;

    CREATE TRIGGER evidence_shelf_library_immutable
    BEFORE UPDATE OF library_id ON evidence_shelf_items
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'evidence shelf library ownership is immutable');
    END;

    CREATE TRIGGER evidence_shelf_scope_insert
    BEFORE INSERT ON evidence_shelf_items
    WHEN NOT EXISTS (
      SELECT 1
      FROM research_projects project
      WHERE project.id = NEW.project_id
        AND project.library_id = NEW.library_id
    )
    OR (NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM works work
      WHERE work.id = NEW.work_id
        AND work.library_id = NEW.library_id
    ))
    OR (NEW.asset_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM document_assets asset
      WHERE asset.id = NEW.asset_id
        AND asset.library_id = NEW.library_id
        AND asset.work_id IS NEW.work_id
    ))
    OR (NEW.revision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM document_revisions revision
      JOIN document_assets asset ON asset.id = revision.asset_id
      WHERE revision.id = NEW.revision_id
        AND asset.library_id = NEW.library_id
        AND revision.asset_id IS NEW.asset_id
        AND asset.work_id IS NEW.work_id
    ))
    BEGIN
      SELECT RAISE(ABORT, 'evidence shelf source must stay within its Library and Project scope');
    END;

    CREATE TRIGGER evidence_shelf_scope_update
    BEFORE UPDATE OF project_id, work_id, asset_id, revision_id ON evidence_shelf_items
    WHEN NOT EXISTS (
      SELECT 1
      FROM research_projects project
      WHERE project.id = NEW.project_id
        AND project.library_id = NEW.library_id
    )
    OR (NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM works work
      WHERE work.id = NEW.work_id
        AND work.library_id = NEW.library_id
    ))
    OR (NEW.asset_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM document_assets asset
      WHERE asset.id = NEW.asset_id
        AND asset.library_id = NEW.library_id
        AND asset.work_id IS NEW.work_id
    ))
    OR (NEW.revision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM document_revisions revision
      JOIN document_assets asset ON asset.id = revision.asset_id
      WHERE revision.id = NEW.revision_id
        AND asset.library_id = NEW.library_id
        AND revision.asset_id IS NEW.asset_id
        AND asset.work_id IS NEW.work_id
    ))
    BEGIN
      SELECT RAISE(ABORT, 'evidence shelf source must stay within its Library and Project scope');
    END;

    CREATE TRIGGER evidence_shelf_snapshot_immutable
    BEFORE UPDATE OF work_id, asset_id, revision_id, anchor_snapshot_json,
      preview_payload_json, source_content_hash ON evidence_shelf_items
    WHEN OLD.work_id IS NOT NEW.work_id
      OR OLD.asset_id IS NOT NEW.asset_id
      OR OLD.revision_id IS NOT NEW.revision_id
      OR OLD.anchor_snapshot_json <> NEW.anchor_snapshot_json
      OR OLD.preview_payload_json <> NEW.preview_payload_json
      OR OLD.source_content_hash <> NEW.source_content_hash
    BEGIN
      SELECT RAISE(ABORT, 'evidence shelf source snapshot is immutable');
    END;
  `);
}
