import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "./database";
import { requireLocalLibraryId } from "./local-first";
import { runMigrations } from "./migrations";
import { AttachmentsRepo } from "./repos/attachments";
import { CollectionsRepo } from "./repos/collections";
import { TagsRepo } from "./repos/tags";
import { WorksRepo } from "./repos/works";
import { locateWorkPageOffset, queryWorkPage } from "./work-page";

let db: Database;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  works = new WorksRepo(db, libraryId);
});

describe("work-page database pagination", () => {
  it("returns exact totals beyond 1,000 rows and locates the same sorted offset", async () => {
    for (let index = 0; index < 1_005; index += 1) {
      const id = `work-${String(index).padStart(4, "0")}`;
      await db.run(
        `INSERT INTO works
           (id, library_id, title, type, reading_status, starred, created_at, updated_at)
         VALUES (?, ?, ?, 'article', 'unread', 0, ?, ?)`,
        [id, libraryId, `Work ${index}`, index, index],
      );
    }

    const page = await queryWorkPage(db, libraryId, {
      limit: 3,
      offset: 1_000,
      sort: "added",
    });

    expect(page.total).toBe(1_005);
    expect(page.offset).toBe(1_000);
    expect(page.works.map((work) => work.id)).toEqual(["work-0004", "work-0003", "work-0002"]);
    await expect(
      locateWorkPageOffset(db, libraryId, "work-0004", { limit: 3, offset: 900, sort: "added" }),
    ).resolves.toBe(1_000);
  });

  it("filters collection, FTS search, active tag, escaped source, PDF, status, and UI facets", async () => {
    const collections = new CollectionsRepo(db, libraryId);
    const tags = new TagsRepo(db, libraryId);
    const attachments = new AttachmentsRepo(db, libraryId);
    const collectionId = await collections.create("Focus");
    const matching = await works.upsert({
      title: "Neural Retrieval",
      abstract: "Evidence-oriented retrieval work",
      year: 2024,
      venueName: "ACM_Proceedings",
      type: "article",
      arxivId: "2401.00001",
    });
    const wildcardNearMiss = await works.upsert({
      title: "Neural Retrieval Near Miss",
      abstract: "Evidence-oriented retrieval work",
      year: 2023,
      venueName: "ACM-XProceedings",
      type: "article",
    });
    const withoutPdf = await works.upsert({
      title: "Neural Retrieval Without PDF",
      abstract: "Evidence-oriented retrieval work",
      year: 2022,
      venueName: "Journal of Scope",
      type: "review",
    });
    await collections.setWorkCollection(matching.id, collectionId);
    await collections.setWorkCollection(wildcardNearMiss.id, collectionId);
    await collections.setWorkCollection(withoutPdf.id, collectionId);
    await tags.addToWorks([matching.id], "Focus Tag");
    await tags.addToWorks([withoutPdf.id], "No PDF Tag");
    await works.setReadingStatus(matching.id, "reading");
    await works.setStarred(matching.id, true);
    const attachment = await attachments.create({
      workId: matching.id,
      sha256: "a".repeat(64),
      byteSize: 42,
      originalFilename: "matching.pdf",
    });
    await db.run(
      `INSERT INTO annotations
         (id, attachment_id, work_id, type, page_index, sort_key, created_at, updated_at)
       VALUES ('matching-annotation', ?, ?, 'note', 0, 0, 1, 1)`,
      [attachment.id, matching.id],
    );

    const page = await queryWorkPage(db, libraryId, {
      collectionId,
      filter: "starred",
      pdf: "with-pdf",
      search: "neural retrieval",
      source: "ACM_",
      status: "reading",
      tag: "focus tag",
      sort: "year",
    });

    expect(page.total).toBe(1);
    expect(page.works.map((work) => work.id)).toEqual([matching.id]);
    expect(page.browseSummary).toMatchObject({
      baseTotal: 3,
      notedTotal: 1,
      readingTotal: 1,
      starredTotal: 1,
      unreadTotal: 2,
      withPdfTotal: 1,
      withoutPdfTotal: 2,
      availableTags: ["Focus Tag", "No PDF Tag"],
      availableSources: ["ACM-XProceedings", "ACM_Proceedings", "article", "arXiv", "Journal of Scope", "review"],
    });
    await expect(
      queryWorkPage(db, libraryId, {
        collectionId,
        pdf: "without-pdf",
        search: "neural retrieval",
        sort: "year",
      }),
    ).resolves.toMatchObject({
      total: 2,
      works: [{ id: wildcardNearMiss.id }, { id: withoutPdf.id }],
    });
    await expect(
      locateWorkPageOffset(db, libraryId, matching.id, {
        collectionId,
        search: "neural retrieval",
      }),
    ).resolves.toBeTypeOf("number");
  });

  it("partitions active and deleted records and never crosses Library ownership", async () => {
    const active = await works.upsert({ title: "Scoped Active", year: 2024 });
    const deleted = await works.upsert({ title: "Scoped Deleted", year: 2023 });
    await works.softDelete(deleted.id);
    const foreignLibraryId = "foreign-library";
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign', 'personal', 1, 1, NULL)`,
      [foreignLibraryId],
    );
    const foreignWorks = new WorksRepo(db, foreignLibraryId);
    const foreign = await foreignWorks.upsert({ title: "Scoped Active", year: 2025 });

    await expect(queryWorkPage(db, libraryId, { deleted: "active", sort: "added" })).resolves.toMatchObject({
      total: 1,
      works: [{ id: active.id }],
    });
    await expect(queryWorkPage(db, libraryId, { deleted: "deleted", sort: "added" })).resolves.toMatchObject({
      total: 1,
      works: [{ id: deleted.id }],
    });
    await expect(locateWorkPageOffset(db, libraryId, foreign.id, { sort: "added" })).resolves.toBeNull();
  });

  it("uses deterministic tie breakers for added and publication-year sorts", async () => {
    for (const id of ["same-a", "same-c", "same-b"]) {
      await db.run(
        `INSERT INTO works
           (id, library_id, title, year, type, reading_status, starred, created_at, updated_at)
         VALUES (?, ?, ?, 2024, 'article', 'unread', 0, 100, 100)`,
        [id, libraryId, id],
      );
    }
    await db.run(
      `INSERT INTO works
         (id, library_id, title, year, type, reading_status, starred, created_at, updated_at)
       VALUES ('no-year', ?, 'No Year', NULL, 'article', 'unread', 0, 999, 999)`,
      [libraryId],
    );

    await expect(queryWorkPage(db, libraryId, { sort: "added" })).resolves.toMatchObject({
      works: [{ id: "no-year" }, { id: "same-c" }, { id: "same-b" }, { id: "same-a" }],
    });
    const byYear = await queryWorkPage(db, libraryId, { sort: "year" });
    expect(byYear.works.map((work) => work.id)).toEqual(["same-c", "same-b", "same-a", "no-year"]);
    await expect(locateWorkPageOffset(db, libraryId, "same-b", { sort: "year" })).resolves.toBe(1);
  });

  it("installs the page query indexes in migration v23", async () => {
    const indexRows = await db.query<{ name: string }>(`PRAGMA index_list('works')`);
    const names = new Set(indexRows.map((row) => row.name));
    expect(names.has("works_page_created_idx")).toBe(true);
    expect(names.has("works_page_year_idx")).toBe(true);
    expect(names.has("works_page_deleted_idx")).toBe(true);
  });
});
