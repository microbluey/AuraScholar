import type { SqlExecutor } from "./migrations.js";

/** Schema v21: rebuildable full-text index over immutable ContentUnits. */
export async function applyKnowledgeContentUnitsFtsV21(db: SqlExecutor): Promise<void> {
  await db.exec(`
    CREATE VIRTUAL TABLE content_units_fts USING fts5(
      text,
      content='content_units', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER content_units_fts_ai AFTER INSERT ON content_units BEGIN
      INSERT INTO content_units_fts(rowid, text)
      VALUES (new.rowid, new.text);
    END;

    CREATE TRIGGER content_units_fts_ad AFTER DELETE ON content_units BEGIN
      INSERT INTO content_units_fts(content_units_fts, rowid, text)
      VALUES ('delete', old.rowid, old.text);
    END;

    CREATE TRIGGER content_units_fts_au AFTER UPDATE OF text ON content_units BEGIN
      INSERT INTO content_units_fts(content_units_fts, rowid, text)
      VALUES ('delete', old.rowid, old.text);
      INSERT INTO content_units_fts(rowid, text)
      VALUES (new.rowid, new.text);
    END;

    -- Populate the external-content index for ContentUnits created before v21.
    INSERT INTO content_units_fts(content_units_fts) VALUES ('rebuild');
  `);
}
