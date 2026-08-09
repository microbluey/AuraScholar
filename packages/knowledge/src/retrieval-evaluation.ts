import { assertEmbeddingVector, type EmbeddingProvider } from "./embedding.js";
import type { VectorStore } from "./vector-store.js";

/**
 * Bilingual semantic-retrieval evaluation is intentionally independent from a
 * particular vector store or embedding runtime. A driver supplies ranked
 * ContentUnit IDs; this module validates the human-labelled corpus and scores
 * the ranks without comparing backend-specific scores.
 */

export const RETRIEVAL_EVALUATION_SCHEMA_VERSION = 1;
export const BILINGUAL_RETRIEVAL_LANGUAGES = ["zh", "en"] as const;
export const BILINGUAL_RETRIEVAL_SLICES = ["zh-zh", "en-en", "zh-en", "en-zh"] as const;
export const DEFAULT_RETRIEVAL_EVALUATION_CUTOFFS = [10, 20] as const;
export const RETRIEVAL_EVALUATION_CANDIDATE_SCOPES = [
  "full-corpus",
  "target-language-only",
] as const;
export const DEFAULT_RETRIEVAL_EVALUATION_CANDIDATE_SCOPE = "full-corpus" as const;
export const MIN_RELEASE_RETRIEVAL_EVALUATION_QUERIES = 360;
export const MIN_RELEASE_RETRIEVAL_EVALUATION_DISCIPLINES = 4;

export type BilingualRetrievalLanguage = (typeof BILINGUAL_RETRIEVAL_LANGUAGES)[number];
export type BilingualRetrievalSlice = (typeof BILINGUAL_RETRIEVAL_SLICES)[number];
export type RetrievalEvaluationCandidateScope =
  (typeof RETRIEVAL_EVALUATION_CANDIDATE_SCOPES)[number];
export type RetrievalEvaluationMode = "same-language" | "cross-language";
export type RetrievalEvaluationSplit = "development" | "held-out";
export type RetrievalRelevanceGrade = 1 | 2 | 3;

/**
 * A benchmark corpus unit. `text` is kept in the evaluation dataset so the
 * harness can reject copied-query self matches before a model is measured.
 */
export interface RetrievalEvaluationContentUnit {
  readonly id: string;
  readonly language: BilingualRetrievalLanguage;
  readonly sourceId: string;
  readonly text: string;
}

export interface RetrievalEvaluationRelevanceJudgment {
  readonly contentUnitId: string;
  /** 1 = relevant, 2 = highly relevant, 3 = essential evidence. */
  readonly relevance: RetrievalRelevanceGrade;
}

/**
 * Synthetic labels may exercise the harness, but only independently reviewed
 * and adjudicated labels are eligible for a held-out release benchmark.
 */
export type RetrievalEvaluationLabelProvenance =
  | {
      readonly adjudicated: boolean;
      readonly independentReviewerCount: number;
      readonly kind: "human-reviewed";
    }
  | {
      readonly generator: string;
      readonly kind: "synthetic";
    };

export interface RetrievalEvaluationQuery {
  readonly discipline: string;
  readonly id: string;
  readonly labelProvenance: RetrievalEvaluationLabelProvenance;
  readonly language: BilingualRetrievalLanguage;
  readonly relevanceJudgments: readonly RetrievalEvaluationRelevanceJudgment[];
  /** Language of every positive relevance target for this query. */
  readonly targetLanguage: BilingualRetrievalLanguage;
  readonly text: string;
}

export interface RetrievalEvaluationDataset {
  readonly contentUnits: readonly RetrievalEvaluationContentUnit[];
  readonly id: string;
  readonly queries: readonly RetrievalEvaluationQuery[];
  readonly schemaVersion: typeof RETRIEVAL_EVALUATION_SCHEMA_VERSION;
  readonly split: RetrievalEvaluationSplit;
  readonly version: string;
}

export interface RetrievalEvaluationRetrieverInput {
  readonly candidates: readonly RetrievalEvaluationContentUnit[];
  readonly limit: number;
  readonly query: RetrievalEvaluationQuery;
  readonly signal?: AbortSignal;
}

/** A driver returns ordered ContentUnit IDs, not backend score values. */
export type RetrievalEvaluationRetriever = (
  input: RetrievalEvaluationRetrieverInput,
) => Promise<readonly string[]>;

