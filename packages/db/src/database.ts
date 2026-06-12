// Minimal parameterized-SQL interface the repositories build on. Implemented
// by: tauri-plugin-sql (desktop), @sqlite.org/sqlite-wasm in a Worker (web),
// better-sqlite3 (tests). Kept deliberately tiny so every driver is ~30 lines.
import type { SqlExecutor } from "./migrations";

export interface Database extends SqlExecutor {
  /** SELECT — returns row objects keyed by column name. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** INSERT/UPDATE/DELETE — returns affected row count. */
  run(sql: string, params?: unknown[]): Promise<number>;
}

/** Test/dev driver backed by better-sqlite3 (synchronous under the hood). */
export async function createNodeDatabase(path = ":memory:"): Promise<Database> {
  const { default: BetterSqlite3 } = await import("better-sqlite3");
  const db = new BetterSqlite3(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: unknown[] = []): Promise<number> {
      return db.prepare(sql).run(...params).changes;
    },
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
    async queryScalar(sql: string): Promise<unknown> {
      const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
      return row ? Object.values(row)[0] : undefined;
    },
  };
}
