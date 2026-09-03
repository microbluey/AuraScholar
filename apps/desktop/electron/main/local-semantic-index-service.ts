import {
  EmbeddingProfilesRepo,
  KnowledgeIndexesRepo,
  KnowledgeJobsRepo,
  type Database,
  type KnowledgeIndexEntryRow,
  type KnowledgeIndexRow,
  type KnowledgeJobRow,
} from "@aurascholar/db";
import type { EmbeddingProvider } from "@aurascholar/knowledge";
import type { LibraryScopeToken } from "../library-read-command-contract";
import type { LocalEmbeddingProfileDescriptor } from "./local-embedding-provider";
import { assertActiveLibraryScopeToken, getActiveLibraryScopeToken } from "./library-scope-token";
import {
  assertEmbedJob,
  assertKnowledgeIndexSnapshot,
  assertId,
  currentTime,
  isAbort,
  isScopeRejection,
  isStaleIndexSnapshotError,
  SCOPE_REJECTED_ERROR,
  staleIndexSnapshotError,
  throwIfAborted,
} from "./local-semantic-index-snapshot";

const EMBED_BATCH_SIZE = 16;

type DatabaseOperation<T> = (database: Database) => Promise<T> | T;

export interface LocalSemanticEmbeddingProvider extends EmbeddingProvider {
  readonly embeddingProfile: LocalEmbeddingProfileDescriptor;
}

export interface LocalSemanticVectorWriter {
  persist(input: {
    libraryId: string;
    indexId: string;
    sourceChangeSeq: number;
    expectedScope?: LibraryScopeToken;
    entries: readonly { contentUnitId: string; vector: Float32Array }[];
  }): Promise<readonly KnowledgeIndexEntryRow[]>;
  discardPhysicalRows?(input: {
    libraryId: string;
    indexId: string;
    expectedScope?: LibraryScopeToken;
  }): Promise<number>;
}

export interface LocalSemanticIndexServiceDependencies {
  /** Revalidates the active Library generation inside a serialized DB lease. */
  assertScope?(database: Database, expectedScope: LibraryScopeToken): Promise<LibraryScopeToken>;
  ensureVectorRuntime?(): Promise<void>;
  getEmbeddingProvider(): Promise<LocalSemanticEmbeddingProvider>;
  inspect<T>(operation: DatabaseOperation<T>): Promise<T>;
  now?(): number;
  transaction<T>(commandName: string, operation: DatabaseOperation<T>): Promise<T>;
  vectorWriter: LocalSemanticVectorWriter;
}

export interface EnqueueLocalSemanticIndexBuildResult {
  readonly created: boolean;
  readonly index: KnowledgeIndexRow;
  readonly job: KnowledgeJobRow;
}

export interface LocalSemanticIndexSummary {
  readonly expectedCount: number;
  readonly id: string;
  readonly indexedCount: number;
  /** The pinned source snapshot is older than the Library's current changes. */
  readonly stale: boolean;
  readonly status: "active" | "building" | "failed";
}

export interface LocalSemanticIndexStatus {
  readonly active: LocalSemanticIndexSummary | null;
  readonly building: LocalSemanticIndexSummary | null;
  readonly failed: LocalSemanticIndexSummary | null;
}

/**
 * Bridges the immutable local-embedding profile, durable index generation,
 * and the existing Knowledge job queue. It never accepts a model path, URL,
 * or embedding provider choice from a caller.
 */
export class LocalSemanticIndexService {
  constructor(private readonly dependencies: LocalSemanticIndexServiceDependencies) {}

  /** Safe progress projection for renderer status; raw errors and paths stay private. */
  async getStatus(
    libraryId: string,
    expectedScope?: LibraryScopeToken,
  ): Promise<LocalSemanticIndexStatus> {
    assertId(libraryId, "Semantic index Library id");
    const snapshot = await this.dependencies.inspect(async (database) => {
      await this.assertScopeInLease(database, libraryId, expectedScope);
      const indexes = new KnowledgeIndexesRepo(database, libraryId);
      return {
        indexes: await indexes.list(["active", "building", "failed"]),
        latestSourceChangeSeq: await indexes.getLatestSourceChangeSeq(),
      };
    });
    return {
      active: summarizeIndex(
        snapshot.indexes.find((index) => index.status === "active") ?? null,
        snapshot.latestSourceChangeSeq,
      ),
      building: summarizeIndex(
        snapshot.indexes.find((index) => index.status === "building") ?? null,
        snapshot.latestSourceChangeSeq,
      ),
      failed: summarizeIndex(
        snapshot.indexes.find((index) => index.status === "failed") ?? null,
        snapshot.latestSourceChangeSeq,
      ),
    };
  }

