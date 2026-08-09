import {
  BILINGUAL_RETRIEVAL_SLICES,
  MIN_RELEASE_RETRIEVAL_EVALUATION_DISCIPLINES,
  MIN_RELEASE_RETRIEVAL_EVALUATION_QUERIES,
  RETRIEVAL_EVALUATION_SCHEMA_VERSION,
  type BilingualRetrievalLanguage,
  type BilingualRetrievalSlice,
  type RetrievalEvaluationCandidateScope,
  type RetrievalEvaluationContentUnit,
  type RetrievalEvaluationDataset,
  type RetrievalEvaluationLabelProvenance,
  type RetrievalEvaluationMetricAtK,
  type RetrievalEvaluationMode,
  type RetrievalEvaluationQuery,
  type RetrievalEvaluationReleaseReadiness,
  type RetrievalEvaluationRunProvenance,
  type RetrievalRelevanceGrade,
} from "./retrieval-evaluation-contract.js";

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

export function assertLabelProvenance(
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

export function assertLanguage(
  value: unknown,
  label: string,
): asserts value is BilingualRetrievalLanguage {
  if (value !== "zh" && value !== "en") {
    throw new Error(`${label} must be zh or en`);
  }
}

export function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

export function assertRankedContentUnitIds(
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

export function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function isMultiDocumentQuery(
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

export function isRelevanceGrade(value: unknown): value is RetrievalRelevanceGrade {
  return value === 1 || value === 2 || value === 3;
}

export function modeForQuery(query: RetrievalEvaluationQuery): RetrievalEvaluationMode {
  return query.language === query.targetLanguage ? "same-language" : "cross-language";
}

export function normalizeCutoffs(cutoffs: readonly number[]): number[] {
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

export function normalizeCandidateScope(value: unknown): RetrievalEvaluationCandidateScope {
  if (value !== "full-corpus" && value !== "target-language-only") {
    throw new Error(
      "Retrieval evaluation candidate scope must be full-corpus or target-language-only",
    );
  }
  return value;
}

export function normalizeRunProvenance(
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

export function normalizeProvenanceField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
    throw new Error(`Retrieval evaluation run ${label} provenance must be non-empty`);
  }
  return value.trim();
}

export function queryFor(
  dataset: RetrievalEvaluationDataset,
  queryId: string,
): RetrievalEvaluationQuery {
  const query = dataset.queries.find((candidate) => candidate.id === queryId);
  if (!query) throw new Error(`Retrieval evaluation query ${queryId} is missing`);
  return query;
}

export function scoreQuery(
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

export function sliceForQuery(query: RetrievalEvaluationQuery): BilingualRetrievalSlice {
  if (query.language === "zh") return query.targetLanguage === "zh" ? "zh-zh" : "zh-en";
  return query.targetLanguage === "zh" ? "en-zh" : "en-en";
}

export function textIdentityFor(text: unknown, label: string): string {
  assertNonEmpty(text, label);
  const identity = normalizeRetrievalEvaluationText(text);
  if (!/[\p{L}\p{N}]/u.test(identity)) {
    throw new Error(`${label} must contain letters or numbers`);
  }
  return identity;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
