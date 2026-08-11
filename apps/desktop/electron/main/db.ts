// SQLite in the main process via better-sqlite3 (the same driver the db
// package's tests use). Typed main-process commands own production database
// access. The raw renderer SQL handlers below are smoke-test-only; migrations
// run once at startup and the native driver never enters the renderer bundle.
import { join } from "node:path";
import { app } from "electron";
import { handle } from "./ipc";
import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { CH } from "../shared";
import { DatabaseCoordinator, type DatabaseOperation } from "./database-coordinator";
import { getStableDeviceId } from "./platform";
import { loadSqliteVecExtension, type SqliteVecRuntimeStatus } from "./sqlite-vec-runtime";

let databaseCoordinatorPromise: Promise<DatabaseCoordinator> | null = null;
let sqliteVecRuntimeStatus: SqliteVecRuntimeStatus | null = null;

async function open(): Promise<DatabaseCoordinator> {
  const file = join(app.getPath("userData"), "aurascholar.db");
  const db = await createNodeDatabase(file);
  sqliteVecRuntimeStatus = await loadSqliteVecExtension(db, { isPackaged: app.isPackaged });
  await runMigrations(db);
  await ensureLocalFirstState(db, {
    deviceId: await getStableDeviceId(),
    deviceName: app.name || "AuraScholar Desktop",
    platform: process.platform,
  });
  return new DatabaseCoordinator(db);
}

export function getMainDatabaseCoordinator(): Promise<DatabaseCoordinator> {
  databaseCoordinatorPromise ??= open();
  return databaseCoordinatorPromise;
}

export function getMainDb(): Promise<Database> {
  return getMainDatabaseCoordinator();
}

/** Safe capability state for future semantic-index jobs; never contains a local path or raw error. */
export async function getSqliteVecRuntimeStatus(): Promise<SqliteVecRuntimeStatus> {
  await getMainDatabaseCoordinator();
  return (
    sqliteVecRuntimeStatus ?? {
      reason: "extension-loader-unavailable",
      state: "unavailable",
    }
  );
}

export async function withMainDatabase<T>(operation: DatabaseOperation<T>): Promise<T> {
  return (await getMainDatabaseCoordinator()).execute(operation);
}

export async function withMainDatabaseTransaction<T>(
  commandName: string,
  operation: DatabaseOperation<T>,
): Promise<T> {
  return (await getMainDatabaseCoordinator()).transaction(commandName, operation);
}

/** Registers raw SQL IPC only for the isolated AURASCHOLAR_SMOKE process. */
export function registerSmokeDbHandlers(): void {
  handle(CH.dbQuery, async (_e, sql: string, params: unknown[]) => {
    return (await getMainDatabaseCoordinator()).query(sql, params);
  });
  handle(CH.dbRun, async (_e, sql: string, params: unknown[]) => {
    return (await getMainDatabaseCoordinator()).run(sql, params);
  });
  handle(CH.dbExec, async (_e, sql: string) => {
    await (await getMainDatabaseCoordinator()).exec(sql);
  });
  handle(CH.dbScalar, async (_e, sql: string) => {
    return (await getMainDatabaseCoordinator()).queryScalar(sql);
  });
}
