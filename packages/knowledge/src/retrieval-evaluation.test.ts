import { describe, expect, it, vi } from "vitest";
import {
  assessRetrievalEvaluationQuality,
  assertReleaseReadyRetrievalEvaluationDataset,
  assertRetrievalEvaluationDataset,
  assertRetrievalEvaluationRunProvenance,
  createSemanticRetrievalEvaluationRetriever,
  evaluateRetrievalDataset,
  getRetrievalEvaluationReleaseReadiness,
  normalizeRetrievalEvaluationText,
  type BilingualRetrievalSlice,
  type RetrievalEvaluationDataset,
  type RetrievalEvaluationMetricAtK,
  type RetrievalEvaluationRunProvenance,
  type RetrievalEvaluationSliceResult,
  type EmbeddingProvider,
  type VectorStore,
} from "./index.js";

describe("retrieval evaluation", () => {
  it("scores ranked ContentUnit IDs by bilingual slice without comparing backend scores", async () => {
    const dataset = developmentDataset();
    const retrieve = vi.fn(async ({ query, limit }: { query: { id: string }; limit: number }) => {
      const ranks: Record<string, readonly string[]> = {
        "query:en-en": ["unit:en-noise", "unit:en-general"],
        "query:en-zh": ["unit:zh-general"],
        "query:zh-en": ["unit:en-general", "unit:en-noise", "unit:en-support"],
        "query:zh-zh": ["unit:zh-noise", "unit:zh-general"],
      };
      return ranks[query.id]!.slice(0, limit);
    });

    const report = await evaluateRetrievalDataset(dataset, retrieve, {
      cutoffs: [3, 1],
      runProvenance: testRunProvenance(),
    });

    expect(report.candidateScope).toBe("full-corpus");
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ candidates: dataset.contentUnits, limit: 3, signal: undefined }),
    );
    expect(report.overall.queryCount).toBe(4);
    expect(metricFor(report.bySlice, "zh-zh", 1)).toMatchObject({
      hitRate: 0,
      meanReciprocalRank: 0,
      recall: 0,
    });
    expect(metricFor(report.bySlice, "zh-zh", 3)).toMatchObject({
      hitRate: 1,
      meanReciprocalRank: 0.5,
      recall: 1,
    });
    expect(metricFor(report.bySlice, "zh-en", 1)).toMatchObject({
      hitRate: 1,
      recall: 0.5,
    });
    expect(metricFor(report.bySlice, "zh-en", 3).ndcg).toBeCloseTo(0.9828, 3);
    expect(report.multiDocument.queryCount).toBe(1);
    expect(report.releaseReadiness).toMatchObject({ eligible: false });
    expect(report.releaseReadiness.reasons).toContain("dataset split must be held-out");
    expect(report.runProvenance).toEqual(testRunProvenance());
  });

  it("can isolate target-language candidates for a pure cross-language semantic run", async () => {
    const dataset = developmentDataset();
    const retrieve = vi.fn(
      async ({
        candidates,
        query,
        limit,
      }: {
        candidates: RetrievalEvaluationDataset["contentUnits"];
        query: RetrievalEvaluationDataset["queries"][number];
        limit: number;
      }) => {
        expect(candidates.every((candidate) => candidate.language === query.targetLanguage)).toBe(
          true,
        );
        return query.relevanceJudgments.map((judgment) => judgment.contentUnitId).slice(0, limit);
      },
    );

    const report = await evaluateRetrievalDataset(dataset, retrieve, {
      candidateScope: "target-language-only",
      cutoffs: [10, 20],
      runProvenance: testRunProvenance(),
    });

    expect(report.candidateScope).toBe("target-language-only");
    expect(retrieve).toHaveBeenCalledTimes(dataset.queries.length);
    await expect(
      evaluateRetrievalDataset(
        dataset,
        async ({ query }) => [
          dataset.contentUnits.find((candidate) => candidate.language !== query.targetLanguage)!.id,
        ],
        { candidateScope: "target-language-only", runProvenance: testRunProvenance() },
      ),
    ).rejects.toThrow("out-of-corpus");
  });

  it("rejects copied query self matches after Unicode, case, spacing, and punctuation normalization", () => {
    const dataset = developmentDataset();
    const invalid: RetrievalEvaluationDataset = {
      ...dataset,
      contentUnits: [
        { ...dataset.contentUnits[0]!, text: "怎样评估模型在未见数据上的效果？" },
        ...dataset.contentUnits.slice(1),
      ],
    };

    expect(() => assertRetrievalEvaluationDataset(invalid)).toThrow(
      "matches ContentUnit unit:zh-general after text normalization",
    );
    expect(normalizeRetrievalEvaluationText(" A—B， C! ")).toBe("abc");
    expect(normalizeRetrievalEvaluationText("C++")).toBe("c++");
  });

  it("rejects invalid target-language labels and invalid rank lists instead of silently scoring them", async () => {
    const dataset = developmentDataset();
    const wrongTarget: RetrievalEvaluationDataset = {
      ...dataset,
      queries: [{ ...dataset.queries[0]!, targetLanguage: "en" }, ...dataset.queries.slice(1)],
    };

    expect(() => assertRetrievalEvaluationDataset(wrongTarget)).toThrow("target language");
    await expect(
      evaluateRetrievalDataset(dataset, async () => ["unit:zh-general", "unit:zh-general"], {
        runProvenance: testRunProvenance(),
      }),
    ).rejects.toThrow("more than once");
    await expect(
      evaluateRetrievalDataset(dataset, async () => ["unit:not-in-corpus"], {
        runProvenance: testRunProvenance(),
      }),
    ).rejects.toThrow("out-of-corpus");
    expect(() =>
      assertRetrievalEvaluationRunProvenance({ ...testRunProvenance(), vectorStore: "   " }),
    ).toThrow("VectorStore");
  });

  it("requires the held-out human-reviewed corpus structure before it can be release-eligible", () => {
    const development = developmentDataset();
    expect(() => assertReleaseReadyRetrievalEvaluationDataset(development)).toThrow(
      "not release-ready",
    );

    const release = releaseDataset();
    expect(getRetrievalEvaluationReleaseReadiness(release)).toEqual({
      eligible: true,
      reasons: [],
    });
    expect(() => assertReleaseReadyRetrievalEvaluationDataset(release)).not.toThrow();
  });

  it("assesses every language slice and multi-document recall without making human review a gate", async () => {
    const dataset = developmentDataset();
    const report = await evaluateRetrievalDataset(
      dataset,
      async ({ query, limit }) =>
        query.relevanceJudgments.map((judgment) => judgment.contentUnitId).slice(0, limit),
      { cutoffs: [10, 20], runProvenance: testRunProvenance() },
    );

    const assessment = assessRetrievalEvaluationQuality(report);

    expect(assessment).toMatchObject({
      candidateScope: "full-corpus",
      passed: true,
      provisional: true,
      reasons: [],
      thresholds: {
        crossLanguageNdcgAt10: 0.72,
        crossLanguageRecallAt10: 0.82,
        multiDocumentRecallAt20: 0.8,
        sameLanguageNdcgAt10: 0.8,
        sameLanguageRecallAt10: 0.9,
      },
    });
    expect(assessment.checks).toHaveLength(9);
    expect(assessment.checks.every((check) => check.passed)).toBe(true);
    expect(report.releaseReadiness.eligible).toBe(false);
  });

  it("fails closed for missing quality cutoffs and rejects invalid threshold overrides", async () => {
    const report = await evaluateRetrievalDataset(
      developmentDataset(),
      async ({ query, limit }) =>
        query.relevanceJudgments.map((judgment) => judgment.contentUnitId).slice(0, limit),
      { cutoffs: [1, 3], runProvenance: testRunProvenance() },
    );

    expect(assessRetrievalEvaluationQuality(report)).toMatchObject({
      passed: false,
      provisional: true,
    });
    expect(assessRetrievalEvaluationQuality(report).reasons).toContain(
      "zh-zh recall@10 missing is below 0.9",
    );
    expect(() =>
      assessRetrievalEvaluationQuality(report, {
        thresholds: { crossLanguageRecallAt10: 1.01 },
      }),
    ).toThrow("crossLanguageRecallAt10 must be between 0 and 1");
  });

  it("adapts an isolated VectorStore as pure semantic retrieval without blending FTS ranks", async () => {
    const dataset = developmentDataset();
    const embedQuery = vi.fn().mockResolvedValue(new Float32Array([1, 0]));
    const vectorSearch = vi
      .fn()
      .mockResolvedValue([
        { contentUnitId: "unit:zh-general", distance: 0.1, sourceId: "source:zh-general" },
      ]);
    const embeddingProvider: EmbeddingProvider = {
      dimension: 2,
      egressMode: "local",
      embedDocuments: vi.fn(),
      embedQuery,
      id: "evaluation-provider",
      model: "evaluation-model",
    };
    const vectorStore: VectorStore = { search: vectorSearch };

    const report = await evaluateRetrievalDataset(
      dataset,
      createSemanticRetrievalEvaluationRetriever({
        embeddingProvider,
        indexId: "index:benchmark",
        libraryId: "library:benchmark",
        vectorStore,
      }),
      { cutoffs: [1], runProvenance: testRunProvenance() },
    );

    expect(embedQuery).toHaveBeenCalledWith("怎样评估模型在未见数据上的效果？", {
      signal: undefined,
    });
    expect(vectorSearch).toHaveBeenCalledWith({
      allowedSourceIds: dataset.contentUnits.map((unit) => unit.sourceId),
      indexId: "index:benchmark",
      libraryId: "library:benchmark",
      limit: 1,
      signal: undefined,
      vector: new Float32Array([1, 0]),
    });
    expect(report.queries[0]?.rankedContentUnitIds).toEqual(["unit:zh-general"]);
  });
});

