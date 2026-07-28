import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { listWorks, searchWorksByMetadata } from "../work-list";
import { CanvasRepo, type StoredCanvasWorkspaceDocument } from "./canvas";
import { CollectionsRepo } from "./collections";
import { SavedSearchesRepo } from "./saved-searches";
import { SentinelRepo } from "./sentinel";
import { TagsRepo } from "./tags";
import { WorksRepo } from "./works";

let db: Database;
let libraryA: string;
const libraryB = "library:scope-b";

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryA = await requireLocalLibraryId(db);
  const now = Date.now();
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, 'Scope B', 'personal', ?, ?)`,
    [libraryB, now, now],
  );
});

describe("root repository Library ownership", () => {
  it("isolates Work deduplication, reads, authors, and id mutations", async () => {
    const worksA = new WorksRepo(db, libraryA);
    const worksB = new WorksRepo(db, libraryB);
    const input = {
      doi: "10.4242/library-scope",
      title: "Library Scoped Paper",
      authors: [{ displayName: "Ada Scholar", orcid: "0000-0001-2345-6789", position: 0 }],
    };

    const workA = await worksA.upsert(input);
    const workB = await worksB.upsert(input);

    expect(workA.id).not.toBe(workB.id);
    expect((await worksA.list()).map((row) => row.id)).toEqual([workA.id]);
    expect((await worksB.list()).map((row) => row.id)).toEqual([workB.id]);
    expect(await worksA.get(workB.id)).toBeNull();
    await expect(worksA.update(workB.id, { title: "Cross-library write" })).rejects.toThrow(
      "missing or removed",
    );
    await expect(worksA.softDelete(workB.id)).rejects.toThrow("missing or already removed");
    await expect(worksA.mergeInto(workA.id, [workB.id])).rejects.toThrow("outside library");

    const authors = await db.query<{ library_id: string }>(
      `SELECT library_id FROM authors WHERE orcid = ? ORDER BY library_id`,
      ["0000-0001-2345-6789"],
    );
    expect(authors.map((row) => row.library_id).sort()).toEqual([libraryA, libraryB].sort());
  });

  it("isolates tags and collections and rejects cross-Library relationships", async () => {
    const worksA = new WorksRepo(db, libraryA);
    const worksB = new WorksRepo(db, libraryB);
    const tagsA = new TagsRepo(db, libraryA);
    const tagsB = new TagsRepo(db, libraryB);
    const collectionsA = new CollectionsRepo(db, libraryA);
    const collectionsB = new CollectionsRepo(db, libraryB);
    const workA = await worksA.upsert({ title: "A" });
    const workB = await worksB.upsert({ title: "B" });
    const tagA = await tagsA.ensure("method");
    const tagB = await tagsB.ensure("method");
    const collectionA = await collectionsA.create("Reading");
    const collectionB = await collectionsB.create("Reading");

    expect(tagA).not.toBe(tagB);
    expect(collectionA).not.toBe(collectionB);
    await expect(tagsA.addToWorks([workB.id], "foreign")).rejects.toThrow("missing or removed");
    await expect(collectionsA.setWorkCollection(workB.id, collectionA)).rejects.toThrow(
      "missing or removed",
    );
    await expect(collectionsA.setWorkCollection(workA.id, collectionB)).rejects.toThrow(
      "missing or removed",
    );
    await expect(tagsA.rename(tagB, "renamed")).rejects.toThrow("missing or removed");

    expect(await tagsA.list()).toMatchObject([{ id: tagA, library_id: libraryA }]);
    expect(await collectionsA.list()).toMatchObject([{ id: collectionA, library_id: libraryA }]);
  });

  it("keeps Canvas workspaces and paper references inside one Library", async () => {
    const canvasA = new CanvasRepo(db, libraryA);
    const canvasB = new CanvasRepo(db, libraryB);
    const workB = await new WorksRepo(db, libraryB).upsert({ title: "Private B" });
    const defaultA = await canvasA.ensureDefault();
    const defaultB = await canvasB.ensureDefault();

    expect(defaultA.workspaceId).not.toBe(defaultB.workspaceId);
    expect(await canvasA.load(defaultB.workspaceId)).toBeNull();
    expect(await canvasA.deleteWorkspace(defaultB.workspaceId)).toBe(false);

    const now = Date.now();
    const foreignReference: StoredCanvasWorkspaceDocument = {
      schemaVersion: 1,
      workspaceId: "canvas:foreign-reference",
      name: "Foreign",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: "node:foreign-paper",
          type: "paper",
          position: { x: 0, y: 0 },
          dimensions: { width: 320, height: 220 },
          tags: [],
          data: { workId: workB.id },
          createdAt: now,
          updatedAt: now,
        },
      ],
      edges: [],
      createdAt: now,
      updatedAt: now,
    };
    await expect(canvasA.save(foreignReference)).rejects.toThrow("outside library");
    await expect(canvasA.deleteWorkspace(defaultA.workspaceId)).rejects.toThrow(
      "last canvas workspace",
    );
  });

  it("isolates saved searches and Sentinel tasks, including background queues", async () => {
    const searchesA = new SavedSearchesRepo(db, libraryA);
    const searchesB = new SavedSearchesRepo(db, libraryB);
    const sentinelA = new SentinelRepo(db, libraryA);
    const sentinelB = new SentinelRepo(db, libraryB);
    const workB = await new WorksRepo(db, libraryB).upsert({ title: "Sentinel B" });
    const searchA = await searchesA.create({ query: "same query" });
    const searchB = await searchesB.create({ query: "same query" });
    const taskA = await sentinelA.create({ doi: "10.4242/same", title: "A task" });
    const taskB = await sentinelB.create({
      doi: "10.4242/same",
      title: "B task",
      workId: workB.id,
    });

    expect((await searchesA.due()).map((row) => row.id)).toEqual([searchA]);
    expect((await searchesB.due()).map((row) => row.id)).toEqual([searchB]);
    await expect(searchesA.clearNew(searchB)).rejects.toThrow("missing or removed");
    expect((await sentinelA.list()).map((row) => row.id)).toEqual([taskA]);
    expect((await sentinelB.list()).map((row) => row.id)).toEqual([taskB]);
    await expect(sentinelA.setStatus(taskB, "paused")).rejects.toThrow("missing or removed");
    await expect(sentinelA.linkWork(taskA, workB.id)).rejects.toThrow("missing or removed");
  });

  it("requires Library scope for list and metadata search helpers", async () => {
    const workA = await new WorksRepo(db, libraryA).upsert({
      title: "Shared Search Term",
      authors: [{ displayName: "Author A", position: 0 }],
    });
    const workB = await new WorksRepo(db, libraryB).upsert({
      title: "Shared Search Term",
      authors: [{ displayName: "Author B", position: 0 }],
    });

    expect((await listWorks(db, libraryA)).map((row) => row.id)).toEqual([workA.id]);
    expect((await listWorks(db, libraryB)).map((row) => row.id)).toEqual([workB.id]);
    expect((await searchWorksByMetadata(db, libraryA, "Author B")).map((row) => row.id)).toEqual(
      [],
    );
    expect((await searchWorksByMetadata(db, libraryB, "Author B")).map((row) => row.id)).toEqual([
      workB.id,
    ]);
  });
});
