import type { EmbeddingProvider } from "./embedding.js";
import {
  assertRetrievalEvaluationDataset,
  assertRetrievalEvaluationRunProvenance,
  createSemanticRetrievalEvaluationRetriever,
  evaluateRetrievalDataset,
  type RetrievalEvaluationDataset,
  type RetrievalEvaluationMetricAtK,
  type RetrievalEvaluationOptions,
  type RetrievalEvaluationReport,
  type RetrievalEvaluationRetriever,
  type RetrievalEvaluationRunProvenance,
} from "./retrieval-evaluation.js";
import type { VectorStore } from "./vector-store.js";

/**
 * A candidate in a model-selection run. Comparison is deliberately local-only:
 * a benchmark must not turn a private evaluation corpus into remote embedding
 * traffic merely because a second candidate was added.
 */
export interface LocalRetrievalEvaluationCandidate {
  readonly egressMode: "local";
  readonly id: string;
  readonly retrieve: RetrievalEvaluationRetriever;
  readonly runProvenance: RetrievalEvaluationRunProvenance;
}

/** Inputs for adapting one local EmbeddingProvider and isolated VectorStore. */
export interface LocalSemanticRetrievalEvaluationCandidateInput {
  readonly embeddingProvider: EmbeddingProvider;
  readonly id: string;
  readonly indexId: string;
  readonly libraryId: string;
  readonly runProvenance: RetrievalEvaluationRunProvenance;
  readonly vectorStore: VectorStore;
}

export interface RetrievalEvaluationComparisonOptions {
  /** The candidate used for every reported signed delta. */
  readonly baselineCandidateId: string;
  readonly candidateScope?: RetrievalEvaluationOptions["candidateScope"];
  readonly cutoffs?: RetrievalEvaluationOptions["cutoffs"];
  readonly signal?: AbortSignal;
}

/** Candidate value minus baseline value at a shared cutoff. */
export interface RetrievalEvaluationMetricDelta {
  readonly hitRate: number;
  readonly k: number;
  readonly meanReciprocalRank: number;
  readonly ndcg: number;
  readonly recall: number;
}

export interface RetrievalEvaluationCandidateComparisonResult {
  readonly deltaFromBaseline: {
    readonly bySlice: readonly {
      readonly metrics: readonly RetrievalEvaluationMetricDelta[];
      readonly slice: string;
    }[];
    readonly overall: readonly RetrievalEvaluationMetricDelta[];
  };
  readonly id: string;
  readonly report: RetrievalEvaluationReport;
}

/**
 * A scorecard preserves full reports and adds deltas rather than reducing a
 * bilingual result to a single winner. A model must be inspected per language
 * slice before it can be selected.
 */
export interface RetrievalEvaluationComparison {
  readonly baselineCandidateId: string;
  readonly candidates: readonly RetrievalEvaluationCandidateComparisonResult[];
  readonly dataset: RetrievalEvaluationReport["dataset"];
}

/**
 * Adapts an isolated local semantic index into a candidate accepted by the
 * comparison runner. Remote providers fail before any query text is embedded.
 */
export function createLocalSemanticRetrievalEvaluationCandidate(
  input: LocalSemanticRetrievalEvaluationCandidateInput,
): LocalRetrievalEvaluationCandidate {
  if (!input || typeof input !== "object") {
    throw new Error("Local retrieval evaluation candidate input must be an object");
  }
  const id = normalizeCandidateId(input.id);
  const provider = input.embeddingProvider;
  if (!provider || typeof provider !== "object" || provider.egressMode !== "local") {
    throw new Error("Local retrieval evaluation candidate requires a local embedding provider");
  }
  assertRetrievalEvaluationRunProvenance(input.runProvenance);
  return {
    egressMode: "local",
    id,
    retrieve: createSemanticRetrievalEvaluationRetriever({
      embeddingProvider: provider,
      indexId: input.indexId,
      libraryId: input.libraryId,
      vectorStore: input.vectorStore,
    }),
    runProvenance: input.runProvenance,
  };
}

/**
 * Runs candidates serially against exactly the same corpus, cutoffs, and
 * retrieval contract. Serial execution prevents local ONNX runtimes from
 * competing for memory and makes an abort stop before the next candidate.
 */
