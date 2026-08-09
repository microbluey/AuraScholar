/** Storage representations offered by the semantic-index planning estimate. */
export const VECTOR_STORAGE_PRECISIONS = ["float32", "int8"] as const;
export type VectorStoragePrecision = (typeof VECTOR_STORAGE_PRECISIONS)[number];

/**
 * The estimate reserves space for an engine's graph/lookup structures and
 * record metadata. It is deliberately a planning assumption, not a promise
 * that every future VectorStore backend has the same layout.
 */
export const DEFAULT_VECTOR_INDEX_OVERHEAD_RATIO = 0.5;
export const DEFAULT_VECTOR_METADATA_BYTES_PER_UNIT = 192;

export interface VectorIndexCapacityInput {
  contentUnitCount: number;
  dimension: number;
  precision: VectorStoragePrecision;
  indexOverheadRatio?: number;
  metadataBytesPerUnit?: number;
}

export interface VectorIndexCapacityEstimate {
  contentUnitCount: number;
  dimension: number;
  precision: VectorStoragePrecision;
  bytesPerVector: number;
  rawVectorBytes: number;
  indexOverheadBytes: number;
  metadataBytes: number;
  totalBytes: number;
}

/**
 * Deterministically estimates one local index generation from the active
 * ContentUnit count. It has no filesystem or model dependency.
 */
export function estimateVectorIndexCapacity(
  input: VectorIndexCapacityInput,
): VectorIndexCapacityEstimate {
  assertNonNegativeSafeInteger(input.contentUnitCount, "ContentUnit count");
  assertPositiveSafeInteger(input.dimension, "Embedding dimension");
  if (!VECTOR_STORAGE_PRECISIONS.includes(input.precision)) {
    throw new Error(`Unsupported vector storage precision: ${String(input.precision)}`);
  }

  const indexOverheadRatio = input.indexOverheadRatio ?? DEFAULT_VECTOR_INDEX_OVERHEAD_RATIO;
  if (!Number.isFinite(indexOverheadRatio) || indexOverheadRatio < 0 || indexOverheadRatio > 10) {
    throw new Error("Vector index overhead ratio must be between 0 and 10");
  }
  const metadataBytesPerUnit = input.metadataBytesPerUnit ?? DEFAULT_VECTOR_METADATA_BYTES_PER_UNIT;
  assertNonNegativeSafeInteger(metadataBytesPerUnit, "Vector metadata bytes per ContentUnit");

  const bytesPerVector = input.dimension * bytesPerComponent(input.precision);
  const rawVectorBytes = input.contentUnitCount * bytesPerVector;
  const indexOverheadBytes = Math.ceil(rawVectorBytes * indexOverheadRatio);
  const metadataBytes = input.contentUnitCount * metadataBytesPerUnit;
  const totalBytes = rawVectorBytes + indexOverheadBytes + metadataBytes;
  if (!Number.isSafeInteger(totalBytes)) {
    throw new Error("Vector index capacity estimate exceeds safe integer precision");
  }

  return {
    contentUnitCount: input.contentUnitCount,
    dimension: input.dimension,
    precision: input.precision,
    bytesPerVector,
    rawVectorBytes,
    indexOverheadBytes,
    metadataBytes,
    totalBytes,
  };
}

/** Returns whether an estimate fits in a caller-selected local disk quota. */
export function fitsVectorIndexQuota(
  estimate: VectorIndexCapacityEstimate,
  quotaBytes: number,
): boolean {
  assertNonNegativeSafeInteger(quotaBytes, "Vector index disk quota");
  return estimate.totalBytes <= quotaBytes;
}

function bytesPerComponent(precision: VectorStoragePrecision): number {
  switch (precision) {
    case "float32":
      return 4;
    case "int8":
      return 1;
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}
