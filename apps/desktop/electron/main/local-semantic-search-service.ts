import {
  HybridRetriever,
  type EmbeddingProvider,
  type FullTextCandidateRetriever,
  type HybridSearchResult,
  type CorpusScopeSnapshot,
  type VectorStore,
} from "@aurascholar/knowledge";

export interface LocalSemanticSearchInput {
  readonly allowedSourceIds: readonly string[];
  readonly corpusScope?: CorpusScopeSnapshot;
  readonly fullText: FullTextCandidateRetriever;
  readonly libraryId: string;
  readonly limit: number;
  readonly query: string;
  readonly signal?: AbortSignal;
}

export interface LocalSemanticSearchServiceDependencies {
  getActiveHybridIndexId(libraryId: string): Promise<string | null>;
  getEmbeddingProvider(): Promise<EmbeddingProvider>;
  vectorStore: VectorStore;
}

/**
 * Adds semantic retrieval only when an active generation and the same trusted
 * local model are available. FTS remains the safe, complete fallback for any
 * optional-runtime error.
 */
export class LocalSemanticSearchService {
  constructor(private readonly dependencies: LocalSemanticSearchServiceDependencies) {}

  async search(input: LocalSemanticSearchInput): Promise<HybridSearchResult> {
    let activeIndexId: string | null;
    try {
      activeIndexId = await this.dependencies.getActiveHybridIndexId(input.libraryId);
    } catch (error) {
      if (isAbort(error, input.signal)) throw error;
      return this.fullTextFallback(input, "unavailable");
    }
    if (!activeIndexId) return this.fullTextFallback(input, "not-configured");

    let provider: EmbeddingProvider;
    try {
      provider = await this.dependencies.getEmbeddingProvider();
    } catch (error) {
      if (isAbort(error, input.signal)) throw error;
      return this.fullTextFallback(input, "unavailable");
    }
    return new HybridRetriever({
      embeddingProvider: provider,
      fullText: input.fullText,
      vectorStore: this.dependencies.vectorStore,
    }).search({
      allowedSourceIds: input.allowedSourceIds,
      ...(input.corpusScope ? { corpusScope: input.corpusScope } : {}),
      libraryId: input.libraryId,
      limit: input.limit,
      query: input.query,
      semanticIndexId: activeIndexId,
      signal: input.signal,
    });
  }

  private async fullTextFallback(
    input: LocalSemanticSearchInput,
    semanticStatus: "not-configured" | "unavailable",
  ): Promise<HybridSearchResult> {
    const result = await new HybridRetriever({ fullText: input.fullText }).search({
      allowedSourceIds: input.allowedSourceIds,
      ...(input.corpusScope ? { corpusScope: input.corpusScope } : {}),
      libraryId: input.libraryId,
      limit: input.limit,
      query: input.query,
      signal: input.signal,
    });
    return { ...result, semanticStatus };
  }
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
}
