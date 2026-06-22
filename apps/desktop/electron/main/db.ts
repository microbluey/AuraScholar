// SQLite in the main process via better-sqlite3 (the same driver the db
// package's tests use). The renderer talks to this over IPC; migrations run
// once at startup. Reuses createNodeDatabase + runMigrations from @aurascholar/db.
import { join } from "node:path";
import { app, ipcMain } from "electron";
import {
  createNodeDatabase,
  ensureLocalFirstState,
  runMigrations,
  type Database,
} from "@aurascholar/db";
import { CH } from "../shared";
import { getStableDeviceId } from "./platform";

let dbPromise: Promise<Database> | null = null;

async function open(): Promise<Database> {
  const file = join(app.getPath("userData"), "aurascholar.db");
  const db = await createNodeDatabase(file);
  await runMigrations(db);
  await ensureLocalFirstState(db, {
    deviceId: await getStableDeviceId(),
    deviceName: app.name || "AuraScholar Desktop",
    platform: process.platform,
  });
  return db;
}

export function getMainDb(): Promise<Database> {
  dbPromise ??= open();
  return dbPromise;
}

export function registerDbHandlers(): void {
  ipcMain.handle(CH.dbQuery, async (_e, sql: string, params: unknown[]) => {
    return (await getMainDb()).query(sql, params);
  });
  ipcMain.handle(CH.dbRun, async (_e, sql: string, params: unknown[]) => {
    return (await getMainDb()).run(sql, params);
  });
  ipcMain.handle(CH.dbExec, async (_e, sql: string) => {
    await (await getMainDb()).exec(sql);
  });
  ipcMain.handle(CH.dbScalar, async (_e, sql: string) => {
    return (await getMainDb()).queryScalar(sql);
  });
}
