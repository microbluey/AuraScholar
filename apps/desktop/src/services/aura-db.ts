// Desktop Database driver. Runs in the renderer but every call is forwarded to
// the better-sqlite3 connection in the Electron main process via the preload
// bridge (window.aura.db). Migrations run main-side at startup.
import type { Database as AppDatabase } from "@aurascholar/db";

let instance: Promise<AppDatabase> | null = null;

export function getDb(): Promise<AppDatabase> {
  instance ??= open();
  return instance;
}

async function open(): Promise<AppDatabase> {
  const db: AppDatabase = {
    query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return window.aura.db.query<T>(sql, params);
    },
    run(sql: string, params: unknown[] = []): Promise<number> {
      return window.aura.db.run(sql, params);
    },
    exec(sql: string): Promise<void> {
      return window.aura.db.exec(sql);
    },
    queryScalar(sql: string): Promise<unknown> {
      return window.aura.db.queryScalar(sql);
    },
  };
  return db;
}
