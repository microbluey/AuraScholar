import { createRequire } from "node:module";
import type { Database } from "@aurascholar/db";

const requireFromRuntime = createRequire(import.meta.url);

export type SqliteVecRuntimeStatus =
  | { state: "available"; version: string }
  | { reason: "extension-load-failed" | "extension-loader-unavailable"; state: "unavailable" };

export interface LoadSqliteVecExtensionOptions {
  /** Electron packages load dylibs from app.asar.unpacked, never from app.asar. */
  isPackaged: boolean;
  /** Injectable in tests; production resolves the installed sqlite-vec package. */
  getLoadablePath?: () => string;
}

/**
 * Loads sqlite-vec only in the trusted main process. A missing or incompatible
 * extension is a capability failure, never a reason to block FTS or Library
 * startup. The caller receives no raw load error because it may expose a local
 * application path.
 */
export async function loadSqliteVecExtension(
  database: Pick<Database, "loadExtension" | "queryScalar">,
  options: LoadSqliteVecExtensionOptions,
): Promise<SqliteVecRuntimeStatus> {
  if (!database.loadExtension) {
    return { reason: "extension-loader-unavailable", state: "unavailable" };
  }

  try {
    const loadablePath = resolveSqliteVecLoadablePath(
      (options.getLoadablePath ?? getInstalledSqliteVecLoadablePath)(),
      options.isPackaged,
    );
    await database.loadExtension(loadablePath);
    const version = await database.queryScalar("SELECT vec_version() AS version");
    if (typeof version !== "string" || !version.trim()) {
      return { reason: "extension-load-failed", state: "unavailable" };
    }
    return { state: "available", version };
  } catch {
    return { reason: "extension-load-failed", state: "unavailable" };
  }
}

/** Maps an asar path to the matching native file emitted by electron-builder. */
export function resolveSqliteVecLoadablePath(loadablePath: string, isPackaged: boolean): string {
  if (!isPackaged) return loadablePath;
  return loadablePath.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}

function getInstalledSqliteVecLoadablePath(): string {
  const sqliteVec = requireFromRuntime("sqlite-vec") as { getLoadablePath: () => unknown };
  const path = sqliteVec.getLoadablePath();
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("sqlite-vec did not provide a loadable extension path");
  }
  return path;
}
