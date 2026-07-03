import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "./database";
import { runMigrations } from "./migrations";
import { CollectionsRepo } from "./repos/collections";
import { WorksRepo } from "./repos/works";
import { listDeletedWorks, listWorks } from "./work-list";

let db: Database;
let works: WorksRepo;
let collections: CollectionsRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  works = new WorksRepo(db);
  collections = new CollectionsRepo(db);
});

describe("work-list lightweight queries", () => {
  it("lists active works with authors in position order", async () => {
    await works.upsert({
      title: "Attention Is All You Need",
      year: 2017,
      authors: [
        { displayName: "Ashish Vaswani", position: 0 },
        { displayName: "Noam Shazeer", position: 1 },
      ],
    });

    const rows = await listWorks(db);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Attention Is All You Need");
    expect(rows[0]?.authorNames).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
  });

  it("matches WorksRepo list search semantics, including collection filters", async () => {
    const targetCollection = await collections.create("Transformers");
    const attention = await works.upsert({
      title: "Attention Is All You Need",
      abstract: "Transformer sequence transduction",
      year: 2017,
    });
    await works.upsert({
      title: "Deep Residual Learning for Image Recognition",
      abstract: "Residual networks",
      year: 2016,
    });
    await collections.setWorkCollection(attention.id, targetCollection);

    const rows = await listWorks(db, {
      search: "trans",
      collectionId: targetCollection,
      limit: 10,
    });

    expect(rows.map((row) => row.title)).toEqual(["Attention Is All You Need"]);
  });

  it("keeps active and deleted lists separate", async () => {
    const active = await works.upsert({ title: "Active Paper", year: 2025 });
    const deleted = await works.upsert({ title: "Deleted Paper", year: 2024 });
    await works.softDelete(deleted.id);

    const activeRows = await listWorks(db, { search: "paper" });
    const deletedRows = await listDeletedWorks(db, { search: "deleted" });

    expect(activeRows.map((row) => row.id)).toEqual([active.id]);
    expect(deletedRows.map((row) => row.id)).toEqual([deleted.id]);
  });
});
