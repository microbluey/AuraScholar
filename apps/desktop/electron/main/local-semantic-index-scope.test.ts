import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import { getActiveLibraryScopeToken, assertActiveLibraryScopeToken } from "./library-scope-token";
import type { LibraryScopeToken } from "../library-read-command-contract";
import {
  LocalSemanticIndexService,
  type LocalSemanticEmbeddingProvider,
} from "./local-semantic-index-service";

let database: Database;
let coordinator: DatabaseCoordinator;
let libraryId: string;
let provider: LocalSemanticEmbeddingProvider;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "local-semantic-index-scope",
    deviceName: "Local semantic index scope",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  provider = fakeProvider();
});

describe("LocalSemanticIndexService Library scope boundaries", () => {
  it("rejects a build that becomes stale while the embedding provider resolves", async () => {
    const expectedScope = await getActiveLibraryScopeToken(database);
    let resolveProvider!: (value: LocalSemanticEmbeddingProvider) => void;
    const providerReady = new Promise<LocalSemanticEmbeddingProvider>((resolve) => {
      resolveProvider = resolve;
    });
    const getEmbeddingProvider = vi.fn(() => providerReady);
    const service = serviceWith({ getEmbeddingProvider });

    const pendingBuild = service.enqueueBuild(libraryId, expectedScope);
    await vi.waitFor(() => expect(getEmbeddingProvider).toHaveBeenCalledTimes(1));
    await switchLocalLibrary("library:semantic-scope-switched");
    resolveProvider(provider);

    await expect(pendingBuild).rejects.toThrow("Rejected stale or foreign Library scope");
    await expect(indexRows(libraryId)).resolves.toEqual([]);
    await expect(jobRows(libraryId)).resolves.toEqual([]);
  });

  it("rolls back the generation when the scope lease fails at the enqueue boundary", async () => {
    const expectedScope = await getActiveLibraryScopeToken(database);
    let checks = 0;
    const assertScope = vi.fn(async (db: Database, scope: LibraryScopeToken) => {
      checks += 1;
      if (checks === 3) throw new Error("Rejected stale or foreign Library scope");
      return assertActiveLibraryScopeToken(db, scope);
    });
    const service = serviceWith({ assertScope });
    const profilesBefore = await profileRows();

    await expect(service.enqueueBuild(libraryId, expectedScope)).rejects.toThrow(
      "Rejected stale or foreign Library scope",
    );
    expect(checks).toBe(3);
    await expect(indexRows(libraryId)).resolves.toEqual([]);
    await expect(jobRows(libraryId)).resolves.toEqual([]);
    await expect(profileRows()).resolves.toEqual(profilesBefore);
  });

  it("rolls back profile, entries, and generation when queue insertion fails", async () => {
    const profilesBefore = await profileRows();
    const service = serviceWith({
      transaction: (commandName, operation) =>
        coordinator.transaction(commandName, async (db) =>
          operation(databaseThatRejectsJobInsert(db)),
        ),
    });

    await expect(service.enqueueBuild(libraryId)).rejects.toThrow("injected enqueue failure");
    await expect(indexRows(libraryId)).resolves.toEqual([]);
    await expect(jobRows(libraryId)).resolves.toEqual([]);
    await expect(profileRows()).resolves.toEqual(profilesBefore);
  });

  it("serializes a Library switch behind the atomic enqueue transaction", async () => {
    const expectedScope = await getActiveLibraryScopeToken(database);
    const nextLibraryId = "library:semantic-scope-queued-switch";
    let releaseTransaction!: () => void;
    const transactionHeld = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    let signalSwitchQueued!: () => void;
    const switchQueued = new Promise<void>((resolve) => {
      signalSwitchQueued = resolve;
    });
    let switchPromise: Promise<void> | null = null;
    let checks = 0;
    const assertScope = vi.fn(async (db: Database, scope: LibraryScopeToken) => {
      checks += 1;
      const current = await assertActiveLibraryScopeToken(db, scope);
      if (checks === 3) {
        switchPromise = switchLocalLibrary(nextLibraryId);
        signalSwitchQueued();
        await transactionHeld;
      }
      return current;
    });
    const service = serviceWith({ assertScope });
    const pendingBuild = service.enqueueBuild(libraryId, expectedScope);

    await switchQueued;
    releaseTransaction();
    const queued = await pendingBuild;
    if (!switchPromise) throw new Error("Library switch was not queued");
    await switchPromise;

    expect(checks).toBe(3);
    await expect(indexRows(libraryId)).resolves.toEqual([
      expect.objectContaining({ id: queued.index.id, status: "building" }),
    ]);
    await expect(jobRows(libraryId)).resolves.toHaveLength(1);
    await expect(getActiveLibraryScopeToken(database)).resolves.toMatchObject({
      libraryId: nextLibraryId,
    });
  });

  it("checks status inside its read lease instead of presenting a stale Library", async () => {
    const expectedScope = await getActiveLibraryScopeToken(database);
    const service = serviceWith();
    await switchLocalLibrary("library:semantic-scope-status");

    await expect(service.getStatus(libraryId, expectedScope)).rejects.toThrow(
      "Rejected stale or foreign Library scope",
    );
  });
});

