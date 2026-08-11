import type { Database } from "@aurascholar/db";
import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { describe, expect, it } from "vitest";
import { previewLibraryBackupJson } from "./sync";
import {
  exportLibraryBackupJsonFromDatabase,
  importParsedLibraryBackupIntoDatabase,
  parseLibraryBackupJson,
} from "../shared/library-backup";
import { SqliteSyncStorage } from "../shared/sqlite-sync-storage";

type TestDatabase = Awaited<ReturnType<typeof createNodeDatabase>>;

async function importLibraryBackupJsonIntoDatabase(text: string, db: Database, libraryId: string) {
  const backup = parseLibraryBackupJson(text);
  await db.exec("BEGIN");
  try {
    const summary = await importParsedLibraryBackupIntoDatabase(db, backup, libraryId);
    await db.exec("COMMIT");
    return summary;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

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
  doi: string | null = null,
): Promise<void> {
  await db.run(
    `INSERT INTO works (id, library_id, doi, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, 10, 10)`,
    [id, libraryId, doi, title],
  );
}

async function addLoggedWorkChange(
  db: TestDatabase,
  libraryId: string,
  workId: string,
  seq = 41,
): Promise<void> {
  const hlc = "000000000000020-000000-device-a";
  await db.run(
    `INSERT INTO sync_log (
       seq, library_id, entity_table, entity_id, op, values_json,
       column_hlcs_json, hlc, device_id, created_at
     ) VALUES (?, ?, 'works', ?, 'upsert', ?, ?, ?, 'device-a', 20)`,
    [
      seq,
      libraryId,
      workId,
      JSON.stringify({ library_id: libraryId, title: "Logged", updated_at: 10 }),
      JSON.stringify({ library_id: hlc, title: hlc, updated_at: hlc }),
      hlc,
    ],
  );
}

describe("Library-scoped sync storage", () => {
  it("exposes an optional process-boundary segment command without changing legacy construction", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");

    const legacy = new SqliteSyncStorage(db, "device-a", "library-a", "test-provider");
    expect(legacy.applyRemoteSegment).toBeUndefined();

    const applyRemoteSegment = async () => ({
      appliedEntries: 1,
      conflicts: 0,
      cursor: 1,
      pulledEntries: 1,
    });
    const delegated = new SqliteSyncStorage(
      db,
      "device-a",
      "library-a",
      "test-provider",
      "remote:test-provider",
      { applyRemoteSegment },
    );
    expect(delegated.applyRemoteSegment).toBe(applyRemoteSegment);
  });

  it("requires explicit remote owners and rejects foreign owners and cross-Library ids", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await addLibrary(db, "library-b");
    await addWork(db, "library-a", "work-a", "A");
    await addWork(db, "library-b", "work-b", "B");

    const storage = new SqliteSyncStorage(db, "device-a", "library-a", "test-provider");
    const hlc = "000000000000020-000000-device-b";

    await expect(
      storage.applyUpsert(
        "works",
        "unowned-work",
        { title: "Unowned", created_at: 20, updated_at: 20 },
        { title: hlc, created_at: hlc, updated_at: hlc },
      ),
    ).rejects.toThrow(/cross-library sync owner/);
    await expect(
      db.query<{ id: string }>(`SELECT id FROM works WHERE id = 'unowned-work'`),
    ).resolves.toEqual([]);

    await storage.applyUpsert(
      "works",
      "owned-work",
      { library_id: "library-a", title: "Owned", created_at: 20, updated_at: 20 },
      { library_id: hlc, title: hlc, created_at: hlc, updated_at: hlc },
    );
    await expect(
      db.query<{ library_id: string }>(`SELECT library_id FROM works WHERE id = 'owned-work'`),
    ).resolves.toEqual([{ library_id: "library-a" }]);

    await expect(
      storage.applyUpsert(
        "works",
        "foreign-owner",
        {
          library_id: "library-b",
          title: "Foreign",
          created_at: 20,
          updated_at: 20,
        },
        { library_id: hlc, title: hlc, created_at: hlc, updated_at: hlc },
      ),
    ).rejects.toThrow(/cross-library sync owner/);
    await expect(
      storage.applyUpsert(
        "works",
        "work-b",
        { library_id: "library-a", title: "Attempted overwrite", updated_at: 20 },
        { library_id: hlc, title: hlc, updated_at: hlc },
      ),
    ).rejects.toThrow(/cross-library sync row/);
    await expect(storage.applyDelete("works", "work-b", hlc)).rejects.toThrow(
      /cross-library sync row/,
    );
    await db.run(
      `INSERT INTO sentinel_tasks (
         id, library_id, work_id, title, next_poll_at, created_at, updated_at
       ) VALUES ('task-a', 'library-a', 'work-a', 'Task A', 20, 10, 10)`,
    );
    await storage.applyUpsert(
      "sentinel_tasks",
      "task-a",
      { library_id: "library-a", title: "Updated Task A", updated_at: 20 },
      { library_id: hlc, title: hlc, updated_at: hlc },
    );
    await expect(
      db.query<{ title: string }>(`SELECT title FROM sentinel_tasks WHERE id = 'task-a'`),
    ).resolves.toEqual([{ title: "Updated Task A" }]);
    await expect(
      storage.applyUpsert(
        "sentinel_tasks",
        "task-a",
        { library_id: "library-a", work_id: "work-b", updated_at: 20 },
        { library_id: hlc, work_id: hlc, updated_at: hlc },
      ),
    ).rejects.toThrow(/cross-library sentinel_tasks\.work_id/);
    await expect(
      storage.applyUpsert(
        "sentinel_tasks",
        "foreign-task",
        {
          library_id: "library-a",
          work_id: "work-b",
          title: "Foreign Task",
          next_poll_at: 20,
          created_at: 20,
          updated_at: 20,
        },
        {
          library_id: hlc,
          work_id: hlc,
          title: hlc,
          next_poll_at: hlc,
          created_at: hlc,
          updated_at: hlc,
        },
      ),
    ).rejects.toThrow(/cross-library sentinel_tasks\.work_id/);

    const changes = await storage.unsyncedChanges(0);
    expect(changes.map((entry) => entry.rowId)).toContain("work-a");
    expect(changes.map((entry) => entry.rowId)).toContain("owned-work");
    expect(changes.map((entry) => entry.rowId)).not.toContain("unowned-work");
    expect(changes.map((entry) => entry.rowId)).not.toContain("work-b");
    expect(changes.every((entry) => entry.values.library_id === "library-a")).toBe(true);
    await expect(
      db.query<{ title: string; deleted_at: number | null }>(
        `SELECT title, deleted_at FROM works WHERE id = 'work-b'`,
      ),
    ).resolves.toEqual([{ title: "B", deleted_at: null }]);
  });

  it("does not clear the snapshot watermark or log when push state cannot advance", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await addWork(db, "library-a", "work-a", "A");
    await addLoggedWorkChange(db, "library-a", "work-a");

    const failingDb: TestDatabase = {
      query: db.query.bind(db),
      exec: db.exec.bind(db),
      queryScalar: db.queryScalar.bind(db),
      async run(sql, params = []) {
        if (sql.includes("INSERT INTO sync_state")) {
          throw new Error("injected sync-state failure");
        }
        return db.run(sql, params);
      },
    };
    const storage = new SqliteSyncStorage(
      failingDb,
      "device-a",
      "library-a",
      "provider",
      "remote:provider",
    );
    const changes = await storage.unsyncedChanges(0);

    await expect(storage.markPushed(changes.at(-1)!.seq, { complete: true })).rejects.toThrow(
      "injected sync-state failure",
    );
    await expect(storage.lastPushedSeq()).resolves.toBe(0);
    await expect(
      db.query<{ synced_at: number | null }>(`SELECT synced_at FROM sync_log WHERE seq = 41`),
    ).resolves.toEqual([{ synced_at: null }]);
    await expect(
      db.query<{ key: string }>(
        `SELECT key FROM settings
         WHERE key = 'sync.library-a.provider.library-scope-v3-evidence.last_pushed_at'`,
      ),
    ).resolves.toEqual([]);
  });

  it("keeps an advanced transport cursor when later push cleanup fails", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await addWork(db, "library-a", "work-a", "A");
    await addLoggedWorkChange(db, "library-a", "work-a");

    const failingDb: TestDatabase = {
      query: db.query.bind(db),
      exec: db.exec.bind(db),
      queryScalar: db.queryScalar.bind(db),
      async run(sql, params = []) {
        if (sql.includes("INSERT INTO settings")) {
          throw new Error("injected snapshot-watermark failure");
        }
        return db.run(sql, params);
      },
    };
    const storage = new SqliteSyncStorage(
      failingDb,
      "device-a",
      "library-a",
      "provider",
      "remote:provider",
    );
    const changes = await storage.unsyncedChanges(0);
    const publishedSeq = changes.at(-1)!.seq;

    await expect(storage.markPushed(publishedSeq, { complete: true })).rejects.toThrow(
      "injected snapshot-watermark failure",
    );
    await expect(storage.lastPushedSeq()).resolves.toBe(publishedSeq);
    await expect(
      db.query<{ synced_at: number | null }>(`SELECT synced_at FROM sync_log WHERE seq = 41`),
    ).resolves.toEqual([{ synced_at: null }]);
    await expect(
      db.query<{ key: string }>(
        `SELECT key FROM settings
         WHERE key = 'sync.library-a.provider.library-scope-v3-evidence.last_pushed_at'`,
      ),
    ).resolves.toEqual([]);

    const retry = await storage.unsyncedChanges(await storage.lastPushedSeq());
    expect(retry.length).toBeGreaterThan(0);
    expect(retry.every((entry) => entry.seq > publishedSeq)).toBe(true);
    expect(retry[0]?.seq).toBe(publishedSeq + 1);
  });

  it("recovers an already-published cursor without acknowledging pending rows", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await addWork(db, "library-a", "work-a", "A");
    await addLoggedWorkChange(db, "library-a", "work-a");

    const storage = new SqliteSyncStorage(
      db,
      "device-a",
      "library-a",
      "provider",
      "remote:provider",
    );
    const firstProjection = await storage.unsyncedChanges(0);
    const publishedSeq = firstProjection.at(-1)!.seq;

    await storage.recoverPublishedSeq(publishedSeq);

    await expect(storage.lastPushedSeq()).resolves.toBe(publishedSeq);
    await expect(
      db.query<{ synced_at: number | null }>(`SELECT synced_at FROM sync_log WHERE seq = 41`),
    ).resolves.toEqual([{ synced_at: null }]);
    await expect(
      db.query<{ key: string }>(
        `SELECT key FROM settings
         WHERE key = 'sync.library-a.provider.library-scope-v3-evidence.last_pushed_at'`,
      ),
    ).resolves.toEqual([]);

    const retry = await storage.unsyncedChanges(publishedSeq);
    expect(retry.length).toBeGreaterThan(0);
    expect(retry[0]?.seq).toBe(publishedSeq + 1);
  });

  it("injects one transport owner into local logged and snapshot upserts across devices", async () => {
    const dbA = await createNodeDatabase(":memory:");
    const dbB = await createNodeDatabase(":memory:");
    await runMigrations(dbA);
    await runMigrations(dbB);
    const [ownerA] = await dbA.query<{ id: string }>(
      `SELECT id FROM libraries WHERE deleted_at IS NULL LIMIT 1`,
    );
    const [ownerB] = await dbB.query<{ id: string }>(
      `SELECT id FROM libraries WHERE deleted_at IS NULL LIMIT 1`,
    );
    expect(ownerA?.id).toBeTruthy();
    expect(ownerB?.id).toBeTruthy();
    expect(ownerA?.id).not.toBe(ownerB?.id);
    await addWork(dbA, ownerA!.id, "work-a", "A");
    await addWork(dbB, ownerB!.id, "work-b", "B");

    await addLoggedWorkChange(dbA, ownerA!.id, "work-a");

    const transportOwner = "remote:shared-target";
    const storageA = new SqliteSyncStorage(dbA, "device-a", ownerA!.id, "provider", transportOwner);
    const storageB = new SqliteSyncStorage(dbB, "device-b", ownerB!.id, "provider", transportOwner);
    const changesA = await storageA.unsyncedChanges(0);
    expect(changesA.map((entry) => entry.seq)).toEqual(changesA.map((_, index) => index + 1));
    const workA = changesA.find((entry) => entry.table === "works" && entry.rowId === "work-a");
    expect(workA?.values.library_id).toBe(transportOwner);
    await storageB.applyUpsert("works", "work-a", workA!.values, workA!.columnHlcs);
    await expect(
      dbB.query<{ library_id: string }>(`SELECT library_id FROM works WHERE id = 'work-a'`),
    ).resolves.toEqual([{ library_id: ownerB!.id }]);

    await storageA.markPushed(changesA.at(-1)!.seq, { complete: true });
    await expect(storageA.lastPushedSeq()).resolves.toBe(changesA.at(-1)!.seq);
    await expect(
      dbA.query<{ synced_at: number | null }>(`SELECT synced_at FROM sync_log WHERE seq = 41`),
    ).resolves.toEqual([{ synced_at: expect.any(Number) }]);

    const changesB = await storageB.unsyncedChanges(0);
    const workB = changesB.find((entry) => entry.table === "works" && entry.rowId === "work-b");
    expect(workB?.values.library_id).toBe(transportOwner);
    await storageA.applyUpsert("works", "work-b", workB!.values, workB!.columnHlcs);
    await expect(
      dbA.query<{ library_id: string }>(`SELECT library_id FROM works WHERE id = 'work-b'`),
    ).resolves.toEqual([{ library_id: ownerA!.id }]);
  });
});