  /**
   * Captures a fresh hybrid generation, then creates one resumable `embed`
   * job. The model is only resolved as an already-installed local artifact;
   * actual ONNX loading remains lazy until the background job starts.
   */
  async enqueueBuild(
    libraryId: string,
    expectedScope?: LibraryScopeToken,
  ): Promise<EnqueueLocalSemanticIndexBuildResult> {
    assertId(libraryId, "Semantic index Library id");
    // Reject a stale request before resolving the optional native runtime or
    // loading an embedding artifact. The durable boundaries below repeat this
    // check after each potentially long provider/runtime await.
    await this.assertScope(libraryId, expectedScope);
    await this.dependencies.ensureVectorRuntime?.();
    const provider = await this.dependencies.getEmbeddingProvider();
    const descriptor = assertLocalProvider(provider);
    // Keep profile registration, generation capture, and job creation in one
    // durable transaction. In particular, a scope check that fails after the
    // generation is inserted must roll the insert back rather than leaving an
    // orphaned `building` row that a worker can never claim.
    const prepared = await this.dependencies.transaction(
      "knowledge.semanticIndex.enqueueBuild",
      async (database) => {
        await this.assertScopeInLease(database, libraryId, expectedScope);
        const profile = await new EmbeddingProfilesRepo(database).register(
          toProfileInput(descriptor),
        );
        const index = await new KnowledgeIndexesRepo(database, libraryId).begin({
          embeddingProfileId: profile.id,
          mode: "hybrid",
          now: currentTime(this.dependencies.now),
        });

        // Keep this second lease assertion at the job boundary. The outer
        // BEGIN IMMEDIATE makes a normal Library switch wait until commit, and
        // any injected/foreign scope change still aborts the whole transaction.
        await this.assertScopeInLease(database, libraryId, expectedScope);
        const enqueued = await new KnowledgeJobsRepo(database, libraryId).enqueue({
          dedupeKey: `semantic-index:${index.id}`,
          indexId: index.id,
          kind: "embed",
          sourceId: libraryId,
          sourceType: "library",
        });
        return { enqueued, index };
      },
    );
    return {
      created: prepared.enqueued.created,
      index: prepared.index,
      job: prepared.enqueued.job,
    };
  }

