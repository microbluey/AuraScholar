import { isAbsolute } from "node:path";
import { assertEmbeddingVector, type EmbeddingProvider } from "@aurascholar/knowledge";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_DOCUMENTS_PER_CALL = 64;
const MAX_EMBED_BATCH_SIZE = 32;
const MAX_WINDOWS_PER_DOCUMENT = 2_048;

export type LocalEmbeddingPoolingPolicy = "mean-l2-v1";

/**
 * A model contract is separate from a downloaded artifact. This lets a future
 * installer pin a concrete artifact digest without hard-coding a network URL
 * or causing a model download merely by importing the desktop app.
 */
export interface LocalEmbeddingModelSpec {
  readonly id: string;
  /** Upstream model identity used in the durable embedding profile. */
  readonly sourceModelId: string;
  /** ONNX artifact layout expected by a compatible offline runtime. */
  readonly artifactModelId: string;
  readonly dimension: number;
  readonly maxSequenceTokens: number;
  /** Leaves room for prefixes and special tokens inside `maxSequenceTokens`. */
  readonly maxContentTokens: number;
  readonly documentWindowOverlapTokens: number;
  readonly queryPrefix: string;
  readonly documentPrefix: string;
  readonly pooling: LocalEmbeddingPoolingPolicy;
}

/**
 * First bilingual baseline candidate. It is not installed or downloaded by
 * this declaration; a future explicit installer supplies the artifact below.
 */
export const LOCAL_EMBEDDING_MODEL_PRESETS = {
  multilingualE5Small: {
    artifactModelId: "Xenova/multilingual-e5-small",
    dimension: 384,
    documentPrefix: "passage: ",
    documentWindowOverlapTokens: 64,
    id: "multilingual-e5-small-windowed-v1",
    maxContentTokens: 448,
    maxSequenceTokens: 512,
    pooling: "mean-l2-v1",
    queryPrefix: "query: ",
    sourceModelId: "intfloat/multilingual-e5-small",
  },
} as const satisfies Readonly<Record<string, LocalEmbeddingModelSpec>>;

/**
 * Local installer output. The manifest digest represents every artifact file
 * and is intentionally retained in the embedding profile fingerprint.
 */
export interface LocalEmbeddingArtifact {
  readonly manifestSha256: string;
  readonly modelRevision: string;
  /** Main-process-only absolute directory; never expose it over renderer IPC. */
  readonly rootDirectory: string;
  readonly runtimeId: string;
  readonly runtimeVersion: string;
}

export interface OfflineEmbeddingRuntimeLoadInput {
  readonly artifact: LocalEmbeddingArtifact;
  readonly model: LocalEmbeddingModelSpec;
}

/**
 * A runtime must read only the explicitly installed local artifact. It has no
 * model URL or HTTP client, so callers cannot silently turn a local profile
 * into remote embedding by configuration.
 */
export interface OfflineEmbeddingRuntime {
  readonly id: string;
  readonly version: string;
  load(input: OfflineEmbeddingRuntimeLoadInput): Promise<OfflineEmbeddingSession>;
}

export interface OfflineEmbeddingSession {
  /** Splits unprefixed document text without truncating it. */
  splitDocument(
    text: string,
    options: {
      maxContentTokens: number;
      overlapTokens: number;
      signal?: AbortSignal;
    },
  ): Promise<readonly string[]>;
  /** Rejects input that cannot fit; it must not silently truncate. */
  embed(
    texts: readonly string[],
    options: { maxSequenceTokens: number; signal?: AbortSignal },
  ): Promise<readonly Float32Array[]>;
}

/** Structural equivalent of the DB's immutable embedding profile input. */
export interface LocalEmbeddingProfileDescriptor {
  readonly chunkProfileVersion: string;
  readonly dimension: number;
  readonly distanceMetric: "cosine";
  readonly egressMode: "local";
  readonly fingerprint: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly normalization: "l2";
  readonly providerKind: string;
}

