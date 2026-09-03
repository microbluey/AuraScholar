import {
  ContentUnitsRepo,
  KnowledgeChangesRepo,
  KnowledgeIndexesRepo,
  KnowledgeJobLeaseLostError,
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

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let database: Database;
let libraryId: string;
let coordinator: DatabaseCoordinator;
let provider: LocalSemanticEmbeddingProvider;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "local-semantic-index-service",
    deviceName: "Local semantic index service",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  provider = fakeProvider();
});

describe("LocalSemanticIndexService", () => {
  it("pins a local profile, queues a durable job, embeds every pending unit, and activates the generation", async () => {
    await new ContentUnitsRepo(database, libraryId).upsertMany([
      contentUnit(
        "content-unit:semantic-a",
        "A local vector index preserves source scope.",
        HASH_A,
      ),
      contentUnit("content-unit:semantic-b", "Embeddings stay on the device.", HASH_B),
    ]);
    const persist = vi.fn(
      async (input: {
        libraryId: string;
        indexId: string;
        entries: readonly { contentUnitId: string; vector: Float32Array }[];
      }) => {
        return coordinator.transaction("test.vector.persist", async (db) => {
          const indexes = new KnowledgeIndexesRepo(db, input.libraryId);
          const rows = [];
          for (const [position, entry] of input.entries.entries()) {
            rows.push(
              await indexes.markVectorReady(input.indexId, {
                contentUnitId: entry.contentUnitId,
                now: 10 + position,
                vectorRef: String(position + 1),
              }),
            );
          }
          return rows;
        });
      },
    );
    const ensureVectorRuntime = vi.fn().mockResolvedValue(undefined);
    const service = serviceWith({ ensureVectorRuntime, persist });

    const queued = await service.enqueueBuild(libraryId);
    const result = await service.materialize(queued.job, new AbortController().signal);

    expect(ensureVectorRuntime).toHaveBeenCalledTimes(1);
    expect(queued.created).toBe(true);
    expect(queued.job).toMatchObject({
      indexId: queued.index.id,
      kind: "embed",
      sourceId: libraryId,
      sourceType: "library",
    });
    expect(provider.embedDocuments).toHaveBeenCalledWith(
      ["A local vector index preserves source scope.", "Embeddings stay on the device."],
      { signal: expect.any(AbortSignal) },
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          { contentUnitId: "content-unit:semantic-a", vector: new Float32Array([1, 0]) },
          { contentUnitId: "content-unit:semantic-b", vector: new Float32Array([0, 1]) },
        ],
        expectedScope: expect.objectContaining({ libraryId }),
        indexId: queued.index.id,
        libraryId,
        sourceChangeSeq: queued.index.sourceChangeSeq,
      }),
    );
    expect(result.progress).toMatchObject({
      embedded: 2,
      indexedCount: 2,
      indexId: queued.index.id,
      status: "active",
    });
    await expect(
      new KnowledgeIndexesRepo(database, libraryId).get(queued.index.id),
    ).resolves.toMatchObject({
      embeddingProfileId: expect.any(String),
      indexedCount: 2,
      mode: "hybrid",
      status: "active",
    });
  });

  it("does not load or vectorize anything when a completed generation is replayed", async () => {
    const persist = vi.fn();
    const service = serviceWith({ persist });
    const queued = await service.enqueueBuild(libraryId);
    await service.materialize(queued.job, new AbortController().signal);

    const replay = await service.materialize(queued.job, new AbortController().signal);
    expect(replay).toEqual({ progress: { reason: "index-active", status: "skipped" } });
    expect(provider.embedDocuments).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("marks an active generation stale after a newer durable Library change", async () => {
    const service = serviceWith({ persist: vi.fn() });
    const queued = await service.enqueueBuild(libraryId);
    await service.materialize(queued.job, new AbortController().signal);

    await expect(service.getStatus(libraryId)).resolves.toMatchObject({
      active: { id: queued.index.id, stale: false },
    });
    await new KnowledgeChangesRepo(database, libraryId).append({
      changeKind: "upsert",
      sourceId: "revision:status-stale",
      sourceType: "revision",
    });
    await expect(service.getStatus(libraryId)).resolves.toMatchObject({
      active: { id: queued.index.id, stale: true },
    });
  });

  it("fails a queued generation closed when its source snapshot is already stale", async () => {
    await new ContentUnitsRepo(database, libraryId).upsertMany([
      contentUnit("content-unit:job-stale", "A stale queued snapshot.", HASH_A),
    ]);
    const service = serviceWith({ persist: vi.fn() });
    const queued = await service.enqueueBuild(libraryId);
    await new KnowledgeChangesRepo(database, libraryId).append({
      changeKind: "upsert",
      sourceId: "revision:job-stale",
      sourceType: "revision",
    });

    await expect(service.materialize(queued.job, new AbortController().signal)).resolves.toEqual({
      progress: { reason: "stale-snapshot", status: "skipped" },
    });
    expect(provider.embedDocuments).not.toHaveBeenCalled();
    await expect(
      new KnowledgeIndexesRepo(database, libraryId).get(queued.index.id),
    ).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("rejects a batch that becomes stale while the provider is awaiting", async () => {
    await new ContentUnitsRepo(database, libraryId).upsertMany([
      contentUnit("content-unit:await-stale", "The source changes during embedding.", HASH_A),
    ]);
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseEmbedding!: () => void;
    const embeddingReleased = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    const embedDocuments = vi.fn(async (texts: readonly string[]) => {
      signalStarted();
      await embeddingReleased;
      return texts.map(() => new Float32Array([1, 0]));
    });
    const delayedProvider = { ...provider, embedDocuments };
    const persist = vi.fn().mockResolvedValue([]);
    const service = serviceWith({
      getEmbeddingProvider: vi.fn().mockResolvedValue(delayedProvider),
      persist,
    });
    const queued = await service.enqueueBuild(libraryId);
    const running = service.materialize(queued.job, new AbortController().signal);

    await started;
    await new KnowledgeChangesRepo(database, libraryId).append({
      changeKind: "upsert",
      sourceId: "revision:await-stale",
      sourceType: "revision",
    });
    releaseEmbedding();

    await expect(running).resolves.toEqual({
      progress: { reason: "stale-snapshot", status: "skipped" },
    });
    expect(persist).not.toHaveBeenCalled();
    await expect(
      new KnowledgeIndexesRepo(database, libraryId).get(queued.index.id),
    ).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("rejects a vector batch when its worker lease is lost while the provider is awaiting", async () => {
    await new ContentUnitsRepo(database, libraryId).upsertMany([
      contentUnit("content-unit:await-lease", "The lease changes during embedding.", HASH_A),
    ]);
    let leaseLost = false;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseEmbedding!: () => void;
    const embeddingReleased = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    const delayedProvider = {
      ...provider,
      embedDocuments: vi.fn(async (texts: readonly string[]) => {
        signalStarted();
        await embeddingReleased;
        return texts.map(() => new Float32Array([1, 0]));
      }),
    };
    const persist = vi.fn().mockResolvedValue([]);
    const assertJobLease = vi.fn(async () => {
      if (leaseLost) throw new KnowledgeJobLeaseLostError("job:lease-lost");
    });
    const service = serviceWith({
      assertJobLease,
      getEmbeddingProvider: vi.fn().mockResolvedValue(delayedProvider),
      persist,
    });
    const queued = await service.enqueueBuild(libraryId);
    const running = service.materialize(queued.job, new AbortController().signal);

    await started;
    leaseLost = true;
    releaseEmbedding();

    await expect(running).rejects.toBeInstanceOf(KnowledgeJobLeaseLostError);
    expect(persist).not.toHaveBeenCalled();
  });

  it("cleans already-written vectors when a snapshot changes before activation", async () => {
    const unit = contentUnit("content-unit:late-stale", "A late vector must be discarded.", HASH_A);
    await new ContentUnitsRepo(database, libraryId).upsertMany([unit]);
    let signalPersisted!: () => void;
    const persisted = new Promise<void>((resolve) => {
      signalPersisted = resolve;
    });
    let releasePersist!: () => void;
    const persistReleased = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    const persist = vi.fn(
      async (input: {
        libraryId: string;
        indexId: string;
        entries: readonly { contentUnitId: string; vector: Float32Array }[];
      }) => {
        const rows = await coordinator.transaction("test.vector.persist", async (db) => {
          const indexes = new KnowledgeIndexesRepo(db, input.libraryId);
          return indexes.markVectorReady(input.indexId, {
            contentUnitId: input.entries[0]!.contentUnitId,
            vectorRef: "late-vector",
          });
        });
        signalPersisted();
        await persistReleased;
        return [rows];
      },
    );
    const discardPhysicalRows = vi.fn().mockResolvedValue(1);
    const service = serviceWith({ discardPhysicalRows, persist });
    const queued = await service.enqueueBuild(libraryId);
    const running = service.materialize(queued.job, new AbortController().signal);

    await persisted;
    await new KnowledgeChangesRepo(database, libraryId).append({
      changeKind: "upsert",
      sourceId: "revision:late-stale",
      sourceType: "revision",
    });
    releasePersist();

    await expect(running).resolves.toEqual({
      progress: { reason: "stale-snapshot", status: "skipped" },
    });
    expect(discardPhysicalRows).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedScope: expect.objectContaining({ libraryId }),
        indexId: queued.index.id,
        libraryId,
      }),
    );
  });

  it("rejects a malformed embed job before reading an embedding provider", async () => {
    const getEmbeddingProvider = vi.fn().mockResolvedValue(provider);
    const service = serviceWith({ getEmbeddingProvider, persist: vi.fn() });

    await expect(
      service.materialize(
        {
          indexId: "index:semantic",
          kind: "embed",
          libraryId,
          maxAttempts: 3,
          sourceId: "library:foreign",
          sourceType: "library",
        } as never,
        new AbortController().signal,
      ),
    ).rejects.toThrow("invalid source scope");
    expect(getEmbeddingProvider).not.toHaveBeenCalled();
  });
});

function serviceWith({
  assertJobLease = async () => {},
  discardPhysicalRows,
  ensureVectorRuntime,
  getEmbeddingProvider = vi.fn().mockImplementation(async () => provider),
  persist,
}: {
  assertJobLease?: (
    database: Database,
    job: import("@aurascholar/db").KnowledgeJobRow,
  ) => Promise<void>;
  discardPhysicalRows?: ReturnType<typeof vi.fn>;
  ensureVectorRuntime?: ReturnType<typeof vi.fn>;
  getEmbeddingProvider?: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof vi.fn>;
}) {
  return new LocalSemanticIndexService({
    assertJobLease,
    ensureVectorRuntime,
    getEmbeddingProvider,
    inspect: (operation) => coordinator.execute(operation),
    now: () => 1_738_361_600_000,
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
    vectorWriter: { discardPhysicalRows, persist },
  });
}

function fakeProvider(): LocalSemanticEmbeddingProvider {
  return {
    dimension: 2,
    egressMode: "local",
    embedDocuments: vi.fn(async (texts: readonly string[]) =>
      texts.map((_text, index) =>
        index % 2 === 0 ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
      ),
    ),
    embedQuery: vi.fn(async () => new Float32Array([1, 0])),
    embeddingProfile: {
      chunkProfileVersion: "embedding-window-mean-v1:test",
      dimension: 2,
      distanceMetric: "cosine",
      egressMode: "local",
      fingerprint: "local-embedding-test-fingerprint",
      modelId: "test/local",
      modelRevision: "test@1",
      normalization: "l2",
      providerKind: "local-test",
    },
    id: "local:test",
    model: "test/local",
  };
}

function contentUnit(id: string, text: string, contentHash: string): ContentUnit {
  return {
    anchor: { kind: "pdf", pageIndex: 0, revisionId: "revision:semantic", version: 1 },
    assetId: null,
    chunkProfile: "test-chunk-v1",
    contentHash,
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
    text,
    tokenCount: 5,
    workId: null,
  };
}
