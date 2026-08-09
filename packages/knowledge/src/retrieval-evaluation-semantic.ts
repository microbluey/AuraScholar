import { assertEmbeddingVector } from "./embedding.js";
import type {
  RetrievalEvaluationRetriever,
  SemanticRetrievalEvaluationRetrieverOptions,
} from "./retrieval-evaluation-contract.js";

/**
 * Creates a driver for an isolated, generation-pinned vector index. The
 * generic evaluator still verifies returned IDs against its exact candidate
 * list, so an index that contains extra Library data cannot silently affect a
 * benchmark result.
 */
export function createSemanticRetrievalEvaluationRetriever(
  options: SemanticRetrievalEvaluationRetrieverOptions,
): RetrievalEvaluationRetriever {
  if (!options || typeof options !== "object") {
    throw new Error("Semantic retrieval evaluation options must be an object");
  }
  assertNonEmpty(options.libraryId, "Semantic retrieval evaluation Library id");
  assertNonEmpty(options.indexId, "Semantic retrieval evaluation index id");
  const embeddingProvider = options.embeddingProvider;
  if (!embeddingProvider || typeof embeddingProvider.embedQuery !== "function") {
    throw new Error("Semantic retrieval evaluation requires an embedding provider");
  }
  if (!Number.isSafeInteger(embeddingProvider.dimension) || embeddingProvider.dimension < 1) {
    throw new Error("Semantic retrieval evaluation embedding dimension must be a positive integer");
  }
  const vectorStore = options.vectorStore;
  if (!vectorStore || typeof vectorStore.search !== "function") {
    throw new Error("Semantic retrieval evaluation requires a VectorStore");
  }
  const libraryId = options.libraryId.trim();
  const indexId = options.indexId.trim();

  return async ({ candidates, limit, query, signal }) => {
    throwIfAborted(signal);
    assertNonEmpty(query.text, "Semantic retrieval evaluation query text");
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("Semantic retrieval evaluation candidates must be a non-empty array");
    }
    const allowedSourceIds = [...new Set(candidates.map((candidate) => candidate.sourceId))];
    for (const sourceId of allowedSourceIds) {
      assertNonEmpty(sourceId, "Semantic retrieval evaluation candidate source id");
    }
    const vector = await embeddingProvider.embedQuery(query.text, { signal });
    throwIfAborted(signal);
    assertEmbeddingVector(
      vector,
      embeddingProvider.dimension,
      "Semantic retrieval evaluation query vector",
    );
    const hits = await vectorStore.search({
      allowedSourceIds,
      indexId,
      libraryId,
      limit,
      signal,
      vector,
    });
    throwIfAborted(signal);
    if (!Array.isArray(hits)) {
      throw new Error("Semantic retrieval evaluation VectorStore returned a non-array hit list");
    }
    return hits.map((hit) => {
      if (!hit || typeof hit.contentUnitId !== "string") {
        throw new Error("Semantic retrieval evaluation VectorStore returned an invalid hit");
      }
      return hit.contentUnitId;
    });
  };
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