/**
 * Immutable identifiers for the configuration that produced one report. Use
 * an explicit value such as `not-applicable` or `none` when a retrieval-only
 * run has no prompt, generator, fusion, or reranker; do not omit the field.
 */
export interface RetrievalEvaluationRunProvenance {
  readonly chunker: string;
  readonly embeddingProfile: string;
  readonly extractor: string;
  readonly fusion: string;
  readonly generator: string;
  readonly prompt: string;
  readonly reranker: string;
  readonly vectorStore: string;
}

export interface RetrievalEvaluationOptions {
  /**
   * `full-corpus` measures relevance plus language-selection behavior. The
   * target-language-only scope isolates cross-language semantic matching.
   */
  readonly candidateScope?: RetrievalEvaluationCandidateScope;
  readonly cutoffs?: readonly number[];
  /** Required so every score can be reproduced and compared honestly. */
  readonly runProvenance: RetrievalEvaluationRunProvenance;
  readonly signal?: AbortSignal;
}

/**
 * Connects the generic scorer to a pure vector search. It intentionally does
 * not use HybridRetriever: full-text ranks must not mask embedding quality in
 * a semantic-profile comparison.
 */
export interface SemanticRetrievalEvaluationRetrieverOptions {
  readonly embeddingProvider: EmbeddingProvider;
  readonly indexId: string;
  readonly libraryId: string;
  readonly vectorStore: VectorStore;
}

export interface RetrievalEvaluationMetricAtK {
  readonly hitRate: number;
  readonly k: number;
  readonly meanReciprocalRank: number;
  readonly ndcg: number;
  /** Macro recall over all positive ContentUnit labels, not just first-hit rate. */
  readonly recall: number;
}

export interface RetrievalEvaluationAggregate {
  readonly metrics: readonly RetrievalEvaluationMetricAtK[];
  readonly queryCount: number;
}

export interface RetrievalEvaluationQueryResult {
  readonly isMultiDocument: boolean;
  readonly metrics: readonly RetrievalEvaluationMetricAtK[];
  readonly mode: RetrievalEvaluationMode;
  readonly queryId: string;
  readonly rankedContentUnitIds: readonly string[];
  readonly slice: BilingualRetrievalSlice;
}

export interface RetrievalEvaluationSliceResult extends RetrievalEvaluationAggregate {
  readonly slice: BilingualRetrievalSlice;
}

export interface RetrievalEvaluationModeResult extends RetrievalEvaluationAggregate {
  readonly mode: RetrievalEvaluationMode;
}

export interface RetrievalEvaluationDisciplineResult extends RetrievalEvaluationAggregate {
  readonly discipline: string;
}

