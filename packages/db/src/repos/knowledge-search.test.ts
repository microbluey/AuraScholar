import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { MIGRATIONS, runMigrations } from "../migrations";
import { type ContentUnit, ContentUnitSearchRepo, ContentUnitsRepo } from "./knowledge";
import { WorksRepo } from "./works";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let db: Database;
let libraryId: string;
let units: ContentUnitsRepo;
let search: ContentUnitSearchRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  units = new ContentUnitsRepo(db, libraryId);
  search = new ContentUnitSearchRepo(db, libraryId);
});

function contentUnit(id: string, overrides: Partial<ContentUnit> = {}): ContentUnit {
  return {
    id,
    libraryId,
    sourceType: "pdf",
    sourceId: "revision:search-source",
    workId: null,
    assetId: null,
    revisionId: null,
    parentUnitId: null,
    ordinal: 0,
    headingPath: ["Introduction"],
    anchor: {
      kind: "pdf",
      pageIndex: 2,
      position: { start: 12, end: 54 },
      revisionId: "revision:search-source",
      version: 1,
    },
    text: "Citation anchors preserve the source location for every retrieval.",
    language: "en",
    tokenCount: 9,
    contentHash: HASH_A,
    extractorProfile: "test-extractor-v1",
    chunkProfile: "test-chunk-v1",
    state: "ready",
    ...overrides,
  };
}

