import {
  BILINGUAL_RETRIEVAL_SLICES,
  DEFAULT_RETRIEVAL_EVALUATION_CANDIDATE_SCOPE,
  DEFAULT_RETRIEVAL_EVALUATION_CUTOFFS,
  type RetrievalEvaluationAggregate,
  type RetrievalEvaluationCandidateScope,
  type RetrievalEvaluationContentUnit,
  type RetrievalEvaluationDataset,
  type RetrievalEvaluationOptions,
  type RetrievalEvaluationQuery,
  type RetrievalEvaluationQueryResult,
  type RetrievalEvaluationReport,
  type RetrievalEvaluationRetriever,
} from "./retrieval-evaluation-contract.js";
import {
  assertRankedContentUnitIds,
  assertRetrievalEvaluationDataset,
  compareText,
  getRetrievalEvaluationReleaseReadiness,
  isMultiDocumentQuery,
  modeForQuery,
  normalizeCandidateScope,
  normalizeCutoffs,
  normalizeRunProvenance,
  queryFor,
  scoreQuery,
  sliceForQuery,
  throwIfAborted,
} from "./retrieval-evaluation-validation.js";

export * from "./retrieval-evaluation-contract.js";
export * from "./retrieval-evaluation-semantic.js";
export * from "./retrieval-evaluation-validation.js";

/**
 * Bilingual semantic-retrieval evaluation is intentionally independent from a
 * particular vector store or embedding runtime. A driver supplies ranked
 * ContentUnit IDs; this module validates the human-labelled corpus and scores
 * the ranks without comparing backend-specific scores.
 */

/**
 * Scores a dataset through an injected retriever. The caller remains
 * responsible for creating the isolated corpus/index; this function only
 * supplies its human-labelled units and verifies that returned IDs stay in it.
 */
export async function evaluateRetrievalDataset(
  dataset: RetrievalEvaluationDataset,
  retrieve: RetrievalEvaluationRetriever,
  options: RetrievalEvaluationOptions,
): Promise<RetrievalEvaluationReport> {
  assertRetrievalEvaluationDataset(dataset);
  if (typeof retrieve !== "function") {
    throw new Error("Retrieval evaluation retriever must be a function");
  }
  const runProvenance = normalizeRunProvenance(options.runProvenance);
  const cutoffs = normalizeCutoffs(options.cutoffs ?? DEFAULT_RETRIEVAL_EVALUATION_CUTOFFS);
  const candidateScope = normalizeCandidateScope(
    options.candidateScope ?? DEFAULT_RETRIEVAL_EVALUATION_CANDIDATE_SCOPE,
  );
  const limit = cutoffs[cutoffs.length - 1]!;
  const contentUnitById = new Map(dataset.contentUnits.map((unit) => [unit.id, unit]));
  const results: RetrievalEvaluationQueryResult[] = [];

  for (const query of dataset.queries) {
    throwIfAborted(options.signal);
    const candidates = candidatesForQuery(dataset.contentUnits, query, candidateScope);
    const rankedContentUnitIds = await retrieve({
      candidates,
      limit,
      query,
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    assertRankedContentUnitIds(rankedContentUnitIds, candidateById, limit, query.id);

    const normalizedRanks = [...rankedContentUnitIds];
    const mode = modeForQuery(query);
    results.push({
      isMultiDocument: isMultiDocumentQuery(query, contentUnitById),
      metrics: scoreQuery(query, normalizedRanks, cutoffs),
      mode,
      queryId: query.id,
      rankedContentUnitIds: normalizedRanks,
      slice: sliceForQuery(query),
    });
  }

  return {
    byDiscipline: [...new Set(dataset.queries.map((query) => query.discipline))]
      .sort(compareText)
      .map((discipline) => ({
        discipline,
        ...aggregate(
          results.filter((result) => queryFor(dataset, result.queryId).discipline === discipline),
          cutoffs,
        ),
      })),
    byMode: (["same-language", "cross-language"] as const).map((mode) => ({
      mode,
      ...aggregate(
        results.filter((result) => result.mode === mode),
        cutoffs,
      ),
    })),
    bySlice: BILINGUAL_RETRIEVAL_SLICES.map((slice) => ({
      slice,
      ...aggregate(
        results.filter((result) => result.slice === slice),
        cutoffs,
      ),
    })),
    candidateScope,
    dataset: { id: dataset.id, split: dataset.split, version: dataset.version },
    multiDocument: aggregate(
      results.filter((result) => result.isMultiDocument),
      cutoffs,
    ),
    overall: aggregate(results, cutoffs),
    queries: results,
    releaseReadiness: getRetrievalEvaluationReleaseReadiness(dataset),
    runProvenance,
  };
}

function candidatesForQuery(
  candidates: readonly RetrievalEvaluationContentUnit[],
  query: RetrievalEvaluationQuery,
  scope: RetrievalEvaluationCandidateScope,
): readonly RetrievalEvaluationContentUnit[] {
  if (scope === "full-corpus") return candidates;
  return candidates.filter((candidate) => candidate.language === query.targetLanguage);
}

function aggregate(
  results: readonly RetrievalEvaluationQueryResult[],
  cutoffs: readonly number[],
): RetrievalEvaluationAggregate {
  if (results.length === 0) return { metrics: [], queryCount: 0 };
  return {
    metrics: cutoffs.map((k, index) => {
      const totals = results.reduce(
        (current, result) => {
          const metric = result.metrics[index];
          if (!metric) throw new Error("Retrieval evaluation metric cutoff mismatch");
          current.hitRate += metric.hitRate;
          current.meanReciprocalRank += metric.meanReciprocalRank;
          current.ndcg += metric.ndcg;
          current.recall += metric.recall;
          return current;
        },
        { hitRate: 0, meanReciprocalRank: 0, ndcg: 0, recall: 0 },
      );
      return {
        hitRate: totals.hitRate / results.length,
        k,
        meanReciprocalRank: totals.meanReciprocalRank / results.length,
        ndcg: totals.ndcg / results.length,
        recall: totals.recall / results.length,
      };
    }),
    queryCount: results.length,
  };
}
