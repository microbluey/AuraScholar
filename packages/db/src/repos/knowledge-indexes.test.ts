import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { MIGRATIONS, runMigrations } from "../migrations";
import { KnowledgeChangesRepo, type ContentUnit, ContentUnitsRepo } from "./knowledge";
import {
  EmbeddingProfilesRepo,
  KnowledgeIndexesRepo,
  type EmbeddingProfileRow,
} from "./knowledge-indexes";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let db: Database;
let libraryId: string;
let units: ContentUnitsRepo;
let indexes: KnowledgeIndexesRepo;
let profiles: EmbeddingProfilesRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  units = new ContentUnitsRepo(db, libraryId);
  indexes = new KnowledgeIndexesRepo(db, libraryId);
  profiles = new EmbeddingProfilesRepo(db);
});

function contentUnit(
  id: string,
  ordinal: number,
  overrides: Partial<ContentUnit> = {},
): ContentUnit {
  return {
    id,
    libraryId,
    sourceType: "pdf",
    sourceId: `revision:${id}`,
    workId: null,
    assetId: null,
    revisionId: null,
    parentUnitId: null,
    ordinal,
    headingPath: ["Methods"],
    anchor: { kind: "pdf", pageIndex: ordinal, version: 1 },
    text: `Durable unit ${ordinal}`,
    language: "en",
    tokenCount: 3,
    contentHash: ordinal === 0 ? HASH_A : HASH_B,
    extractorProfile: "test-extractor-v1",
    chunkProfile: "test-chunk-v1",
    state: "ready",
    ...overrides,
  };
}

