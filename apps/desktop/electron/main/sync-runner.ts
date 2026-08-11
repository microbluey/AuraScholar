import { requireLocalLibraryId, type Database } from "@aurascholar/db";
import {
  HlcClock,
  LibraryScopedSyncProvider,
  SyncEngine,
  WebDavProvider,
  type SyncProvider,
  type SyncResult,
} from "@aurascholar/sync";
import type { HttpClient } from "@aurascholar/platform";
import { createMainSyncStorage } from "./main-sync-storage";
import { assertActiveLocalLibrary } from "./data-command-runtime";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import { getStableDeviceId } from "./platform";
import { mainSyncHttp } from "./sync-main-http";
import {
  normalizeMainSyncSettings,
  syncProviderScope,
  type MainSyncSettings,
} from "./sync-command-input";

export interface MainScopedSyncProvider extends SyncProvider {
  markBootstrapComplete(): Promise<void>;
}

export interface MainSyncRunnerDependencies {
  assertActiveLibrary?(database: Database, libraryId: string): Promise<void> | void;
  createProvider?(settings: MainSyncSettings, transportLibraryId: string): MainScopedSyncProvider;
  getDeviceId?(): Promise<string>;
  http?: HttpClient;
  withDatabase?<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  withDatabaseTransaction?<T>(
    commandName: string,
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T>;
}

interface MainSyncIdentity {
  deviceId: string;
  libraryId: string;
}

const defaultDependencies: Required<MainSyncRunnerDependencies> = {
  assertActiveLibrary: assertActiveLocalLibrary,
  createProvider: createDefaultProvider,
  getDeviceId: getStableDeviceId,
  http: mainSyncHttp,
  withDatabase: withMainDatabase,
  withDatabaseTransaction: withMainDatabaseTransaction,
};

/**
 * Runs a full WebDAV synchronization in the main process. Calls for the same
 * local Library coalesce, preventing overlapping push allocators from
 * publishing duplicate sequence ranges.
 */
export class MainSyncRunner {
  private readonly activeRuns = new Map<string, Promise<SyncResult>>();

  constructor(private readonly dependencies: MainSyncRunnerDependencies = {}) {}

  async run(settings: MainSyncSettings): Promise<SyncResult> {
    const normalized = normalizeMainSyncSettings(settings);
    const dependencies = this.resolvedDependencies();
    const identity = await resolveMainSyncIdentity(dependencies);
    const existing = this.activeRuns.get(identity.libraryId);
    if (existing) return existing;

    const providerScope = syncProviderScope(normalized);
    const run = this.runOne(normalized, identity, providerScope, dependencies).finally(() => {
      this.activeRuns.delete(identity.libraryId);
    });
    this.activeRuns.set(identity.libraryId, run);
    return run;
  }

  private async runOne(
    settings: MainSyncSettings,
    identity: MainSyncIdentity,
    providerScope: string,
    dependencies: Required<MainSyncRunnerDependencies>,
  ): Promise<SyncResult> {
    const transportLibraryId = `remote:${providerScope}`;
    const provider = dependencies.createProvider(settings, transportLibraryId);
    const storage = createMainSyncStorage(
      {
        deviceId: identity.deviceId,
        libraryId: identity.libraryId,
        providerScope,
        transportLibraryId,
      },
      dependencies,
    );
    const engine = new SyncEngine(
      provider,
      storage,
      identity.deviceId,
      new HlcClock(identity.deviceId),
    );

    await provider.ping();
    const result = await engine.sync();
    await provider.markBootstrapComplete();
    return result;
  }

  private resolvedDependencies(): Required<MainSyncRunnerDependencies> {
    const resolved = { ...defaultDependencies, ...this.dependencies };
    if (!this.dependencies.createProvider && this.dependencies.http) {
      resolved.createProvider = (settings, transportLibraryId) =>
        createDefaultProvider(settings, transportLibraryId, this.dependencies.http);
    }
    return resolved;
  }
}

export const mainSyncRunner = new MainSyncRunner();

export function runMainSync(settings: MainSyncSettings): Promise<SyncResult> {
  return mainSyncRunner.run(settings);
}

async function resolveMainSyncIdentity(
  dependencies: Required<MainSyncRunnerDependencies>,
): Promise<MainSyncIdentity> {
  const [deviceId, libraryId] = await Promise.all([
    dependencies.getDeviceId(),
    dependencies.withDatabase(async (database) => {
      const activeLibraryId = await requireLocalLibraryId(database);
      await dependencies.assertActiveLibrary(database, activeLibraryId);
      return activeLibraryId;
    }),
  ]);
  return { deviceId, libraryId };
}

function createDefaultProvider(
  settings: MainSyncSettings,
  transportLibraryId: string,
  http: HttpClient = mainSyncHttp,
): MainScopedSyncProvider {
  const remote = new WebDavProvider({
    baseUrl: settings.baseUrl,
    http,
    password: settings.password,
    username: settings.username,
  });
  return new LibraryScopedSyncProvider(remote, transportLibraryId, {
    legacyReadFallback: true,
  });
}