  /** Materializes a pinned hybrid generation in small, transactionally durable batches. */
  async materialize(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<{ progress: Record<string, number | string> }> {
    assertEmbedJob(job);
    const indexId = job.indexId!;
    let workerScope: LibraryScopeToken | undefined;
    try {
      workerScope = await this.captureWorkerScope(job.libraryId);
      const snapshot = await this.dependencies.inspect(async (database) => {
        await this.assertScopeInLease(database, job.libraryId, workerScope);
        const indexes = new KnowledgeIndexesRepo(database, job.libraryId);
        return {
          index: await indexes.get(indexId),
          latestSourceChangeSeq: await indexes.getLatestSourceChangeSeq(),
        };
      });
      const index = snapshot.index;
      if (!index) return { progress: { reason: "index-missing", status: "skipped" } };
      if (index.status !== "building") {
        return { progress: { reason: `index-${index.status}`, status: "skipped" } };
      }
      if (index.sourceChangeSeq !== snapshot.latestSourceChangeSeq) {
        await this.failAndDiscard(job.libraryId, indexId, staleIndexSnapshotError(), workerScope);
        return { progress: { reason: "stale-snapshot", status: "skipped" } };
      }
      if (index.mode !== "hybrid" || !index.embeddingProfileId) {
        throw new Error("Semantic embedding job does not reference a hybrid index profile");
      }

      const provider = await this.dependencies.getEmbeddingProvider();
      const descriptor = assertLocalProvider(provider);
      await this.assertProfileMatches(job.libraryId, index, descriptor, workerScope);

      let embedded = 0;
      while (true) {
        throwIfAborted(signal);
        const pending = await this.dependencies.inspect(async (database) => {
          await this.assertScopeInLease(database, job.libraryId, workerScope);
          await assertKnowledgeIndexSnapshot(
            database,
            job.libraryId,
            index.sourceChangeSeq,
            index.sourceChangeSeq,
          );
          return new KnowledgeIndexesRepo(database, job.libraryId).listPendingVectorEntries(
            indexId,
            {
              limit: EMBED_BATCH_SIZE,
            },
          );
        });
        if (pending.length === 0) break;

        const vectors = await provider.embedDocuments(
          pending.map((entry) => entry.text),
          { signal },
        );
        throwIfAborted(signal);
        if (!Array.isArray(vectors) || vectors.length !== pending.length) {
          throw new Error("Local embedding provider returned an unexpected document vector count");
        }
        throwIfAborted(signal);
        // Injectable writers get the same stale-snapshot behavior as the
        // native writer; the native writer repeats this check atomically.
        await this.assertCurrentSnapshot(
          job.libraryId,
          indexId,
          index.sourceChangeSeq,
          workerScope,
        );
        const persisted = await this.dependencies.vectorWriter.persist({
          entries: pending.map((entry, position) => {
            const vector = vectors[position];
            if (!vector)
              throw new Error("Local embedding provider returned an incomplete document batch");
            return { contentUnitId: entry.contentUnitId, vector };
          }),
          indexId,
          libraryId: job.libraryId,
          sourceChangeSeq: index.sourceChangeSeq,
          expectedScope: workerScope,
        });
        if (!Array.isArray(persisted) || persisted.length !== pending.length) {
          throw new Error("Local vector store did not persist every document vector");
        }
        embedded += persisted.length;
      }

      const active = await this.dependencies.transaction(
        "knowledge.semanticIndex.activate",
        async (database) => {
          await this.assertScopeInLease(database, job.libraryId, workerScope);
          await assertKnowledgeIndexSnapshot(
            database,
            job.libraryId,
            index.sourceChangeSeq,
            index.sourceChangeSeq,
          );
          return new KnowledgeIndexesRepo(database, job.libraryId).activate(indexId, {
            now: currentTime(this.dependencies.now),
          });
        },
      );
      return {
        progress: {
          embedded,
          indexId: active.id,
          indexedCount: active.indexedCount,
          status: "active",
        },
      };
    } catch (error) {
      // Retries are useful for a temporary native-runtime or storage failure.
      // On the final durable attempt, make the failed generation explicit so
      // it can never be selected for retrieval.
      if (!isAbort(error, signal) && isScopeRejection(error)) {
        // A scope switch invalidates this lease. Propagate the rejection so
        // KnowledgeJobWorker cannot complete the old Library's job; its lease
        // will be reclaimed when the active Library changes again or expires.
        throw error;
      }
      if (!isAbort(error, signal) && isStaleIndexSnapshotError(error)) {
        if (!workerScope) throw error;
        await this.failAndDiscard(job.libraryId, indexId, error, workerScope);
        return { progress: { reason: "stale-snapshot", status: "skipped" } };
      }
      if (!isAbort(error, signal) && job.attempts >= job.maxAttempts && workerScope) {
        try {
          await this.failAndDiscard(job.libraryId, indexId, error, workerScope);
        } catch (cleanupError) {
          if (isScopeRejection(cleanupError)) throw cleanupError;
          // Preserve the original provider/storage error. The queue lease
          // remains the retry/terminal-failure authority.
        }
      }
      throw error;
    }
  }

  private async assertProfileMatches(
    libraryId: string,
    index: KnowledgeIndexRow,
    descriptor: LocalEmbeddingProfileDescriptor,
    expectedScope?: LibraryScopeToken,
  ): Promise<void> {
    const expected = toProfileInput(descriptor);
    const profile = await this.dependencies.inspect(async (database) => {
      await this.assertScopeInLease(database, libraryId, expectedScope);
      return new EmbeddingProfilesRepo(database).get(index.embeddingProfileId!);
    });
    if (!profile || !sameProfile(profile, expected)) {
      throw new Error("Local embedding artifact does not match this semantic index generation");
    }
    // Keep `libraryId` in the method signature deliberately: matching a global
    // immutable profile is not enough unless its generation was fetched from
    // the same Library in `materialize`.
    assertId(libraryId, "Semantic index Library id");
  }

  private async captureWorkerScope(libraryId: string): Promise<LibraryScopeToken> {
    return this.dependencies.inspect(async (database) => {
      const scope = await getActiveLibraryScopeToken(database);
      if (scope.libraryId !== libraryId) throw new Error(SCOPE_REJECTED_ERROR);
      return scope;
    });
  }

  private async assertCurrentSnapshot(
    libraryId: string,
    indexId: string,
    sourceChangeSeq: number,
    expectedScope: LibraryScopeToken,
  ): Promise<void> {
    await this.dependencies.inspect(async (database) => {
      await this.assertScopeInLease(database, libraryId, expectedScope);
      const index = await new KnowledgeIndexesRepo(database, libraryId).get(indexId);
      if (!index) throw staleIndexSnapshotError();
      await assertKnowledgeIndexSnapshot(
        database,
        libraryId,
        index.sourceChangeSeq,
        sourceChangeSeq,
      );
    });
  }

  private async failAndDiscard(
    libraryId: string,
    indexId: string,
    error: unknown,
    expectedScope?: LibraryScopeToken,
  ): Promise<void> {
    await this.failIndex(libraryId, indexId, error, expectedScope);
    try {
      await this.dependencies.vectorWriter.discardPhysicalRows?.({
        libraryId,
        indexId,
        expectedScope,
      });
    } catch (cleanupError) {
      if (isScopeRejection(cleanupError)) throw cleanupError;
      // Failed generations stay out of retrieval; a later GC pass can retry
      // physical cleanup without masking the original failure.
    }
  }

  private async failIndex(
    libraryId: string,
    indexId: string,
    error: unknown,
    expectedScope?: LibraryScopeToken,
  ): Promise<boolean> {
    return this.dependencies.transaction("knowledge.semanticIndex.fail", async (database) => {
      await this.assertScopeInLease(database, libraryId, expectedScope);
      return new KnowledgeIndexesRepo(database, libraryId).fail(indexId, error, {
        now: currentTime(this.dependencies.now),
      });
    });
  }

  private async assertScope(libraryId: string, expectedScope?: LibraryScopeToken): Promise<void> {
    if (!expectedScope) return;
    await this.dependencies.inspect((database) =>
      this.assertScopeInLease(database, libraryId, expectedScope),
    );
  }

  private async assertScopeInLease(
    database: Database,
    libraryId: string,
    expectedScope?: LibraryScopeToken,
  ): Promise<void> {
    if (!expectedScope) return;
    if (expectedScope.libraryId !== libraryId) {
      throw new Error(SCOPE_REJECTED_ERROR);
    }
    if (this.dependencies.assertScope) {
      await this.dependencies.assertScope(database, expectedScope);
      return;
    }
    // Keep injectable tests safe even when they do not provide the production
    // callback; the shared authority remains the fail-closed fallback.
    await assertActiveLibraryScopeToken(database, expectedScope);
  }
}

function assertLocalProvider(
  provider: LocalSemanticEmbeddingProvider,
): LocalEmbeddingProfileDescriptor {
  if (!provider || provider.egressMode !== "local") {
    throw new Error("Semantic index requires an on-device embedding provider");
  }
  const descriptor = provider.embeddingProfile;
  if (!descriptor || descriptor.dimension !== provider.dimension) {
    throw new Error("Local embedding provider has an invalid durable profile");
  }
  if (descriptor.egressMode !== "local" || descriptor.distanceMetric !== "cosine") {
    throw new Error("Local embedding provider has an incompatible retrieval profile");
  }
  return descriptor;
}

function toProfileInput(descriptor: LocalEmbeddingProfileDescriptor): {
  chunkProfileVersion: string;
  dimension: number;
  distanceMetric: "cosine";
  egressMode: "local";
  fingerprint: string;
  modelId: string;
  modelRevision: string;
  normalization: "l2";
  providerKind: string;
} {
  return { ...descriptor };
}

function sameProfile(
  stored: {
    chunkProfileVersion: string;
    dimension: number;
    distanceMetric: string;
    egressMode: string;
    fingerprint: string;
    modelId: string;
    modelRevision: string | null;
    normalization: string;
    providerKind: string;
  },
  expected: ReturnType<typeof toProfileInput>,
): boolean {
  return (
    stored.chunkProfileVersion === expected.chunkProfileVersion &&
    stored.dimension === expected.dimension &&
    stored.distanceMetric === expected.distanceMetric &&
    stored.egressMode === expected.egressMode &&
    stored.fingerprint === expected.fingerprint &&
    stored.modelId === expected.modelId &&
    stored.modelRevision === expected.modelRevision &&
    stored.normalization === expected.normalization &&
    stored.providerKind === expected.providerKind
  );
}

function summarizeIndex(
  index: KnowledgeIndexRow | null,
  latestSourceChangeSeq: number,
): LocalSemanticIndexSummary | null {
  if (!index) return null;
  if (index.status !== "active" && index.status !== "building" && index.status !== "failed") {
    throw new Error("Semantic index status cannot be presented safely");
  }
  return {
    expectedCount: index.expectedCount,
    id: index.id,
    indexedCount: index.indexedCount,
    stale: index.sourceChangeSeq !== latestSourceChangeSeq,
    status: index.status,
  };
}
