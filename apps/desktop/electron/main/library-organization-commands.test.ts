import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@aurascholar/db";
import { CollectionsRepo } from "@aurascholar/db/repos/collections";
import { TagsRepo } from "@aurascholar/db/repos/tags";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";
import { MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS } from "./data-command-runtime";

let database: Database;
let libraryId: string;
let coordinator: DatabaseCoordinator;
let dependencies: DataCommandDependencies;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "organization-command-device",
    deviceName: "Organization commands",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
  works = new WorksRepo(database, libraryId);
});

describe("Library organization data commands", () => {
  it("rejects malformed requests before acquiring a database transaction", async () => {
    let executeCalls = 0;
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("must not run");
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("must not run");
      },
    };
    const requests = [
      {
        name: "library.createCollection",
        input: { libraryId, name: " ", parentId: null },
      },
      {
        name: "library.moveCollection",
        input: { libraryId, collectionId: "collection", parentId: null, position: -1 },
      },
      {
        name: "library.addTagToWorks",
        input: { libraryId, name: "tag", workIds: ["same", "same"] },
      },
      {
        name: "library.setTagColor",
        input: { libraryId, tagId: "tag", color: { invalid: true } },
      },
      {
        name: "library.restoreCollection",
        input: { libraryId, collectionId: "collection", workIds: "not-an-array" },
      },
      {
        name: "library.listTags",
        input: { libraryId: "foreign-library" },
      },
    ];

    for (const request of requests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("lists only local tag summaries with active-work counts", async () => {
    const first = await works.upsert({ title: "First tagged work" });
    const second = await works.upsert({ title: "Second tagged work" });
    const removed = await works.upsert({ title: "Removed tagged work" });
    const tags = new TagsRepo(database, libraryId);
    const evidenceId = await tags.ensure("Evidence", "#7566f0");
    const alphaId = await tags.ensure("Alpha", "#25bfae");
    await database.run(
      `INSERT INTO work_tags (work_id, tag_id) VALUES
         (?, ?), (?, ?), (?, ?), (?, ?)`,
      [first.id, evidenceId, second.id, evidenceId, removed.id, evidenceId, first.id, alphaId],
    );
    await works.softDelete(removed.id);

    const foreignLibraryId = "library:foreign-tags";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign tags', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    await new TagsRepo(database, foreignLibraryId).ensure("Foreign", "#ffffff");

    await expect(
      executeDataCommand({ name: "library.listTags", input: {} }, dependencies),
    ).resolves.toEqual({
      tags: [
        { color: "#7566f0", count: 2, id: evidenceId, name: "Evidence" },
        { color: "#25bfae", count: 1, id: alphaId, name: "Alpha" },
      ],
    });
  });

  it("accepts Library bulk selections larger than the legacy 500-item ceiling", async () => {
    const workIds = Array.from({ length: 501 }, (_, index) => `work-${index}`);
    let transactionCalls = 0;
    const leaseProbeDependencies: DataCommandDependencies = {
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };

    await expect(
      executeDataCommand(
        {
          name: "library.addTagToWorks",
          input: { libraryId, name: "large selection", workIds },
        },
        leaseProbeDependencies,
      ),
    ).rejects.toThrow("transaction reached");
    await expect(
      executeDataCommand(
        {
          name: "library.setWorksCollection",
          input: { libraryId, collectionId: null, workIds },
        },
        leaseProbeDependencies,
      ),
    ).rejects.toThrow("transaction reached");

    expect(transactionCalls).toBe(2);
  });

  it("rejects oversized tag and collection deletion snapshots before changing data", async () => {
    const associationCount = MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS + 1;
    const now = Date.now();
    await database.run(
      `WITH digits(value) AS (
         VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9)
       ),
       numbers(value) AS (
         SELECT
           ones.value
           + tens.value * 10
           + hundreds.value * 100
           + thousands.value * 1000
           + ten_thousands.value * 10000
         FROM digits ones
         CROSS JOIN digits tens
         CROSS JOIN digits hundreds
         CROSS JOIN digits thousands
         CROSS JOIN digits ten_thousands
       )
       INSERT INTO works (
         id, library_id, title, type, reading_status, starred, created_at, updated_at
       )
       SELECT
         printf('organization-boundary-%05d', value),
         ?,
         printf('Organization boundary work %05d', value),
         'article',
         'unread',
         0,
         ?,
         ?
       FROM numbers
       WHERE value < ?`,
      [libraryId, now, now, associationCount],
    );

    const tags = new TagsRepo(database, libraryId);
    const collections = new CollectionsRepo(database, libraryId);
    const tagId = await tags.ensure("Oversized delete boundary");
    const collectionId = await collections.create("Oversized delete boundary");
    await database.run(
      `INSERT INTO work_tags (work_id, tag_id)
       SELECT id, ?
       FROM works
       WHERE library_id = ? AND id LIKE 'organization-boundary-%'`,
      [tagId, libraryId],
    );
    await database.run(
      `INSERT INTO collection_items (collection_id, work_id)
       SELECT ?, id
       FROM works
       WHERE library_id = ? AND id LIKE 'organization-boundary-%'`,
      [collectionId, libraryId],
    );

    await expect(
      executeDataCommand({ name: "library.deleteTag", input: { libraryId, tagId } }, dependencies),
    ).rejects.toThrow(`limited to ${MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS}`);
    await expect(
      executeDataCommand(
        {
          name: "library.deleteCollection",
          input: { libraryId, collectionId },
        },
        dependencies,
      ),
    ).rejects.toThrow(`limited to ${MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS}`);

    expect(
      await database.query<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM tags WHERE id = ?`,
        [tagId],
      ),
    ).toEqual([{ deleted_at: null }]);
    expect(
      await database.query<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM collections WHERE id = ?`,
        [collectionId],
      ),
    ).toEqual([{ deleted_at: null }]);
    await expect(
      database.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM work_tags WHERE tag_id = ?`,
        [tagId],
      ),
    ).resolves.toEqual([{ count: associationCount }]);
    await expect(
      database.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM collection_items WHERE collection_id = ?`,
        [collectionId],
      ),
    ).resolves.toEqual([{ count: associationCount }]);
  });

  it("runs the complete tag lifecycle through typed main-process transactions", async () => {
    const active = await works.upsert({ title: "Active Tag Command Work" });
    const removed = await works.upsert({ title: "Removed Tag Command Work" });
    const createResult = await executeDataCommand(
      {
        name: "library.createTag",
        input: { libraryId, name: "initial", color: "#7566f0" },
      },
      dependencies,
    );
    expect(createResult).toEqual({ tagId: expect.any(String), updated: 1 });
    const tagId = (createResult as { tagId: string }).tagId;

    await expect(
      executeDataCommand(
        {
          name: "library.addTagToWorks",
          input: { libraryId, name: "initial", workIds: [active.id, removed.id] },
        },
        dependencies,
      ),
    ).resolves.toEqual({ tagId, updated: 2 });
    await works.softDelete(removed.id);

    await expect(
      executeDataCommand(
        {
          name: "library.renameTag",
          input: { libraryId, tagId, name: "renamed" },
        },
        dependencies,
      ),
    ).resolves.toEqual({ tagId, updated: 1 });
    await expect(
      executeDataCommand(
        {
          name: "library.setTagColor",
          input: { libraryId, tagId, color: "#25bfae" },
        },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });

    const deletion = await executeDataCommand(
      { name: "library.deleteTag", input: { libraryId, tagId } },
      dependencies,
    );
    expect(deletion).toEqual({ workIds: [active.id, removed.id].sort() });
    await expect(
      executeDataCommand(
        {
          name: "library.restoreTag",
          input: {
            libraryId,
            tagId,
            workIds: (deletion as { workIds: string[] }).workIds,
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ tagId, updated: 2 });

    await works.restoreMany([removed.id]);
    const tags = new TagsRepo(database, libraryId);
    expect((await tags.list()).find((tag) => tag.id === tagId)).toMatchObject({
      color: "#25bfae",
      count: 2,
      name: "renamed",
    });
  });

  it("runs collection management atomically and preserves a newer folder choice", async () => {
    const work = await works.upsert({ title: "Collection Command Work" });
    const original = (await executeDataCommand(
      {
        name: "library.createCollection",
        input: { libraryId, name: "Original", parentId: null },
      },
      dependencies,
    )) as { collectionId: string };
    const newer = (await executeDataCommand(
      {
        name: "library.createCollection",
        input: { libraryId, name: "Newer", parentId: null },
      },
      dependencies,
    )) as { collectionId: string };

    await expect(
      executeDataCommand(
        {
          name: "library.renameCollection",
          input: { libraryId, collectionId: original.collectionId, name: "Renamed" },
        },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      executeDataCommand(
        {
          name: "library.moveCollection",
          input: {
            libraryId,
            collectionId: newer.collectionId,
            parentId: original.collectionId,
            position: 0,
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });
    await executeDataCommand(
      {
        name: "library.moveCollection",
        input: {
          libraryId,
          collectionId: newer.collectionId,
          parentId: null,
          position: 1,
        },
      },
      dependencies,
    );
    await expect(
      executeDataCommand(
        {
          name: "library.setWorksCollection",
          input: {
            libraryId,
            collectionId: original.collectionId,
            workIds: [work.id],
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });

    const deletion = (await executeDataCommand(
      {
        name: "library.deleteCollection",
        input: { libraryId, collectionId: original.collectionId },
      },
      dependencies,
    )) as { workIds: string[] };
    expect(deletion).toEqual({ workIds: [work.id] });
    await executeDataCommand(
      {
        name: "library.setWorksCollection",
        input: {
          libraryId,
          collectionId: newer.collectionId,
          workIds: [work.id],
        },
      },
      dependencies,
    );

    await expect(
      executeDataCommand(
        {
          name: "library.restoreCollection",
          input: {
            libraryId,
            collectionId: original.collectionId,
            workIds: deletion.workIds,
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ restoredWorkIds: [], skippedWorkIds: [work.id] });
    expect(await new CollectionsRepo(database, libraryId).collectionOf(work.id)).toBe(
      newer.collectionId,
    );
  });

  it("rolls back deletion when a collection still owns child folders", async () => {
    const collections = new CollectionsRepo(database, libraryId);
    const parentId = await collections.create("Parent");
    const childId = await collections.create("Child", parentId);

    await expect(
      executeDataCommand(
        {
          name: "library.deleteCollection",
          input: { libraryId, collectionId: parentId },
        },
        dependencies,
      ),
    ).rejects.toThrow("请先移动或删除此文件夹中的子文件夹");

    expect(await collections.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: parentId, parent_id: null }),
        expect.objectContaining({ id: childId, parent_id: parentId }),
      ]),
    );
  });

  it("rejects stale Library scope and foreign work ids inside the transaction", async () => {
    const now = Date.now();
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES ('foreign-library', 'Foreign', 'personal', ?, ?)`,
      [now, now],
    );
    await database.run(
      `INSERT INTO works
         (id, library_id, title, type, reading_status, starred, created_at, updated_at)
       VALUES ('foreign-work', 'foreign-library', 'Foreign', 'article', 'unread', 0, ?, ?)`,
      [now, now],
    );

    await expect(
      executeDataCommand(
        {
          name: "library.createTag",
          input: { libraryId: "foreign-library", name: "foreign" },
        },
        dependencies,
      ),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
    await expect(
      executeDataCommand(
        {
          name: "library.addTagToWorks",
          input: { libraryId, name: "scoped", workIds: ["foreign-work"] },
        },
        dependencies,
      ),
    ).rejects.toThrow("missing or removed");
    expect(
      (await new TagsRepo(database, libraryId).list()).find((tag) => tag.name === "scoped"),
    ).toBe(undefined);
  });
});