export interface RetrievalEvaluationReleaseReadiness {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export interface RetrievalEvaluationReport {
  readonly byDiscipline: readonly RetrievalEvaluationDisciplineResult[];
  readonly byMode: readonly RetrievalEvaluationModeResult[];
  readonly bySlice: readonly RetrievalEvaluationSliceResult[];
  readonly candidateScope: RetrievalEvaluationCandidateScope;
  readonly dataset: Pick<RetrievalEvaluationDataset, "id" | "split" | "version">;
  readonly multiDocument: RetrievalEvaluationAggregate;
  readonly overall: RetrievalEvaluationAggregate;
  readonly queries: readonly RetrievalEvaluationQueryResult[];
  readonly releaseReadiness: RetrievalEvaluationReleaseReadiness;
  readonly runProvenance: RetrievalEvaluationRunProvenance;
}

/**
 * Creates a driver for an isolated, generation-pinned vector index. The
 * generic evaluator still verifies returned IDs against its exact candidate
 * list, so an index that contains extra Library data cannot silently affect a
 * benchmark result.
 */
export function createSemanticRetrievalEvaluationRetriever(
  options: SemanticRetrievalEvaluationRetrieverOptions,
): RetrievalEvaluationRetriever {
  if (!options || typeof options !== "object") {
    throw new Error("Semantic retrieval evaluation options must be an object");
  }
  assertNonEmpty(options.libraryId, "Semantic retrieval evaluation Library id");
  assertNonEmpty(options.indexId, "Semantic retrieval evaluation index id");
  const embeddingProvider = options.embeddingProvider;
  if (!embeddingProvider || typeof embeddingProvider.embedQuery !== "function") {
    throw new Error("Semantic retrieval evaluation requires an embedding provider");
  }
  if (!Number.isSafeInteger(embeddingProvider.dimension) || embeddingProvider.dimension < 1) {
    throw new Error("Semantic retrieval evaluation embedding dimension must be a positive integer");
  }
  const vectorStore = options.vectorStore;
  if (!vectorStore || typeof vectorStore.search !== "function") {
    throw new Error("Semantic retrieval evaluation requires a VectorStore");
  }
  const libraryId = options.libraryId.trim();
  const indexId = options.indexId.trim();

  return async ({ candidates, limit, query, signal }) => {
    throwIfAborted(signal);
    assertNonEmpty(query.text, "Semantic retrieval evaluation query text");
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("Semantic retrieval evaluation candidates must be a non-empty array");
    }
    const allowedSourceIds = [...new Set(candidates.map((candidate) => candidate.sourceId))];
    for (const sourceId of allowedSourceIds) {
      assertNonEmpty(sourceId, "Semantic retrieval evaluation candidate source id");
    }
    const vector = await embeddingProvider.embedQuery(query.text, { signal });
    throwIfAborted(signal);
    assertEmbeddingVector(
      vector,
      embeddingProvider.dimension,
      "Semantic retrieval evaluation query vector",
    );
    const hits = await vectorStore.search({
      allowedSourceIds,
      indexId,
      libraryId,
      limit,
      signal,
      vector,
    });
    throwIfAborted(signal);
    if (!Array.isArray(hits)) {
      throw new Error("Semantic retrieval evaluation VectorStore returned a non-array hit list");
    }
    return hits.map((hit) => {
      if (!hit || typeof hit.contentUnitId !== "string") {
        throw new Error("Semantic retrieval evaluation VectorStore returned an invalid hit");
      }
      return hit.contentUnitId;
    });
  };
}

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

/** Validates and normalizes the configuration fingerprint retained in a report. */
export function assertRetrievalEvaluationRunProvenance(
  provenance: RetrievalEvaluationRunProvenance,
): void {
  normalizeRunProvenance(provenance);
}

/**
 * Validates the benchmark format before it reaches an embedding model. In
 * particular, a query cannot equal any candidate after Unicode/case/spacing/
 * punctuation normalization, so copied-query self matches cannot inflate a
 * semantic-retrieval score.
 */