export interface LocalEmbeddingProviderOptions {
  artifact: LocalEmbeddingArtifact;
  model: LocalEmbeddingModelSpec;
  runtime: OfflineEmbeddingRuntime;
}

/**
 * Trusted-main-process EmbeddingProvider for an explicitly installed offline
 * artifact. Long documents are split by the model tokenizer, embedded as
 * prefixed windows, then reduced to one L2-normalized vector per ContentUnit.
 * This preserves the current one-vector-per-generation-entry lifecycle while
 * preventing an E5-style 512-token model from silently truncating a page.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  readonly egressMode = "local" as const;
  readonly id: string;
  readonly model: string;
  private readonly artifact: LocalEmbeddingArtifact;
  private readonly modelSpec: LocalEmbeddingModelSpec;
  private readonly profileDescriptor: LocalEmbeddingProfileDescriptor;
  private readonly runtime: OfflineEmbeddingRuntime;
  private sessionPromise: Promise<OfflineEmbeddingSession> | null = null;

  constructor(options: LocalEmbeddingProviderOptions) {
    assertModelSpec(options.model);
    assertArtifact(options.artifact);
    assertRuntime(options.runtime);
    if (
      options.artifact.runtimeId !== options.runtime.id ||
      options.artifact.runtimeVersion !== options.runtime.version
    ) {
      throw new Error("Local embedding artifact does not match the selected runtime");
    }
    this.artifact = { ...options.artifact };
    this.modelSpec = { ...options.model };
    this.runtime = options.runtime;
    this.dimension = options.model.dimension;
    this.id = `local:${options.runtime.id}`;
    this.model = options.model.sourceModelId;
    this.profileDescriptor = createProfileDescriptor(options.model, options.artifact);
  }

  /** Register this exact artifact/runtime/windowing combination before a build. */
  get embeddingProfile(): LocalEmbeddingProfileDescriptor {
    return { ...this.profileDescriptor };
  }

  async embedQuery(text: string, options: { signal?: AbortSignal } = {}): Promise<Float32Array> {
    const query = normalizeText(text, "Embedding query");
    throwIfAborted(options.signal);
    const session = await this.session(options.signal);
    throwIfAborted(options.signal);
    const vectors = await this.runInference(
      () =>
        session.embed([`${this.modelSpec.queryPrefix}${query}`], {
          maxSequenceTokens: this.modelSpec.maxSequenceTokens,
          signal: options.signal,
        }),
      options.signal,
    );
    return oneNormalizedVector(vectors, this.dimension, "Local embedding query result");
  }

  async embedDocuments(
    texts: readonly string[],
    options: { signal?: AbortSignal } = {},
  ): Promise<Float32Array[]> {
    if (!Array.isArray(texts)) throw new Error("Embedding documents must be an array");
    if (texts.length > MAX_DOCUMENTS_PER_CALL) {
      throw new Error(
        `Embedding documents batch must contain at most ${MAX_DOCUMENTS_PER_CALL} items`,
      );
    }
    const documents = texts.map((text) => normalizeText(text, "Embedding document"));
    if (documents.length === 0) return [];
    throwIfAborted(options.signal);
    const session = await this.session(options.signal);
    const windows = await this.splitDocuments(session, documents, options.signal);
    const vectorsByDocument = documents.map((): Float32Array[] => []);

    for (const batch of chunk(windows, MAX_EMBED_BATCH_SIZE)) {
      throwIfAborted(options.signal);
      const vectors = await this.runInference(
        () =>
          session.embed(
            batch.map((window) => `${this.modelSpec.documentPrefix}${window.text}`),
            {
              maxSequenceTokens: this.modelSpec.maxSequenceTokens,
              signal: options.signal,
            },
          ),
        options.signal,
      );
      if (!Array.isArray(vectors) || vectors.length !== batch.length) {
        throw new Error("Local embedding runtime returned an unexpected vector count");
      }
      for (let index = 0; index < batch.length; index += 1) {
        const window = batch[index];
        const vector = vectors[index];
        if (!window || !vector)
          throw new Error("Local embedding runtime returned an incomplete batch");
        vectorsByDocument[window.documentIndex]!.push(
          normalizeVector(vector, this.dimension, "Local embedding document window result"),
        );
      }
    }

    return vectorsByDocument.map((vectors) => poolNormalizedVectors(vectors, this.dimension));
  }

  private async session(signal: AbortSignal | undefined): Promise<OfflineEmbeddingSession> {
    if (!this.sessionPromise) {
      const loading = this.runtime.load({ artifact: this.artifact, model: this.modelSpec });
      this.sessionPromise = loading;
      void loading.catch(() => {
        if (this.sessionPromise === loading) this.sessionPromise = null;
      });
    }
    try {
      return await waitForAbort(this.sessionPromise, signal);
    } catch (error) {
      rethrowAbort(error, signal);
      throw new Error("Local embedding model is unavailable", { cause: error });
    }
  }

  private async splitDocuments(
    session: OfflineEmbeddingSession,
    documents: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<Array<{ documentIndex: number; text: string }>> {
    const windows: Array<{ documentIndex: number; text: string }> = [];
    for (let documentIndex = 0; documentIndex < documents.length; documentIndex += 1) {
      throwIfAborted(signal);
      const document = documents[documentIndex]!;
      const split = await this.runInference(
        () =>
          session.splitDocument(document, {
            maxContentTokens: this.modelSpec.maxContentTokens,
            overlapTokens: this.modelSpec.documentWindowOverlapTokens,
            signal,
          }),
        signal,
      );
      if (!Array.isArray(split) || split.length === 0 || split.length > MAX_WINDOWS_PER_DOCUMENT) {
        throw new Error(
          "Local embedding document could not be split into a safe number of windows",
        );
      }
      for (const text of split) {
        windows.push({ documentIndex, text: normalizeText(text, "Embedding document window") });
      }
    }
    return windows;
  }

  private async runInference<T>(
    operation: () => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    try {
      return await waitForAbort(operation(), signal);
    } catch (error) {
      rethrowAbort(error, signal);
      throw new Error("Local embedding inference failed", { cause: error });
    }
  }
}

