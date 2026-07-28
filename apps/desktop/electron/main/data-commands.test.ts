import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@aurascholar/db";
import { WorksRepo } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { segmentPath, type ApplyRemoteSegmentCommand } from "@aurascholar/sync";
import { exportLibraryBackupJsonFromDatabase } from "../../src/shared/library-backup";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function createLibraryDatabase(deviceId: string): Promise<{
  database: Database;
  libraryId: string;
}> {
  const database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  const { libraryId } = await ensureLocalFirstState(database, {
    deviceId,
    deviceName: deviceId,
    platform: "test",
  });
  return { database, libraryId };
}

function dependenciesFor(coordinator: DatabaseCoordinator): DataCommandDependencies {
  return {
    getDeviceId: async () => "local-device",
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
}

const PROVIDER_SCOPE = "webdav-00000000000000";
const REMOTE_OWNER = `remote:${PROVIDER_SCOPE}`;

function workSegment(
  entries: Array<{ omitOwner?: boolean; owner?: string; rowId: string; seq: number }>,
): ApplyRemoteSegmentCommand {
  const remoteDeviceId = "remote-device";
  const startSeq = entries[0]!.seq;
  const endSeq = entries.at(-1)!.seq;
  return {
    path: segmentPath(remoteDeviceId, startSeq, endSeq),
    deviceId: remoteDeviceId,
    startSeq,
    endSeq,
    expectedCursor: startSeq - 1,
    entries: entries.map(({ omitOwner = false, owner = REMOTE_OWNER, rowId, seq }) => {
      const hlc = `${String(1_000 + seq).padStart(15, "0")}-000000-${remoteDeviceId}`;
      const values: Record<string, unknown> = {
        title: `Remote work ${seq}`,
        created_at: 1_000 + seq,
        updated_at: 1_000 + seq,
      };
      if (!omitOwner) values.library_id = owner;
      return {
        seq,
        table: "works",
        rowId,
        op: "upsert" as const,
        values,
        columnHlcs: Object.fromEntries(Object.keys(values).map((column) => [column, hlc])),
        hlc,
        deviceId: remoteDeviceId,
      };
    }),
  };
}

describe("main-process data commands", () => {
  let backupText: string;

  beforeEach(async () => {
    const source = await createLibraryDatabase("backup-source-device");
    const works = new WorksRepo(source.database, source.libraryId);
    await works.upsert({
      title: "Main process backup command",
      doi: "10.4242/main-process-backup",
      authors: [{ displayName: "Ada Boundary", position: 0 }],
    });
    backupText = await exportLibraryBackupJsonFromDatabase(source.database, source.libraryId);
  });

  it("rejects malformed input before acquiring a database lease", async () => {
    let transactionCalls = 0;
    const dependencies: DataCommandDependencies = {
      async transaction() {
        transactionCalls += 1;
        throw new Error("must not run");
      },
    };

    await expect(
      executeDataCommand(
        {
          name: "library.importBackup",
          input: { backupText, libraryId: " " },
        },
        dependencies,
      ),
    ).rejects.toThrow("Library id is required");
    expect(transactionCalls).toBe(0);
  });

  it("revalidates the durable active Library inside the transaction", async () => {
    const target = await createLibraryDatabase("backup-target-device");
    const now = Date.now();
    await target.database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES ('foreign-library', 'Foreign', 'personal', ?, ?, NULL)`,
      [now, now],
    );
    const coordinator = new DatabaseCoordinator(target.database);

    await expect(
      executeDataCommand(
        {
          name: "library.importBackup",
          input: { backupText, libraryId: "foreign-library" },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("Rejected stale or foreign Library scope");

    await expect(
      target.database.query<{ id: string }>(
        `SELECT id FROM works WHERE library_id = 'foreign-library'`,
      ),
    ).resolves.toEqual([]);
  });

  it("imports a validated backup through one main-process transaction", async () => {
    const target = await createLibraryDatabase("backup-target-device");
    const coordinator = new DatabaseCoordinator(target.database);

    const result = await executeDataCommand(
      {
        name: "library.importBackup",
        input: { backupText, libraryId: target.libraryId },
      },
      dependenciesFor(coordinator),
    );

    expect(result).toMatchObject({ imported: expect.any(Number) });
    await expect(
      target.database.query<{ title: string }>(
        `SELECT title FROM works WHERE library_id = ? AND doi = ?`,
        [target.libraryId, "10.4242/main-process-backup"],
      ),
    ).resolves.toEqual([{ title: "Main process backup command" }]);
  });

  it("rolls back a failed import before allowing a queued unrelated write", async () => {
    const target = await createLibraryDatabase("backup-target-device");
    await target.database.exec(`
      CREATE TEMP TRIGGER fail_backup_author
      BEFORE INSERT ON authors
      BEGIN
        SELECT RAISE(FAIL, 'injected backup author failure');
      END
    `);

    const workInserted = deferred();
    const releaseImport = deferred();
    const gatedDatabase: Database = {
      query: target.database.query.bind(target.database),
      queryScalar: target.database.queryScalar.bind(target.database),
      exec: target.database.exec.bind(target.database),
      async run(sql, params = []) {
        const changes = await target.database.run(sql, params);
        if (sql.includes('INSERT OR IGNORE INTO "works"')) {
          workInserted.resolve();
          await releaseImport.promise;
        }
        return changes;
      },
    };
    const coordinator = new DatabaseCoordinator(gatedDatabase);
    const importResult = executeDataCommand(
      {
        name: "library.importBackup",
        input: { backupText, libraryId: target.libraryId },
      },
      dependenciesFor(coordinator),
    );
    await workInserted.promise;

    const queuedWrite = coordinator.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES ('uow.concurrent-write', '"preserved"', 'local', ?)`,
      [Date.now()],
    );
    releaseImport.resolve();

    await expect(importResult).rejects.toThrow("injected backup author failure");
    await expect(queuedWrite).resolves.toBe(1);
    await expect(
      target.database.query<{ id: string }>(
        `SELECT id FROM works WHERE doi = '10.4242/main-process-backup'`,
      ),
    ).resolves.toEqual([]);
    await expect(
      target.database.query<{ key: string }>(
        `SELECT key FROM settings WHERE key = 'uow.concurrent-write'`,
      ),
    ).resolves.toEqual([{ key: "uow.concurrent-write" }]);
  });

  it("applies one remote sync segment and its cursor in the same command", async () => {
    const target = await createLibraryDatabase("sync-target-device");
    const coordinator = new DatabaseCoordinator(target.database);
    const segment = workSegment([{ rowId: "remote-work", seq: 1 }]);

    const result = await executeDataCommand(
      {
        name: "sync.applyRemoteSegment",
        input: {
          libraryId: target.libraryId,
          providerScope: PROVIDER_SCOPE,
          segment,
        },
      },
      dependenciesFor(coordinator),
    );

    expect(result).toEqual({
      appliedEntries: 1,
      conflicts: 0,
      cursor: 1,
      pulledEntries: 1,
    });
    await expect(
      target.database.query<{ id: string; library_id: string }>(
        `SELECT id, library_id FROM works WHERE id = 'remote-work'`,
      ),
    ).resolves.toEqual([{ id: "remote-work", library_id: target.libraryId }]);
    await expect(
      target.database.query<{ last_pulled_cursor: string }>(
        `SELECT last_pulled_cursor
         FROM sync_state
         WHERE library_id = ? AND provider_id = ?`,
        [
          target.libraryId,
          `webdav:${PROVIDER_SCOPE}:${target.libraryId}:library-scope-v2:remote-device`,
        ],
      ),
    ).resolves.toEqual([{ last_pulled_cursor: "1" }]);
  });

  it("rejects a foreign remote owner without partially applying the segment", async () => {
    const target = await createLibraryDatabase("sync-target-device");
    const coordinator = new DatabaseCoordinator(target.database);
    const segment = workSegment([
      { rowId: "valid-first-work", seq: 1 },
      { owner: "remote:another-library", rowId: "foreign-second-work", seq: 2 },
    ]);

    await expect(
      executeDataCommand(
        {
          name: "sync.applyRemoteSegment",
          input: {
            libraryId: target.libraryId,
            providerScope: PROVIDER_SCOPE,
            segment,
          },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("Rejected cross-library sync owner");

    await expect(
      target.database.query<{ id: string }>(
        `SELECT id FROM works WHERE id IN ('valid-first-work', 'foreign-second-work')`,
      ),
    ).resolves.toEqual([]);
    await expect(
      target.database.query<{ row_id: string }>(
        `SELECT row_id FROM sync_row_clocks WHERE library_id = ?`,
        [target.libraryId],
      ),
    ).resolves.toEqual([]);
    await expect(
      target.database.query<{ provider_id: string }>(
        `SELECT provider_id FROM sync_state WHERE library_id = ?`,
        [target.libraryId],
      ),
    ).resolves.toEqual([]);
  });

  it("rejects a missing remote owner and rolls back rows, clocks, and cursor", async () => {
    const target = await createLibraryDatabase("sync-target-device");
    const coordinator = new DatabaseCoordinator(target.database);
    const segment = workSegment([
      { rowId: "valid-first-work", seq: 1 },
      { omitOwner: true, rowId: "unowned-second-work", seq: 2 },
    ]);

    await expect(
      executeDataCommand(
        {
          name: "sync.applyRemoteSegment",
          input: {
            libraryId: target.libraryId,
            providerScope: PROVIDER_SCOPE,
            segment,
          },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("Rejected cross-library sync owner");

    await expect(
      target.database.query<{ id: string }>(
        `SELECT id FROM works WHERE id IN ('valid-first-work', 'unowned-second-work')`,
      ),
    ).resolves.toEqual([]);
    await expect(
      target.database.query<{ row_id: string }>(
        `SELECT row_id
         FROM sync_row_clocks
         WHERE library_id = ?
           AND row_id IN ('valid-first-work', 'unowned-second-work')`,
        [target.libraryId],
      ),
    ).resolves.toEqual([]);
    await expect(
      target.database.query<{ provider_id: string }>(
        `SELECT provider_id
         FROM sync_state
         WHERE library_id = ?
           AND provider_id = ?`,
        [
          target.libraryId,
          `webdav:${PROVIDER_SCOPE}:${target.libraryId}:library-scope-v2:remote-device`,
        ],
      ),
    ).resolves.toEqual([]);
  });

  it("rolls back remote rows and clocks when cursor persistence fails", async () => {
    const target = await createLibraryDatabase("sync-target-device");
    const cursorFailingDatabase: Database = {
      query: target.database.query.bind(target.database),
      queryScalar: target.database.queryScalar.bind(target.database),
      exec: target.database.exec.bind(target.database),
      async run(sql, params = []) {
        if (sql.includes("INSERT INTO sync_state")) {
          throw new Error("injected sync cursor failure");
        }
        return target.database.run(sql, params);
      },
    };
    const coordinator = new DatabaseCoordinator(cursorFailingDatabase);

    await expect(
      executeDataCommand(
        {
          name: "sync.applyRemoteSegment",
          input: {
            libraryId: target.libraryId,
            providerScope: PROVIDER_SCOPE,
            segment: workSegment([{ rowId: "rolled-back-remote-work", seq: 1 }]),
          },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("injected sync cursor failure");

    await expect(
      target.database.query<{ id: string }>(
        `SELECT id FROM works WHERE id = 'rolled-back-remote-work'`,
      ),
    ).resolves.toEqual([]);
    await expect(
      target.database.query<{ row_id: string }>(
        `SELECT row_id FROM sync_row_clocks WHERE row_id = 'rolled-back-remote-work'`,
      ),
    ).resolves.toEqual([]);
  });
});
