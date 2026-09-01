import { WorksRepo } from "@aurascholar/db";
import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { describe, expect, it } from "vitest";
import { SqliteSyncStorage } from "../shared/sqlite-sync-storage";

type TestDatabase = Awaited<ReturnType<typeof createNodeDatabase>>;

async function addLibrary(db: TestDatabase, id: string): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'personal', 1, 1)`,
    [id, id],
  );
}

async function addWork(
  db: TestDatabase,
  libraryId: string,
  id: string,
  title: string,
): Promise<void> {
  await db.run(
    `INSERT INTO works (id, library_id, title, created_at, updated_at)
     VALUES (?, ?, ?, 10, 10)`,
    [id, libraryId, title],
  );
}

async function addLegacyDeleteChange(
  db: TestDatabase,
  libraryId: string,
  workId: string,
  seq = 90,
): Promise<void> {
  await db.run(
    `INSERT INTO sync_log (
       seq, library_id, entity_table, entity_id, op, values_json,
       column_hlcs_json, hlc, device_id, created_at
     ) VALUES (?, ?, 'works', ?, 'delete', NULL, NULL,
               '000000000000030-000000-device-a', 'device-a', 30)`,
    [seq, libraryId, workId],
  );
}

async function addLegacyNullUpsertChange(
  db: TestDatabase,
  libraryId: string,
  workId: string,
  seq = 89,
): Promise<void> {
  await db.run(
    `INSERT INTO sync_log (
       seq, library_id, entity_table, entity_id, op, values_json,
       column_hlcs_json, hlc, device_id, created_at
     ) VALUES (?, ?, 'works', ?, 'upsert', NULL, NULL,
               '000000000000029-000000-device-a', 'device-a', 29)`,
    [seq, libraryId, workId],
  );
}

describe("Legacy SQLite delete-log replay", () => {
  it("replays and acknowledges a tombstone after physical purge", async () => {
    const dbA = await createNodeDatabase(":memory:");
    const dbB = await createNodeDatabase(":memory:");
    await runMigrations(dbA);
    await runMigrations(dbB);
    await addLibrary(dbA, "library-a");
    await addLibrary(dbB, "library-b");
    await addWork(dbA, "library-a", "legacy-delete-work", "A");
    await addWork(dbB, "library-b", "legacy-delete-work", "A");
    await addLegacyNullUpsertChange(dbA, "library-a", "unmaterialized-work");
    await addLegacyDeleteChange(dbA, "library-a", "legacy-delete-work");

    const worksA = new WorksRepo(dbA, "library-a");
    await worksA.softDelete("legacy-delete-work");
    await worksA.purgeDeleted("legacy-delete-work");
    await expect(
      dbA.query<{ id: string }>(`SELECT id FROM works WHERE id = 'legacy-delete-work'`),
    ).resolves.toEqual([]);
    await expect(
      dbA.query<{ seq: number; values_json: string | null; column_hlcs_json: string | null }>(
        `SELECT seq, values_json, column_hlcs_json FROM sync_log WHERE seq IN (89, 90) ORDER BY seq`,
      ),
    ).resolves.toEqual([
      { seq: 89, values_json: null, column_hlcs_json: null },
      { seq: 90, values_json: null, column_hlcs_json: null },
    ]);

    const storageA = new SqliteSyncStorage(dbA, "device-a", "library-a", "provider");
    const changes = await storageA.unsyncedChanges(0);
    expect(changes).toEqual([
      expect.objectContaining({
        seq: 1,
        table: "works",
        rowId: "legacy-delete-work",
        op: "delete",
        values: {},
        columnHlcs: {},
        hlc: "000000000000030-000000-device-a",
      }),
    ]);

    const storageB = new SqliteSyncStorage(dbB, "device-b", "library-b", "provider");
    await storageB.applyDelete(changes[0]!.table, changes[0]!.rowId, changes[0]!.hlc);
    await expect(
      dbB.query<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM works WHERE id = 'legacy-delete-work'`,
      ),
    ).resolves.toEqual([{ deleted_at: expect.any(Number) }]);
    await expect(storageB.rowDeleted("works", "legacy-delete-work")).resolves.toBe(true);
    await expect(storageB.rowClocks("works", "legacy-delete-work")).resolves.toMatchObject({
      deleted_at: "000000000000030-000000-device-a",
    });

    await storageA.markPushed(changes[0]!.seq, { complete: true });
    await expect(storageA.lastPushedSeq()).resolves.toBe(1);
    await expect(
      dbA.query<{ seq: number; synced_at: number | null }>(
        `SELECT seq, synced_at FROM sync_log WHERE seq IN (89, 90) ORDER BY seq`,
      ),
    ).resolves.toEqual([
      { seq: 89, synced_at: null },
      { seq: 90, synced_at: expect.any(Number) },
    ]);
    await expect(storageA.unsyncedChanges(await storageA.lastPushedSeq())).resolves.toEqual([]);
  });

  it("rejects a null-valued delete that is tagged to one Library but targets another", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await addLibrary(db, "library-b");
    await addWork(db, "library-b", "foreign-delete-work", "B");
    await addLegacyDeleteChange(db, "library-a", "foreign-delete-work", 91);

    const storage = new SqliteSyncStorage(db, "device-a", "library-a", "provider");
    await expect(storage.unsyncedChanges(0)).rejects.toThrow(
      /Rejected cross-library sync row works\.foreign-delete-work/,
    );
    await expect(
      db.query<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM works WHERE id = 'foreign-delete-work'`,
      ),
    ).resolves.toEqual([{ deleted_at: null }]);
    await expect(
      db.query<{ synced_at: number | null }>(`SELECT synced_at FROM sync_log WHERE seq = 91`),
    ).resolves.toEqual([{ synced_at: null }]);
  });

  it("continues to fail closed for nullable legacy upserts", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await db.run(
      `INSERT INTO sync_log (
         seq, library_id, entity_table, entity_id, op, values_json,
         column_hlcs_json, hlc, device_id, created_at
       ) VALUES (92, 'library-a', 'works', 'missing-work', 'upsert', NULL, NULL,
                 '000000000000030-000000-device-a', 'device-a', 30)`,
    );

    const storage = new SqliteSyncStorage(db, "device-a", "library-a", "provider");
    await expect(storage.unsyncedChanges(0)).resolves.toEqual([]);
    await expect(
      db.query<{ synced_at: number | null }>(`SELECT synced_at FROM sync_log WHERE seq = 92`),
    ).resolves.toEqual([{ synced_at: null }]);
  });

  it("rejects an unknown operation even when its legacy payload is null", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await db.run(
      `INSERT INTO sync_log (
         seq, library_id, entity_table, entity_id, op, values_json,
         column_hlcs_json, hlc, device_id, created_at
       ) VALUES (93, 'library-a', 'works', 'unknown-work', 'replace', NULL, NULL,
                 '000000000000030-000000-device-a', 'device-a', 30)`,
    );

    const storage = new SqliteSyncStorage(db, "device-a", "library-a", "provider");
    await expect(storage.unsyncedChanges(0)).rejects.toThrow(
      "Invalid local sync log entry 93: unsupported operation",
    );
  });
});
