import {
  type BilingualRetrievalSlice,
  type RetrievalEvaluationCandidateScope,
  type RetrievalEvaluationMetricAtK,
  type RetrievalEvaluationReport,
} from "./retrieval-evaluation.js";

/**
 * Automated semantic-retrieval thresholds from Gate 1B. They deliberately
 * assess every primary language slice so a strong aggregate cannot conceal a
 * weak cross-language direction. Dataset/reviewer release readiness remains a
 * separate concern from this model-quality signal.
 */
export const DEFAULT_RETRIEVAL_EVALUATION_QUALITY_THRESHOLDS = {
  crossLanguageNdcgAt10: 0.72,
  crossLanguageRecallAt10: 0.82,
  multiDocumentRecallAt20: 0.8,
  sameLanguageNdcgAt10: 0.8,
  sameLanguageRecallAt10: 0.9,
} as const;

export interface RetrievalEvaluationQualityThresholds {
  readonly crossLanguageNdcgAt10: number;
  readonly crossLanguageRecallAt10: number;
  readonly multiDocumentRecallAt20: number;
  readonly sameLanguageNdcgAt10: number;
  readonly sameLanguageRecallAt10: number;
}

export interface RetrievalEvaluationQualityOptions {
  /** Override one or more Gate 1B thresholds for an explicit experiment. */
  readonly thresholds?: Partial<RetrievalEvaluationQualityThresholds>;
}

export type RetrievalEvaluationQualityMetric = "ndcg" | "recall";
export type RetrievalEvaluationQualityScope = "cross-language" | "multi-document" | "same-language";

export interface RetrievalEvaluationQualityCheck {
  /** Null means the report omitted the required slice or cutoff. */
  readonly actual: number | null;
  readonly expected: number;
  readonly k: number;
  readonly metric: RetrievalEvaluationQualityMetric;
  readonly passed: boolean;
  readonly scope: RetrievalEvaluationQualityScope;
  readonly slice?: BilingualRetrievalSlice;
}

export interface RetrievalEvaluationQualityAssessment {
  readonly candidateScope: RetrievalEvaluationCandidateScope;
  readonly checks: readonly RetrievalEvaluationQualityCheck[];
  /** Development data can pass a mechanical check but remains non-release data. */
  readonly provisional: boolean;
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly thresholds: RetrievalEvaluationQualityThresholds;
}

/**
 * Converts a scored report into a deterministic, machine-readable Gate 1B
 * signal. It is intentionally not called by local indexing or search: model
 * quality informs selection/release work without turning a missing benchmark
 * or human review into a product availability dependency.
 */
export function assessRetrievalEvaluationQuality(
  report: RetrievalEvaluationReport,
  options: RetrievalEvaluationQualityOptions = {},
): RetrievalEvaluationQualityAssessment {
  assertReport(report);
  const thresholds = normalizeThresholds(options);
  const checks: RetrievalEvaluationQualityCheck[] = [];

  appendSliceChecks(checks, report, "zh-zh", "same-language", {
    ndcg: thresholds.sameLanguageNdcgAt10,
    recall: thresholds.sameLanguageRecallAt10,
  });
  appendSliceChecks(checks, report, "en-en", "same-language", {
    ndcg: thresholds.sameLanguageNdcgAt10,
    recall: thresholds.sameLanguageRecallAt10,
  });
  appendSliceChecks(checks, report, "zh-en", "cross-language", {
    ndcg: thresholds.crossLanguageNdcgAt10,
    recall: thresholds.crossLanguageRecallAt10,
  });
  appendSliceChecks(checks, report, "en-zh", "cross-language", {
    ndcg: thresholds.crossLanguageNdcgAt10,
    recall: thresholds.crossLanguageRecallAt10,
  });
  checks.push(
    qualityCheck({
      actual: metricAt(report.multiDocument.metrics, 20, "recall"),
      expected: thresholds.multiDocumentRecallAt20,
      k: 20,
      metric: "recall",
      scope: "multi-document",
    }),
  );

  const reasons = checks.filter((check) => !check.passed).map(describeFailure);
  return {
    candidateScope: report.candidateScope,
    checks,
    passed: reasons.length === 0,
    provisional: report.dataset.split !== "held-out",
    reasons,
    thresholds,
  };
}

function appendSliceChecks(
  checks: RetrievalEvaluationQualityCheck[],
  report: RetrievalEvaluationReport,
  slice: BilingualRetrievalSlice,
  scope: "same-language" | "cross-language",
  expected: { readonly ndcg: number; readonly recall: number },
): void {
  const metrics = report.bySlice.find((candidate) => candidate.slice === slice)?.metrics ?? [];
  checks.push(
    qualityCheck({
      actual: metricAt(metrics, 10, "recall"),
      expected: expected.recall,
      k: 10,
      metric: "recall",
      scope,
      slice,
    }),
    qualityCheck({
      actual: metricAt(metrics, 10, "ndcg"),
      expected: expected.ndcg,
      k: 10,
      metric: "ndcg",
      scope,
      slice,
    }),
  );
}

function qualityCheck(input: {
  readonly actual: number | null;
  readonly expected: number;
  readonly k: number;
  readonly metric: RetrievalEvaluationQualityMetric;
  readonly scope: RetrievalEvaluationQualityScope;
  readonly slice?: BilingualRetrievalSlice;
}): RetrievalEvaluationQualityCheck {
  return {
    ...input,
    passed: input.actual !== null && input.actual >= input.expected,
  };
}

function metricAt(
  metrics: readonly RetrievalEvaluationMetricAtK[],
  k: number,
  metric: RetrievalEvaluationQualityMetric,
): number | null {
  const candidate = metrics.find((item) => item.k === k);
  if (!candidate) return null;
  const value = candidate[metric];
  return Number.isFinite(value) ? value : null;
}

function describeFailure(check: RetrievalEvaluationQualityCheck): string {
  const target = check.slice ?? check.scope;
  const actual = check.actual === null ? "missing" : formatScore(check.actual);
  return `${target} ${check.metric}@${check.k} ${actual} is below ${formatScore(check.expected)}`;
}

function formatScore(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function normalizeThresholds(
  options: RetrievalEvaluationQualityOptions,
): RetrievalEvaluationQualityThresholds {
  if (!options || typeof options !== "object") {
    throw new Error("Retrieval evaluation quality options must be an object");
  }
  const supplied = options.thresholds;
  if (supplied !== undefined && (!supplied || typeof supplied !== "object")) {
    throw new Error("Retrieval evaluation quality thresholds must be an object");
  }
  const thresholds = {
    ...DEFAULT_RETRIEVAL_EVALUATION_QUALITY_THRESHOLDS,
    ...supplied,
  };
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Retrieval evaluation quality threshold ${name} must be between 0 and 1`);
    }
  }
  return thresholds;
}

function assertReport(report: RetrievalEvaluationReport): void {
  if (!report || typeof report !== "object") {
    throw new Error("Retrieval evaluation quality requires a report");
  }
  if (
    !report.dataset ||
    !Array.isArray(report.bySlice) ||
    !report.multiDocument ||
    (report.candidateScope !== "full-corpus" && report.candidateScope !== "target-language-only")
  ) {
    throw new Error("Retrieval evaluation quality report is incomplete");
  }
}
