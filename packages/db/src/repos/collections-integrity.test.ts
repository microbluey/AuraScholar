import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { CollectionsRepo } from "./collections";
import { WorksRepo } from "./works";

let db: Database;
let libraryId: string;
let collections: CollectionsRepo;
let works: WorksRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  collections = new CollectionsRepo(db, libraryId);
  works = new WorksRepo(db, libraryId);
});

async function makeWork(title: string): Promise<string> {
  return (await works.upsert({ title })).id;
}

describe("CollectionsRepo integrity", () => {
  it("rejects deleting a parent with active children without mutating the tree", async () => {
    const parentId = await collections.create("Parent");
    const childId = await collections.create("Child", parentId);

    await expect(collections.softDelete(parentId)).rejects.toThrow(
      "请先移动或删除此文件夹中的子文件夹",
    );

    expect(await collections.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: parentId, parent_id: null }),
        expect.objectContaining({ id: childId, parent_id: parentId }),
      ]),
    );
  });

  it("captures active and recycle-bin memberships in the same deletion", async () => {
    const active = await makeWork("Active Collection Member");
    const removed = await makeWork("Removed Collection Member");
    const collectionId = await collections.create("Atomic Snapshot");
    await collections.setWorksCollection([active, removed], collectionId);
    await works.softDelete(removed);

    const result = await collections.softDelete(collectionId);

    expect(result.workIds).toEqual([active, removed].sort());
    expect(
      await db.query(`SELECT * FROM collection_items WHERE collection_id = ?`, [collectionId]),
    ).toHaveLength(0);

    await expect(collections.restore(collectionId, result.workIds)).resolves.toEqual({
      restoredWorkIds: [active, removed].sort(),
      skippedWorkIds: [],
    });
    await works.restoreMany([removed]);
    expect(await collections.collectionOf(active)).toBe(collectionId);
    expect(await collections.collectionOf(removed)).toBe(collectionId);
  });

  it("restores surviving memberships and skips work purged after deletion", async () => {
    const surviving = await makeWork("Surviving Collection Member");
    const purged = await makeWork("Purged Collection Member");
    const collectionId = await collections.create("Purge-safe Undo");
    await collections.setWorksCollection([surviving, purged], collectionId);
    await works.softDelete(purged);
    const snapshot = await collections.softDelete(collectionId);
    await works.purgeDeleted(purged);

    await expect(collections.restore(collectionId, snapshot.workIds)).resolves.toEqual({
      restoredWorkIds: [surviving],
      skippedWorkIds: [purged],
    });
    expect(await collections.collectionOf(surviving)).toBe(collectionId);
  });

  it("rejects foreign work during restore and rolls back surviving memberships", async () => {
    const surviving = await makeWork("Owned Restore Member");
    const collectionId = await collections.create("Scoped Undo");
    await collections.setWorkCollection(surviving, collectionId);
    const snapshot = await collections.softDelete(collectionId);
    const foreignLibraryId = "library:collection-restore-foreign";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Restore Library', 'personal', ?, ?)`,
      [foreignLibraryId, now, now],
    );
    const foreignWork = await new WorksRepo(db, foreignLibraryId).upsert({
      title: "Foreign Restore Member",
    });

    await expect(
      collections.restore(collectionId, [...snapshot.workIds, foreignWork.id]),
    ).rejects.toThrow(`Work ${foreignWork.id} belongs to another Library`);

    expect((await collections.list()).some((row) => row.id === collectionId)).toBe(false);
    expect(
      await db.query(`SELECT * FROM collection_items WHERE collection_id = ?`, [collectionId]),
    ).toHaveLength(0);
  });

  it("does not overwrite a newer folder choice while undoing deletion", async () => {
    const workId = await makeWork("Newer Folder Choice");
    const originalId = await collections.create("Original");
    const newerId = await collections.create("Newer");
    await collections.setWorkCollection(workId, originalId);
    const snapshot = await collections.softDelete(originalId);
    await collections.setWorkCollection(workId, newerId);

    await expect(collections.restore(originalId, snapshot.workIds)).resolves.toEqual({
      restoredWorkIds: [],
      skippedWorkIds: [workId],
    });

    expect(await collections.collectionOf(workId)).toBe(newerId);
    expect(
      await db.query(`SELECT * FROM collection_items WHERE collection_id = ? AND work_id = ?`, [
        originalId,
        workId,
      ]),
    ).toHaveLength(0);
  });

  it("compacts sibling order after deleting a leaf collection", async () => {
    const first = await collections.create("First");
    const second = await collections.create("Second");
    const third = await collections.create("Third");

    await collections.softDelete(second);

    const roots = (await collections.list()).filter((row) => row.parent_id === null);
    expect(roots.map((row) => [row.id, row.sort_order])).toEqual([
      [first, 0],
      [third, 1],
    ]);
  });

  it("rejects silently ignored collection creation", async () => {
    await db.exec(`
      CREATE TEMP TRIGGER ignore_collection_create
      BEFORE INSERT ON collections
      WHEN NEW.name = 'Ignored'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    try {
      await expect(collections.create("Ignored")).rejects.toThrow(
        'Collection "Ignored" was not created',
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS ignore_collection_create");
    }
    expect(await collections.list()).toHaveLength(0);
  });

  it("rolls back when SQLite silently ignores a collection assignment", async () => {
    const workId = await makeWork("Ignored Assignment");
    const originalId = await collections.create("Original");
    const targetId = await collections.create("Target");
    await collections.setWorkCollection(workId, originalId);
    await db.exec(`
      CREATE TEMP TRIGGER ignore_collection_assignment
      BEFORE INSERT ON collection_items
      WHEN NEW.collection_id = '${targetId}'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    try {
      await expect(collections.setWorkCollection(workId, targetId)).rejects.toThrow(
        `Work ${workId} did not reach the requested collection state`,
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS ignore_collection_assignment");
    }
    expect(await collections.collectionOf(workId)).toBe(originalId);
  });

  it("rolls back when SQLite silently ignores a hierarchy move", async () => {
    const parentId = await collections.create("Parent");
    const movingId = await collections.create("Moving");
    await db.exec(`
      CREATE TEMP TRIGGER ignore_collection_move
      BEFORE UPDATE OF parent_id ON collections
      WHEN OLD.id = '${movingId}' AND NEW.parent_id = '${parentId}'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    try {
      await expect(collections.move(movingId, parentId, 0)).rejects.toThrow(
        `Collection ${movingId} was not moved`,
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS ignore_collection_move");
    }
    expect((await collections.list()).find((row) => row.id === movingId)?.parent_id).toBeNull();
  });

  it("rolls back bulk moves when a later assignment fails", async () => {
    const first = await makeWork("Bulk Move Alpha");
    const second = await makeWork("Bulk Move Beta");
    const currentId = await collections.create("Bulk Move Current");
    const targetId = await collections.create("Bulk Move Target");
    await collections.setWorksCollection([first, second], currentId);
    await db.exec(`
      CREATE TEMP TRIGGER fail_second_bulk_collection_move
      BEFORE INSERT ON collection_items
      WHEN NEW.collection_id = '${targetId}' AND NEW.work_id = '${second}'
      BEGIN
        SELECT RAISE(FAIL, 'forced bulk collection move failure');
      END;
    `);

    try {
      await expect(collections.setWorksCollection([first, second], targetId)).rejects.toThrow(
        "forced bulk collection move failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_second_bulk_collection_move");
    }

    expect(await collections.collectionOf(first)).toBe(currentId);
    expect(await collections.collectionOf(second)).toBe(currentId);
  });

  it("rolls back bulk clears when a later removal fails", async () => {
    const first = await makeWork("Bulk Clear Alpha");
    const second = await makeWork("Bulk Clear Beta");
    const collectionId = await collections.create("Bulk Clear Target");
    await collections.setWorksCollection([first, second], collectionId);
    await db.exec(`
      CREATE TEMP TRIGGER fail_second_bulk_collection_clear
      BEFORE DELETE ON collection_items
      WHEN OLD.collection_id = '${collectionId}' AND OLD.work_id = '${second}'
      BEGIN
        SELECT RAISE(FAIL, 'forced bulk collection clear failure');
      END;
    `);

    try {
      await expect(collections.setWorksCollection([first, second], null)).rejects.toThrow(
        "forced bulk collection clear failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_second_bulk_collection_clear");
    }

    expect(await collections.collectionOf(first)).toBe(collectionId);
    expect(await collections.collectionOf(second)).toBe(collectionId);
  });

  it("keeps a queued work write out of a failing collection savepoint", async () => {
    const first = await makeWork("Queued Alpha");
    const second = await makeWork("Queued Beta");
    const targetId = await collections.create("Queued Target");
    let releaseCollection!: () => void;
    let markCollectionStarted!: () => void;
    const collectionStarted = new Promise<void>((resolve) => {
      markCollectionStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseCollection = resolve;
    });
    const gatedDb: Database = {
      query: (sql, params) => db.query(sql, params),
      run: async (sql, params = []) => {
        const changed = await db.run(sql, params);
        if (
          sql.includes("INSERT INTO collection_items") &&
          params[0] === targetId &&
          params[1] === first
        ) {
          markCollectionStarted();
          await release;
        }
        return changed;
      },
      exec: (sql) => db.exec(sql),
      queryScalar: (sql) => db.queryScalar(sql),
    };
    const gatedCollections = new CollectionsRepo(gatedDb, libraryId);
    const gatedWorks = new WorksRepo(gatedDb, libraryId);
    await db.exec(`
      CREATE TEMP TRIGGER fail_second_queued_collection_assignment
      BEFORE INSERT ON collection_items
      WHEN NEW.collection_id = '${targetId}' AND NEW.work_id = '${second}'
      BEGIN
        SELECT RAISE(FAIL, 'forced queued collection rollback');
      END;
    `);

    try {
      const failingCollectionWrite = gatedCollections.setWorksCollection([first, second], targetId);
      await collectionStarted;
      let workWriteSettled = false;
      const workWrite = gatedWorks.softDelete(first).then(() => {
        workWriteSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(workWriteSettled).toBe(false);

      releaseCollection();
      await expect(failingCollectionWrite).rejects.toThrow("forced queued collection rollback");
      await expect(workWrite).resolves.toBeUndefined();
    } finally {
      releaseCollection();
      await db.exec("DROP TRIGGER IF EXISTS fail_second_queued_collection_assignment");
    }

    const workRows = await db.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM works WHERE id = ?`,
      [first],
    );
    expect(workRows[0]?.deleted_at).not.toBeNull();
    expect(
      await db.query(`SELECT * FROM collection_items WHERE collection_id = ?`, [targetId]),
    ).toHaveLength(0);
  });
});
