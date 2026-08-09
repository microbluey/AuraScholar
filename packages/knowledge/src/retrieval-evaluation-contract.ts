import type { EmbeddingProvider } from "./embedding.js";
import type { VectorStore } from "./vector-store.js";

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
