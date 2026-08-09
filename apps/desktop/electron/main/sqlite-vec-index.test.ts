import { createRequire } from "node:module";
import {
  ContentUnitsRepo,
  EmbeddingProfilesRepo,
  KnowledgeIndexesRepo,
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
