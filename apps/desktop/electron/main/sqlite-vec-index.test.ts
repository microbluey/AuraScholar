import { createRequire } from "node:module";
import {
  ContentUnitsRepo,
  DocumentAssetsRepo,
  EmbeddingProfilesRepo,
  KnowledgeChangesRepo,
  KnowledgeIndexesRepo,
  KnowledgeJobLeaseLostError,
  KnowledgeJobsRepo,
  WorksRepo,
  type ContentUnit,
  type Database,
} from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import { SqliteVecIndexStore, sqliteVecTableName } from "./sqlite-vec-index";

const requireFromTest = createRequire(import.meta.url);
const sqliteVecLoadablePath = resolveSqliteVecLoadablePath();

let database: Database;
let coordinator: DatabaseCoordinator;
let libraryId: string;
let units: ContentUnitsRepo;
let indexes: KnowledgeIndexesRepo;
let store: SqliteVecIndexStore;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  const loadExtension = database.loadExtension;
  if (!loadExtension) throw new Error("The Node SQLite test driver cannot load sqlite-vec");
  await loadExtension(sqliteVecLoadablePath);
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "sqlite-vec-index-test-device",
    deviceName: "sqlite-vec index test",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  units = new ContentUnitsRepo(database, libraryId);
  indexes = new KnowledgeIndexesRepo(database, libraryId);
  store = new SqliteVecIndexStore({
    inspect: (operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  });
});

