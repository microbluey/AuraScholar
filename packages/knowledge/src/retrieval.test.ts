import { describe, expect, it, vi } from "vitest";
import {
  ExactVectorStore,
  HybridRetriever,
  assertEmbeddingVector,
  reciprocalRankFusion,
  type EmbeddingProvider,
  type FullTextCandidateRetriever,
  type VectorStore,
  type VectorEntrySource,
} from "./index.js";

function entry(
  contentUnitId: string,
  sourceId: string,
  vector: readonly number[],
  overrides: Partial<{
    indexId: string;
    libraryId: string;
  }> = {},
) {
  return {
    contentUnitId,
    indexId: "index:g1",
    libraryId: "library:one",
    sourceId,
    vector: new Float32Array(vector),
    ...overrides,
  };
}

describe("ExactVectorStore", () => {
  it("selects the requested Library/index/source scope before exact cosine ranking", async () => {
    const listEntries = vi
      .fn<VectorEntrySource["listEntries"]>()
      .mockResolvedValue([
        entry("content-unit:far", "source:allowed", [0, 1]),
        entry("content-unit:near", "source:allowed", [1, 0]),
      ]);
    const store = new ExactVectorStore({ listEntries });

    const hits = await store.search({
      allowedSourceIds: ["source:allowed"],
      indexId: "index:g1",
      libraryId: "library:one",
      limit: 10,
      vector: new Float32Array([1, 0]),
    });

    expect(listEntries).toHaveBeenCalledWith({
      allowedSourceIds: ["source:allowed"],
      indexId: "index:g1",
      libraryId: "library:one",
      signal: undefined,
    });
    expect(hits.map((hit) => hit.contentUnitId)).toEqual(["content-unit:near", "content-unit:far"]);
    expect(hits[0]?.distance).toBeCloseTo(0);
    expect(hits[1]?.distance).toBeCloseTo(1);
  });

  it("fails closed when a storage adapter leaks an out-of-scope entry", async () => {
    const source: VectorEntrySource = {
      async listEntries() {
        return [entry("content-unit:foreign", "source:foreign", [1, 0])];
      },
    };

    await expect(
      new ExactVectorStore(source).search({
        allowedSourceIds: ["source:allowed"],
        indexId: "index:g1",
        libraryId: "library:one",
        limit: 10,
        vector: new Float32Array([1, 0]),
      }),
    ).rejects.toThrow("outside the requested scope");
  });

  it("avoids opening a storage cursor for an empty selected corpus", async () => {
    const listEntries = vi.fn<VectorEntrySource["listEntries"]>();
    const hits = await new ExactVectorStore({ listEntries }).search({
      allowedSourceIds: [],
      indexId: "index:g1",
      libraryId: "library:one",
      limit: 10,
      vector: new Float32Array([1, 0]),
    });

    expect(hits).toEqual([]);
    expect(listEntries).not.toHaveBeenCalled();
  });

  it("rejects malformed query or stored vectors instead of returning arbitrary ranks", async () => {
    expect(() => assertEmbeddingVector(new Float32Array([0, 0]))).toThrow("zero vector");
    const source: VectorEntrySource = {
      async listEntries() {
        return [entry("content-unit:wrong-dimension", "source:allowed", [1, 0, 0])];
      },
    };

    await expect(
      new ExactVectorStore(source).search({
        allowedSourceIds: ["source:allowed"],
        indexId: "index:g1",
        libraryId: "library:one",
        limit: 10,
        vector: new Float32Array([1, 0]),
      }),
    ).rejects.toThrow("does not match the active embedding profile");
  });
});

describe("reciprocalRankFusion", () => {
  it("fuses FTS and vector rank positions without comparing incompatible score scales", () => {
    const ranks = reciprocalRankFusion(
      [
        {
          candidates: [{ contentUnitId: "content-unit:a" }, { contentUnitId: "content-unit:b" }],
          id: "fulltext",
        },
        {
          candidates: [{ contentUnitId: "content-unit:b" }, { contentUnitId: "content-unit:c" }],
          id: "vector",
        },
      ],
      { rankConstant: 0 },
    );

    expect(ranks.map((rank) => rank.contentUnitId)).toEqual([
      "content-unit:b",
      "content-unit:a",
      "content-unit:c",
    ]);
    expect(ranks[0]).toMatchObject({
      ranks: [
        { channelId: "fulltext", rank: 2 },
        { channelId: "vector", rank: 1 },
      ],
      score: 1.5,
    });
  });

  it("rejects duplicate candidates within a channel", () => {
    expect(() =>
      reciprocalRankFusion([
        {
          candidates: [
            { contentUnitId: "content-unit:one" },
            { contentUnitId: "content-unit:one" },
          ],
          id: "fulltext",
        },
      ]),
    ).toThrow("appears more than once");
  });
});