async function migrateThrough(version: number): Promise<Database> {
  const legacy = await createNodeDatabase(":memory:");
  await legacy.exec(
    `CREATE TABLE _migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );
  for (const migration of MIGRATIONS) {
    if (migration.version > version) break;
    if (migration.disableForeignKeys) await legacy.exec("PRAGMA foreign_keys = OFF");
    await legacy.exec("BEGIN");
    try {
      if (migration.apply) await migration.apply(legacy);
      else await legacy.exec(migration.sql);
      await legacy.run(`INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)`, [
        migration.version,
        migration.name,
        Date.now(),
      ]);
      await legacy.exec("COMMIT");
    } catch (error) {
      await legacy.exec("ROLLBACK");
      throw error;
    } finally {
      if (migration.disableForeignKeys) await legacy.exec("PRAGMA foreign_keys = ON");
    }
  }
  return legacy;
}

describe("ContentUnit full-text search", () => {
  it("counts only active units for semantic-index capacity planning", async () => {
    const pdf = contentUnit("content-unit:stats-pdf", { sourceId: "revision:stats-pdf" });
    const annotation = contentUnit("content-unit:stats-annotation", {
      contentHash: HASH_B,
      sourceId: "annotation:stats",
      sourceType: "annotation",
      state: "context-only",
    });
    const retiredEvidence = contentUnit("content-unit:stats-evidence", {
      contentHash: "c".repeat(64),
      sourceId: "evidence:stats",
      sourceType: "evidence",
    });
    await units.upsertMany([pdf, annotation, retiredEvidence]);
    await units.retireSource({ sourceType: "evidence", sourceId: retiredEvidence.sourceId });

    await expect(units.getIndexStats()).resolves.toEqual({
      total: 2,
      ready: 1,
      contextOnly: 1,
      sourceCounts: { pdf: 1, annotation: 1, evidence: 0 },
      languageCoverage: { zh: 0, en: 1, other: 0, missing: 0 },
    });
  });

  it("reports effective language coverage for citation-safe units", async () => {
    const works = new WorksRepo(db, libraryId);
    const work = await works.upsert({
      language: "en-US",
      title: "Inherited Language Coverage Paper",
    });
    const inherited = contentUnit("content-unit:stats-language-inherited", {
      contentHash: HASH_A,
      language: null,
      sourceId: "revision:stats-language-inherited",
      workId: work.id,
    });
    const chinese = contentUnit("content-unit:stats-language-chinese", {
      contentHash: HASH_B,
      language: "zh-Hans",
      sourceId: "revision:stats-language-chinese",
    });
    const other = contentUnit("content-unit:stats-language-other", {
      contentHash: "c".repeat(64),
      language: "fr",
      sourceId: "revision:stats-language-other",
    });
    const missing = contentUnit("content-unit:stats-language-missing", {
      contentHash: "d".repeat(64),
      language: null,
      sourceId: "revision:stats-language-missing",
    });
    const contextOnlyChinese = contentUnit("content-unit:stats-language-context", {
      contentHash: "e".repeat(64),
      language: "zh",
      sourceId: "annotation:stats-language-context",
      sourceType: "annotation",
      state: "context-only",
    });
    await units.upsertMany([inherited, chinese, other, missing, contextOnlyChinese]);

    await expect(units.getIndexStats()).resolves.toEqual({
      total: 5,
      ready: 4,
      contextOnly: 1,
      sourceCounts: { pdf: 4, annotation: 1, evidence: 0 },
      languageCoverage: { zh: 1, en: 1, other: 1, missing: 1 },
    });

    await works.update(work.id, { language: "zh-CN" });
    await expect(units.getIndexStats()).resolves.toMatchObject({
      languageCoverage: { zh: 2, en: 0, other: 1, missing: 1 },
    });
  });

  it("returns a ranked result with its original source anchor", async () => {
    const work = await new WorksRepo(db, libraryId).upsert({ title: "Grounded Search Paper" });
    const unit = contentUnit("content-unit:anchored-pdf", { workId: work.id });
    await units.upsertMany([unit]);

    const results = await search.search({
      query: "citation anchors",
      sourceId: unit.sourceId,
      sourceTypes: ["pdf"],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: unit.id,
      sourceType: "pdf",
      sourceId: unit.sourceId,
      anchor: unit.anchor,
      text: unit.text,
      excerpt: expect.stringContaining("Citation anchors"),
      workTitle: "Grounded Search Paper",
    });
    expect(Number.isFinite(results[0]!.score)).toBe(true);
  });

  it("inherits a Work language label for older units without overriding an explicit unit label", async () => {
    const work = await new WorksRepo(db, libraryId).upsert({
      language: "en-US",
      title: "Language-labelled Search Paper",
    });
    const inherited = contentUnit("content-unit:inherited-language", {
      contentHash: HASH_B,
      sourceId: "revision:inherited-language",
      workId: work.id,
      language: null,
      text: "Inherited language metadata keeps source routing explainable.",
    });
    const explicit = contentUnit("content-unit:explicit-language", {
      contentHash: "c".repeat(64),
      sourceId: "revision:explicit-language",
      workId: work.id,
      language: "zh-Hans",
      text: "Explicit unit language metadata takes precedence over the Work label.",
    });
    await units.upsertMany([inherited, explicit]);

    const results = await search.findReadyByIds({
      contentUnitIds: [inherited.id, explicit.id],
    });
    expect(new Map(results.map((result) => [result.id, result.language]))).toEqual(
      new Map([
        [inherited.id, "en-US"],
        [explicit.id, "zh-Hans"],
      ]),
    );

    await new WorksRepo(db, libraryId).update(work.id, { language: "zh-CN" });
    await expect(search.findReadyByIds({ contentUnitIds: [inherited.id] })).resolves.toMatchObject([
      { id: inherited.id, language: "zh-CN" },
    ]);
  });

  it("excludes context-only and retired units unless explicitly requested", async () => {
    const ready = contentUnit("content-unit:ready", {
      sourceId: "revision:ready",
      text: "Durable retrieval keeps verified source passages available.",
    });
    const contextOnly = contentUnit("content-unit:context", {
      sourceId: "revision:context",
      contentHash: HASH_B,
      state: "context-only",
      text: "Private synthesis is useful context but not a direct citation.",
    });
    await units.upsertMany([ready, contextOnly]);

    expect(await search.search({ query: "private synthesis" })).toEqual([]);
    await expect(
      search.search({ query: "private synthesis", includeContextOnly: true }),
    ).resolves.toMatchObject([{ id: contextOnly.id, state: "context-only" }]);

    await units.retireSource({ sourceType: "pdf", sourceId: ready.sourceId });
    expect(await search.search({ query: "verified passages" })).toEqual([]);
  });

  it("keeps searches inside the requested Library and honors source filters", async () => {
    const localPdf = contentUnit("content-unit:local-pdf", {
      sourceId: "revision:local",
      text: "Scoped retrieval protects a Library boundary.",
    });
    const localAnnotation = contentUnit("content-unit:local-annotation", {
      sourceType: "annotation",
      sourceId: "annotation:local",
      contentHash: HASH_B,
      text: "Scoped retrieval protects an annotation boundary.",
    });
    await units.upsertMany([localPdf, localAnnotation]);

    const otherLibraryId = "library:content-search-other";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'personal', ?, ?, NULL)`,
      [otherLibraryId, "Other search Library", now, now],
    );
    await new ContentUnitsRepo(db, otherLibraryId).upsertMany([
      contentUnit("content-unit:other-library", {
        libraryId: otherLibraryId,
        sourceId: "revision:other",
        text: "Scoped retrieval protects a separate Library boundary.",
      }),
    ]);

    await expect(
      search.search({
        query: "scoped retrieval boundary",
        sourceId: localAnnotation.sourceId,
        sourceTypes: ["annotation"],
      }),
    ).resolves.toMatchObject([{ id: localAnnotation.id, libraryId }]);
    expect(await search.search({ query: "separate Library" })).toEqual([]);
  });

  it("applies a resolved source snapshot before FTS, ready-source listing, and hydration", async () => {
    const first = contentUnit("content-unit:snapshot-first", {
      sourceId: "revision:snapshot-first",
      text: "Snapshot allowlists keep the first source visible.",
    });
    const second = contentUnit("content-unit:snapshot-second", {
      contentHash: HASH_B,
      sourceId: "revision:snapshot-second",
      text: "Snapshot allowlists keep the second source visible.",
    });
    await units.upsertMany([first, second]);

    await expect(
      search.search({ query: "snapshot allowlists", allowedSourceIds: [first.sourceId] }),
    ).resolves.toMatchObject([{ id: first.id }]);
    await expect(
      search.search({ query: "snapshot allowlists", allowedSourceIds: [] }),
    ).resolves.toEqual([]);
    await expect(
      search.listReadySourceIds({ allowedSourceIds: [first.sourceId] }),
    ).resolves.toEqual([first.sourceId]);
    await expect(
      search.findReadyByIds({
        allowedSourceIds: [first.sourceId],
        contentUnitIds: [first.id, second.id],
      }),
    ).resolves.toMatchObject([{ id: first.id }]);
  });

  it("resolves a ready-only vector allowlist and safely hydrates semantic candidates", async () => {
    const readyPdf = contentUnit("content-unit:semantic-pdf", {
      sourceId: "revision:semantic-pdf",
      text: "Semantic candidates retain their original anchored text.",
    });
    const readyAnnotation = contentUnit("content-unit:semantic-annotation", {
      contentHash: HASH_B,
      sourceId: "annotation:semantic",
      sourceType: "annotation",
      text: "An annotation candidate is also ready for local vectors.",
    });
    const contextOnly = contentUnit("content-unit:semantic-context", {
      contentHash: "c".repeat(64),
      sourceId: "annotation:semantic-context",
      sourceType: "annotation",
      state: "context-only",
      text: "This contextual candidate must not receive a vector.",
    });
    await units.upsertMany([readyPdf, readyAnnotation, contextOnly]);

    await expect(search.listReadySourceIds({ sourceTypes: ["annotation"] })).resolves.toEqual([
      readyAnnotation.sourceId,
    ]);
    await expect(
      search.findReadyByIds({
        contentUnitIds: [contextOnly.id, readyAnnotation.id, readyPdf.id],
        sourceTypes: ["annotation"],
      }),
    ).resolves.toMatchObject([
      {
        id: readyAnnotation.id,
        score: 0,
        sourceId: readyAnnotation.sourceId,
        text: readyAnnotation.text,
      },
    ]);
  });

  it("rebuilds searchable entries when upgrading a v20 database", async () => {
    const legacy = await migrateThrough(20);
    const legacyLibraryId = await requireLocalLibraryId(legacy);
    const legacyUnit = contentUnit("content-unit:legacy-upgrade", {
      libraryId: legacyLibraryId,
      sourceId: "revision:legacy",
      text: "Migration rebuild keeps legacy ContentUnits searchable.",
    });
    await new ContentUnitsRepo(legacy, legacyLibraryId).upsertMany([legacyUnit]);

    await runMigrations(legacy);

    await expect(
      new ContentUnitSearchRepo(legacy, legacyLibraryId).search({ query: "legacy searchable" }),
    ).resolves.toMatchObject([{ id: legacyUnit.id, anchor: legacyUnit.anchor }]);
  });
});