describe("SqliteVecIndexStore", () => {
  it("pre-filters source scope inside KNN, hides retired units, and collects the physical rows", async () => {
    const allowed = contentUnit("content-unit:allowed", {
      contentHash: "a".repeat(64),
      sourceId: "revision:allowed",
    });
    const excludedButCloser = contentUnit("content-unit:excluded", {
      contentHash: "b".repeat(64),
      ordinal: 1,
      sourceId: "revision:excluded",
    });
    await units.upsertMany([allowed, excludedButCloser]);
    const index = await beginHybridIndex();

    await store.persist({
      libraryId,
      indexId: index.id,
      sourceChangeSeq: index.sourceChangeSeq,
      entries: [
        { contentUnitId: allowed.id, vector: new Float32Array([0, 1]) },
        { contentUnitId: excludedButCloser.id, vector: new Float32Array([1, 0]) },
      ],
      now: 100,
    });
    await indexes.activate(index.id, { now: 101 });

    // The excluded vector is an exact match. If `source_id` were post-filtered
    // after a global k=1 KNN query, this would return no result instead.
    await expect(
      store.search({
        libraryId,
        indexId: index.id,
        allowedSourceIds: [allowed.sourceId],
        vector: new Float32Array([1, 0]),
        limit: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ contentUnitId: allowed.id, sourceId: allowed.sourceId }),
    ]);

    await units.retireSource({
      sourceType: allowed.sourceType,
      sourceId: allowed.sourceId,
      now: 102,
    });
    await expect(
      store.search({
        libraryId,
        indexId: index.id,
        allowedSourceIds: [allowed.sourceId],
        vector: new Float32Array([1, 0]),
        limit: 1,
      }),
    ).resolves.toEqual([]);
    await expect(indexes.listEntries(index.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contentUnitId: allowed.id, status: "retired" }),
      ]),
    );
    await expect(nativeRowCount(index.id)).resolves.toBe(2);

    await indexes.retire(index.id, { now: 103 });
    await expect(store.garbageCollect({ libraryId, indexId: index.id, now: 104 })).resolves.toBe(
      true,
    );
    await expect(nativeRowCount(index.id)).resolves.toBe(0);
    await expect(indexes.get(index.id)).resolves.toMatchObject({
      status: "garbage-collected",
      indexedCount: 0,
    });
  });

  it("rolls back native rows when a later relational mapping cannot be recorded", async () => {
    const first = contentUnit("content-unit:atomic-first", { contentHash: "c".repeat(64) });
    const second = contentUnit("content-unit:atomic-second", {
      contentHash: "d".repeat(64),
      ordinal: 1,
      sourceId: "revision:atomic-second",
    });
    await units.upsertMany([first, second]);
    const index = await beginHybridIndex();
    await database.exec(`
      CREATE TRIGGER test_reject_second_sqlite_vec_mapping
      BEFORE UPDATE OF vector_ref, status ON knowledge_index_entries
      WHEN NEW.index_id = '${index.id}' AND NEW.content_unit_id = '${second.id}'
      BEGIN
        SELECT RAISE(ABORT, 'forced vector mapping failure');
      END
    `);

    await expect(
      store.persist({
        libraryId,
        indexId: index.id,
        sourceChangeSeq: index.sourceChangeSeq,
        entries: [
          { contentUnitId: first.id, vector: new Float32Array([1, 0]) },
          { contentUnitId: second.id, vector: new Float32Array([0, 1]) },
        ],
        now: 200,
      }),
    ).rejects.toThrow("forced vector mapping failure");

    await expect(indexes.listEntries(index.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contentUnitId: first.id, status: "pending", vectorRef: null }),
        expect.objectContaining({ contentUnitId: second.id, status: "pending", vectorRef: null }),
      ]),
    );
    await expect(indexes.get(index.id)).resolves.toMatchObject({
      indexedCount: 0,
      status: "building",
    });
    await expect(nativeTableExists()).resolves.toBe(false);
    await expect(nativeRowCount(index.id)).resolves.toBe(0);
  });

  it("rejects a vector batch whose source snapshot changed before the write", async () => {
    const unit = contentUnit("content-unit:stale-write", {
      sourceId: "revision:stale-write",
    });
    await units.upsertMany([unit]);
    const index = await beginHybridIndex();
    await new KnowledgeChangesRepo(database, libraryId).append({
      changeKind: "upsert",
      sourceId: unit.sourceId,
      sourceType: "revision",
    });

    await expect(
      store.persist({
        libraryId,
        indexId: index.id,
        sourceChangeSeq: index.sourceChangeSeq,
        entries: [{ contentUnitId: unit.id, vector: new Float32Array([1, 0]) }],
      }),
    ).rejects.toThrow("snapshot is stale and must be rebuilt");

    await expect(nativeTableExists()).resolves.toBe(false);
    await expect(indexes.get(index.id)).resolves.toMatchObject({
      indexedCount: 0,
      status: "building",
    });
    await expect(indexes.listEntries(index.id)).resolves.toEqual([
      expect.objectContaining({ contentUnitId: unit.id, status: "pending", vectorRef: null }),
    ]);
  });

  it("rejects a vector batch after its worker lease is reclaimed", async () => {
    const unit = contentUnit("content-unit:lease-fence", { sourceId: "revision:lease-fence" });
    await units.upsertMany([unit]);
    const index = await beginHybridIndex();
    const jobs = new KnowledgeJobsRepo(database, libraryId);
    const queued = await jobs.enqueue({
      availableAt: 0,
      indexId: index.id,
      kind: "embed",
      sourceId: libraryId,
      sourceType: "library",
    });
    const base = Date.now();
    await jobs.claimNext("worker-a", { now: base, leaseMs: 1_000 });
    const running = await jobs.start(queued.job.id, "worker-a", { now: base, leaseMs: 1_000 });
    if (!running) throw new Error("test lease did not start");
    expect(await jobs.recoverExpiredLeases(base + 1_001)).toBe(1);
    expect(await jobs.claimNext("worker-b", { now: base + 1_001, leaseMs: 1_000 })).not.toBeNull();

    await expect(
      store.persist({
        entries: [{ contentUnitId: unit.id, vector: new Float32Array([1, 0]) }],
        indexId: index.id,
        job: running,
        libraryId,
        sourceChangeSeq: index.sourceChangeSeq,
      }),
    ).rejects.toThrow("Knowledge job lease is no longer owned");
    await expect(nativeTableExists()).resolves.toBe(false);
    await expect(indexes.listEntries(index.id)).resolves.toEqual([
      expect.objectContaining({ contentUnitId: unit.id, status: "pending", vectorRef: null }),
    ]);
  });

  it("rejects a vector batch when its lease belongs to another Library", async () => {
    const unit = contentUnit("content-unit:foreign-lease");
    await units.upsertMany([unit]);
    const index = await beginHybridIndex();
    const queued = await new KnowledgeJobsRepo(database, libraryId).enqueue({
      availableAt: 0,
      indexId: index.id,
      kind: "embed",
      sourceId: libraryId,
      sourceType: "library",
    });
    const foreignJob = {
      ...queued.job,
      libraryId: "library:foreign",
      leaseOwner: "worker:foreign",
      leaseExpiresAt: Date.now() + 60_000,
    };

    await expect(
      store.persist({
        entries: [{ contentUnitId: unit.id, vector: new Float32Array([1, 0]) }],
        indexId: index.id,
        job: foreignJob,
        libraryId,
        sourceChangeSeq: index.sourceChangeSeq,
      }),
    ).rejects.toBeInstanceOf(KnowledgeJobLeaseLostError);
    await expect(nativeTableExists()).resolves.toBe(false);
  });

  it("rejects a vector batch when its live lease targets another index", async () => {
    const unit = contentUnit("content-unit:wrong-index");
    await units.upsertMany([unit]);
    const sourceIndex = await beginHybridIndex();
    const otherIndex = await beginHybridIndex();
    const jobs = new KnowledgeJobsRepo(database, libraryId);
    const queued = await jobs.enqueue({
      availableAt: 0,
      indexId: sourceIndex.id,
      kind: "embed",
      sourceId: libraryId,
      sourceType: "library",
    });
    const base = Date.now();
    await jobs.claimNext("worker-target", { now: base, leaseMs: 1_000 });
    const running = await jobs.start(queued.job.id, "worker-target", {
      now: base,
      leaseMs: 1_000,
    });
    if (!running) throw new Error("test lease did not start");

    await expect(
      store.persist({
        entries: [{ contentUnitId: unit.id, vector: new Float32Array([1, 0]) }],
        indexId: otherIndex.id,
        job: running,
        libraryId,
        sourceChangeSeq: otherIndex.sourceChangeSeq,
      }),
    ).rejects.toBeInstanceOf(KnowledgeJobLeaseLostError);
    await expect(nativeTableExists()).resolves.toBe(false);
    await expect(indexes.get(otherIndex.id)).resolves.toMatchObject({ status: "building" });

    await indexes.fail(otherIndex.id, new Error("cleanup target"), { now: base + 1 });
    await expect(
      store.discardPhysicalRows({ indexId: otherIndex.id, job: running, libraryId }),
    ).rejects.toBeInstanceOf(KnowledgeJobLeaseLostError);
  });

  it("discards failed physical rows without hiding failure metadata", async () => {
    const unit = contentUnit("content-unit:discard", { sourceId: "revision:discard" });
    await units.upsertMany([unit]);
    const index = await beginHybridIndex();
    await store.persist({
      libraryId,
      indexId: index.id,
      sourceChangeSeq: index.sourceChangeSeq,
      entries: [{ contentUnitId: unit.id, vector: new Float32Array([1, 0]) }],
      now: 500,
    });
    await indexes.fail(index.id, new Error("build failed"), { now: 501 });

    await expect(store.discardPhysicalRows({ libraryId, indexId: index.id })).resolves.toBe(1);
    await expect(store.discardPhysicalRows({ libraryId, indexId: index.id })).resolves.toBe(0);
    await expect(nativeRowCount(index.id)).resolves.toBe(0);
    await expect(indexes.get(index.id)).resolves.toMatchObject({
      status: "failed",
      indexedCount: 1,
    });
    await expect(indexes.listEntries(index.id)).resolves.toEqual([
      expect.objectContaining({ contentUnitId: unit.id, status: "ready" }),
    ]);
  });

  it("rejects physical cleanup with a stale Library scope token", async () => {
    const index = await beginHybridIndex();
    await indexes.retire(index.id, { now: 502 });

    await expect(
      store.garbageCollect({
        expectedScope: { libraryId, scopeToken: "stale-scope-token" },
        indexId: index.id,
        libraryId,
      }),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
    await expect(indexes.get(index.id)).resolves.toMatchObject({ status: "retired" });
  });

  it("suppresses a physically retained vector after its PDF revision is no longer current", async () => {
    const work = await new WorksRepo(database, libraryId).upsert({
      title: "Vector visibility paper",
    });
    const asset = await new DocumentAssetsRepo(database, libraryId).create({
      workId: work.id,
      kind: "pdf",
      title: "vector-visibility.pdf",
    });
    const first = await new DocumentAssetsRepo(database, libraryId).createRevision(asset.id, {
      id: "revision:vector-visibility-first",
      mimeType: "application/pdf",
      blobSha256: "1".repeat(64),
      byteSize: 10,
      extractionStatus: "ready",
    });
    const second = await new DocumentAssetsRepo(database, libraryId).createRevision(asset.id, {
      id: "revision:vector-visibility-second",
      mimeType: "application/pdf",
      blobSha256: "2".repeat(64),
      byteSize: 10,
      extractionStatus: "ready",
      makeCurrent: false,
    });
    const oldUnit = contentUnit("content-unit:vector-visibility-old", {
      sourceId: first.id,
      assetId: asset.id,
      revisionId: first.id,
      workId: work.id,
      contentHash: "e".repeat(64),
    });
    await units.upsertMany([oldUnit]);
    const index = await beginHybridIndex();
    await store.persist({
      libraryId,
      indexId: index.id,
      sourceChangeSeq: index.sourceChangeSeq,
      entries: [{ contentUnitId: oldUnit.id, vector: new Float32Array([0, 1]) }],
      now: 300,
    });
    await indexes.activate(index.id, { now: 301 });

    // Simulate a canonical pointer switch before the asynchronous vector GC.
    await database.run(
      `UPDATE document_assets SET current_revision_id = ?, updated_at = 302 WHERE id = ?`,
      [second.id, asset.id],
    );
    await expect(
      store.search({
        libraryId,
        indexId: index.id,
        allowedSourceIds: [first.id],
        vector: new Float32Array([0, 1]),
        limit: 1,
      }),
    ).resolves.toEqual([]);
  });

  it("ignores an orphaned native vector mapping instead of surfacing it", async () => {
    const unit = contentUnit("content-unit:vector-orphan", {
      sourceId: "revision:vector-orphan",
    });
    await units.upsertMany([unit]);
    const index = await beginHybridIndex();
    await store.persist({
      libraryId,
      indexId: index.id,
      sourceChangeSeq: index.sourceChangeSeq,
      entries: [{ contentUnitId: unit.id, vector: new Float32Array([0, 1]) }],
      now: 400,
    });
    await indexes.activate(index.id, { now: 401 });

    // Simulate a damaged legacy database with foreign-key enforcement disabled.
    // The physical row remains, but a missing relational ContentUnit must not
    // become a result or an adapter error.
    await database.exec("PRAGMA foreign_keys = OFF");
    await database.run("DELETE FROM content_units WHERE id = ?", [unit.id]);
    await database.exec("PRAGMA foreign_keys = ON");
    await expect(
      store.search({
        libraryId,
        indexId: index.id,
        allowedSourceIds: [unit.sourceId],
        vector: new Float32Array([0, 1]),
        limit: 1,
      }),
    ).resolves.toEqual([]);
  });
});