function createProfileDescriptor(
  model: LocalEmbeddingModelSpec,
  artifact: LocalEmbeddingArtifact,
): LocalEmbeddingProfileDescriptor {
  const chunkProfileVersion = [
    "embedding-window-mean-v1",
    model.id,
    `tokens-${model.maxContentTokens}`,
    `overlap-${model.documentWindowOverlapTokens}`,
  ].join(":");
  const modelRevision = `${model.artifactModelId}@${artifact.modelRevision}`;
  const fingerprint = [
    "local-embedding-v1",
    `runtime=${artifact.runtimeId}@${artifact.runtimeVersion}`,
    `source=${model.sourceModelId}`,
    `artifact=${modelRevision}`,
    `manifest=${artifact.manifestSha256}`,
    `dimension=${model.dimension}`,
    "distance=cosine",
    "normalization=l2",
    `chunk=${chunkProfileVersion}`,
  ].join("|");
  if (fingerprint.length > 512 || modelRevision.length > 512 || chunkProfileVersion.length > 512) {
    throw new Error("Local embedding profile identity exceeds its durable size limit");
  }
  return {
    chunkProfileVersion,
    dimension: model.dimension,
    distanceMetric: "cosine",
    egressMode: "local",
    fingerprint,
    modelId: model.sourceModelId,
    modelRevision,
    normalization: "l2",
    providerKind: `local-${artifact.runtimeId}`,
  };
}

