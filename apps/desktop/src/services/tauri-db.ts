// Desktop Database driver over tauri-plugin-sql (sqlite). The plugin keeps a
// connection pool on the Rust side; we address it by URL.
import Database from "@tauri-apps/plugin-sql";
import type { Database as AppDatabase } from "@aurascholar/db";
import { runMigrations } from "@aurascholar/db";

let instance: Promise<AppDatabase> | null = null;

export function getDb(): Promise<AppDatabase> {
  instance ??= open();
  return instance;
}

async function open(): Promise<AppDatabase> {
  const sqlite = await Database.load("sqlite:aurascholar.db");
  const db: AppDatabase = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return sqlite.select<T[]>(sql, params);
    },
    async run(sql: string, params: unknown[] = []): Promise<number> {
      const res = await sqlite.execute(sql, params);
      return res.rowsAffected;
    },
    async exec(sql: string): Promise<void> {
      await sqlite.execute(sql, []);
    },
    async queryScalar(sql: string): Promise<unknown> {
      const rows = await sqlite.select<Record<string, unknown>[]>(sql, []);
      const first = rows[0];
      return first ? Object.values(first)[0] : undefined;
    },
  };
  await runMigrations(db);
  return db;
}
