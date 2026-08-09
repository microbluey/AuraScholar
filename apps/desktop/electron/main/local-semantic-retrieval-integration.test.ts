import { createRequire } from "node:module";
import {
  ContentUnitSearchRepo,
  ContentUnitsRepo,
  KnowledgeIndexesRepo,
  type ContentUnit,
  type Database,
} from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import {
  LocalSemanticIndexService,
  type LocalSemanticEmbeddingProvider,
} from "./local-semantic-index-service";
import { LocalSemanticSearchService } from "./local-semantic-search-service";
import { SqliteVecIndexStore } from "./sqlite-vec-index";

const requireFromTest = createRequire(import.meta.url);
const sqliteVecLoadablePath = resolveSqliteVecLoadablePath();

let database: Database;
let coordinator: DatabaseCoordinator;
let libraryId: string;
let provider: LocalSemanticEmbeddingProvider;
let store: SqliteVecIndexStore;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  const loadExtension = database.loadExtension;
  if (!loadExtension) throw new Error("The Node SQLite test driver cannot load sqlite-vec");
  await loadExtension(sqliteVecLoadablePath);
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "local-semantic-retrieval-integration",
    deviceName: "Local semantic retrieval integration",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  provider = localTestProvider();
  store = new SqliteVecIndexStore({
    inspect: (operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  });
});

describe("local semantic retrieval integration", () => {
  it("builds a durable local generation and merges its semantic-only candidate with FTS", async () => {
    const lexical = contentUnit("content-unit:lexical", {
      contentHash: "a".repeat(64),
      sourceId: "revision:lexical",
      text: "Grounded retrieval preserves a literal source anchor.",
    });
    const semanticOnly = contentUnit("content-unit:semantic", {
      contentHash: "b".repeat(64),
      ordinal: 1,
      sourceId: "revision:semantic",
      text: "A conceptually matching passage has no exact search token.",
    });
    await new ContentUnitsRepo(database, libraryId).upsertMany([lexical, semanticOnly]);

    const indexService = new LocalSemanticIndexService({
      ensureVectorRuntime: vi.fn().mockResolvedValue(undefined),
      getEmbeddingProvider: vi.fn().mockResolvedValue(provider),
      inspect: (operation) => coordinator.execute(operation),
      now: () => 1_738_361_600_000,
      transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
      vectorWriter: store,
    });
    const queued = await indexService.enqueueBuild(libraryId);
    await indexService.materialize(queued.job, new AbortController().signal);

    const searchService = new LocalSemanticSearchService({
      getActiveHybridIndexId: async (scope) => {
        const active = await new KnowledgeIndexesRepo(database, scope).getActive();
        return active?.id ?? null;
      },
      getEmbeddingProvider: vi.fn().mockResolvedValue(provider),
      vectorStore: store,
    });
    const result = await searchService.search({
      allowedSourceIds: [lexical.sourceId, semanticOnly.sourceId],
      fullText: {
        search: async ({ query, limit }) =>
          (await new ContentUnitSearchRepo(database, libraryId).search({ limit, query })).map((row) => ({
            contentUnitId: row.id,
          })),
      },
      libraryId,
      limit: 10,
      query: "grounded retrieval",
    });

    expect(result).toMatchObject({ mode: "hybrid", semanticStatus: "used" });
    expect(result.candidates.map(({ contentUnitId }) => contentUnitId)).toEqual(
      expect.arrayContaining([lexical.id, semanticOnly.id]),
    );
    expect(provider.embedDocuments).toHaveBeenCalledTimes(1);
    expect(provider.embedQuery).toHaveBeenCalledWith("grounded retrieval", { signal: undefined });
    await expect(new KnowledgeIndexesRepo(database, libraryId).get(queued.index.id)).resolves.toMatchObject({
      indexedCount: 2,
      status: "active",
    });
  });
});

function localTestProvider(): LocalSemanticEmbeddingProvider {
  return {
    dimension: 2,
    egressMode: "local",
    embedDocuments: vi.fn(async (texts: readonly string[]) =>
      texts.map((text) =>
        text.includes("conceptually") ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
      ),
    ),
    embedQuery: vi.fn(async () => new Float32Array([1, 0])),
    embeddingProfile: {
      chunkProfileVersion: "embedding-window-mean-v1:test",
      dimension: 2,
      distanceMetric: "cosine",
      egressMode: "local",
      fingerprint: "local-semantic-retrieval-integration",
      modelId: "test/local",
      modelRevision: "test@1",
      normalization: "l2",
      providerKind: "local-test",
    },
    id: "local:test",
    model: "test/local",
  };
}

function contentUnit(id: string, overrides: Partial<ContentUnit> = {}): ContentUnit {
  return {
    anchor: { kind: "pdf", pageIndex: 0, revisionId: "revision:semantic", version: 1 },
    assetId: null,
    chunkProfile: "test-chunk-v1",
    contentHash: "0".repeat(64),
    extractorProfile: "test-extractor-v1",
    headingPath: null,
    id,
    language: "en",
    libraryId,
    ordinal: 0,
    parentUnitId: null,
    revisionId: null,
    sourceId: "revision:semantic",
    sourceType: "pdf",
    state: "ready",
    text: `Durable ContentUnit ${id}`,
    tokenCount: 5,
    workId: null,
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
