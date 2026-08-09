import type { SqlExecutor } from "./migrations.js";

/** Schema v20: durable, disposable Knowledge Layer derived state. */
export async function applyKnowledgeV20(db: SqlExecutor): Promise<void> {
  const now = Date.now();
  await db.exec(`
    CREATE TABLE content_units (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'annotation', 'evidence')),
      source_id TEXT NOT NULL,
      work_id TEXT REFERENCES works(id) ON DELETE CASCADE,
      asset_id TEXT REFERENCES document_assets(id) ON DELETE CASCADE,
      revision_id TEXT REFERENCES document_revisions(id) ON DELETE CASCADE,
      parent_unit_id TEXT REFERENCES content_units(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      heading_path_json TEXT,
      anchor_json TEXT NOT NULL,
      text TEXT NOT NULL CHECK (length(trim(text)) > 0),
      language TEXT,
      token_count INTEGER CHECK (token_count IS NULL OR token_count >= 0),
      content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
      extractor_profile TEXT NOT NULL CHECK (length(trim(extractor_profile)) > 0),
      chunk_profile TEXT NOT NULL CHECK (length(trim(chunk_profile)) > 0),
      state TEXT NOT NULL CHECK (state IN ('ready', 'context-only')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX content_units_source_idx
      ON content_units(library_id, source_type, source_id, revision_id, ordinal);
    CREATE INDEX content_units_revision_idx
      ON content_units(library_id, revision_id, deleted_at, ordinal);
    CREATE INDEX content_units_hash_idx
      ON content_units(library_id, content_hash);

    CREATE TABLE knowledge_changes (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (
        source_type IN ('work', 'asset', 'revision', 'annotation', 'evidence', 'library')
      ),
      source_id TEXT NOT NULL,
      change_kind TEXT NOT NULL CHECK (change_kind IN ('upsert', 'delete', 'reindex')),
      expected_revision_id TEXT,
      expected_content_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX knowledge_changes_library_seq_idx
      ON knowledge_changes(library_id, seq);
    CREATE INDEX knowledge_changes_source_idx
      ON knowledge_changes(library_id, source_type, source_id, seq);

    CREATE TABLE knowledge_jobs (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('extract', 'chunk', 'embed', 'remove', 'reindex')),
      source_type TEXT NOT NULL CHECK (
        source_type IN ('work', 'asset', 'revision', 'annotation', 'evidence', 'library')
      ),
      source_id TEXT NOT NULL,
      expected_revision_id TEXT,
      expected_content_hash TEXT,
      index_id TEXT,
      source_change_seq INTEGER REFERENCES knowledge_changes(seq) ON DELETE SET NULL,
      dedupe_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('queued', 'leased', 'running', 'retry-wait', 'completed', 'cancelled', 'terminal-failed')
      ),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
      available_at INTEGER NOT NULL,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      progress_json TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX knowledge_jobs_claim_idx
      ON knowledge_jobs(library_id, status, available_at, created_at, id);
    CREATE INDEX knowledge_jobs_source_idx
      ON knowledge_jobs(library_id, source_type, source_id, updated_at);
    CREATE UNIQUE INDEX knowledge_jobs_change_uq
      ON knowledge_jobs(library_id, source_change_seq)
      WHERE source_change_seq IS NOT NULL;
    CREATE UNIQUE INDEX knowledge_jobs_active_dedupe_uq
      ON knowledge_jobs(library_id, dedupe_key)
      WHERE status IN ('queued', 'leased', 'running', 'retry-wait');

    -- Existing Libraries need one durable full rebuild after the Knowledge
    -- tables arrive. Fresh empty Libraries deliberately do not get a job.
    INSERT INTO knowledge_changes (
      library_id, source_type, source_id, change_kind,
      expected_revision_id, expected_content_hash, created_at
    )
    SELECT library.id, 'library', library.id, 'reindex', NULL, NULL, ${now}
    FROM libraries library
    WHERE library.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM works work
          WHERE work.library_id = library.id AND work.deleted_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM document_assets asset
          WHERE asset.library_id = library.id AND asset.deleted_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM evidence_items evidence
          WHERE evidence.library_id = library.id AND evidence.deleted_at IS NULL
        )
      );
  `);
}
