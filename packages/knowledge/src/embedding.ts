/** Whether embedding text is kept on-device or leaves the Library boundary. */
export const EMBEDDING_EGRESS_MODES = ["local", "remote"] as const;
export type EmbeddingEgressMode = (typeof EMBEDDING_EGRESS_MODES)[number];

/**
 * Platform-neutral embedding contract. Concrete runtimes live outside this
 * package so a renderer can never silently choose a remote provider.
 */
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimension: number;
  readonly egressMode: EmbeddingEgressMode;

  embedQuery(text: string, options?: { signal?: AbortSignal }): Promise<Float32Array>;
  embedDocuments(
    texts: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<Float32Array[]>;
}

/** Validates one non-zero, finite vector before it reaches a VectorStore. */
export function assertEmbeddingVector(
  vector: Float32Array,
  expectedDimension?: number,
  label = "Embedding vector",
): void {
  if (!(vector instanceof Float32Array)) throw new Error(`${label} must be a Float32Array`);
  if (vector.length < 1) throw new Error(`${label} must not be empty`);
  if (expectedDimension !== undefined) {
    if (!Number.isSafeInteger(expectedDimension) || expectedDimension < 1) {
      throw new Error("Expected embedding dimension must be a positive integer");
    }
    if (vector.length !== expectedDimension) {
      throw new Error(`${label} dimension does not match the active embedding profile`);
    }
  }

  let squaredMagnitude = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite values`);
    squaredMagnitude += value * value;
  }
  if (!Number.isFinite(squaredMagnitude) || squaredMagnitude <= 0) {
    throw new Error(`${label} must not be the zero vector`);
  }
}
