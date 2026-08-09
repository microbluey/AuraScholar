import { describe, expect, it } from "vitest";
import {
  getRetrievalEvaluationReleaseReadiness,
  RETRIEVAL_EVALUATION_SCHEMA_VERSION,
  type RetrievalEvaluationDataset,
} from "./index.js";
import {
  assertRetrievalEvaluationBlindReviewSubmission,
  createRetrievalEvaluationBlindReviewBundle,
  finalizeHumanReviewedRetrievalEvaluation,
  listRetrievalEvaluationReviewDisagreements,
  type RetrievalEvaluationBlindReviewAdjudication,
  type RetrievalEvaluationBlindReviewBundle,
  type RetrievalEvaluationBlindReviewSubmission,
} from "./retrieval-evaluation-tools.js";

describe("retrieval evaluation blind review", () => {
  it("creates a label-free packet with opaque task and candidate aliases", () => {
    const bundle = createRetrievalEvaluationBlindReviewBundle(heldOutSeedDataset());
    const serialized = JSON.stringify(bundle.packet);

    expect(bundle.packet.tasks).toHaveLength(4);
    expect(bundle.packet.tasks.every((task) => task.candidates.length === 2)).toBe(true);
    expect(
      bundle.packet.tasks.every((task) =>
        task.candidates.every((candidate) => candidate.id.startsWith("candidate:")),
      ),
    ).toBe(true);
    expect(serialized).not.toContain("unit:zh:method");
    expect(serialized).not.toContain("source:zh:method");
    expect(serialized).not.toContain("relevanceJudgments");
    expect(bundle.key.candidateToContentUnitId).toHaveProperty("candidate:0001");
  });

  it("requires complete independent review matrices and reports disagreements without resolving them", () => {
    const dataset = heldOutSeedDataset();
    const bundle = createRetrievalEvaluationBlindReviewBundle(dataset);
    const first = reviewerSubmission(bundle, dataset, "reviewer-a");
    const second = reviewerSubmission(bundle, dataset, "reviewer-b", {
      candidateId: bundle.packet.tasks[0]!.candidates[0]!.id,
      relevance: 1,
      taskId: bundle.packet.tasks[0]!.id,
    });

    expect(() =>
      assertRetrievalEvaluationBlindReviewSubmission(bundle.packet, first),
    ).not.toThrow();
    expect(() =>
      assertRetrievalEvaluationBlindReviewSubmission(bundle.packet, {
        ...first,
        tasks: [
          { ...first.tasks[0]!, grades: first.tasks[0]!.grades.slice(1) },
          ...first.tasks.slice(1),
        ],
      }),
    ).toThrow("must grade every candidate");
    expect(listRetrievalEvaluationReviewDisagreements(bundle.packet, [first, second])).toEqual([
      {
        candidateId: bundle.packet.tasks[0]!.candidates[0]!.id,
        firstRelevance: 0,
        secondRelevance: 1,
        taskId: bundle.packet.tasks[0]!.id,
      },
    ]);
  });

  it("finalizes only a held-out corpus after two reviewers and explicit adjudication", () => {
    const sourceDataset = heldOutSeedDataset();
    const bundle = createRetrievalEvaluationBlindReviewBundle(sourceDataset);
    const first = reviewerSubmission(bundle, sourceDataset, "reviewer-a");
    const second = reviewerSubmission(bundle, sourceDataset, "reviewer-b", {
      candidateId: bundle.packet.tasks[0]!.candidates[0]!.id,
      relevance: 1,
      taskId: bundle.packet.tasks[0]!.id,
    });
    const result = finalizeHumanReviewedRetrievalEvaluation({
      adjudication: adjudication(bundle, sourceDataset, "adjudicator-c"),
      reviewBundle: bundle,
      reviewerSubmissions: [first, second],
      sourceDataset,
    });

    expect(result.audit).toEqual({
      adjudicatorId: "adjudicator-c",
      disagreementCount: 1,
      packetId: bundle.packet.id,
      reviewerIds: ["reviewer-a", "reviewer-b"],
    });
    expect(result.dataset.queries).toHaveLength(4);
    expect(
      result.dataset.queries.every((query) => query.labelProvenance.kind === "human-reviewed"),
    ).toBe(true);
    expect(
      result.dataset.queries.every(
        (query) =>
          query.labelProvenance.kind === "human-reviewed" &&
          query.labelProvenance.independentReviewerCount === 2 &&
          query.labelProvenance.adjudicated,
      ),
    ).toBe(true);
    expect(sourceDataset.queries.every((query) => query.labelProvenance.kind === "synthetic")).toBe(
      true,
    );
    expect(getRetrievalEvaluationReleaseReadiness(result.dataset).reasons).not.toContain(
      "query query:en-en needs two independent human reviews and adjudication",
    );
  });

  it("refuses to turn a development corpus or duplicated reviewer identity into release labels", () => {
    const sourceDataset = heldOutSeedDataset();
    const bundle = createRetrievalEvaluationBlindReviewBundle(sourceDataset);
    const first = reviewerSubmission(bundle, sourceDataset, "reviewer-a");
    const adjudicated = adjudication(bundle, sourceDataset, "adjudicator-c");

    expect(() =>
      finalizeHumanReviewedRetrievalEvaluation({
        adjudication: adjudicated,
        reviewBundle: bundle,
        reviewerSubmissions: [first, reviewerSubmission(bundle, sourceDataset, "reviewer-a")],
        sourceDataset,
      }),
    ).toThrow("distinct reviewer ids");
    expect(() =>
      finalizeHumanReviewedRetrievalEvaluation({
        adjudication: adjudicated,
        reviewBundle: bundle,
        reviewerSubmissions: [first, reviewerSubmission(bundle, sourceDataset, "reviewer-b")],
        sourceDataset: { ...sourceDataset, split: "development" },
      }),
    ).toThrow("requires a held-out dataset");
  });
});

