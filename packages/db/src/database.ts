// Minimal parameterized-SQL interface the repositories build on. Implemented
// by: tauri-plugin-sql (desktop), @sqlite.org/sqlite-wasm in a Worker (web),
// better-sqlite3 (tests). Kept deliberately tiny so every driver is ~30 lines.
import type { SqlExecutor } from "./migrations.js";

export interface Database extends SqlExecutor {
  /** SELECT — returns row objects keyed by column name. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** INSERT/UPDATE/DELETE — returns affected row count. */
  run(sql: string, params?: unknown[]): Promise<number>;
  /**
   * Optional native SQLite extension hook. It is intentionally absent from web
   * and Tauri implementations; desktop capability code must handle that case.
   */
  loadExtension?(path: string): Promise<void>;
}

/** Test/dev driver backed by better-sqlite3 (synchronous under the hood). */
export async function createNodeDatabase(path = ":memory:"): Promise<Database> {
  try {
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
      async loadExtension(file: string): Promise<void> {
        db.loadExtension(file);
      },
    };
  } catch (error) {
    if (!isIncompatibleBetterSqliteBinding(error)) throw error;
    return createBuiltinNodeSqliteDatabase(path);
  }
}

/**
 * Node 22+ supplies a built-in SQLite driver. Keep it as a test/dev fallback
 * when node_modules contains a better-sqlite3 binary for another ABI (common
 * when an editor upgrades Node before dependencies are rebuilt). Electron and
 * normal Node installs continue through better-sqlite3 above.
 */
async function createBuiltinNodeSqliteDatabase(path: string): Promise<Database> {
  // Keep Vite/Vitest from trying to resolve this Node-only builtin as a web
  // module. The structural type is intentionally local to avoid a static
  // `node:sqlite` module reference in browser-oriented test transforms.
  const sqliteSpecifier = ["node", "sqlite"].join(":");
  const nativeImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<unknown>;
  const { DatabaseSync } = (await nativeImport(sqliteSpecifier)) as {
    DatabaseSync: new (
      filename: string,
      options?: { allowExtension?: boolean },
    ) => BuiltinNodeSqliteDatabase;
  };
  const db = new DatabaseSync(path, { allowExtension: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async run(sql: string, params: unknown[] = []): Promise<number> {
      return Number(db.prepare(sql).run(...(params as never[])).changes);
    },
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
    async queryScalar(sql: string): Promise<unknown> {
      const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
      return row ? Object.values(row)[0] : undefined;
    },
    async loadExtension(file: string): Promise<void> {
      db.enableLoadExtension(true);
      try {
        db.loadExtension(file);
      } finally {
        db.enableLoadExtension(false);
      }
    },
  };
}

interface BuiltinNodeSqliteDatabase {
  exec(sql: string): void;
  enableLoadExtension(enabled: boolean): void;
  loadExtension(path: string): void;
  prepare(sql: string): BuiltinNodeSqliteStatement;
}

interface BuiltinNodeSqliteStatement {
  all(...params: never[]): unknown[];
  get(): Record<string, unknown> | undefined;
  run(...params: never[]): { changes: number | bigint };
}

function isIncompatibleBetterSqliteBinding(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Could not locate the bindings file|NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(
    error.message,
  );
}