describe("HybridRetriever", () => {
  it("keeps full-text retrieval usable when semantic capability is not configured", async () => {
    const fullText: FullTextCandidateRetriever = {
      search: vi.fn().mockResolvedValue([{ contentUnitId: "content-unit:fts" }]),
    };
    const result = await new HybridRetriever({ fullText }).search({
      allowedSourceIds: ["source:one"],
      libraryId: "library:one",
      limit: 10,
      query: "grounded retrieval",
    });

    expect(result).toMatchObject({
      candidates: [{ contentUnitId: "content-unit:fts" }],
      mode: "fulltext",
      semanticStatus: "not-configured",
    });
    expect(fullText.search).toHaveBeenCalledWith({
      allowedSourceIds: ["source:one"],
      libraryId: "library:one",
      limit: 10,
      query: "grounded retrieval",
      signal: undefined,
    });
  });

  it("fuses a scoped vector result when an active local profile is available", async () => {
    const fullText: FullTextCandidateRetriever = {
      search: vi
        .fn()
        .mockResolvedValue([
          { contentUnitId: "content-unit:fts" },
          { contentUnitId: "content-unit:shared" },
        ]),
    };
    const embeddingProvider: EmbeddingProvider = {
      dimension: 2,
      egressMode: "local",
      embedDocuments: vi.fn(),
      embedQuery: vi.fn().mockResolvedValue(new Float32Array([1, 0])),
      id: "local-test",
      model: "test-model",
    };
    const vectorStore: VectorStore = {
      search: vi.fn().mockResolvedValue([
        { contentUnitId: "content-unit:shared", distance: 0.1, sourceId: "source:one" },
        { contentUnitId: "content-unit:vector", distance: 0.2, sourceId: "source:one" },
      ]),
    };

    const result = await new HybridRetriever({
      embeddingProvider,
      fullText,
      fusion: { rankConstant: 0 },
      vectorStore,
    }).search({
      allowedSourceIds: ["source:one"],
      libraryId: "library:one",
      limit: 10,
      query: "grounded retrieval",
      semanticIndexId: "index:g1",
    });

    expect(result.semanticStatus).toBe("used");
    expect(result.mode).toBe("hybrid");
    expect(result.candidates.map((candidate) => candidate.contentUnitId)).toEqual([
      "content-unit:shared",
      "content-unit:fts",
      "content-unit:vector",
    ]);
    expect(vectorStore.search).toHaveBeenCalledWith({
      allowedSourceIds: ["source:one"],
      indexId: "index:g1",
      libraryId: "library:one",
      limit: 10,
      signal: undefined,
      vector: new Float32Array([1, 0]),
    });
  });

  it("falls back without exposing semantic provider errors", async () => {
    const fullText: FullTextCandidateRetriever = {
      search: vi.fn().mockResolvedValue([{ contentUnitId: "content-unit:fts" }]),
    };
    const embeddingProvider: EmbeddingProvider = {
      dimension: 2,
      egressMode: "local",
      embedDocuments: vi.fn(),
      embedQuery: vi.fn().mockResolvedValue(new Float32Array([1, 0])),
      id: "local-test",
      model: "test-model",
    };
    const vectorStore: VectorStore = {
      search: vi.fn().mockRejectedValue(new Error("raw document title must not surface")),
    };

    await expect(
      new HybridRetriever({ embeddingProvider, fullText, vectorStore }).search({
        allowedSourceIds: ["source:one"],
        libraryId: "library:one",
        limit: 10,
        query: "grounded retrieval",
        semanticIndexId: "index:g1",
      }),
    ).resolves.toMatchObject({
      candidates: [{ contentUnitId: "content-unit:fts" }],
      mode: "fulltext",
      semanticStatus: "unavailable",
    });
  });
});
