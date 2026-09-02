import type { ContentUnitSourceType } from "@aurascholar/db/repos/knowledge";

/**
 * User-selected corpus scope. The renderer may choose a scope, but it never
 * submits the resolved source allowlist; the main process captures that list
 * from canonical Library rows for this request.
 */
export type KnowledgeCorpusScope =
  | { kind: "library" }
  | { kind: "project"; projectId: string }
  | { kind: "works"; workIds: string[] }
  | { kind: "asset"; assetId: string };

/**
 * Filters for grounded, source-anchored retrieval from the local Knowledge
 * Layer. Omitted filters leave that dimension unrestricted within the selected
 * corpus scope (or the whole Library when scope is omitted).
 */
export interface SearchKnowledgeContentCommandInput {
  libraryId: string;
  query: string;
  /** Defaults to the whole active Library for backwards compatibility. */
  scope?: KnowledgeCorpusScope;
  limit?: number;
  sourceTypes?: ContentUnitSourceType[];
  sourceId?: string;
  workId?: string;
  assetId?: string;
  revisionId?: string;
  includeContextOnly?: boolean;
}

/**
 * Renderer-safe projection of a ContentUnit FTS result. `anchor` is retained
 * verbatim so a caller can navigate to its PDF/evidence/annotation origin.
 */
export interface KnowledgeContentSearchResult {
  id: string;
  sourceType: ContentUnitSourceType;
  sourceId: string;
  workId: string | null;
  workTitle: string | null;
  assetId: string | null;
  revisionId: string | null;
  parentUnitId: string | null;
  ordinal: number;
  headingPath: string[] | null;
  anchor: unknown;
  text: string;
  language: string | null;
  tokenCount: number | null;
  state: "ready" | "context-only";
  score: number;
  excerpt: string;
}

/** Retrieval capability state, never a relevance/confidence score. */
export type KnowledgeContentSearchMode = "fulltext" | "hybrid";
export type KnowledgeSemanticSearchStatus = "not-configured" | "unavailable" | "used";
export type KnowledgeContentSearchLanguage = "zh" | "en";

export interface KnowledgeContentSearchLanguagePreference {
  /** Language explicitly requested for source material, not answer generation. */
  requestedLanguage: KnowledgeContentSearchLanguage;
  /** True only when at least one candidate carried a matching known label. */
  applied: boolean;
}

export interface KnowledgeContentSearchRetrieval {
  mode: KnowledgeContentSearchMode;
  semanticStatus: KnowledgeSemanticSearchStatus;
  languagePreference?: KnowledgeContentSearchLanguagePreference;
}

/** Effective language labels for citation-safe ContentUnits in a local Library. */
export interface KnowledgeContentIndexLanguageCoverage {
  zh: number;
  en: number;
  other: number;
  missing: number;
}

/** Active, Library-scoped corpus counts used by the semantic-index planner. */
export interface KnowledgeContentIndexStats {
  totalContentUnits: number;
  readyContentUnits: number;
  contextOnlyContentUnits: number;
  sourceCounts: Record<ContentUnitSourceType, number>;
  /** Labels recognized by the product's explicit zh/en material preference. */
  languageCoverage: KnowledgeContentIndexLanguageCoverage;
}

/** Renderer-safe state for the fixed local semantic-index generation. */
export interface KnowledgeSemanticIndexSummary {
  expectedCount: number;
  id: string;
  indexedCount: number;
  /** True when newer Library changes exist beyond this generation snapshot. */
  stale: boolean;
  status: "active" | "building" | "failed";
}

export interface KnowledgeSemanticIndexStatus {
  active: KnowledgeSemanticIndexSummary | null;
  building: KnowledgeSemanticIndexSummary | null;
  failed: KnowledgeSemanticIndexSummary | null;
}

export interface BuildKnowledgeSemanticIndexResult {
  created: boolean;
  index: KnowledgeSemanticIndexSummary;
  job: { id: string; status: "queued" | "leased" | "running" | "retry-wait" };
}
