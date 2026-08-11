import type { Database } from "@aurascholar/db";
import {
  applyRemoteSegment,
  type ApplyRemoteSegmentCommand,
  type ApplyRemoteSegmentResult,
  type SyncStorage,
} from "@aurascholar/sync";
import { SqliteSyncStorage } from "../../src/shared/sqlite-sync-storage";
import { assertActiveLocalLibrary } from "./data-command-runtime";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";

export interface MainSyncStorageIdentity {
  deviceId: string;
  libraryId: string;
  providerScope: string;
  transportLibraryId: string;
}

export interface MainSyncStorageDependencies {
  assertActiveLibrary?(database: Database, libraryId: string): Promise<void> | void;
  withDatabase?<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  withDatabaseTransaction?<T>(
    commandName: string,
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T>;
}

const defaultDependencies: Required<MainSyncStorageDependencies> = {
  assertActiveLibrary: assertActiveLocalLibrary,
  withDatabase: withMainDatabase,
  withDatabaseTransaction: withMainDatabaseTransaction,
};

/**
 * Keeps the long-lived SyncEngine state in main while each database operation
 * acquires only a short coordinator lease. In particular, WebDAV network I/O
 * never runs while an SQLite transaction is open.
 */
export function createMainSyncStorage(
  identity: MainSyncStorageIdentity,
  dependencies: MainSyncStorageDependencies = {},
): SyncStorage {
  const resolved = { ...defaultDependencies, ...dependencies };
  const scopedDatabase = new ScopedMainSyncDatabase(identity.libraryId, resolved);

  return new SqliteSyncStorage(
    scopedDatabase,
    identity.deviceId,
    identity.libraryId,
    identity.providerScope,
    identity.transportLibraryId,
    {
      applyRemoteSegment: (command) =>
        mergeRemoteSegmentInMainTransaction(command, identity, resolved),
    },
  );
}

async function mergeRemoteSegmentInMainTransaction(
  command: ApplyRemoteSegmentCommand,
  identity: MainSyncStorageIdentity,
  dependencies: Required<MainSyncStorageDependencies>,
): Promise<ApplyRemoteSegmentResult> {
  return dependencies.withDatabaseTransaction("sync.mergeRemoteSegment", async (database) => {
    await dependencies.assertActiveLibrary(database, identity.libraryId);
    const storage = new SqliteSyncStorage(
      database,
      identity.deviceId,
      identity.libraryId,
      identity.providerScope,
      identity.transportLibraryId,
    );
    return applyRemoteSegment(storage, command);
  });
}

class ScopedMainSyncDatabase implements Database {
  constructor(
    private readonly libraryId: string,
    private readonly dependencies: Required<MainSyncStorageDependencies>,
  ) {}

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.withActiveLibrary((database) => database.query<T>(sql, params));
  }

  run(sql: string, params: unknown[] = []): Promise<number> {
    return this.withActiveLibrary((database) => database.run(sql, params));
  }

  exec(sql: string): Promise<void> {
    return this.withActiveLibrary((database) => database.exec(sql));
  }

  queryScalar(sql: string): Promise<unknown> {
    return this.withActiveLibrary((database) => database.queryScalar(sql));
  }

  private async withActiveLibrary<T>(
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T> {
    return this.dependencies.withDatabase(async (database) => {
      await this.dependencies.assertActiveLibrary(database, this.libraryId);
      return await operation(database);
    });
  }
}