function serviceWith(
  options: {
    assertScope?: (
      database: Database,
      expectedScope: LibraryScopeToken,
    ) => Promise<LibraryScopeToken>;
    getEmbeddingProvider?: ReturnType<typeof vi.fn>;
    transaction?: <T>(
      commandName: string,
      operation: (database: Database) => T | Promise<T>,
    ) => Promise<T>;
  } = {},
): LocalSemanticIndexService {
  return new LocalSemanticIndexService({
    assertScope: options.assertScope ?? assertActiveLibraryScopeToken,
    ensureVectorRuntime: vi.fn().mockResolvedValue(undefined),
    getEmbeddingProvider: options.getEmbeddingProvider ?? vi.fn().mockResolvedValue(provider),
    inspect: (operation) => coordinator.execute(operation),
    now: () => 1_738_361_600_000,
    transaction:
      options.transaction ??
      ((commandName, operation) => coordinator.transaction(commandName, operation)),
    vectorWriter: {
      persist: vi.fn().mockResolvedValue([]),
    },
  });
}

async function switchLocalLibrary(nextLibraryId: string): Promise<void> {
  await coordinator.transaction("test.switch-local-library", async (db) => {
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'personal', ?, ?, NULL)`,
      [nextLibraryId, "Switched test Library", now, now],
    );
    await db.run(
      `UPDATE settings SET value_json = ?, updated_at = ? WHERE key = 'local.library_id'`,
      [JSON.stringify(nextLibraryId), now],
    );
  });
}

function indexRows(scope: string): Promise<Array<{ id: string; status: string }>> {
  return coordinator.execute((db) =>
    db.query<{ id: string; status: string }>(
      `SELECT id, status FROM knowledge_indexes WHERE library_id = ? ORDER BY id`,
      [scope],
    ),
  );
}

function jobRows(scope: string): Promise<Array<{ id: string }>> {
  return coordinator.execute((db) =>
    db.query<{ id: string }>(`SELECT id FROM knowledge_jobs WHERE library_id = ? ORDER BY id`, [
      scope,
    ]),
  );
}

function profileRows(): Promise<Array<{ id: string; fingerprint: string }>> {
  return coordinator.execute((db) =>
    db.query<{ id: string; fingerprint: string }>(
      `SELECT id, fingerprint FROM embedding_profiles ORDER BY id`,
    ),
  );
}

function databaseThatRejectsJobInsert(database: Database): Database {
  return {
    query: <T>(sql: string, params: unknown[] = []) => database.query<T>(sql, params),
    run: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("INSERT OR IGNORE INTO knowledge_jobs")) {
        throw new Error("injected enqueue failure");
      }
      return database.run(sql, params);
    },
    exec: (sql: string) => database.exec(sql),
    queryScalar: (sql: string) => database.queryScalar(sql),
  };
}

function fakeProvider(): LocalSemanticEmbeddingProvider {
  return {
    dimension: 2,
    egressMode: "local",
    embedDocuments: vi.fn(async (texts: readonly string[]) =>
      texts.map(() => new Float32Array([1, 0])),
    ),
    embedQuery: vi.fn(async () => new Float32Array([1, 0])),
    embeddingProfile: {
      chunkProfileVersion: "embedding-window-mean-v1:test",
      dimension: 2,
      distanceMetric: "cosine",
      egressMode: "local",
      fingerprint: "local-semantic-index-scope-test",
      modelId: "test/local",
      modelRevision: "test@1",
      normalization: "l2",
      providerKind: "local-test",
    },
    id: "local:test",
    model: "test/local",
  };
}
