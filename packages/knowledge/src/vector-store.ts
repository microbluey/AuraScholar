import { assertEmbeddingVector } from "./embedding.js";
import type { CorpusScopeSnapshot } from "./corpus-scope.js";

/** A vector entry is always pinned to one Library and one index generation. */
export interface VectorIndexEntry {
  libraryId: string;
  indexId: string;
  contentUnitId: string;
  sourceId: string;
  vector: Float32Array;
}

/**
 * Storage boundary for the exact-scan spike. A future SQLite or sidecar adapter
 * must select this scope before returning any vectors; it may not post-filter a
 * global nearest-neighbour result.
 */
export interface VectorEntrySource {
  listEntries(input: VectorEntrySelection): Promise<readonly VectorIndexEntry[]>;
}

export interface VectorEntrySelection {
  /** The immutable scope captured by the owning retrieval operation. */
  corpusScope?: CorpusScopeSnapshot;
  libraryId: string;
  indexId: string;
  allowedSourceIds: readonly string[];
  signal?: AbortSignal;
}

export interface VectorSearchInput extends VectorEntrySelection {
  vector: Float32Array;
  limit: number;
}

export interface VectorSearchHit {
  contentUnitId: string;
  sourceId: string;
  /** Internal cosine distance only; it is not a user-facing confidence score. */
  distance: number;
}

export interface VectorStore {
  search(input: VectorSearchInput): Promise<readonly VectorSearchHit[]>;
}

/**
 * Portable exact cosine scan used for the first VectorStore capability spike.
 * It deliberately owns no persistence format, which keeps a future SQLite BLOB
 * or sidecar implementation interchangeable behind VectorEntrySource.
 */
export class ExactVectorStore implements VectorStore {
  constructor(private readonly entries: VectorEntrySource) {}

  async search(input: VectorSearchInput): Promise<readonly VectorSearchHit[]> {
    assertNonEmpty(input.libraryId, "Vector search Library id");
    assertNonEmpty(input.indexId, "Vector search index id");
    assertLimit(input.limit);
    assertEmbeddingVector(input.vector, undefined, "Vector search query");
    throwIfAborted(input.signal);

    const allowedSourceIds = [...new Set(input.allowedSourceIds)];
    for (const sourceId of allowedSourceIds) assertNonEmpty(sourceId, "Allowed vector source id");
    assertCorpusScope(input.corpusScope, input.libraryId, allowedSourceIds);
    if (allowedSourceIds.length === 0) return [];

    const entries = await this.entries.listEntries({
      libraryId: input.libraryId,
      indexId: input.indexId,
      allowedSourceIds,
      signal: input.signal,
      ...(input.corpusScope ? { corpusScope: input.corpusScope } : {}),
    });
    throwIfAborted(input.signal);

    const allowed = new Set(allowedSourceIds);
    const seenContentUnitIds = new Set<string>();
    const hits: VectorSearchHit[] = [];
    for (const entry of entries) {
      throwIfAborted(input.signal);
      assertEntryScope(entry, input.libraryId, input.indexId, allowed);
      if (seenContentUnitIds.has(entry.contentUnitId)) {
        throw new Error(`Vector source returned ContentUnit ${entry.contentUnitId} more than once`);
      }
      seenContentUnitIds.add(entry.contentUnitId);
      assertEmbeddingVector(entry.vector, input.vector.length, "Stored vector");
      hits.push({
        contentUnitId: entry.contentUnitId,
        sourceId: entry.sourceId,
        distance: cosineDistance(input.vector, entry.vector),
      });
    }

    return hits
      .sort((left, right) => {
        if (left.distance !== right.distance) return left.distance - right.distance;
        return compareText(left.contentUnitId, right.contentUnitId);
      })
      .slice(0, input.limit);
  }
}

function assertEntryScope(
  entry: VectorIndexEntry,
  libraryId: string,
  indexId: string,
  allowedSourceIds: ReadonlySet<string>,
): void {
  assertNonEmpty(entry.libraryId, "Stored vector Library id");
  assertNonEmpty(entry.indexId, "Stored vector index id");
  assertNonEmpty(entry.contentUnitId, "Stored vector ContentUnit id");
  assertNonEmpty(entry.sourceId, "Stored vector source id");
  if (entry.libraryId !== libraryId || entry.indexId !== indexId) {
    throw new Error("Vector source returned an entry from a different Library or index generation");
  }
  if (!allowedSourceIds.has(entry.sourceId)) {
    throw new Error("Vector source returned an entry outside the requested scope");
  }
}

function cosineDistance(left: Float32Array, right: Float32Array): number {
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const similarity = dotProduct / Math.sqrt(leftMagnitude * rightMagnitude);
  return 1 - Math.max(-1, Math.min(1, similarity));
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Vector search limit must be an integer between 1 and 1000");
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertCorpusScope(
  scope: CorpusScopeSnapshot | undefined,
  libraryId: string,
  allowedSourceIds: readonly string[],
): void {
  if (!scope) return;
  if (scope.libraryId !== libraryId) {
    throw new Error("Corpus scope belongs to a different Library");
  }
  const snapshotSources = new Set(scope.allowedSourceIds);
  if (allowedSourceIds.some((sourceId) => !snapshotSources.has(sourceId))) {
    throw new Error("Vector source is outside the captured corpus scope");
  }
}
