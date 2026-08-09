import { describe, expect, it } from "vitest";
import * as coreKnowledge from "./index.js";
import {
  assertRetrievalEvaluationDataset,
  getRetrievalEvaluationReleaseReadiness,
  type EmbeddingProvider,
  type RetrievalEvaluationRetriever,
  type RetrievalEvaluationRunProvenance,
  type VectorStore,
} from "./index.js";
import {
  BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1,
  compareLocalRetrievalEvaluationCandidates,
  createLocalSemanticRetrievalEvaluationCandidate,
  type LocalRetrievalEvaluationCandidate,
} from "./retrieval-evaluation-tools.js";

describe("bilingual retrieval development corpus", () => {
  it("is exposed only through the explicit evaluation-tools entry point", () => {
    expect(coreKnowledge).not.toHaveProperty("BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1");
    expect(BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.id).toBe(
      "aurascholar-bilingual-development-v1",
    );
  });

  it("is a valid visible calibration corpus with balanced language slices and disciplines", () => {
    assertRetrievalEvaluationDataset(BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1);

    expect(BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.contentUnits).toHaveLength(16);
    expect(BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries).toHaveLength(32);
    expect(
      BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries.filter(
        (query) => query.language === "zh" && query.targetLanguage === "zh",
      ),
    ).toHaveLength(8);
    expect(
      BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries.filter(
        (query) => query.language === "en" && query.targetLanguage === "en",
      ),
    ).toHaveLength(8);
    expect(
      BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries.filter(
        (query) => query.language === "zh" && query.targetLanguage === "en",
      ),
    ).toHaveLength(8);
    expect(
      BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries.filter(
        (query) => query.language === "en" && query.targetLanguage === "zh",
      ),
    ).toHaveLength(8);
    expect(
      new Set(BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1.queries.map((query) => query.discipline)),
    ).toEqual(
      new Set(["research-methods", "public-health", "climate-science", "digital-humanities"]),
    );
  });

  it("is deliberately not eligible to stand in for an independently reviewed held-out set", () => {
    const readiness = getRetrievalEvaluationReleaseReadiness(
      BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1,
    );

    expect(readiness.eligible).toBe(false);
    expect(readiness.reasons).toContain("dataset split must be held-out");
    expect(readiness.reasons).toContain("dataset needs at least 360 quality queries");
    expect(readiness.reasons).toContain(
      "query query:development:methods-validation:zh-zh needs two independent human reviews and adjudication",
    );
  });

  it("compares two local candidates with exact shared-corpus deltas", async () => {
    const comparison = await compareLocalRetrievalEvaluationCandidates(
      BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1,
      [candidate("noise", noiseRetriever()), candidate("oracle", oracleRetriever())],
      { baselineCandidateId: "noise", cutoffs: [1, 2] },
    );

    expect(comparison.dataset).toEqual({
      id: "aurascholar-bilingual-development-v1",
      split: "development",
      version: "1.0.0",
    });
    const baseline = comparison.candidates.find((candidate) => candidate.id === "noise");
    const oracle = comparison.candidates.find((candidate) => candidate.id === "oracle");
    expect(baseline?.deltaFromBaseline.overall).toEqual([
      { hitRate: 0, k: 1, meanReciprocalRank: 0, ndcg: 0, recall: 0 },
      { hitRate: 0, k: 2, meanReciprocalRank: 0, ndcg: 0, recall: 0 },
    ]);
    expect(oracle?.deltaFromBaseline.overall).toEqual([
      { hitRate: 1, k: 1, meanReciprocalRank: 1, ndcg: 1, recall: 0.5 },
      { hitRate: 1, k: 2, meanReciprocalRank: 1, ndcg: 1, recall: 1 },
    ]);
    expect(oracle?.deltaFromBaseline.bySlice).toHaveLength(4);
  });

  it("fails closed when a comparison or semantic candidate is not local", async () => {
    const remoteProvider = {
      dimension: 2,
      egressMode: "remote",
      embedDocuments: async () => [new Float32Array([1, 0])],
      embedQuery: async () => new Float32Array([1, 0]),
      id: "test:remote",
      model: "remote-test",
    } satisfies EmbeddingProvider;
    const vectorStore: VectorStore = { search: async () => [] };

    expect(() =>
      createLocalSemanticRetrievalEvaluationCandidate({
        embeddingProvider: remoteProvider,
        id: "remote",
        indexId: "index:development",
        libraryId: "library:development",
        runProvenance: runProvenance("remote"),
        vectorStore,
      }),
    ).toThrow("requires a local embedding provider");
    await expect(
      compareLocalRetrievalEvaluationCandidates(
        BILINGUAL_RETRIEVAL_DEVELOPMENT_CORPUS_V1,
        [
          candidate("baseline", noiseRetriever()),
          {
            ...candidate("remote", oracleRetriever()),
            egressMode: "remote",
          } as unknown as LocalRetrievalEvaluationCandidate,
        ],
        { baselineCandidateId: "baseline" },
      ),
    ).rejects.toThrow("must run locally");
  });
});

function candidate(
  id: string,
  retrieve: RetrievalEvaluationRetriever,
): LocalRetrievalEvaluationCandidate {
  return {
    egressMode: "local",
    id,
    retrieve,
    runProvenance: runProvenance(id),
  };
}

function runProvenance(candidateId: string): RetrievalEvaluationRunProvenance {
  return {
    chunker: "evaluation-chunker-v1",
    embeddingProfile: `local-${candidateId}-profile@1`,
    extractor: "evaluation-extractor-v1",
    fusion: "none:semantic-only",
    generator: "not-applicable",
    prompt: "not-applicable",
    reranker: "none",
    vectorStore: "exact-vector-store@1",
  };
}

function oracleRetriever(): RetrievalEvaluationRetriever {
  return async ({ limit, query }) =>
    query.relevanceJudgments.map((judgment) => judgment.contentUnitId).slice(0, limit);
}

function noiseRetriever(): RetrievalEvaluationRetriever {
  return async ({ candidates, limit, query }) => {
    const judged = new Set(query.relevanceJudgments.map((judgment) => judgment.contentUnitId));
    return candidates
      .map((candidate) => candidate.id)
      .filter((candidateId) => !judged.has(candidateId))
      .slice(0, limit);
  };
}
