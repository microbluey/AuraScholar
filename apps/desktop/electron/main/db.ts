// SQLite in the main process via better-sqlite3 (the same driver the db
// package's tests use). The renderer talks to this over IPC; migrations run
// once at startup. The native SQLite driver stays in the main process so the
// renderer bundle never pulls better-sqlite3 into the browser dependency graph.
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

let databaseCoordinatorPromise: Promise<DatabaseCoordinator> | null = null;

async function open(): Promise<DatabaseCoordinator> {
  const file = join(app.getPath("userData"), "aurascholar.db");
  const db = await createNodeDatabase(file);
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

export async function withMainDatabase<T>(operation: DatabaseOperation<T>): Promise<T> {
  return (await getMainDatabaseCoordinator()).execute(operation);
}

export async function withMainDatabaseTransaction<T>(
  commandName: string,
  operation: DatabaseOperation<T>,
): Promise<T> {
  return (await getMainDatabaseCoordinator()).transaction(commandName, operation);
}

export function registerDbHandlers(): void {
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