export function assertRetrievalEvaluationDataset(dataset: RetrievalEvaluationDataset): void {
  if (!dataset || typeof dataset !== "object") {
    throw new Error("Retrieval evaluation dataset must be an object");
  }
  if (dataset.schemaVersion !== RETRIEVAL_EVALUATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported retrieval evaluation schema version: ${dataset.schemaVersion}`);
  }
  assertNonEmpty(dataset.id, "Retrieval evaluation dataset id");
  assertNonEmpty(dataset.version, "Retrieval evaluation dataset version");
  if (dataset.split !== "development" && dataset.split !== "held-out") {
    throw new Error("Retrieval evaluation dataset split must be development or held-out");
  }
  if (!Array.isArray(dataset.contentUnits) || dataset.contentUnits.length === 0) {
    throw new Error("Retrieval evaluation dataset must contain at least one ContentUnit");
  }
  if (!Array.isArray(dataset.queries) || dataset.queries.length === 0) {
    throw new Error("Retrieval evaluation dataset must contain at least one query");
  }

  const contentUnitById = new Map<string, RetrievalEvaluationContentUnit>();
  const contentUnitByTextIdentity = new Map<string, RetrievalEvaluationContentUnit>();
  for (const unit of dataset.contentUnits) {
    assertNonEmpty(unit.id, "Retrieval evaluation ContentUnit id");
    assertNonEmpty(unit.sourceId, `Retrieval evaluation ContentUnit ${unit.id} source id`);
    assertLanguage(unit.language, `Retrieval evaluation ContentUnit ${unit.id} language`);
    const textIdentity = textIdentityFor(
      unit.text,
      `Retrieval evaluation ContentUnit ${unit.id} text`,
    );
    if (contentUnitById.has(unit.id)) {
      throw new Error(`Retrieval evaluation ContentUnit ${unit.id} was supplied more than once`);
    }
    const duplicate = contentUnitByTextIdentity.get(textIdentity);
    if (duplicate) {
      throw new Error(
        `Retrieval evaluation ContentUnits ${duplicate.id} and ${unit.id} have the same normalized text`,
      );
    }
    contentUnitById.set(unit.id, unit);
    contentUnitByTextIdentity.set(textIdentity, unit);
  }

  const queryIds = new Set<string>();
  const queryTextIdentities = new Set<string>();
  for (const query of dataset.queries) {
    assertNonEmpty(query.id, "Retrieval evaluation query id");
    if (queryIds.has(query.id)) {
      throw new Error(`Retrieval evaluation query ${query.id} was supplied more than once`);
    }
    queryIds.add(query.id);
    assertNonEmpty(query.discipline, `Retrieval evaluation query ${query.id} discipline`);
    assertLanguage(query.language, `Retrieval evaluation query ${query.id} language`);
    assertLanguage(query.targetLanguage, `Retrieval evaluation query ${query.id} target language`);
    const queryTextIdentity = textIdentityFor(
      query.text,
      `Retrieval evaluation query ${query.id} text`,
    );
    if (queryTextIdentities.has(queryTextIdentity)) {
      throw new Error(
        `Retrieval evaluation query ${query.id} duplicates another normalized query text`,
      );
    }
    queryTextIdentities.add(queryTextIdentity);
    const copiedCandidate = contentUnitByTextIdentity.get(queryTextIdentity);
    if (copiedCandidate) {
      throw new Error(
        `Retrieval evaluation query ${query.id} matches ContentUnit ${copiedCandidate.id} after text normalization`,
      );
    }
    assertLabelProvenance(query.labelProvenance, query.id);
    if (!Array.isArray(query.relevanceJudgments) || query.relevanceJudgments.length === 0) {
      throw new Error(
        `Retrieval evaluation query ${query.id} must have at least one relevance judgment`,
      );
    }
    const judgedIds = new Set<string>();
    for (const judgment of query.relevanceJudgments) {
      assertNonEmpty(
        judgment.contentUnitId,
        `Retrieval evaluation query ${query.id} relevance ContentUnit id`,
      );
      if (judgedIds.has(judgment.contentUnitId)) {
        throw new Error(
          `Retrieval evaluation query ${query.id} judges ContentUnit ${judgment.contentUnitId} more than once`,
        );
      }
      judgedIds.add(judgment.contentUnitId);
      if (!isRelevanceGrade(judgment.relevance)) {
        throw new Error(
          `Retrieval evaluation query ${query.id} relevance must be an integer from 1 to 3`,
        );
      }
      const unit = contentUnitById.get(judgment.contentUnitId);
      if (!unit) {
        throw new Error(
          `Retrieval evaluation query ${query.id} references unknown ContentUnit ${judgment.contentUnitId}`,
        );
      }
      if (unit.language !== query.targetLanguage) {
        throw new Error(
          `Retrieval evaluation query ${query.id} target language does not match ContentUnit ${unit.id}`,
        );
      }
    }
  }
}

/**
 * Checks the structural, reviewer, and coverage requirements from the RFC.
 * It deliberately does not make a performance decision: that requires a real
 * held-out corpus and an evaluated report.
 */
export function getRetrievalEvaluationReleaseReadiness(
  dataset: RetrievalEvaluationDataset,
): RetrievalEvaluationReleaseReadiness {
  assertRetrievalEvaluationDataset(dataset);
  const reasons: string[] = [];
  if (dataset.split !== "held-out") {
    reasons.push("dataset split must be held-out");
  }
  if (dataset.queries.length < MIN_RELEASE_RETRIEVAL_EVALUATION_QUERIES) {
    reasons.push(
      `dataset needs at least ${MIN_RELEASE_RETRIEVAL_EVALUATION_QUERIES} quality queries`,
    );
  }
  const disciplineCount = new Set(dataset.queries.map((query) => query.discipline)).size;
  if (disciplineCount < MIN_RELEASE_RETRIEVAL_EVALUATION_DISCIPLINES) {
    reasons.push(
      `dataset needs at least ${MIN_RELEASE_RETRIEVAL_EVALUATION_DISCIPLINES} disciplines`,
    );
  }
  for (const slice of BILINGUAL_RETRIEVAL_SLICES) {
    if (!dataset.queries.some((query) => sliceForQuery(query) === slice)) {
      reasons.push(`dataset is missing the ${slice} language slice`);
    }
  }
  for (const query of dataset.queries) {
    const provenance = query.labelProvenance;
    if (
      provenance.kind !== "human-reviewed" ||
      provenance.independentReviewerCount < 2 ||
      !provenance.adjudicated
    ) {
      reasons.push(`query ${query.id} needs two independent human reviews and adjudication`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

export function assertReleaseReadyRetrievalEvaluationDataset(
  dataset: RetrievalEvaluationDataset,
): void {
  const readiness = getRetrievalEvaluationReleaseReadiness(dataset);
  if (!readiness.eligible) {
    throw new Error(
      `Retrieval evaluation dataset is not release-ready: ${readiness.reasons.join("; ")}`,
    );
  }
}

/** The anti-self-match normalizer is exported so dataset tooling uses one rule. */
export function normalizeRetrievalEvaluationText(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\s]+/gu, "");
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

function assertLabelProvenance(
  provenance: RetrievalEvaluationLabelProvenance,
  queryId: string,
): void {
  if (!provenance || typeof provenance !== "object") {
    throw new Error(`Retrieval evaluation query ${queryId} label provenance must be an object`);
  }
  if (provenance.kind === "human-reviewed") {
    if (
      !Number.isSafeInteger(provenance.independentReviewerCount) ||
      provenance.independentReviewerCount < 1
    ) {
      throw new Error(
        `Retrieval evaluation query ${queryId} human reviewer count must be a positive integer`,
      );
    }
    if (typeof provenance.adjudicated !== "boolean") {
      throw new Error(`Retrieval evaluation query ${queryId} adjudicated must be a boolean`);
    }
    return;
  }
  if (provenance.kind === "synthetic") {
    assertNonEmpty(
      provenance.generator,
      `Retrieval evaluation query ${queryId} synthetic generator`,
    );
    return;
  }
  throw new Error(`Retrieval evaluation query ${queryId} label provenance kind is unsupported`);
}

function assertLanguage(
  value: unknown,
  label: string,
): asserts value is BilingualRetrievalLanguage {
  if (value !== "zh" && value !== "en") {
    throw new Error(`${label} must be zh or en`);
  }
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function assertRankedContentUnitIds(
  rankedContentUnitIds: readonly string[],
  contentUnitById: ReadonlyMap<string, RetrievalEvaluationContentUnit>,
  limit: number,
  queryId: string,
): void {
  if (!Array.isArray(rankedContentUnitIds)) {
    throw new Error(
      `Retrieval evaluation retriever returned a non-array rank list for query ${queryId}`,
    );
  }
  if (rankedContentUnitIds.length > limit) {
    throw new Error(
      `Retrieval evaluation retriever returned more than the requested ${limit} ranks for query ${queryId}`,
    );
  }
  const seen = new Set<string>();
  for (const contentUnitId of rankedContentUnitIds) {
    assertNonEmpty(contentUnitId, `Retrieval evaluation retriever rank for query ${queryId}`);
    if (seen.has(contentUnitId)) {
      throw new Error(
        `Retrieval evaluation retriever returned ContentUnit ${contentUnitId} more than once for query ${queryId}`,
      );
    }
    seen.add(contentUnitId);
    if (!contentUnitById.has(contentUnitId)) {
      throw new Error(
        `Retrieval evaluation retriever returned out-of-corpus ContentUnit ${contentUnitId} for query ${queryId}`,
      );
    }
  }
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isMultiDocumentQuery(
  query: RetrievalEvaluationQuery,
  contentUnitById: ReadonlyMap<string, RetrievalEvaluationContentUnit>,
): boolean {
  return (
    new Set(
      query.relevanceJudgments.map((judgment) => {
        const unit = contentUnitById.get(judgment.contentUnitId);
        if (!unit)
          throw new Error(`Retrieval evaluation ContentUnit ${judgment.contentUnitId} is missing`);
        return unit.sourceId;
      }),
    ).size > 1
  );
}

function isRelevanceGrade(value: unknown): value is RetrievalRelevanceGrade {
  return value === 1 || value === 2 || value === 3;
}

function modeForQuery(query: RetrievalEvaluationQuery): RetrievalEvaluationMode {
  return query.language === query.targetLanguage ? "same-language" : "cross-language";
}

function normalizeCutoffs(cutoffs: readonly number[]): number[] {
  if (!Array.isArray(cutoffs) || cutoffs.length === 0) {
    throw new Error("Retrieval evaluation cutoffs must contain at least one positive integer");
  }
  const normalized = [...cutoffs];
  for (const cutoff of normalized) {
    if (!Number.isSafeInteger(cutoff) || cutoff < 1 || cutoff > 1_000) {
      throw new Error("Retrieval evaluation cutoffs must be integers between 1 and 1000");
    }
  }
  normalized.sort((left, right) => left - right);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1] === normalized[index]) {
      throw new Error("Retrieval evaluation cutoffs must not contain duplicates");
    }
  }
  return normalized;
}

function normalizeCandidateScope(value: unknown): RetrievalEvaluationCandidateScope {
  if (value !== "full-corpus" && value !== "target-language-only") {
    throw new Error(
      "Retrieval evaluation candidate scope must be full-corpus or target-language-only",
    );
  }
  return value;
}

function normalizeRunProvenance(
  provenance: RetrievalEvaluationRunProvenance,
): RetrievalEvaluationRunProvenance {
  if (!provenance || typeof provenance !== "object") {
    throw new Error("Retrieval evaluation run provenance must be an object");
  }
  return {
    chunker: normalizeProvenanceField(provenance.chunker, "chunker"),
    embeddingProfile: normalizeProvenanceField(provenance.embeddingProfile, "embedding profile"),
    extractor: normalizeProvenanceField(provenance.extractor, "extractor"),
    fusion: normalizeProvenanceField(provenance.fusion, "fusion"),
    generator: normalizeProvenanceField(provenance.generator, "generator"),
    prompt: normalizeProvenanceField(provenance.prompt, "prompt"),
    reranker: normalizeProvenanceField(provenance.reranker, "reranker"),
    vectorStore: normalizeProvenanceField(provenance.vectorStore, "VectorStore"),
  };
}

function normalizeProvenanceField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
    throw new Error(`Retrieval evaluation run ${label} provenance must be non-empty`);
  }
  return value.trim();
}

function queryFor(dataset: RetrievalEvaluationDataset, queryId: string): RetrievalEvaluationQuery {
  const query = dataset.queries.find((candidate) => candidate.id === queryId);
  if (!query) throw new Error(`Retrieval evaluation query ${queryId} is missing`);
  return query;
}

function scoreQuery(
  query: RetrievalEvaluationQuery,
  rankedContentUnitIds: readonly string[],
  cutoffs: readonly number[],
): RetrievalEvaluationMetricAtK[] {
  const relevanceByContentUnitId = new Map(
    query.relevanceJudgments.map((judgment) => [judgment.contentUnitId, judgment.relevance]),
  );
  const idealGrades = [...relevanceByContentUnitId.values()].sort((left, right) => right - left);

  return cutoffs.map((k) => {
    const ranks = rankedContentUnitIds.slice(0, k);
    let firstRelevantRank = 0;
    let relevantCount = 0;
    let dcg = 0;
    for (const [index, contentUnitId] of ranks.entries()) {
      const relevance = relevanceByContentUnitId.get(contentUnitId);
      if (!relevance) continue;
      const rank = index + 1;
      relevantCount += 1;
      if (!firstRelevantRank) firstRelevantRank = rank;
      dcg += (2 ** relevance - 1) / Math.log2(rank + 1);
    }
    const idealDcg = idealGrades
      .slice(0, k)
      .reduce((total, relevance, index) => total + (2 ** relevance - 1) / Math.log2(index + 2), 0);
    return {
      hitRate: firstRelevantRank ? 1 : 0,
      k,
      meanReciprocalRank: firstRelevantRank ? 1 / firstRelevantRank : 0,
      ndcg: idealDcg ? dcg / idealDcg : 0,
      recall: relevantCount / relevanceByContentUnitId.size,
    };
  });
}

function sliceForQuery(query: RetrievalEvaluationQuery): BilingualRetrievalSlice {
  if (query.language === "zh") return query.targetLanguage === "zh" ? "zh-zh" : "zh-en";
  return query.targetLanguage === "zh" ? "en-zh" : "en-en";
}

function textIdentityFor(text: unknown, label: string): string {
  assertNonEmpty(text, label);
  const identity = normalizeRetrievalEvaluationText(text);
  if (!/[\p{L}\p{N}]/u.test(identity)) {
    throw new Error(`${label} must contain letters or numbers`);
  }
  return identity;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