function metricFor(
  groups: readonly RetrievalEvaluationSliceResult[],
  slice: BilingualRetrievalSlice,
  k: number,
): RetrievalEvaluationMetricAtK {
  const group = groups.find((candidate) => candidate.slice === slice);
  if (!group) throw new Error(`Missing ${slice} group`);
  const metric = group.metrics.find((candidate) => candidate.k === k);
  if (!metric) throw new Error(`Missing @${k} metric`);
  return metric;
}

function testRunProvenance(): RetrievalEvaluationRunProvenance {
  return {
    chunker: "evaluation-chunker-v1",
    embeddingProfile: "test-embedding-profile@1",
    extractor: "evaluation-extractor-v1",
    fusion: "none:semantic-only",
    generator: "not-applicable",
    prompt: "not-applicable",
    reranker: "none",
    vectorStore: "exact-vector-store@1",
  };
}

function developmentDataset(): RetrievalEvaluationDataset {
  return {
    contentUnits: [
      {
        id: "unit:zh-general",
        language: "zh",
        sourceId: "source:zh-general",
        text: "交叉验证通过保留部分样本来估计模型面对新数据时的泛化能力。",
      },
      {
        id: "unit:zh-noise",
        language: "zh",
        sourceId: "source:zh-noise",
        text: "研究笔记应记录实验使用的软件版本和随机种子。",
      },
      {
        id: "unit:en-general",
        language: "en",
        sourceId: "source:en-general",
        text: "A holdout evaluation estimates how a trained model will perform on unseen examples.",
      },
      {
        id: "unit:en-support",
        language: "en",
        sourceId: "source:en-support",
        text: "Repeated resampling can reduce uncertainty when reporting generalization estimates.",
      },
      {
        id: "unit:en-noise",
        language: "en",
        sourceId: "source:en-noise",
        text: "A bibliography manager stores identifiers, authors, and publication dates.",
      },
    ],
    id: "bilingual-development-v1",
    queries: [
      query("query:zh-zh", "怎样评估模型在未见数据上的效果？", "zh", "zh", [
        { contentUnitId: "unit:zh-general", relevance: 3 },
      ]),
      query(
        "query:en-en",
        "How can a study test a model on examples outside its training data?",
        "en",
        "en",
        [{ contentUnitId: "unit:en-general", relevance: 3 }],
      ),
      query("query:zh-en", "如何判断训练好的系统能否推广到新的样本？", "zh", "en", [
        { contentUnitId: "unit:en-general", relevance: 3 },
        { contentUnitId: "unit:en-support", relevance: 1 },
      ]),
      query(
        "query:en-zh",
        "Which method estimates generalization on fresh observations?",
        "en",
        "zh",
        [{ contentUnitId: "unit:zh-general", relevance: 3 }],
      ),
    ],
    schemaVersion: 1,
    split: "development",
    version: "1.0.0",
  };
}