async function beginHybridIndex() {
  const profile = await new EmbeddingProfilesRepo(database).register({
    providerKind: "local-test",
    egressMode: "local",
    modelId: "sqlite-vec-test",
    modelRevision: "r1",
    dimension: 2,
    distanceMetric: "cosine",
    normalization: "l2",
    chunkProfileVersion: "test-chunk-v1",
    fingerprint: "local-test:sqlite-vec-test:r1:2:cosine:l2:test-chunk-v1",
    createdAt: 1,
  });
  return indexes.begin({ mode: "hybrid", embeddingProfileId: profile.id, now: 2 });
}

async function nativeRowCount(indexId: string): Promise<number> {
  if (!(await nativeTableExists())) return 0;
  const rows = await database.query<{ count: number | bigint }>(
    `SELECT COUNT(*) AS count FROM ${sqliteVecTableName(2)} WHERE library_id = ? AND index_id = ?`,
    [libraryId, indexId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function nativeTableExists(): Promise<boolean> {
  const rows = await database.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    [sqliteVecTableName(2)],
  );
  return rows.length > 0;
}

function contentUnit(id: string, overrides: Partial<ContentUnit> = {}): ContentUnit {
  return {
    id,
    libraryId,
    sourceType: "pdf",
    sourceId: "revision:sqlite-vec",
    workId: null,
    assetId: null,
    revisionId: null,
    parentUnitId: null,
    ordinal: 0,
    headingPath: ["Methods"],
    anchor: { kind: "pdf", pageIndex: 0, version: 1 },
    text: `Durable ContentUnit ${id}`,
    language: "en",
    tokenCount: 4,
    contentHash: "0".repeat(64),
    extractorProfile: "test-extractor-v1",
    chunkProfile: "test-chunk-v1",
    state: "ready",
    ...overrides,
  };
}

function resolveSqliteVecLoadablePath(): string {
  const sqliteVec = requireFromTest("sqlite-vec") as { getLoadablePath: () => unknown };
  const loadablePath = sqliteVec.getLoadablePath();
  if (typeof loadablePath !== "string" || !loadablePath.trim()) {
    throw new Error("sqlite-vec did not provide a loadable extension path");
  }
  return loadablePath;
}
