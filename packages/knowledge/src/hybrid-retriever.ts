import { assertEmbeddingVector, type EmbeddingProvider } from "./embedding.js";
import {
  reciprocalRankFusion,
  type FusedRetrievalRank,
  type ReciprocalRankFusionOptions,
} from "./hybrid-ranking.js";
import type { VectorStore } from "./vector-store.js";

export interface FullTextCandidateRetriever {
  search(input: FullTextCandidateSearchInput): Promise<readonly { contentUnitId: string }[]>;
}

export interface FullTextCandidateSearchInput {
  libraryId: string;
  query: string;
  allowedSourceIds: readonly string[];
  limit: number;
  signal?: AbortSignal;
}

export interface HybridSearchInput {
  libraryId: string;
  /** A pinned vector generation. Omit it to explicitly remain full-text only. */
  semanticIndexId?: string;
  query: string;
  /** Resolved before either retrieval backend sees the query. */
  allowedSourceIds: readonly string[];
  limit: number;
  signal?: AbortSignal;
}

export type SemanticSearchStatus = "not-configured" | "unavailable" | "used";

export interface HybridSearchResult {
  mode: "fulltext" | "hybrid";
  semanticStatus: SemanticSearchStatus;
  candidates: FusedRetrievalRank[];
}

export interface HybridRetrieverDependencies {
  fullText: FullTextCandidateRetriever;
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: VectorStore;
  fusion?: ReciprocalRankFusionOptions;
}

/**
 * Runs FTS and semantic retrieval independently, then combines their positions
 * with RRF. Missing or failed semantic capability is deliberately non-fatal:
 * callers retain grounded full-text retrieval and receive a safe status only.
 */
export class HybridRetriever {
  constructor(private readonly dependencies: HybridRetrieverDependencies) {}

  async search(input: HybridSearchInput): Promise<HybridSearchResult> {
    const query = input.query.trim();
    if (!query) return fullTextOnly([]);
    assertNonEmpty(input.libraryId, "Hybrid search Library id");
    assertLimit(input.limit);
    const allowedSourceIds = [...new Set(input.allowedSourceIds)];
    for (const sourceId of allowedSourceIds)
      assertNonEmpty(sourceId, "Allowed retrieval source id");
    if (allowedSourceIds.length === 0) return fullTextOnly([]);
    throwIfAborted(input.signal);

    const fullTextPromise = this.dependencies.fullText.search({
      libraryId: input.libraryId,
      query,
      allowedSourceIds,
      limit: input.limit,
      signal: input.signal,
    });

    const semantic = this.semanticSearch(input, query, allowedSourceIds);
    const [fullTextCandidates, semanticResult] = await Promise.all([fullTextPromise, semantic]);
    throwIfAborted(input.signal);

    const channels = [{ id: "fulltext", candidates: fullTextCandidates }];
    if (semanticResult.status === "used") {
      channels.push({
        id: "vector",
        candidates: semanticResult.hits.map((hit) => ({ contentUnitId: hit.contentUnitId })),
      });
    }
    return {
      mode: semanticResult.status === "used" ? "hybrid" : "fulltext",
      semanticStatus: semanticResult.status,
      candidates: reciprocalRankFusion(channels, {
        ...this.dependencies.fusion,
        limit: input.limit,
      }),
    };
  }

  private async semanticSearch(
    input: HybridSearchInput,
    query: string,
    allowedSourceIds: readonly string[],
  ): Promise<
    | { status: "not-configured" | "unavailable"; hits: readonly [] }
    | { status: "used"; hits: Awaited<ReturnType<VectorStore["search"]>> }
  > {
    const provider = this.dependencies.embeddingProvider;
    const vectorStore = this.dependencies.vectorStore;
    const indexId = input.semanticIndexId?.trim();
    if (!provider || !vectorStore || !indexId) return { status: "not-configured", hits: [] };

    try {
      const vector = await provider.embedQuery(query, { signal: input.signal });
      assertEmbeddingVector(vector, provider.dimension, "Embedding provider result");
      const hits = await vectorStore.search({
        allowedSourceIds,
        indexId,
        libraryId: input.libraryId,
        limit: input.limit,
        signal: input.signal,
        vector,
      });
      return { status: "used", hits };
    } catch (error) {
      if (isAbort(error) || input.signal?.aborted) throw error;
      // Do not propagate provider error text: it could contain a document title,
      // endpoint detail, or a secret. The UI only needs the capability state.
      return { status: "unavailable", hits: [] };
    }
  }
}

function fullTextOnly(candidates: FusedRetrievalRank[]): HybridSearchResult {
  return { candidates, mode: "fulltext", semanticStatus: "not-configured" };
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Hybrid search limit must be an integer between 1 and 1000");
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