function query(
  id: string,
  text: string,
  language: "zh" | "en",
  targetLanguage: "zh" | "en",
  relevanceJudgments: RetrievalEvaluationDataset["queries"][number]["relevanceJudgments"],
): RetrievalEvaluationDataset["queries"][number] {
  return {
    discipline: "computer-science",
    id,
    labelProvenance: { generator: "unit-test", kind: "synthetic" },
    language,
    relevanceJudgments,
    targetLanguage,
    text,
  };
}

function releaseDataset(): RetrievalEvaluationDataset {
  const contentUnits: RetrievalEvaluationDataset["contentUnits"] = [
    {
      id: "unit:release-zh",
      language: "zh",
      sourceId: "source:release-zh",
      text: "中文候选材料描述了经过同行评议的研究方法。",
    },
    {
      id: "unit:release-en",
      language: "en",
      sourceId: "source:release-en",
      text: "The English candidate describes a peer-reviewed research method.",
    },
  ];
  const combinations: ReadonlyArray<readonly ["zh" | "en", "zh" | "en"]> = [
    ["zh", "zh"],
    ["en", "en"],
    ["zh", "en"],
    ["en", "zh"],
  ];
  const queries: RetrievalEvaluationDataset["queries"][number][] = [];
  for (let index = 0; index < 360; index += 1) {
    const [language, targetLanguage] = combinations[index % combinations.length]!;
    queries.push({
      discipline: `discipline-${index % 4}`,
      id: `query:release-${index}`,
      labelProvenance: {
        adjudicated: true,
        independentReviewerCount: 2,
        kind: "human-reviewed",
      },
      language,
      relevanceJudgments: [
        {
          contentUnitId: targetLanguage === "zh" ? "unit:release-zh" : "unit:release-en",
          relevance: 3,
        },
      ],
      targetLanguage,
      text:
        language === "zh"
          ? `第 ${index} 个独立研究检索问题`
          : `Independent research query ${index}`,
    });
  }
  return {
    contentUnits,
    id: "bilingual-held-out-v1",
    queries,
    schemaVersion: 1,
    split: "held-out",
    version: "1.0.0",
  };
}