function reviewerSubmission(
  bundle: RetrievalEvaluationBlindReviewBundle,
  dataset: RetrievalEvaluationDataset,
  reviewerId: string,
  override?: { candidateId: string; relevance: 0 | 1 | 2 | 3; taskId: string },
): RetrievalEvaluationBlindReviewSubmission {
  return {
    packetId: bundle.packet.id,
    reviewerId,
    tasks: packetGrades(bundle, dataset, override),
  };
}

function adjudication(
  bundle: RetrievalEvaluationBlindReviewBundle,
  dataset: RetrievalEvaluationDataset,
  adjudicatorId: string,
): RetrievalEvaluationBlindReviewAdjudication {
  return {
    adjudicatorId,
    packetId: bundle.packet.id,
    tasks: packetGrades(bundle, dataset),
  };
}

function packetGrades(
  bundle: RetrievalEvaluationBlindReviewBundle,
  dataset: RetrievalEvaluationDataset,
  override?: { candidateId: string; relevance: 0 | 1 | 2 | 3; taskId: string },
) {
  const queryById = new Map(dataset.queries.map((query) => [query.id, query]));
  return bundle.packet.tasks.map((task) => {
    const queryId = bundle.key.taskToQueryId[task.id];
    if (!queryId) throw new Error(`Missing test query mapping for ${task.id}`);
    const query = queryById.get(queryId);
    if (!query) throw new Error(`Missing test query ${queryId}`);
    const essentialContentUnitId = query.relevanceJudgments[0]?.contentUnitId;
    if (!essentialContentUnitId) throw new Error(`Missing test relevance label for ${queryId}`);
    return {
      grades: task.candidates.map((candidate) => {
        const contentUnitId = bundle.key.candidateToContentUnitId[candidate.id];
        const relevance =
          override?.taskId === task.id && override.candidateId === candidate.id
            ? override.relevance
            : contentUnitId === essentialContentUnitId
              ? 3
              : 0;
        return { candidateId: candidate.id, relevance };
      }),
      taskId: task.id,
    };
  });
}

function heldOutSeedDataset(): RetrievalEvaluationDataset {
  return {
    contentUnits: [
      {
        id: "unit:en:archive",
        language: "en",
        sourceId: "source:en:archive",
        text: "Archival descriptions retain creator relationships and original arrangement.",
      },
      {
        id: "unit:en:method",
        language: "en",
        sourceId: "source:en:method",
        text: "Cross-validation estimates error on observations outside the fitting fold.",
      },
      {
        id: "unit:zh:archive",
        language: "zh",
        sourceId: "source:zh:archive",
        text: "档案来源原则保存文件形成者和原有排列之间的关系。",
      },
      {
        id: "unit:zh:method",
        language: "zh",
        sourceId: "source:zh:method",
        text: "交叉验证用未参与拟合的样本估计模型误差。",
      },
    ],
    id: "held-out-review-seed-v1",
    queries: [
      query(
        "query:en-en",
        "en",
        "en",
        "Which validation method tests performance away from the fitting fold?",
        "unit:en:method",
      ),
      query(
        "query:en-zh",
        "en",
        "zh",
        "Which Chinese method evaluates a model on data not used while fitting?",
        "unit:zh:method",
      ),
      query(
        "query:zh-en",
        "zh",
        "en",
        "英文材料中哪种方法使用未参与拟合的样本评估模型？",
        "unit:en:method",
      ),
      query("query:zh-zh", "zh", "zh", "怎样用未参与拟合的数据检查模型误差？", "unit:zh:method"),
    ],
    schemaVersion: RETRIEVAL_EVALUATION_SCHEMA_VERSION,
    split: "held-out",
    version: "1.0.0",
  };
}

function query(
  id: string,
  language: "zh" | "en",
  targetLanguage: "zh" | "en",
  text: string,
  contentUnitId: string,
): RetrievalEvaluationDataset["queries"][number] {
  return {
    discipline: "research-methods",
    id,
    labelProvenance: { generator: "review-seed", kind: "synthetic" },
    language,
    relevanceJudgments: [{ contentUnitId, relevance: 3 }],
    targetLanguage,
    text,
  };
}