describe("Library backup ownership", () => {
  it("exports v4 with only the selected Library graph and explicit app-global rows", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await addLibrary(db, "library-b");
    await addWork(db, "library-a", "work-a", "A");
    await addWork(db, "library-b", "work-b", "B");
    await db.run(
      `INSERT INTO attachments
         (id, work_id, sha256, byte_size, created_at, updated_at)
       VALUES ('attachment-a', 'work-a', 'sha-a', 1, 10, 10),
              ('attachment-b', 'work-b', 'sha-b', 1, 10, 10)`,
    );
    await db.run(
      `INSERT INTO authors
         (id, library_id, display_name, orcid, created_at, updated_at)
       VALUES ('author-a', 'library-a', 'Author A', 'orcid-a', 10, 10),
              ('author-b', 'library-b', 'Author B', 'orcid-b', 10, 10)`,
    );
    await db.run(
      `INSERT INTO work_authors (work_id, author_id, position)
       VALUES ('work-a', 'author-a', 0), ('work-b', 'author-b', 0)`,
    );
    await db.run(
      `INSERT INTO collections
         (id, library_id, name, created_at, updated_at)
       VALUES ('collection-a', 'library-a', 'Collection A', 10, 10),
              ('collection-b', 'library-b', 'Collection B', 10, 10)`,
    );
    await db.run(
      `INSERT INTO collection_items (collection_id, work_id)
       VALUES ('collection-a', 'work-a'), ('collection-b', 'work-b')`,
    );
    await db.run(
      `INSERT INTO tags (id, library_id, name, created_at, updated_at)
       VALUES ('tag-a', 'library-a', 'Tag A', 10, 10),
              ('tag-b', 'library-b', 'Tag B', 10, 10)`,
    );
    await db.run(
      `INSERT INTO work_tags (work_id, tag_id)
       VALUES ('work-a', 'tag-a'), ('work-b', 'tag-b')`,
    );
    await db.run(
      `INSERT INTO cv_profiles (id, display_name, created_at, updated_at)
       VALUES ('global-profile', 'Global Profile', 10, 10)`,
    );

    const text = await exportLibraryBackupJsonFromDatabase(db, "library-a");
    const backup = JSON.parse(text) as {
      sourceLibraryId: string;
      tables: Record<string, Array<Record<string, unknown>>>;
      version: number;
    };

    expect(backup.version).toBe(4);
    expect(backup.sourceLibraryId).toBe("library-a");
    expect(backup.tables.libraries?.map((row) => row.id)).toEqual(["library-a"]);
    expect(backup.tables.works?.map((row) => row.id)).toEqual(["work-a"]);
    expect(backup.tables.attachments?.map((row) => row.id)).toEqual(["attachment-a"]);
    expect(backup.tables.authors?.map((row) => row.id)).toEqual(["author-a"]);
    expect(backup.tables.work_authors).toEqual([
      expect.objectContaining({ author_id: "author-a", work_id: "work-a" }),
    ]);
    expect(backup.tables.collections?.map((row) => row.id)).toEqual(["collection-a"]);
    expect(backup.tables.collection_items).toEqual([
      expect.objectContaining({ collection_id: "collection-a", work_id: "work-a" }),
    ]);
    expect(backup.tables.tags?.map((row) => row.id)).toEqual(["tag-a"]);
    expect(backup.tables.work_tags).toEqual([
      expect.objectContaining({ tag_id: "tag-a", work_id: "work-a" }),
    ]);
    expect(backup.tables.cv_profiles?.map((row) => row.id)).toContain("global-profile");
    expect(previewLibraryBackupJson(text).sourceLibraryId).toBe("library-a");
  });

  it("rejects a v1 row without an identity before preview or import", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const backup = JSON.stringify({
      version: 1,
      exportedAt: "2026-07-27T00:00:00.000Z",
      tables: {
        libraries: [
          {
            id: "source-library",
            name: "Source",
            kind: "personal",
            created_at: 10,
            updated_at: 10,
          },
        ],
        works: [
          {
            id: "valid-work",
            title: "Must roll back",
            created_at: 10,
            updated_at: 10,
          },
          {
            title: "Missing identity",
            created_at: 10,
            updated_at: 10,
          },
        ],
      },
    });

    expect(() => previewLibraryBackupJson(backup)).toThrow(/缺失或无效的行标识：works\.id/);
    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "target-library")).rejects.toThrow(
      /缺失或无效的行标识：works\.id/,
    );
    await expect(
      db.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM works
         WHERE id IS NULL OR title IN ('Must roll back', 'Missing identity')`,
      ),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("rejects a v2 row without an identity before preview or import", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const backup = JSON.stringify({
      version: 2,
      exportedAt: "2026-07-28T00:00:00.000Z",
      sourceLibraryId: "source-library",
      tables: {
        libraries: [
          {
            id: "source-library",
            name: "Source",
            kind: "personal",
            created_at: 10,
            updated_at: 10,
          },
        ],
        works: [
          {
            id: "valid-work",
            library_id: "source-library",
            title: "Must roll back",
            created_at: 10,
            updated_at: 10,
          },
          {
            library_id: "source-library",
            title: "Missing identity",
            created_at: 10,
            updated_at: 10,
          },
        ],
      },
    });

    expect(() => previewLibraryBackupJson(backup)).toThrow(/缺失或无效的行标识：works\.id/);
    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "target-library")).rejects.toThrow(
      /缺失或无效的行标识：works\.id/,
    );
    await expect(
      db.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM works
         WHERE id IS NULL OR title IN ('Must roll back', 'Missing identity')`,
      ),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("rejects duplicate composite identities before preview or import", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const backup = JSON.stringify({
      version: 2,
      exportedAt: "2026-07-28T00:00:00.000Z",
      sourceLibraryId: "source-library",
      tables: {
        libraries: [
          {
            id: "source-library",
            name: "Source",
            kind: "personal",
            created_at: 10,
            updated_at: 10,
          },
        ],
        works: [
          {
            id: "source-work",
            library_id: "source-library",
            title: "Must roll back",
            created_at: 10,
            updated_at: 10,
          },
        ],
        authors: [
          {
            id: "source-author",
            library_id: "source-library",
            display_name: "Source Author",
            created_at: 10,
            updated_at: 10,
          },
        ],
        work_authors: [
          { work_id: "source-work", author_id: "source-author", position: 0 },
          { work_id: "source-work", author_id: "source-author", position: 1 },
        ],
      },
    });

    expect(() => previewLibraryBackupJson(backup)).toThrow(
      /重复的行标识：work_authors\.work_id\+author_id/,
    );
    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "target-library")).rejects.toThrow(
      /重复的行标识：work_authors\.work_id\+author_id/,
    );
    await expect(
      db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM works WHERE id = 'source-work'`),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("rejects a mixed-owner v2 backup before importing any row", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const backup = JSON.stringify({
      version: 2,
      exportedAt: "2026-07-28T00:00:00.000Z",
      sourceLibraryId: "source-library",
      tables: {
        libraries: [
          {
            id: "source-library",
            name: "Source",
            kind: "personal",
            created_at: 10,
            updated_at: 10,
          },
        ],
        works: [
          {
            id: "source-work",
            library_id: "source-library",
            title: "Source",
            created_at: 10,
            updated_at: 10,
          },
          {
            id: "foreign-work",
            library_id: "foreign-library",
            title: "Foreign",
            created_at: 10,
            updated_at: 10,
          },
        ],
      },
    });

    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "target-library")).rejects.toThrow(
      /混合或缺失的 Library owner/,
    );
    await expect(
      db.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM works
         WHERE id IN ('source-work', 'foreign-work')`,
      ),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("rejects v2 child rows that point outside the source Library graph", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const backup = JSON.stringify({
      version: 2,
      exportedAt: "2026-07-28T00:00:00.000Z",
      sourceLibraryId: "source-library",
      tables: {
        libraries: [
          {
            id: "source-library",
            name: "Source",
            kind: "personal",
            created_at: 10,
            updated_at: 10,
          },
        ],
        works: [
          {
            id: "source-work",
            library_id: "source-library",
            title: "Source",
            created_at: 10,
            updated_at: 10,
          },
        ],
        attachments: [
          {
            id: "foreign-attachment",
            work_id: "work-outside-backup",
            sha256: "foreign",
            byte_size: 1,
            created_at: 10,
            updated_at: 10,
          },
        ],
      },
    });

    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "target-library")).rejects.toThrow(
      /跨 Library 关系/,
    );
    await expect(
      db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM works WHERE id = 'source-work'`),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("rejects legacy child rows that target an existing foreign Library parent", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    await addLibrary(db, "foreign-library");
    await addWork(db, "foreign-library", "foreign-work", "Foreign");
    const backup = JSON.stringify({
      version: 1,
      exportedAt: "2026-07-27T00:00:00.000Z",
      tables: {
        attachments: [
          {
            id: "cross-library-attachment",
            work_id: "foreign-work",
            sha256: "foreign-sha",
            byte_size: 1,
            created_at: 10,
            updated_at: 10,
          },
        ],
      },
    });

    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "target-library")).rejects.toThrow(
      /跨 Library 关系/,
    );
    await expect(
      db.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM attachments WHERE id = 'cross-library-attachment'`,
      ),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("rejects derived payloads whose scoped source is outside the backup graph", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const backup = JSON.stringify({
      version: 2,
      exportedAt: "2026-07-28T00:00:00.000Z",
      sourceLibraryId: "source-library",
      tables: {
        libraries: [
          {
            id: "source-library",
            name: "Source",
            kind: "personal",
            created_at: 10,
            updated_at: 10,
          },
        ],
        derived_artifacts: [
          {
            id: "foreign-derived",
            library_id: "source-library",
            source_table: "works",
            source_id: "work-outside-backup",
            kind: "summary",
            payload_json: "{}",
            created_at: 10,
            updated_at: 10,
          },
        ],
      },
    });

    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "target-library")).rejects.toThrow(
      /derived_artifacts\.source_id/,
    );
  });

  it("rejects hidden Canvas references outside the source graph or workspace", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const baseLibrary = {
      id: "source-library",
      name: "Source",
      kind: "personal",
      created_at: 10,
      updated_at: 10,
    };
    const baseWorkspace = {
      id: "workspace-a",
      library_id: "source-library",
      name: "A",
      viewport_json: "{}",
      created_at: 10,
      updated_at: 10,
    };
    const node = (
      id: string,
      workspaceId: string,
      type: string,
      data: Record<string, unknown>,
    ) => ({
      id,
      workspace_id: workspaceId,
      work_id: null,
      type,
      pos_x: 0,
      pos_y: 0,
      width: 100,
      height: 100,
      data_json: JSON.stringify(data),
      created_at: 10,
      updated_at: 10,
    });
    const backup = JSON.stringify({
      version: 2,
      exportedAt: "2026-07-28T00:00:00.000Z",
      sourceLibraryId: "source-library",
      tables: {
        libraries: [baseLibrary],
        canvas_workspaces: [baseWorkspace, { ...baseWorkspace, id: "workspace-b", name: "B" }],
        canvas_nodes: [
          node("source-b", "workspace-b", "idea-note", { title: "B", markdown: "" }),
          node("synth-a", "workspace-a", "ai-synth", {
            title: "A",
            markdown: "",
            sourceNodeIds: ["source-b"],
          }),
        ],
      },
    });

    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "target-library")).rejects.toThrow(
      /sourceNodeIds/,
    );

    const excerptBackup = JSON.stringify({
      version: 2,
      exportedAt: "2026-07-28T00:00:00.000Z",
      sourceLibraryId: "source-library",
      tables: {
        libraries: [baseLibrary],
        works: [
          {
            id: "source-work",
            library_id: "source-library",
            title: "Source",
            type: "article",
            created_at: 10,
            updated_at: 10,
          },
        ],
        canvas_workspaces: [baseWorkspace],
        canvas_nodes: [
          {
            ...node("excerpt-a", "workspace-a", "excerpt", {
              workId: "work-outside-backup",
              quote: "untrusted",
            }),
            work_id: "source-work",
          },
        ],
      },
    });
    await expect(
      importLibraryBackupJsonIntoDatabase(excerptBackup, db, "target-library"),
    ).rejects.toThrow(/data_json\.workId/);
  });

  it("fails closed if a foreign root claims an import id after remapping", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    await addLibrary(db, "foreign-library");
    let injected = false;
    const racingDb: TestDatabase = {
      query: db.query.bind(db),
      exec: db.exec.bind(db),
      queryScalar: db.queryScalar.bind(db),
      async run(sql, params = []) {
        if (!injected && sql.startsWith('INSERT OR IGNORE INTO "works"')) {
          injected = true;
          await addWork(db, "foreign-library", "raced-work", "Foreign winner");
        }
        return db.run(sql, params);
      },
    };
    const backup = JSON.stringify({
      version: 2,
      exportedAt: "2026-07-28T00:00:00.000Z",
      sourceLibraryId: "source-library",
      tables: {
        libraries: [
          {
            id: "source-library",
            name: "Source",
            kind: "personal",
            created_at: 10,
            updated_at: 10,
          },
        ],
        works: [
          {
            id: "raced-work",
            library_id: "source-library",
            title: "Imported",
            type: "article",
            created_at: 10,
            updated_at: 10,
          },
        ],
      },
    });

    await expect(
      importLibraryBackupJsonIntoDatabase(backup, racingDb, "target-library"),
    ).rejects.toThrow(/跨 Library 主键或唯一键冲突/);
    expect(injected).toBe(true);
    await expect(
      db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM works WHERE id = 'raced-work'`),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("accepts v1, deduplicates only inside the target, and remaps collisions and parents", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    await addLibrary(db, "foreign-library");
    await addWork(
      db,
      "foreign-library",
      "cross-library-work-id",
      "Foreign collision",
      "10.1000/foreign",
    );
    await addWork(db, "target-library", "target-stable-work", "Target stable", "10.1000/stable");
    await db.run(
      `INSERT INTO authors
         (id, library_id, display_name, orcid, created_at, updated_at)
       VALUES
         ('cross-library-author-id', 'foreign-library', 'Foreign Author', 'foreign-orcid', 10, 10),
         ('target-stable-author', 'target-library', 'Stable Author', 'stable-orcid', 10, 10)`,
    );
    await db.run(
      `INSERT INTO tags (id, library_id, name, created_at, updated_at)
       VALUES
         ('cross-library-tag-id', 'foreign-library', 'Foreign Tag', 10, 10),
         ('target-stable-tag', 'target-library', 'Stable Tag', 10, 10)`,
    );
    await db.run(
      `INSERT INTO collections
         (id, library_id, name, created_at, updated_at)
       VALUES ('cross-library-parent-id', 'foreign-library', 'Foreign Parent', 10, 10)`,
    );

    const backup = JSON.stringify({
      version: 1,
      exportedAt: "2026-07-27T00:00:00.000Z",
      tables: {
        libraries: [
          {
            id: "source-library",
            name: "Source",
            kind: "personal",
            created_at: 10,
            updated_at: 10,
          },
        ],
        works: [
          {
            id: "cross-library-work-id",
            doi: "10.1000/imported",
            title: "Imported collision",
            created_at: 20,
            updated_at: 20,
          },
          {
            id: "source-stable-work",
            doi: "10.1000/stable",
            title: "Duplicate stable work",
            created_at: 20,
            updated_at: 20,
          },
        ],
        authors: [
          {
            id: "cross-library-author-id",
            display_name: "Imported Author",
            orcid: "imported-orcid",
            created_at: 20,
            updated_at: 20,
          },
          {
            id: "source-stable-author",
            display_name: "Duplicate Stable Author",
            orcid: "stable-orcid",
            created_at: 20,
            updated_at: 20,
          },
        ],
        work_authors: [
          {
            work_id: "cross-library-work-id",
            author_id: "cross-library-author-id",
            position: 0,
          },
          {
            work_id: "source-stable-work",
            author_id: "source-stable-author",
            position: 0,
          },
        ],
        tags: [
          {
            id: "cross-library-tag-id",
            name: "Imported Tag",
            created_at: 20,
            updated_at: 20,
          },
          {
            id: "source-stable-tag",
            name: "Stable Tag",
            created_at: 20,
            updated_at: 20,
          },
        ],
        work_tags: [
          { work_id: "cross-library-work-id", tag_id: "cross-library-tag-id" },
          { work_id: "source-stable-work", tag_id: "source-stable-tag" },
        ],
        collections: [
          {
            id: "cross-library-parent-id",
            name: "Imported Parent",
            parent_id: null,
            created_at: 20,
            updated_at: 20,
          },
          {
            id: "source-child-id",
            name: "Imported Child",
            parent_id: "cross-library-parent-id",
            created_at: 20,
            updated_at: 20,
          },
        ],
        collection_items: [{ collection_id: "source-child-id", work_id: "source-stable-work" }],
      },
    });

    await importLibraryBackupJsonIntoDatabase(backup, db, "target-library");

    const [importedWork] = await db.query<{ id: string; library_id: string }>(
      `SELECT id, library_id FROM works
       WHERE library_id = 'target-library' AND doi = '10.1000/imported'`,
    );
    expect(importedWork?.library_id).toBe("target-library");
    expect(importedWork?.id).not.toBe("cross-library-work-id");
    await expect(
      db.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM works
         WHERE library_id = 'target-library' AND doi = '10.1000/stable'`,
      ),
    ).resolves.toEqual([{ total: 1 }]);

    const [importedAuthor] = await db.query<{ id: string; library_id: string }>(
      `SELECT id, library_id FROM authors
       WHERE library_id = 'target-library' AND orcid = 'imported-orcid'`,
    );
    expect(importedAuthor?.library_id).toBe("target-library");
    expect(importedAuthor?.id).not.toBe("cross-library-author-id");
    await expect(
      db.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM authors
         WHERE library_id = 'target-library' AND orcid = 'stable-orcid'`,
      ),
    ).resolves.toEqual([{ total: 1 }]);

    const [importedTag] = await db.query<{ id: string; library_id: string }>(
      `SELECT id, library_id FROM tags
       WHERE library_id = 'target-library' AND name = 'Imported Tag'`,
    );
    expect(importedTag?.library_id).toBe("target-library");
    expect(importedTag?.id).not.toBe("cross-library-tag-id");
    await expect(
      db.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM tags
         WHERE library_id = 'target-library' AND name = 'Stable Tag'`,
      ),
    ).resolves.toEqual([{ total: 1 }]);

    const [parent] = await db.query<{ id: string; library_id: string }>(
      `SELECT id, library_id FROM collections
       WHERE library_id = 'target-library' AND name = 'Imported Parent'`,
    );
    const [child] = await db.query<{ parent_id: string }>(
      `SELECT parent_id FROM collections
       WHERE library_id = 'target-library' AND name = 'Imported Child'`,
    );
    expect(parent?.library_id).toBe("target-library");
    expect(parent?.id).not.toBe("cross-library-parent-id");
    expect(child?.parent_id).toBe(parent?.id);

    await expect(
      db.query<{ library_id: string; title: string }>(
        `SELECT library_id, title FROM works WHERE id = 'cross-library-work-id'`,
      ),
    ).resolves.toEqual([{ library_id: "foreign-library", title: "Foreign collision" }]);
  });
});

