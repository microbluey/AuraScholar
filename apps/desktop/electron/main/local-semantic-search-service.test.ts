import { describe, expect, it, vi } from "vitest";
import {
  LocalSemanticSearchService,
  type LocalSemanticSearchInput,
} from "./local-semantic-search-service";

const input: LocalSemanticSearchInput = {
  allowedSourceIds: ["revision:semantic"],
  fullText: {
    search: vi.fn().mockResolvedValue([{ contentUnitId: "content-unit:fulltext" }]),
  },
  libraryId: "library:semantic",
  limit: 10,
  query: "local semantic retrieval",
};

describe("LocalSemanticSearchService", () => {
  it("uses full-text only until a hybrid generation is active", async () => {
    const getEmbeddingProvider = vi.fn();
    const service = new LocalSemanticSearchService({
      getActiveHybridIndexId: vi.fn().mockResolvedValue(null),
      getEmbeddingProvider,
      vectorStore: { search: vi.fn() },
    });

    await expect(service.search(input)).resolves.toMatchObject({
      candidates: [{ contentUnitId: "content-unit:fulltext" }],
      mode: "fulltext",
      semanticStatus: "not-configured",
    });
    expect(getEmbeddingProvider).not.toHaveBeenCalled();
  });

  it("fuses local vector ranks with full-text ranks for an active generation", async () => {
    const embeddingProvider = {
      dimension: 2,
      egressMode: "local" as const,
      embedDocuments: vi.fn(),
      embedQuery: vi.fn().mockResolvedValue(new Float32Array([1, 0])),
      id: "local:test",
      model: "test/local",
    };
    const service = new LocalSemanticSearchService({
      getActiveHybridIndexId: vi.fn().mockResolvedValue("index:active"),
      getEmbeddingProvider: vi.fn().mockResolvedValue(embeddingProvider),
      vectorStore: {
        search: vi.fn().mockResolvedValue([
          { contentUnitId: "content-unit:semantic", distance: 0.1, sourceId: "revision:semantic" },
        ]),
      },
    });

    await expect(service.search(input)).resolves.toMatchObject({
      mode: "hybrid",
      semanticStatus: "used",
    });
  });

  it("falls back to full-text without surfacing a local model failure", async () => {
    const service = new LocalSemanticSearchService({
      getActiveHybridIndexId: vi.fn().mockResolvedValue("index:active"),
      getEmbeddingProvider: vi.fn().mockRejectedValue(new Error("private model directory")),
      vectorStore: { search: vi.fn() },
    });

    await expect(service.search(input)).resolves.toMatchObject({
      mode: "fulltext",
      semanticStatus: "unavailable",
    });
  });
});
