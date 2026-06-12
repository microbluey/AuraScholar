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
