// Hand-rolled migration runner: an ordered list of SQL scripts applied inside
// a transaction, tracked in _migrations. Works identically on native SQLite
// (desktop) and sqlite-wasm (web) because it only needs `exec`.
//
// FTS5 tables and triggers live here rather than in the Drizzle schema —
// Drizzle has no FTS5 support, and virtual tables must not be ORM-managed.

export interface SqlExecutor {
  exec(sql: string): void | Promise<void>;
  queryScalar(sql: string): unknown | Promise<unknown>;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

import { DDL_V1 } from "./ddl";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "schema_v1",
    sql: DDL_V1,
  },
  {
    version: 2,
    name: "fts5_works_search",
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
        title, abstract, notes_md,
        content='works', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS works_fts_ai AFTER INSERT ON works BEGIN
        INSERT INTO works_fts(rowid, title, abstract, notes_md)
        VALUES (new.rowid, new.title, new.abstract, new.notes_md);
      END;
      CREATE TRIGGER IF NOT EXISTS works_fts_ad AFTER DELETE ON works BEGIN
        INSERT INTO works_fts(works_fts, rowid, title, abstract, notes_md)
        VALUES ('delete', old.rowid, old.title, old.abstract, old.notes_md);
      END;
      CREATE TRIGGER IF NOT EXISTS works_fts_au AFTER UPDATE ON works BEGIN
        INSERT INTO works_fts(works_fts, rowid, title, abstract, notes_md)
        VALUES ('delete', old.rowid, old.title, old.abstract, old.notes_md);
        INSERT INTO works_fts(rowid, title, abstract, notes_md)
        VALUES (new.rowid, new.title, new.abstract, new.notes_md);
      END;
    `,
  },
  {
    version: 3,
    name: "sentinel_title_monitoring",
    sql: `
      ALTER TABLE sentinel_tasks ADD COLUMN hint_venue TEXT;
      ALTER TABLE sentinel_tasks ADD COLUMN hint_author TEXT;
    `,
  },
  {
    version: 4,
    name: "writing_snippets",
    sql: `
      CREATE TABLE IF NOT EXISTS snippets (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id),
        page_index INTEGER,
        quote TEXT NOT NULL,
        note_md TEXT,
        tag TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS snippets_work_idx ON snippets(work_id, created_at);
    `,
  },
  {
    version: 5,
    name: "translation_cache",
    sql: `
      CREATE TABLE IF NOT EXISTS translation_cache (
        cache_key TEXT PRIMARY KEY,
        engine TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    // Rich bibliographic metadata, modeled on EndNote's reference fields and
    // aligned to CSL-JSON variable names. These were previously only inside
    // csl_json (unqueryable, and absent for manual/BibTeX entries); promoting
    // them to columns makes them editable, searchable, and citation-ready.
    version: 6,
    name: "rich_bibliographic_fields",
    sql: `
      ALTER TABLE works ADD COLUMN volume TEXT;
      ALTER TABLE works ADD COLUMN issue TEXT;
      ALTER TABLE works ADD COLUMN pages TEXT;
      ALTER TABLE works ADD COLUMN number_of_volumes TEXT;
      ALTER TABLE works ADD COLUMN edition TEXT;
      ALTER TABLE works ADD COLUMN section TEXT;
      ALTER TABLE works ADD COLUMN publisher TEXT;
      ALTER TABLE works ADD COLUMN place_published TEXT;
      ALTER TABLE works ADD COLUMN series_title TEXT;
      ALTER TABLE works ADD COLUMN short_title TEXT;
      ALTER TABLE works ADD COLUMN original_title TEXT;
      ALTER TABLE works ADD COLUMN issn TEXT;
      ALTER TABLE works ADD COLUMN isbn TEXT;
      ALTER TABLE works ADD COLUMN url TEXT;
      ALTER TABLE works ADD COLUMN accessed_date TEXT;
      ALTER TABLE works ADD COLUMN language TEXT;
      ALTER TABLE works ADD COLUMN call_number TEXT;
      ALTER TABLE works ADD COLUMN accession_number TEXT;
      ALTER TABLE works ADD COLUMN label TEXT;
      ALTER TABLE works ADD COLUMN database_name TEXT;
      ALTER TABLE works ADD COLUMN keywords_json TEXT;
      ALTER TABLE work_authors ADD COLUMN role TEXT NOT NULL DEFAULT 'author';
    `,
  },
];

export async function runMigrations(db: SqlExecutor): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`,
  );
  const current = Number(
    (await db.queryScalar(`SELECT COALESCE(MAX(version), 0) FROM _migrations`)) ?? 0,
  );
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.exec("BEGIN");
    try {
      await db.exec(m.sql);
      await db.exec(
        `INSERT INTO _migrations (version, name, applied_at) VALUES (${m.version}, '${m.name}', ${Date.now()})`,
      );
      await db.exec("COMMIT");
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  }
}
