import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import {
  encodeSegment,
  LibraryScopedSyncProvider,
  MemorySyncProvider,
  segmentPath,
  type ChangeEntry,
} from "@aurascholar/sync";
import { describe, expect, it, vi } from "vitest";
import { assertActiveLocalLibrary } from "./data-command-runtime";
import { DatabaseCoordinator } from "./database-coordinator";
import {
  MainSyncRunner,
  type MainScopedSyncProvider,
  type MainSyncRunnerDependencies,
} from "./sync-runner";
import { syncProviderScope } from "./sync-command-input";

const SETTINGS = {
  baseUrl: "https://dav.example.test/aurascholar",
  password: "app-password",
  username: "alice",
};
const LOCAL_DEVICE_ID = "main-sync-local-device";
const REMOTE_DEVICE_ID = "main-sync-remote-device";

interface TestContext {
  coordinator: DatabaseCoordinator;
  database: Database;
  dependencies: Omit<MainSyncRunnerDependencies, "createProvider">;
  libraryId: string;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

async function createContext(): Promise<TestContext> {
  const database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  const { libraryId } = await ensureLocalFirstState(database, {
    deviceId: LOCAL_DEVICE_ID,
    deviceName: "Main sync runner test",
    platform: "test",
  });
  const coordinator = new DatabaseCoordinator(database);
  return {
    coordinator,
    database,
    dependencies: {
      assertActiveLibrary: assertActiveLocalLibrary,
      getDeviceId: async () => LOCAL_DEVICE_ID,
      withDatabase: (operation) => coordinator.execute(operation),
      withDatabaseTransaction: (commandName, operation) =>
        coordinator.transaction(commandName, operation),
    },
    libraryId,
  };
}

function createScopedProvider(
  remote: MemorySyncProvider,
  transportLibraryId: string,
): MainScopedSyncProvider {
  return new LibraryScopedSyncProvider(remote, transportLibraryId, { legacyReadFallback: true });
}

function remoteWorkEntry(
  transportLibraryId: string,
  options: { owner?: string; rowId?: string; seq?: number } = {},
): ChangeEntry {
  const seq = options.seq ?? 1;
  const rowId = options.rowId ?? `remote-work-${seq}`;
  const hlc = `${String(1_000 + seq).padStart(15, "0")}-000000-${REMOTE_DEVICE_ID}`;
  const values = {
    created_at: 1_000 + seq,
    library_id: options.owner ?? transportLibraryId,
    title: `Remote work ${seq}`,
    updated_at: 1_000 + seq,
  };
  return {
    columnHlcs: Object.fromEntries(Object.keys(values).map((column) => [column, hlc])),
    deviceId: REMOTE_DEVICE_ID,
    hlc,
    op: "upsert",
    rowId,
    seq,
    table: "works",
    values,
  };
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("main-owned sync runner", () => {
  it("pushes local state and publishes the library bootstrap marker", async () => {
    const { database, dependencies, libraryId } = await createContext();
    const remote = new MemorySyncProvider();
    const createProvider = vi.fn((_settings, transportLibraryId: string) =>
      createScopedProvider(remote, transportLibraryId),
    );
    const runner = new MainSyncRunner({ ...dependencies, createProvider });
    await database.run(
      `INSERT INTO works (id, library_id, title, created_at, updated_at)
       VALUES ('main-sync-local-work', ?, 'Main-owned local work', 100, 100)`,
      [libraryId],
    );

    await expect(runner.run(SETTINGS)).resolves.toEqual({
      appliedEntries: 0,
      conflicts: 0,
      pulledEntries: 0,
      // The Library creation trigger also creates its default Project.
      pushedEntries: 2,
    });

    expect(createProvider).toHaveBeenCalledOnce();
    expect([...remote.objects.keys()]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /\/journal\/main-sync-local-device\/000000000001-000000000002\.jsonl$/,
        ),
        expect.stringMatching(/\/journal\/.library-scope-v2-complete$/),
      ]),
    );

    // `unsyncedChanges()` and `markPushed()` use one storage instance across
    // separate coordinator leases. Losing that in-memory state would leave
    // the snapshot watermark unpersisted and upload this work again.
    await expect(runner.run(SETTINGS)).resolves.toEqual({
      appliedEntries: 0,
      conflicts: 0,
      pulledEntries: 0,
      pushedEntries: 0,
    });
  });

