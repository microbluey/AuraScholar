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
import type { LocalEmbeddingProfileDescriptor } from "./local-embedding-provider";

const EMBED_BATCH_SIZE = 16;
const STALE_INDEX_SNAPSHOT_ERROR = "Knowledge index snapshot is stale and must be rebuilt";

type DatabaseOperation<T> = (database: Database) => Promise<T> | T;

export interface LocalSemanticEmbeddingProvider extends EmbeddingProvider {
  readonly embeddingProfile: LocalEmbeddingProfileDescriptor;
}

export interface LocalSemanticVectorWriter {
  persist(input: {
    libraryId: string;
    indexId: string;
    entries: readonly { contentUnitId: string; vector: Float32Array }[];
  }): Promise<readonly KnowledgeIndexEntryRow[]>;
}

export interface LocalSemanticIndexServiceDependencies {
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
  async getStatus(libraryId: string): Promise<LocalSemanticIndexStatus> {
    assertId(libraryId, "Semantic index Library id");
    const snapshot = await this.dependencies.inspect(async (database) => {
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
  async enqueueBuild(libraryId: string): Promise<EnqueueLocalSemanticIndexBuildResult> {
    assertId(libraryId, "Semantic index Library id");
    await this.dependencies.ensureVectorRuntime?.();
    const provider = await this.dependencies.getEmbeddingProvider();
    const descriptor = assertLocalProvider(provider);
    const index = await this.dependencies.transaction(
      "knowledge.semanticIndex.begin",
      async (database) => {
        const profile = await new EmbeddingProfilesRepo(database).register(toProfileInput(descriptor));
        return new KnowledgeIndexesRepo(database, libraryId).begin({
          embeddingProfileId: profile.id,
          mode: "hybrid",
          now: currentTime(this.dependencies.now),
        });
      },
    );

    try {
      const enqueued = await this.dependencies.transaction(
        "knowledge.semanticIndex.enqueue",
        async (database) =>
          new KnowledgeJobsRepo(database, libraryId).enqueue({
            dedupeKey: `semantic-index:${index.id}`,
            indexId: index.id,
            kind: "embed",
            sourceId: libraryId,
            sourceType: "library",
          }),
      );
      return { created: enqueued.created, index, job: enqueued.job };
    } catch (error) {
      // Do not leave a seemingly buildable generation behind when its durable
      // worker record could not be created. The prior active generation stays
      // untouched by `fail`.
      await this.failIndex(libraryId, index.id, error);
      throw error;
    }
  }

  /** Materializes a pinned hybrid generation in small, transactionally durable batches. */
  async materialize(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<{ progress: Record<string, number | string> }> {
    assertEmbedJob(job);
    const indexId = job.indexId!;
    try {
      const index = await this.dependencies.inspect((database) =>
        new KnowledgeIndexesRepo(database, job.libraryId).get(indexId),
      );
      if (!index) return { progress: { reason: "index-missing", status: "skipped" } };
      if (index.status !== "building") {
        return { progress: { reason: `index-${index.status}`, status: "skipped" } };
      }
      const latestSourceChangeSeq = await this.dependencies.inspect((database) =>
        new KnowledgeIndexesRepo(database, job.libraryId).getLatestSourceChangeSeq(),
      );
      if (index.sourceChangeSeq !== latestSourceChangeSeq) {
        await this.failIndex(job.libraryId, indexId, new Error(STALE_INDEX_SNAPSHOT_ERROR));
        return { progress: { reason: "stale-snapshot", status: "skipped" } };
      }
      if (index.mode !== "hybrid" || !index.embeddingProfileId) {
        throw new Error("Semantic embedding job does not reference a hybrid index profile");
      }

      const provider = await this.dependencies.getEmbeddingProvider();
      const descriptor = assertLocalProvider(provider);
      await this.assertProfileMatches(job.libraryId, index, descriptor);

      let embedded = 0;
      while (true) {
        throwIfAborted(signal);
        const pending = await this.dependencies.inspect((database) =>
          new KnowledgeIndexesRepo(database, job.libraryId).listPendingVectorEntries(indexId, {
            limit: EMBED_BATCH_SIZE,
          }),
        );
        if (pending.length === 0) break;

        const vectors = await provider.embedDocuments(
          pending.map((entry) => entry.text),
          { signal },
        );
        throwIfAborted(signal);
        if (!Array.isArray(vectors) || vectors.length !== pending.length) {
          throw new Error("Local embedding provider returned an unexpected document vector count");
        }
        const persisted = await this.dependencies.vectorWriter.persist({
          entries: pending.map((entry, position) => {
            const vector = vectors[position];
            if (!vector) throw new Error("Local embedding provider returned an incomplete document batch");
            return { contentUnitId: entry.contentUnitId, vector };
          }),
          indexId,
          libraryId: job.libraryId,
        });
        if (!Array.isArray(persisted) || persisted.length !== pending.length) {
          throw new Error("Local vector store did not persist every document vector");
        }
        embedded += persisted.length;
      }

      const active = await this.dependencies.transaction(
        "knowledge.semanticIndex.activate",
        (database) =>
          new KnowledgeIndexesRepo(database, job.libraryId).activate(indexId, {
            now: currentTime(this.dependencies.now),
          }),
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
      if (!isAbort(error, signal) && error instanceof Error && error.message === STALE_INDEX_SNAPSHOT_ERROR) {
        await this.failIndex(job.libraryId, indexId, error);
        return { progress: { reason: "stale-snapshot", status: "skipped" } };
      }
      if (!isAbort(error, signal) && job.attempts >= job.maxAttempts) {
        await this.failIndex(job.libraryId, indexId, error);
      }
      throw error;
    }
  }

  private async assertProfileMatches(
    libraryId: string,
    index: KnowledgeIndexRow,
    descriptor: LocalEmbeddingProfileDescriptor,
  ): Promise<void> {
    const expected = toProfileInput(descriptor);
    const profile = await this.dependencies.inspect((database) =>
      new EmbeddingProfilesRepo(database).get(index.embeddingProfileId!),
    );
    if (!profile || !sameProfile(profile, expected)) {
      throw new Error("Local embedding artifact does not match this semantic index generation");
    }
    // Keep `libraryId` in the method signature deliberately: matching a global
    // immutable profile is not enough unless its generation was fetched from
    // the same Library in `materialize`.
    assertId(libraryId, "Semantic index Library id");
  }

  private async failIndex(libraryId: string, indexId: string, error: unknown): Promise<void> {
    try {
      await this.dependencies.transaction("knowledge.semanticIndex.fail", (database) =>
        new KnowledgeIndexesRepo(database, libraryId).fail(indexId, error, {
          now: currentTime(this.dependencies.now),
        }),
      );
    } catch {
      // The job queue still retains the original error/retry state. Avoid
      // masking it with a secondary failure-status write.
    }
  }
}

function assertEmbedJob(job: KnowledgeJobRow): void {
  if (job.kind !== "embed" || job.sourceType !== "library" || job.sourceId !== job.libraryId) {
    throw new Error("Semantic embedding job has an invalid source scope");
  }
  if (!job.indexId?.trim()) throw new Error("Semantic embedding job is missing an index generation");
}

function assertLocalProvider(provider: LocalSemanticEmbeddingProvider): LocalEmbeddingProfileDescriptor {
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

function currentTime(now: (() => number) | undefined): number {
  const value = now?.() ?? Date.now();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Semantic index timestamp is invalid");
  return value;
}

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
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