async function profile(): Promise<EmbeddingProfileRow> {
  return profiles.register({
    providerKind: "local-test",
    egressMode: "local",
    modelId: "test-embedding",
    modelRevision: "r1",
    dimension: 384,
    distanceMetric: "cosine",
    normalization: "l2",
    chunkProfileVersion: "test-chunk-v1",
    fingerprint: "local-test:test-embedding:r1:384:cosine:l2:test-chunk-v1",
    createdAt: 100,
  });
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

describe("Knowledge index generations", () => {
  it("keeps v22 platform-neutral and upgrades a v21 database without a vec0 table", async () => {
    const legacy = await migrateThrough(21);
    await runMigrations(legacy);

    const tables = await legacy.query<{ name: string }>(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('embedding_profiles', 'knowledge_indexes', 'knowledge_index_entries')
       ORDER BY name`,
    );
    expect(tables.map((row) => row.name)).toEqual([
      "embedding_profiles",
      "knowledge_index_entries",
      "knowledge_indexes",
    ]);
    expect(
      await legacy.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'knowledge_vectors_d*'`,
      ),
    ).toEqual([]);
  });

  it("pins a hybrid snapshot, requires every vector, and atomically switches generations", async () => {
    const first = contentUnit("content-unit:index-one", 0);
    const second = contentUnit("content-unit:index-two", 1);
    await units.upsertMany([first, second]);
    const embeddingProfile = await profile();

    const hybrid = await indexes.begin({
      mode: "hybrid",
      embeddingProfileId: embeddingProfile.id,
      now: 1_000,
    });
    expect(hybrid).toMatchObject({
      libraryId,
      mode: "hybrid",
      generation: 1,
      status: "building",
      expectedCount: 2,
      indexedCount: 0,
    });
    await expect(indexes.listPendingVectorEntries(hybrid.id)).resolves.toEqual([
      expect.objectContaining({
        contentUnitId: first.id,
        sourceId: first.sourceId,
        text: first.text,
      }),
      expect.objectContaining({
        contentUnitId: second.id,
        sourceId: second.sourceId,
        text: second.text,
      }),
    ]);
    await expect(indexes.activate(hybrid.id, { now: 1_001 })).rejects.toThrow(
      "before every pinned entry is ready",
    );

    await indexes.markVectorReady(hybrid.id, {
      contentUnitId: first.id,
      vectorRef: "vec:1",
      now: 1_002,
    });
    await indexes.markVectorReady(hybrid.id, {
      contentUnitId: second.id,
      vectorRef: "vec:2",
      now: 1_003,
    });
    await expect(indexes.activate(hybrid.id, { now: 1_004 })).resolves.toMatchObject({
      status: "active",
      indexedCount: 2,
      activatedAt: 1_004,
    });

    const fulltext = await indexes.begin({ mode: "fulltext", now: 2_000 });
    expect(fulltext).toMatchObject({
      generation: 2,
      mode: "fulltext",
      status: "building",
      expectedCount: 2,
      indexedCount: 2,
    });
    await expect(indexes.listEntries(fulltext.id)).resolves.toEqual([
      expect.objectContaining({ contentUnitId: first.id, status: "ready", vectorRef: null }),
      expect.objectContaining({ contentUnitId: second.id, status: "ready", vectorRef: null }),
    ]);
    await indexes.activate(fulltext.id, { now: 2_001 });

    await expect(indexes.getActive()).resolves.toMatchObject({ id: fulltext.id, status: "active" });
    await expect(indexes.get(hybrid.id)).resolves.toMatchObject({
      status: "retired",
      retiredAt: 2_001,
    });
  });

  it("fails closed after source retirement and preserves the prior active generation", async () => {
    const unit = contentUnit("content-unit:active", 0);
    await units.upsertMany([unit]);
    const active = await indexes.begin({ mode: "fulltext", now: 3_000 });
    await indexes.activate(active.id, { now: 3_001 });

    const embeddingProfile = await profile();
    const building = await indexes.begin({
      mode: "hybrid",
      embeddingProfileId: embeddingProfile.id,
      now: 3_002,
    });
    await units.retireSource({ sourceType: unit.sourceType, sourceId: unit.sourceId, now: 3_003 });

    await expect(indexes.listEntries(building.id)).resolves.toEqual([
      expect.objectContaining({ contentUnitId: unit.id, status: "retired" }),
    ]);
    await expect(indexes.activate(building.id, { now: 3_004 })).rejects.toThrow(
      "before every pinned entry is ready",
    );
    await expect(indexes.getActive()).resolves.toMatchObject({ id: active.id, status: "active" });

    await expect(
      indexes.fail(building.id, new Error("model unavailable"), { now: 3_005 }),
    ).resolves.toBe(true);
    await expect(indexes.markGarbageCollected(building.id, { now: 3_006 })).resolves.toBe(true);
    await expect(indexes.get(building.id)).resolves.toMatchObject({
      status: "garbage-collected",
      indexedCount: 0,
    });
    await expect(indexes.listEntries(building.id)).resolves.toEqual([]);
  });

  it("does not activate or serve a generation after its source snapshot changes", async () => {
    const unit = contentUnit("content-unit:stale-snapshot", 0);
    await units.upsertMany([unit]);
    const active = await indexes.begin({ mode: "fulltext", now: 3_100 });
    await indexes.activate(active.id, { now: 3_101 });
    await expect(indexes.getActiveCurrent()).resolves.toMatchObject({ id: active.id });

    const changes = new KnowledgeChangesRepo(db, libraryId);
    const firstChange = await changes.append({
      changeKind: "upsert",
      sourceId: unit.sourceId,
      sourceType: unit.sourceType === "pdf" ? "revision" : unit.sourceType,
      createdAt: 3_102,
    });
    await expect(indexes.getLatestSourceChangeSeq()).resolves.toBe(firstChange.seq);
    await expect(indexes.getActiveCurrent()).resolves.toBeNull();

    const embeddingProfile = await profile();
    const building = await indexes.begin({
      embeddingProfileId: embeddingProfile.id,
      mode: "hybrid",
      now: 3_103,
    });
    await indexes.markVectorReady(building.id, {
      contentUnitId: unit.id,
      vectorRef: "vec:stale",
      now: 3_104,
    });
    await changes.append({
      changeKind: "upsert",
      sourceId: unit.sourceId,
      sourceType: "revision",
      createdAt: 3_105,
    });

    await expect(indexes.activate(building.id, { now: 3_106 })).rejects.toThrow(
      "snapshot is stale and must be rebuilt",
    );
    await expect(indexes.getActive()).resolves.toMatchObject({ id: active.id, status: "active" });
    await expect(indexes.getActiveCurrent()).resolves.toBeNull();
  });

  it("keeps snapshots within their Library and rejects conflicting profile fingerprints", async () => {
    const local = contentUnit("content-unit:local", 0);
    await units.upsertMany([local]);
    const foreignLibraryId = "library:knowledge-index-foreign";
    const now = 4_000;
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign Knowledge Library', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );
    const foreignUnit = contentUnit("content-unit:foreign", 1, {
      libraryId: foreignLibraryId,
      sourceId: "revision:foreign",
    });
    await new ContentUnitsRepo(db, foreignLibraryId).upsertMany([foreignUnit]);

    const localIndex = await indexes.begin({ mode: "fulltext", now });
    await expect(indexes.listEntries(localIndex.id)).resolves.toEqual([
      expect.objectContaining({ contentUnitId: local.id }),
    ]);
    await expect(
      new KnowledgeIndexesRepo(db, foreignLibraryId).get(localIndex.id),
    ).resolves.toBeNull();

    await profile();
    await expect(
      profiles.register({
        providerKind: "different-provider",
        egressMode: "local",
        modelId: "test-embedding",
        dimension: 384,
        distanceMetric: "cosine",
        normalization: "l2",
        chunkProfileVersion: "test-chunk-v1",
        fingerprint: "local-test:test-embedding:r1:384:cosine:l2:test-chunk-v1",
      }),
    ).rejects.toThrow("fingerprint conflicts");
  });
});
