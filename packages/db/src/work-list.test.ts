import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "./database";
import { runMigrations } from "./migrations";
import { CollectionsRepo } from "./repos/collections";
import { TagsRepo } from "./repos/tags";
import { WorksRepo } from "./repos/works";
import {
  citationCountsForWorks,
  listDeletedWorks,
  listWorks,
  parseWorkMetadataSearch,
  searchWorksByMetadata,
} from "./work-list";

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
      venueName: "NeurIPS",
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

  it("searches canvas command candidates by title, author, and active tag", async () => {
    const tags = new TagsRepo(db);
    const attention = await works.upsert({
      title: "Attention Is All You Need",
      abstract: "Transformer sequence transduction",
      venueName: "NeurIPS",
      year: 2017,
      authors: [{ displayName: "Ashish Vaswani", position: 0 }],
    });
    const residual = await works.upsert({
      title: "Deep Residual Learning",
      abstract: "Computer vision",
      year: 2016,
      authors: [{ displayName: "Kaiming He", position: 0 }],
    });
    await tags.addToWorks([residual.id], "方法论");

    await expect(searchWorksByMetadata(db, "attention")).resolves.toMatchObject([
      { id: attention.id, tagNames: [] },
    ]);
    await expect(searchWorksByMetadata(db, "Vaswani")).resolves.toMatchObject([
      { id: attention.id, authorNames: ["Ashish Vaswani"] },
    ]);
    await expect(searchWorksByMetadata(db, "NeurIPS")).resolves.toMatchObject([
      { id: attention.id },
    ]);
    await expect(searchWorksByMetadata(db, "2017")).resolves.toMatchObject([{ id: attention.id }]);
    await expect(
      searchWorksByMetadata(db, Array.from({ length: 100 }, () => "attention").join(" ")),
    ).resolves.toMatchObject([{ id: attention.id }]);
    await expect(searchWorksByMetadata(db, "方法论")).resolves.toMatchObject([
      { id: residual.id, tagNames: ["方法论"] },
    ]);
    await expect(searchWorksByMetadata(db, "/// +++")).resolves.toEqual([]);
    expect(parseWorkMetadataSearch(" Retrieval/Augmented ")).toEqual({
      normalized: "retrieval/augmented",
      tokens: ["retrieval", "augmented"],
    });

    const tag = (await tags.list()).find((candidate) => candidate.name === "方法论");
    expect(tag).toBeDefined();
    await tags.softDelete(tag!.id);
    await expect(searchWorksByMetadata(db, "方法论")).resolves.toEqual([]);
  });

  it("tolerates punctuation-heavy search input without FTS syntax errors", async () => {
    const active = await works.upsert({
      title: "Attention Is All You Need",
      abstract: "Transformer sequence transduction",
      year: 2017,
    });
    const deleted = await works.upsert({
      title: "Deleted Attention Paper",
      abstract: "Archived transformer note",
      year: 2018,
    });
    await works.softDelete(deleted.id);

    await expect(listWorks(db, { search: `"" !!! ***`, limit: 10 })).resolves.toEqual([]);
    await expect(listDeletedWorks(db, { search: `"" !!! ***`, limit: 10 })).resolves.toEqual([]);

    const activeRows = await listWorks(db, { search: `"atten"!!!`, limit: 10 });
    const deletedRows = await listDeletedWorks(db, { search: `"deleted"!!!`, limit: 10 });

    expect(activeRows.map((row) => row.id)).toEqual([active.id]);
    expect(deletedRows.map((row) => row.id)).toEqual([deleted.id]);
  });

  it("ignores stale collection filters when the folder has been removed", async () => {
    const removedCollection = await collections.create("Removed Folder");
    const paper = await works.upsert({
      title: "Hidden Collection Paper",
      abstract: "Transformer sequence transduction",
      year: 2026,
    });
    await collections.setWorkCollection(paper.id, removedCollection);
    await db.run(`UPDATE collections SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      removedCollection,
    ]);

    await expect(listWorks(db, { collectionId: removedCollection })).resolves.toEqual([]);
    await expect(
      listWorks(db, {
        search: "transformer",
        collectionId: removedCollection,
        limit: 10,
      }),
    ).resolves.toEqual([]);
    await expect(works.list({ collectionId: removedCollection })).resolves.toEqual([]);
  });

  it("counts only citation edges whose source and target works are active", async () => {
    const center = await works.upsert({ title: "Center Paper", year: 2026 });
    const activeReference = await works.upsert({ title: "Active Reference", year: 2024 });
    const activeCiter = await works.upsert({ title: "Active Citer", year: 2027 });
    const removed = await works.upsert({ title: "Removed Citation Endpoint", year: 2025 });

    await db.run(
      `INSERT INTO citations (citing_work_id, cited_work_id, source) VALUES (?, ?, 'openalex')`,
      [center.id, activeReference.id],
    );
    await db.run(
      `INSERT INTO citations (citing_work_id, cited_work_id, source) VALUES (?, ?, 'openalex')`,
      [center.id, removed.id],
    );
    await db.run(
      `INSERT INTO citations (citing_work_id, cited_work_id, source) VALUES (?, ?, 'openalex')`,
      [activeCiter.id, center.id],
    );
    await db.run(
      `INSERT INTO citations (citing_work_id, cited_work_id, source) VALUES (?, ?, 'openalex')`,
      [removed.id, center.id],
    );
    await works.softDelete(removed.id);

    const counts = await citationCountsForWorks(db, [
      center.id,
      activeReference.id,
      activeCiter.id,
      removed.id,
    ]);

    expect(counts.get(center.id)).toEqual({ references: 1, citedBy: 1 });
    expect(counts.get(activeReference.id)).toEqual({ references: 0, citedBy: 1 });
    expect(counts.get(activeCiter.id)).toEqual({ references: 1, citedBy: 0 });
    expect(counts.get(removed.id)).toEqual({ references: 0, citedBy: 0 });
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