export async function compareLocalRetrievalEvaluationCandidates(
  dataset: RetrievalEvaluationDataset,
  candidates: readonly LocalRetrievalEvaluationCandidate[],
  options: RetrievalEvaluationComparisonOptions,
): Promise<RetrievalEvaluationComparison> {
  assertRetrievalEvaluationDataset(dataset);
  const normalizedOptions = normalizeComparisonOptions(options);
  const normalizedCandidates = normalizeCandidates(candidates);
  const baseline = normalizedCandidates.find(
    (candidate) => candidate.id === normalizedOptions.baselineCandidateId,
  );
  if (!baseline) {
    throw new Error("Retrieval evaluation comparison baseline candidate is not present");
  }

  const reports: Array<{
    candidate: LocalRetrievalEvaluationCandidate;
    report: RetrievalEvaluationReport;
  }> = [];
  for (const candidate of normalizedCandidates) {
    throwIfAborted(normalizedOptions.signal);
    const report = await evaluateRetrievalDataset(dataset, candidate.retrieve, {
      candidateScope: normalizedOptions.candidateScope,
      cutoffs: normalizedOptions.cutoffs,
      runProvenance: candidate.runProvenance,
      signal: normalizedOptions.signal,
    });
    reports.push({ candidate, report });
  }
  const baselineReport = reports.find((entry) => entry.candidate.id === baseline.id)?.report;
  if (!baselineReport)
    throw new Error("Retrieval evaluation comparison baseline report is missing");

  return {
    baselineCandidateId: baseline.id,
    candidates: reports.map(({ candidate, report }) => ({
      deltaFromBaseline: {
        bySlice: report.bySlice.map((slice) => ({
          metrics: metricDeltas(
            slice.metrics,
            metricsForSlice(baselineReport, slice.slice),
            `slice ${slice.slice}`,
          ),
          slice: slice.slice,
        })),
        overall: metricDeltas(report.overall.metrics, baselineReport.overall.metrics, "overall"),
      },
      id: candidate.id,
      report,
    })),
    dataset: baselineReport.dataset,
  };
}

function metricDeltas(
  metrics: readonly RetrievalEvaluationMetricAtK[],
  baselineMetrics: readonly RetrievalEvaluationMetricAtK[],
  label: string,
): RetrievalEvaluationMetricDelta[] {
  const baselineByCutoff = new Map(baselineMetrics.map((metric) => [metric.k, metric]));
  return metrics.map((metric) => {
    const baseline = baselineByCutoff.get(metric.k);
    if (!baseline) {
      throw new Error(
        `Retrieval evaluation comparison baseline is missing ${label} cutoff ${metric.k}`,
      );
    }
    return {
      hitRate: metric.hitRate - baseline.hitRate,
      k: metric.k,
      meanReciprocalRank: metric.meanReciprocalRank - baseline.meanReciprocalRank,
      ndcg: metric.ndcg - baseline.ndcg,
      recall: metric.recall - baseline.recall,
    };
  });
}

function metricsForSlice(
  report: RetrievalEvaluationReport,
  slice: string,
): readonly RetrievalEvaluationMetricAtK[] {
  const result = report.bySlice.find((candidate) => candidate.slice === slice);
  if (!result)
    throw new Error(`Retrieval evaluation comparison baseline is missing slice ${slice}`);
  return result.metrics;
}

function normalizeCandidates(
  candidates: readonly LocalRetrievalEvaluationCandidate[],
): LocalRetrievalEvaluationCandidate[] {
  if (!Array.isArray(candidates) || candidates.length < 2) {
    throw new Error("Retrieval evaluation comparison requires at least two local candidates");
  }
  const ids = new Set<string>();
  return candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Retrieval evaluation comparison candidate must be an object");
    }
    const id = normalizeCandidateId(candidate.id);
    if (ids.has(id)) {
      throw new Error(
        `Retrieval evaluation comparison candidate ${id} was supplied more than once`,
      );
    }
    ids.add(id);
    if (candidate.egressMode !== "local") {
      throw new Error(`Retrieval evaluation comparison candidate ${id} must run locally`);
    }
    if (typeof candidate.retrieve !== "function") {
      throw new Error(`Retrieval evaluation comparison candidate ${id} must provide a retriever`);
    }
    assertRetrievalEvaluationRunProvenance(candidate.runProvenance);
    return { ...candidate, id };
  });
}

function normalizeComparisonOptions(
  options: RetrievalEvaluationComparisonOptions,
): RetrievalEvaluationComparisonOptions {
  if (!options || typeof options !== "object") {
    throw new Error("Retrieval evaluation comparison options must be an object");
  }
  return {
    baselineCandidateId: normalizeCandidateId(options.baselineCandidateId),
    candidateScope: options.candidateScope,
    cutoffs: options.cutoffs,
    signal: options.signal,
  };
}

function normalizeCandidateId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Retrieval evaluation comparison candidate id must be non-empty");
  }
  return value.trim();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
