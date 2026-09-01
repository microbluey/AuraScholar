import type { SqlExecutor } from "./migrations.js";
import { contentUnitCanonicalVisibilitySql } from "./repos/content-unit-visibility.js";

/**
 * Schema v28: make generation-entry validation use the same canonical source
 * predicate as FTS and vector hydration.  Existing entries are deliberately
 * retained: historical generations remain auditable and read-time validation
 * hides stale rows immediately while physical cleanup stays asynchronous.
 */
export async function applyKnowledgeSourceVisibilityV28(db: SqlExecutor): Promise<void> {
  const visibleUnit = contentUnitCanonicalVisibilitySql();
  await db.exec(`
    DROP TRIGGER knowledge_index_entries_validate_insert;
    DROP TRIGGER knowledge_index_entries_validate_update;

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
          AND ${visibleUnit}
      ) THEN RAISE(ABORT, 'Knowledge index entry must pin a visible ready ContentUnit in the same Library') END;

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
          AND ${visibleUnit}
      ) THEN RAISE(ABORT, 'Knowledge index entry must pin a visible ready ContentUnit in the same Library') END;

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
  `);
}