  it("merges remote entries in one main transaction and keeps their transport owner private", async () => {
    const { database, dependencies, libraryId } = await createContext();
    const remote = new MemorySyncProvider();
    const providerScope = syncProviderScope(SETTINGS);
    const transportLibraryId = `remote:${providerScope}`;
    const publisher = createScopedProvider(remote, transportLibraryId);
    const entry = remoteWorkEntry(transportLibraryId);
    await publisher.put(
      segmentPath(REMOTE_DEVICE_ID, 1, 1),
      encodeSegment({
        deviceId: REMOTE_DEVICE_ID,
        endSeq: 1,
        entries: [entry],
        startSeq: 1,
      }),
    );
    const runner = new MainSyncRunner({
      ...dependencies,
      createProvider: (_settings, target) => createScopedProvider(remote, target),
    });

    await expect(runner.run(SETTINGS)).resolves.toMatchObject({
      appliedEntries: 1,
      pulledEntries: 1,
    });
    await expect(
      database.query<{ id: string; library_id: string; title: string }>(
        "SELECT id, library_id, title FROM works WHERE id = ?",
        [entry.rowId],
      ),
    ).resolves.toEqual([{ id: entry.rowId, library_id: libraryId, title: "Remote work 1" }]);
  });

  it("rolls back a complete remote segment when a later entry has a foreign owner", async () => {
    const { database, dependencies, libraryId } = await createContext();
    const remote = new MemorySyncProvider();
    const providerScope = syncProviderScope(SETTINGS);
    const transportLibraryId = `remote:${providerScope}`;
    const publisher = createScopedProvider(remote, transportLibraryId);
    const valid = remoteWorkEntry(transportLibraryId, { rowId: "valid-first-work", seq: 1 });
    const foreign = remoteWorkEntry(transportLibraryId, {
      owner: "remote:foreign-library",
      rowId: "foreign-second-work",
      seq: 2,
    });
    await publisher.put(
      segmentPath(REMOTE_DEVICE_ID, 1, 2),
      encodeSegment({
        deviceId: REMOTE_DEVICE_ID,
        endSeq: 2,
        entries: [valid, foreign],
        startSeq: 1,
      }),
    );
    const runner = new MainSyncRunner({
      ...dependencies,
      createProvider: (_settings, target) => createScopedProvider(remote, target),
    });

    await expect(runner.run(SETTINGS)).rejects.toThrow("Rejected cross-library sync owner");
    await expect(
      database.query<{ id: string }>(
        "SELECT id FROM works WHERE id IN ('valid-first-work', 'foreign-second-work')",
      ),
    ).resolves.toEqual([]);
    await expect(
      database.query<{ row_id: string }>(
        "SELECT row_id FROM sync_row_clocks WHERE library_id = ?",
        [libraryId],
      ),
    ).resolves.toEqual([]);
  });

  it("coalesces concurrent calls and does not hold the database coordinator during WebDAV I/O", async () => {
    const { coordinator, dependencies } = await createContext();
    const enteredPing = deferred();
    const releasePing = deferred();
    const provider: MainScopedSyncProvider = {
      delete: async () => undefined,
      get: async () => {
        throw new Error("No remote objects are expected");
      },
      id: "gated",
      list: async () => [],
      markBootstrapComplete: async () => undefined,
      ping: async () => {
        enteredPing.resolve();
        await releasePing.promise;
      },
      put: async () => undefined,
    };
    const createProvider = vi.fn(() => provider);
    const runner = new MainSyncRunner({ ...dependencies, createProvider });

    const first = runner.run(SETTINGS);
    const second = runner.run(SETTINGS);
    await enteredPing.promise;
    expect(createProvider).toHaveBeenCalledOnce();

    await expect(
      coordinator.run(
        `INSERT INTO settings (key, value_json, scope, updated_at)
         VALUES ('main-sync-network-lease-check', 'true', 'local', 1)`,
      ),
    ).resolves.toBe(1);

    releasePing.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { appliedEntries: 0, conflicts: 0, pulledEntries: 0, pushedEntries: 1 },
      { appliedEntries: 0, conflicts: 0, pulledEntries: 0, pushedEntries: 1 },
    ]);
  });
});