function assertModelSpec(model: LocalEmbeddingModelSpec): void {
  assertText(model.id, "Local embedding model id", 128);
  assertText(model.sourceModelId, "Local embedding source model id", 512);
  assertText(model.artifactModelId, "Local embedding artifact model id", 512);
  assertText(model.queryPrefix, "Local embedding query prefix", 64);
  assertText(model.documentPrefix, "Local embedding document prefix", 64);
  assertPositiveInteger(model.dimension, "Local embedding dimension");
  assertPositiveInteger(model.maxSequenceTokens, "Local embedding max sequence tokens");
  assertPositiveInteger(model.maxContentTokens, "Local embedding max content tokens");
  if (model.maxContentTokens >= model.maxSequenceTokens) {
    throw new Error("Local embedding content token limit must leave room for model prefixes");
  }
  if (
    !Number.isSafeInteger(model.documentWindowOverlapTokens) ||
    model.documentWindowOverlapTokens < 0 ||
    model.documentWindowOverlapTokens >= model.maxContentTokens
  ) {
    throw new Error("Local embedding document window overlap is invalid");
  }
  if (model.pooling !== "mean-l2-v1") throw new Error("Unsupported local embedding pooling policy");
}

function assertArtifact(artifact: LocalEmbeddingArtifact): void {
  if (!isAbsolute(artifact.rootDirectory)) {
    throw new Error("Local embedding artifact directory must be an absolute local path");
  }
  assertText(artifact.modelRevision, "Local embedding model revision", 256);
  assertText(artifact.runtimeId, "Local embedding runtime id", 128);
  assertText(artifact.runtimeVersion, "Local embedding runtime version", 128);
  if (!SHA256.test(artifact.manifestSha256)) {
    throw new Error("Local embedding artifact manifest must use a lowercase SHA-256 digest");
  }
}

function assertRuntime(runtime: OfflineEmbeddingRuntime): void {
  assertText(runtime.id, "Local embedding runtime id", 128);
  assertText(runtime.version, "Local embedding runtime version", 128);
  if (typeof runtime.load !== "function")
    throw new Error("Local embedding runtime must provide load");
}

function normalizeText(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty`);
  return normalized;
}

function normalizeVector(vector: Float32Array, dimension: number, label: string): Float32Array {
  try {
    assertEmbeddingVector(vector, dimension, label);
  } catch {
    throw new Error("Local embedding runtime returned an invalid vector");
  }
  return l2Normalize(vector);
}

function oneNormalizedVector(
  vectors: readonly Float32Array[],
  dimension: number,
  label: string,
): Float32Array {
  if (vectors.length !== 1 || !vectors[0]) {
    throw new Error("Local embedding runtime returned an unexpected vector count");
  }
  return normalizeVector(vectors[0], dimension, label);
}

function poolNormalizedVectors(vectors: readonly Float32Array[], dimension: number): Float32Array {
  if (vectors.length === 0) throw new Error("Local embedding document has no vectors to pool");
  const sums = new Float64Array(dimension);
  for (const vector of vectors) {
    for (let index = 0; index < dimension; index += 1) {
      sums[index] = sums[index]! + vector[index]!;
    }
  }
  const pooled = new Float32Array(dimension);
  for (let index = 0; index < dimension; index += 1) pooled[index] = sums[index]! / vectors.length;
  try {
    return l2Normalize(pooled);
  } catch {
    throw new Error("Local embedding document windows produced an invalid pooled vector");
  }
}

function l2Normalize(vector: Float32Array): Float32Array {
  let squaredMagnitude = 0;
  for (const value of vector) squaredMagnitude += value * value;
  if (!Number.isFinite(squaredMagnitude) || squaredMagnitude <= 0) {
    throw new Error("Local embedding vector cannot be normalized");
  }
  const magnitude = Math.sqrt(squaredMagnitude);
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index]! / magnitude;
  }
  return normalized;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size));
  return chunks;
}

async function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      void promise.catch(() => undefined);
      return;
    }
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function rethrowAbort(error: unknown, signal: AbortSignal | undefined): void {
  if (signal?.aborted) signal.throwIfAborted();
  if (error instanceof Error && error.name === "AbortError") throw error;
}

function assertText(value: string, label: string, maxLength: number): void {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer`);
}
