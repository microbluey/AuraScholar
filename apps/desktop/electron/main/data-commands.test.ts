import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@aurascholar/db";
import { AttachmentsRepo, WorksRepo } from "@aurascholar/db";
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

  it("rejects malformed merge input before acquiring a database lease", async () => {
    let transactionCalls = 0;
    const dependencies: DataCommandDependencies = {
      async transaction() {
        transactionCalls += 1;
        throw new Error("must not run");
      },
    };
    const invalidInputs = [
      { libraryId: "library", primaryId: "primary", duplicateIds: [] },
      {
        libraryId: "library",
        primaryId: "primary",
        duplicateIds: ["duplicate", "duplicate"],
      },
      { libraryId: "library", primaryId: "primary", duplicateIds: ["primary"] },
      { libraryId: "library", primaryId: "primary", duplicateIds: new Array(1) },
      {
        libraryId: "library",
        primaryId: "primary",
        duplicateIds: Array.from({ length: 501 }, (_, index) => `duplicate-${index}`),
      },
    ];

    for (const input of invalidInputs) {
      await expect(
        executeDataCommand({ name: "library.mergeWorks", input }, dependencies),
      ).rejects.toThrow();
    }
    expect(transactionCalls).toBe(0);
  });

  it("merges active Library works through one main-process transaction", async () => {
    const target = await createLibraryDatabase("merge-target-device");
    const works = new WorksRepo(target.database, target.libraryId);
    const attachments = new AttachmentsRepo(target.database, target.libraryId);
    const primary = await works.upsert({ title: "Merge primary", doi: "10.9/main-merge-primary" });
    const duplicate = await works.upsert({
      title: "Merge duplicate",
      doi: "10.9/main-merge-duplicate",
      abstract: "Metadata moved by the command",
    });
    const attachment = await attachments.create({
      workId: duplicate.id,
      sha256: "main-command-merge-pdf",
      byteSize: 200,
    });
    const coordinator = new DatabaseCoordinator(target.database);

    await expect(
      executeDataCommand(
        {
          name: "library.mergeWorks",
          input: {
            libraryId: target.libraryId,
            primaryId: primary.id,
            duplicateIds: [duplicate.id],
          },
        },
        dependenciesFor(coordinator),
      ),
    ).resolves.toEqual({
      primaryId: primary.id,
      merged: 1,
      movedAttachments: 1,
    });

    await expect(works.get(primary.id)).resolves.toMatchObject({
      id: primary.id,
      abstract: "Metadata moved by the command",
      deleted_at: null,
    });
    await expect(works.get(duplicate.id)).resolves.toMatchObject({
      id: duplicate.id,
      deleted_at: expect.any(Number),
    });
    await expect(attachments.forWork(primary.id)).resolves.toEqual([
      expect.objectContaining({ id: attachment.id, work_id: primary.id }),
    ]);
  });

  it("rejects stale, deleted, or foreign merge targets without changing any work", async () => {
    const target = await createLibraryDatabase("merge-scope-device");
    const works = new WorksRepo(target.database, target.libraryId);
    const primary = await works.upsert({ title: "Scoped primary" });
    const deleted = await works.upsert({ title: "Deleted duplicate" });
    await works.softDelete(deleted.id);
    const now = Date.now();
    await target.database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES ('foreign-library', 'Foreign', 'personal', ?, ?, NULL)`,
      [now, now],
    );
    await target.database.run(
      `INSERT INTO works
         (id, library_id, title, type, reading_status, starred, created_at, updated_at, deleted_at)
       VALUES ('foreign-merge-work', 'foreign-library', 'Foreign merge work',
               'article', 'unread', 0, ?, ?, NULL)`,
      [now, now],
    );
    const coordinator = new DatabaseCoordinator(target.database);

    await expect(
      executeDataCommand(
        {
          name: "library.mergeWorks",
          input: {
            libraryId: target.libraryId,
            primaryId: primary.id,
            duplicateIds: ["foreign-merge-work"],
          },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("Every merge work must be active and belong to the active Library");
    await expect(
      executeDataCommand(
        {
          name: "library.mergeWorks",
          input: {
            libraryId: target.libraryId,
            primaryId: primary.id,
            duplicateIds: [deleted.id],
          },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("Every merge work must be active and belong to the active Library");
    await expect(
      executeDataCommand(
        {
          name: "library.mergeWorks",
          input: {
            libraryId: "foreign-library",
            primaryId: "foreign-merge-work",
            duplicateIds: [primary.id],
          },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("Rejected stale or foreign Library scope");

    await expect(works.get(primary.id)).resolves.toMatchObject({ deleted_at: null });
    await expect(works.get(deleted.id)).resolves.toMatchObject({
      deleted_at: expect.any(Number),
    });
    await expect(
      target.database.query<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM works WHERE id = 'foreign-merge-work'`,
      ),
    ).resolves.toEqual([{ deleted_at: null }]);
  });

  it("rolls back a failed merge before allowing a queued unrelated write", async () => {
    const target = await createLibraryDatabase("merge-rollback-device");
    const works = new WorksRepo(target.database, target.libraryId);
    const attachments = new AttachmentsRepo(target.database, target.libraryId);
    const primary = await works.upsert({ title: "Merge rollback primary" });
    const first = await works.upsert({
      title: "Merge rollback first",
      abstract: "This backfill must roll back",
    });
    const failing = await works.upsert({ title: "Merge rollback failing" });
    const firstAttachment = await attachments.create({
      workId: first.id,
      sha256: "merge-rollback-first-pdf",
      byteSize: 201,
    });
    const firstRetired = deferred();
    const releaseMerge = deferred();
    const gatedDatabase: Database = {
      query: target.database.query.bind(target.database),
      queryScalar: target.database.queryScalar.bind(target.database),
      exec: target.database.exec.bind(target.database),
      async run(sql, params = []) {
        const changes = await target.database.run(sql, params);
        if (
          sql.includes("UPDATE works") &&
          sql.includes("SET deleted_at = ?, updated_at = ?") &&
          params[2] === first.id
        ) {
          firstRetired.resolve();
          await releaseMerge.promise;
        }
        return changes;
      },
    };
    const coordinator = new DatabaseCoordinator(gatedDatabase);
    await coordinator.exec(`
      CREATE TEMP TRIGGER fail_second_main_merge
      BEFORE UPDATE OF deleted_at ON works
      WHEN OLD.id = '${failing.id}' AND NEW.deleted_at IS NOT NULL
      BEGIN
        SELECT RAISE(FAIL, 'injected main merge failure');
      END
    `);
    const mergeResult = executeDataCommand(
      {
        name: "library.mergeWorks",
        input: {
          libraryId: target.libraryId,
          primaryId: primary.id,
          duplicateIds: [first.id, failing.id],
        },
      },
      dependenciesFor(coordinator),
    );
    await firstRetired.promise;

    const queuedWrite = coordinator.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES ('uow.merge-concurrent-write', '"preserved"', 'local', ?)`,
      [Date.now()],
    );
    releaseMerge.resolve();

    await expect(mergeResult).rejects.toThrow("injected main merge failure");
    await expect(queuedWrite).resolves.toBe(1);
    await expect(works.get(primary.id)).resolves.toMatchObject({
      abstract: null,
      deleted_at: null,
    });
    await expect(works.get(first.id)).resolves.toMatchObject({ deleted_at: null });
    await expect(works.get(failing.id)).resolves.toMatchObject({ deleted_at: null });
    await expect(attachments.forWork(first.id)).resolves.toEqual([
      expect.objectContaining({ id: firstAttachment.id, work_id: first.id }),
    ]);
    await expect(
      target.database.query<{ key: string }>(
        `SELECT key FROM settings WHERE key = 'uow.merge-concurrent-write'`,
      ),
    ).resolves.toEqual([{ key: "uow.merge-concurrent-write" }]);
  });

  it("rolls back when SQLite ignores a required attachment move", async () => {
    const target = await createLibraryDatabase("merge-ignore-device");
    const works = new WorksRepo(target.database, target.libraryId);
    const attachments = new AttachmentsRepo(target.database, target.libraryId);
    const primary = await works.upsert({ title: "Ignored move primary" });
    const duplicate = await works.upsert({ title: "Ignored move duplicate" });
    const attachment = await attachments.create({
      workId: duplicate.id,
      sha256: "ignored-attachment-move",
      byteSize: 202,
    });
    const coordinator = new DatabaseCoordinator(target.database);
    await coordinator.exec(`
      CREATE TEMP TRIGGER ignore_main_merge_attachment_move
      BEFORE UPDATE OF work_id ON attachments
      WHEN OLD.id = '${attachment.id}' AND NEW.work_id = '${primary.id}'
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);

    await expect(
      executeDataCommand(
        {
          name: "library.mergeWorks",
          input: {
            libraryId: target.libraryId,
            primaryId: primary.id,
            duplicateIds: [duplicate.id],
          },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow(`Attachment ${attachment.id} could not be merged`);

    await expect(works.get(primary.id)).resolves.toMatchObject({ deleted_at: null });
    await expect(works.get(duplicate.id)).resolves.toMatchObject({ deleted_at: null });
    await expect(attachments.forWork(duplicate.id)).resolves.toEqual([
      expect.objectContaining({ id: attachment.id, work_id: duplicate.id }),
    ]);
  });

  it("rejects malformed permanent-deletion input before acquiring a database lease", async () => {
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
          name: "library.purgeDeletedWorks",
          input: { libraryId: "library", workIds: ["duplicate", "duplicate"] },
        },
        dependencies,
      ),
    ).rejects.toThrow("Work ids must be unique");
    await expect(
      executeDataCommand(
        {
          name: "library.purgeDeletedWorks",
          input: { libraryId: "library", workIds: new Array(1) },
        },
        dependencies,
      ),
    ).rejects.toThrow("Work id at index 0 is required");
    expect(transactionCalls).toBe(0);
  });

  it("permanently deletes only requested recycle-bin works", async () => {
    const target = await createLibraryDatabase("purge-target-device");
    const works = new WorksRepo(target.database, target.libraryId);
    const deleted = await works.upsert({ title: "Deleted target" });
    const active = await works.upsert({ title: "Active work" });
    await works.softDelete(deleted.id);
    const coordinator = new DatabaseCoordinator(target.database);

    await expect(
      executeDataCommand(
        {
          name: "library.purgeDeletedWorks",
          input: { libraryId: target.libraryId, workIds: [deleted.id] },
        },
        dependenciesFor(coordinator),
      ),
    ).resolves.toEqual({ purged: 1 });

    await expect(works.get(deleted.id)).resolves.toBeNull();
    await expect(works.get(active.id)).resolves.toMatchObject({ id: active.id, deleted_at: null });
  });

  it("rejects a non-recycle-bin target without deleting any requested work", async () => {
    const target = await createLibraryDatabase("purge-target-device");
    const works = new WorksRepo(target.database, target.libraryId);
    const deleted = await works.upsert({ title: "Deleted target" });
    const active = await works.upsert({ title: "Active target" });
    await works.softDelete(deleted.id);
    const coordinator = new DatabaseCoordinator(target.database);

    await expect(
      executeDataCommand(
        {
          name: "library.purgeDeletedWorks",
          input: { libraryId: target.libraryId, workIds: [deleted.id, active.id] },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("Every work must belong to the active Library recycle bin");

    await expect(works.get(deleted.id)).resolves.toMatchObject({
      id: deleted.id,
      deleted_at: expect.any(Number),
    });
    await expect(works.get(active.id)).resolves.toMatchObject({ id: active.id, deleted_at: null });
  });

  it("rejects permanent deletion for a stale or foreign Library scope", async () => {
    const target = await createLibraryDatabase("purge-target-device");
    const now = Date.now();
    await target.database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES ('foreign-library', 'Foreign', 'personal', ?, ?, NULL)`,
      [now, now],
    );
    await target.database.run(
      `INSERT INTO works
         (id, library_id, title, type, reading_status, starred, created_at, updated_at, deleted_at)
       VALUES ('foreign-deleted-work', 'foreign-library', 'Foreign deleted work',
               'article', 'unread', 0, ?, ?, ?)`,
      [now, now, now],
    );
    const coordinator = new DatabaseCoordinator(target.database);

    await expect(
      executeDataCommand(
        {
          name: "library.purgeDeletedWorks",
          input: { libraryId: "foreign-library", workIds: ["foreign-deleted-work"] },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
    await expect(
      executeDataCommand(
        {
          name: "library.purgeDeletedWorks",
          input: { libraryId: target.libraryId, workIds: ["foreign-deleted-work"] },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow("Every work must belong to the active Library recycle bin");
    await expect(
      target.database.query<{ id: string }>(
        `SELECT id FROM works WHERE id = 'foreign-deleted-work'`,
      ),
    ).resolves.toEqual([{ id: "foreign-deleted-work" }]);
  });

  it("rolls back a failed permanent deletion before allowing a queued unrelated write", async () => {
    const target = await createLibraryDatabase("purge-target-device");
    const works = new WorksRepo(target.database, target.libraryId);
    const attachments = new AttachmentsRepo(target.database, target.libraryId);
    const first = await works.upsert({ title: "Purge rollback first" });
    const second = await works.upsert({ title: "Purge rollback second" });
    const firstAttachment = await attachments.create({
      workId: first.id,
      sha256: "purge-rollback-first",
      byteSize: 101,
    });
    const secondAttachment = await attachments.create({
      workId: second.id,
      sha256: "purge-rollback-second",
      byteSize: 102,
    });
    await works.softDeleteMany([first.id, second.id]);
    const [firstTarget, failingTarget] = [first, second].sort((left, right) =>
      left.id.localeCompare(right.id),
    );

    const firstDeleted = deferred();
    const releasePurge = deferred();
    const gatedDatabase: Database = {
      query: target.database.query.bind(target.database),
      queryScalar: target.database.queryScalar.bind(target.database),
      exec: target.database.exec.bind(target.database),
      async run(sql, params = []) {
        const changes = await target.database.run(sql, params);
        if (sql.includes("DELETE FROM works WHERE id = ?") && params[0] === firstTarget!.id) {
          firstDeleted.resolve();
          await releasePurge.promise;
        }
        return changes;
      },
    };
    const coordinator = new DatabaseCoordinator(gatedDatabase);
    await coordinator.exec(`
      CREATE TEMP TRIGGER fail_second_main_purge
      BEFORE DELETE ON works
      WHEN OLD.id = '${failingTarget!.id}'
      BEGIN
        SELECT RAISE(FAIL, 'injected main purge failure');
      END
    `);
    const purgeResult = executeDataCommand(
      {
        name: "library.purgeDeletedWorks",
        input: {
          libraryId: target.libraryId,
          workIds: [firstTarget!.id, failingTarget!.id],
        },
      },
      dependenciesFor(coordinator),
    );
    await firstDeleted.promise;

    const queuedWrite = coordinator.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES ('uow.purge-concurrent-write', '"preserved"', 'local', ?)`,
      [Date.now()],
    );
    releasePurge.resolve();

    await expect(purgeResult).rejects.toThrow("injected main purge failure");
    await expect(queuedWrite).resolves.toBe(1);
    await expect(
      target.database.query<{ id: string; deleted_at: number | null }>(
        `SELECT id, deleted_at FROM works WHERE id IN (?, ?) ORDER BY id`,
        [first.id, second.id],
      ),
    ).resolves.toEqual(
      [first.id, second.id].sort().map((id) => ({ id, deleted_at: expect.any(Number) })),
    );
    await expect(
      target.database.query<{ id: string }>(
        `SELECT id FROM attachments WHERE id IN (?, ?) ORDER BY id`,
        [firstAttachment.id, secondAttachment.id],
      ),
    ).resolves.toEqual([firstAttachment.id, secondAttachment.id].sort().map((id) => ({ id })));
    await expect(
      target.database.query<{ key: string }>(
        `SELECT key FROM settings WHERE key = 'uow.purge-concurrent-write'`,
      ),
    ).resolves.toEqual([{ key: "uow.purge-concurrent-write" }]);
  });

  it("rolls back dependent cleanup when SQLite ignores the root work delete", async () => {
    const target = await createLibraryDatabase("purge-ignore-target-device");
    const works = new WorksRepo(target.database, target.libraryId);
    const attachments = new AttachmentsRepo(target.database, target.libraryId);
    const work = await works.upsert({ title: "Ignored root deletion" });
    const attachment = await attachments.create({
      workId: work.id,
      sha256: "purge-ignore-attachment",
      byteSize: 103,
    });
    await works.softDelete(work.id);
    const coordinator = new DatabaseCoordinator(target.database);
    await coordinator.exec(`
      CREATE TEMP TRIGGER ignore_main_purge
      BEFORE DELETE ON works
      WHEN OLD.id = '${work.id}'
      BEGIN
        SELECT RAISE(IGNORE);
      END
    `);

    await expect(
      executeDataCommand(
        {
          name: "library.purgeDeletedWorks",
          input: { libraryId: target.libraryId, workIds: [work.id] },
        },
        dependenciesFor(coordinator),
      ),
    ).rejects.toThrow(`Work ${work.id} could not be permanently removed`);
    await expect(works.get(work.id)).resolves.toMatchObject({
      id: work.id,
      deleted_at: expect.any(Number),
    });
    await expect(
      target.database.query<{ id: string }>(`SELECT id FROM attachments WHERE id = ?`, [
        attachment.id,
      ]),
    ).resolves.toEqual([{ id: attachment.id }]);
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
