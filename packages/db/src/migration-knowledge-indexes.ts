import type { SqlExecutor } from "./migrations.js";

/**
 * Schema v22: immutable embedding profiles plus generation-pinned Knowledge
 * indexes. These tables deliberately contain metadata and entry mappings only;
 * a native vec0 table is created lazily by the trusted desktop adapter after
 * it has verified that sqlite-vec is available.
 */
export async function applyKnowledgeIndexesV22(db: SqlExecutor): Promise<void> {
  await db.exec(`
    CREATE TABLE embedding_profiles (
      id TEXT PRIMARY KEY,
      provider_kind TEXT NOT NULL CHECK (length(trim(provider_kind)) > 0),
      egress_mode TEXT NOT NULL CHECK (egress_mode IN ('local', 'remote')),
      model_id TEXT NOT NULL CHECK (length(trim(model_id)) > 0),
      model_revision TEXT,
      dimension INTEGER NOT NULL CHECK (dimension BETWEEN 1 AND 8192),
      distance_metric TEXT NOT NULL CHECK (distance_metric IN ('cosine', 'dot', 'l2')),
      normalization TEXT NOT NULL CHECK (normalization IN ('l2', 'none')),
      chunk_profile_version TEXT NOT NULL CHECK (length(trim(chunk_profile_version)) > 0),
      fingerprint TEXT NOT NULL UNIQUE CHECK (length(trim(fingerprint)) > 0),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE knowledge_indexes (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('fulltext', 'hybrid')),
      embedding_profile_id TEXT REFERENCES embedding_profiles(id),
      generation INTEGER NOT NULL CHECK (generation >= 1),
      status TEXT NOT NULL CHECK (
        status IN ('building', 'active', 'retired', 'failed', 'garbage-collected')
      ),
      source_change_seq INTEGER NOT NULL DEFAULT 0 CHECK (source_change_seq >= 0),
      expected_count INTEGER NOT NULL CHECK (expected_count >= 0),
      indexed_count INTEGER NOT NULL DEFAULT 0 CHECK (
        indexed_count >= 0 AND indexed_count <= expected_count
      ),
      created_at INTEGER NOT NULL,
      activated_at INTEGER,
      retired_at INTEGER,
      error TEXT CHECK (error IS NULL OR length(error) <= 1024),
      CHECK (
        (mode = 'fulltext' AND embedding_profile_id IS NULL)
        OR (mode = 'hybrid' AND embedding_profile_id IS NOT NULL)
      )
    );
    CREATE UNIQUE INDEX knowledge_indexes_library_generation_uq
      ON knowledge_indexes(library_id, generation);
    CREATE UNIQUE INDEX knowledge_indexes_one_active_per_library_uq
      ON knowledge_indexes(library_id)
      WHERE status = 'active';
    CREATE INDEX knowledge_indexes_library_status_idx
      ON knowledge_indexes(library_id, status, generation DESC);

    CREATE TABLE knowledge_index_entries (
      index_id TEXT NOT NULL REFERENCES knowledge_indexes(id) ON DELETE CASCADE,
      content_unit_id TEXT NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
      vector_ref TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'retired')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (index_id, content_unit_id)
    );
    CREATE INDEX knowledge_index_entries_index_status_idx
      ON knowledge_index_entries(index_id, status, content_unit_id);
    CREATE INDEX knowledge_index_entries_content_unit_idx
      ON knowledge_index_entries(content_unit_id, status);

    CREATE TRIGGER knowledge_indexes_identity_immutable
    BEFORE UPDATE OF library_id, mode, embedding_profile_id, generation, source_change_seq
    ON knowledge_indexes
    BEGIN
      SELECT RAISE(ABORT, 'Knowledge index identity is immutable');
    END;

    CREATE TRIGGER knowledge_index_entries_validate_insert
    BEFORE INSERT ON knowledge_index_entries
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM knowledge_indexes index_generation
        JOIN content_units unit ON unit.id = NEW.content_unit_id
        WHERE index_generation.id = NEW.index_id
          AND index_generation.library_id = unit.library_id
          AND unit.content_hash = NEW.content_hash
          AND unit.state = 'ready'
          AND unit.deleted_at IS NULL
      ) THEN RAISE(ABORT, 'Knowledge index entry must pin a live ready ContentUnit in the same Library') END;

      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM knowledge_indexes
        WHERE id = NEW.index_id AND mode = 'fulltext'
      ) AND NEW.vector_ref IS NOT NULL
      THEN RAISE(ABORT, 'Full-text Knowledge index entries cannot carry a vector reference') END;

      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM knowledge_indexes
        WHERE id = NEW.index_id AND mode = 'hybrid'
      ) AND NEW.status = 'ready'
        AND (NEW.vector_ref IS NULL OR length(trim(NEW.vector_ref)) = 0)
      THEN RAISE(ABORT, 'Ready hybrid Knowledge index entries require a vector reference') END;
    END;

    CREATE TRIGGER knowledge_index_entries_validate_update
    BEFORE UPDATE OF index_id, content_unit_id, content_hash, vector_ref, status
    ON knowledge_index_entries
    WHEN NEW.status <> 'retired'
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM knowledge_indexes index_generation
        JOIN content_units unit ON unit.id = NEW.content_unit_id
        WHERE index_generation.id = NEW.index_id
          AND index_generation.library_id = unit.library_id
          AND unit.content_hash = NEW.content_hash
          AND unit.state = 'ready'
          AND unit.deleted_at IS NULL
      ) THEN RAISE(ABORT, 'Knowledge index entry must pin a live ready ContentUnit in the same Library') END;

      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM knowledge_indexes
        WHERE id = NEW.index_id AND mode = 'fulltext'
      ) AND NEW.vector_ref IS NOT NULL
      THEN RAISE(ABORT, 'Full-text Knowledge index entries cannot carry a vector reference') END;

      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM knowledge_indexes
        WHERE id = NEW.index_id AND mode = 'hybrid'
      ) AND NEW.status = 'ready'
        AND (NEW.vector_ref IS NULL OR length(trim(NEW.vector_ref)) = 0)
      THEN RAISE(ABORT, 'Ready hybrid Knowledge index entries require a vector reference') END;
    END;

    -- Canonical source retirement takes precedence over a stale semantic
    -- generation even when a legacy/raw SQL path bypasses repository helpers.
    -- Restoring a source never reactivates an old generation entry; it must be
    -- captured by an explicit rebuild instead.
    CREATE TRIGGER content_units_index_entries_retire
    AFTER UPDATE OF deleted_at ON content_units
    WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
    BEGIN
      UPDATE knowledge_index_entries
      SET status = 'retired',
          updated_at = MAX(updated_at + 1, NEW.updated_at)
      WHERE content_unit_id = NEW.id AND status <> 'retired';
    END;
  `);
}