describe("library backup Canvas transaction", () => {
  it("rolls back earlier rows when a strict Canvas node insert fails", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-test");
    const backup = JSON.stringify({
      version: 1,
      exportedAt: "2026-07-27T00:00:00.000Z",
      tables: {
        works: [
          {
            id: "work-imported-before-failure",
            title: "Must roll back",
            created_at: 10,
            updated_at: 10,
          },
        ],
        canvas_workspaces: [
          {
            id: "workspace-imported-before-failure",
            name: "Must roll back",
            schema_version: 1,
            viewport_json: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
            created_at: 10,
            updated_at: 10,
          },
        ],
        canvas_nodes: [
          {
            id: "invalid-parent-group",
            workspace_id: "workspace-imported-before-failure",
            work_id: null,
            type: "group",
            pos_x: 0,
            pos_y: 0,
            width: 0,
            height: 400,
            group_id: null,
            sort_order: 0,
            tags_json: "[]",
            data_json: JSON.stringify({ title: "Invalid parent" }),
            created_at: 10,
            updated_at: 10,
          },
          {
            id: "otherwise-valid-child",
            workspace_id: "workspace-imported-before-failure",
            work_id: null,
            type: "idea-note",
            pos_x: 20,
            pos_y: 20,
            width: 280,
            height: 180,
            group_id: "invalid-parent-group",
            sort_order: 1,
            tags_json: "[]",
            data_json: JSON.stringify({
              title: "Child",
              contentMarkdown: "",
              hasEquations: false,
            }),
            created_at: 10,
            updated_at: 10,
          },
        ],
        canvas_edges: [
          {
            id: "edge-after-invalid-parent",
            workspace_id: "workspace-imported-before-failure",
            source_id: "invalid-parent-group",
            target_id: "otherwise-valid-child",
            relation_type: "custom",
            label: null,
            style_json: null,
            sort_order: 0,
            created_at: 10,
            updated_at: 10,
          },
        ],
      },
    });

    await expect(importLibraryBackupJsonIntoDatabase(backup, db, "library-test")).rejects.toThrow();

    for (const [table, id] of [
      ["works", "work-imported-before-failure"],
      ["canvas_workspaces", "workspace-imported-before-failure"],
      ["canvas_nodes", "invalid-parent-group"],
      ["canvas_nodes", "otherwise-valid-child"],
      ["canvas_edges", "edge-after-invalid-parent"],
    ] as const) {
      await expect(
        db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE id = ?`, [id]),
      ).resolves.toEqual([{ total: 0 }]);
    }
  });
});
