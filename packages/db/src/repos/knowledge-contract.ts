/** Canonical sources that can invalidate Knowledge Layer derived state. */
export const KNOWLEDGE_CHANGE_SOURCE_TYPES = [
  "work",
  "asset",
  "revision",
  "annotation",
  "evidence",
  "library",
] as const;
export type KnowledgeChangeSourceType = (typeof KNOWLEDGE_CHANGE_SOURCE_TYPES)[number];

export const KNOWLEDGE_CHANGE_KINDS = ["upsert", "delete", "reindex"] as const;
export type KnowledgeChangeKind = (typeof KNOWLEDGE_CHANGE_KINDS)[number];

export const KNOWLEDGE_JOB_KINDS = ["extract", "chunk", "embed", "remove", "reindex"] as const;
export type KnowledgeJobKind = (typeof KNOWLEDGE_JOB_KINDS)[number];

export const KNOWLEDGE_JOB_STATUSES = [
  "queued",
  "leased",
  "running",
  "retry-wait",
  "completed",
  "cancelled",
  "terminal-failed",
] as const;
export type KnowledgeJobStatus = (typeof KNOWLEDGE_JOB_STATUSES)[number];

/**
 * Structural mirror of the pure @aurascholar/knowledge ContentUnit contract.
 * Keeping it local preserves the lower-level DB package's dependency boundary;
 * objects built by that package are assignable here without adaptation.
 */
export const CONTENT_UNIT_SOURCE_TYPES = ["pdf", "annotation", "evidence"] as const;
export type ContentUnitSourceType = (typeof CONTENT_UNIT_SOURCE_TYPES)[number];

export const CONTENT_UNIT_STATES = ["ready", "context-only"] as const;
export type ContentUnitState = (typeof CONTENT_UNIT_STATES)[number];

export interface ContentUnit {
  id: string;
  libraryId: string;
  sourceType: ContentUnitSourceType;
  sourceId: string;
  workId: string | null;
  assetId: string | null;
  revisionId: string | null;
  parentUnitId: string | null;
  ordinal: number;
  headingPath: string[] | null;
  anchor: unknown;
  text: string;
  language: string | null;
  tokenCount: number | null;
  contentHash: string;
  extractorProfile: string;
  chunkProfile: string;
  state: ContentUnitState;
}

export interface ContentUnitRow extends ContentUnit {
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface KnowledgeChangeRow {
  seq: number;
  libraryId: string;
  sourceType: KnowledgeChangeSourceType;
  sourceId: string;
  changeKind: KnowledgeChangeKind;
  expectedRevisionId: string | null;
  expectedContentHash: string | null;
  createdAt: number;
}

export interface KnowledgeJobRow {
  id: string;
  libraryId: string;
  kind: KnowledgeJobKind;
  sourceType: KnowledgeChangeSourceType;
  sourceId: string;
  expectedRevisionId: string | null;
  expectedContentHash: string | null;
  indexId: string | null;
  sourceChangeSeq: number | null;
  dedupeKey: string;
  status: KnowledgeJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  progress: unknown | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AppendKnowledgeChangeInput {
  libraryId: string;
  sourceType: KnowledgeChangeSourceType;
  sourceId: string;
  changeKind: KnowledgeChangeKind;
  expectedRevisionId?: string | null;
  expectedContentHash?: string | null;
  createdAt?: number;
}

export interface EnqueueKnowledgeJobInput {
  kind: KnowledgeJobKind;
  sourceType: KnowledgeChangeSourceType;
  sourceId: string;
  expectedRevisionId?: string | null;
  expectedContentHash?: string | null;
  indexId?: string | null;
  /** Links exactly one durable job to an outbox change. */
  sourceChangeSeq?: number | null;
  /** Dedupe applies only while a matching job is active. */
  dedupeKey?: string;
  maxAttempts?: number;
  availableAt?: number;
  progress?: unknown | null;
}

export interface ClaimKnowledgeJobOptions {
  now?: number;
  leaseMs?: number;
}

export interface KnowledgeJobLeaseOptions {
  now?: number;
  leaseMs?: number;
}

export interface FailKnowledgeJobOptions {
  now?: number;
  /** Useful for deterministic tests; production callers normally omit it. */
  retryDelayMs?: number;
}

export interface CancelKnowledgeJobOptions {
  now?: number;
  /** Optional worker ownership guard for a cooperative cancellation. */
  owner?: string;
}

export interface ReplaceContentUnitsInput {
  sourceType: ContentUnitSourceType;
  sourceId: string;
  /** When supplied, only this revision's prior units are retired. */
  revisionId?: string | null;
  units: readonly ContentUnit[];
}

/** Library-scoped filters for anchored ContentUnit full-text retrieval. */
export interface SearchContentUnitsInput {
  query: string;
  limit?: number;
  sourceTypes?: readonly ContentUnitSourceType[];
  sourceId?: string;
  workId?: string;
  assetId?: string;
  revisionId?: string;
  /** Excluded by default because these units are not suitable for direct citation. */
  includeContextOnly?: boolean;
}

export interface ContentUnitSearchResult extends ContentUnitRow {
  /** Positive BM25 relevance score; higher is a closer text match. */
  score: number;
  /** A compact plain-text FTS excerpt, preserving the full source anchor separately. */
  excerpt: string;
  /** Current Library title for a work-bound source; absent for standalone units. */
  workTitle: string | null;
}

/**
 * Active ContentUnit counts used to plan a future per-Library semantic index.
 * Retired units are intentionally excluded so estimates match a rebuild.
 */
export interface ContentUnitIndexStats {
  total: number;
  ready: number;
  contextOnly: number;
  sourceCounts: Record<ContentUnitSourceType, number>;
  /**
   * Effective language labels for the citation-safe corpus. `zh` and `en`
   * match the two languages supported by explicit retrieval preference.
   */
  languageCoverage: ContentUnitLanguageCoverage;
}

export interface ContentUnitLanguageCoverage {
  zh: number;
  en: number;
  /** A non-empty effective label outside the currently supported zh/en pair. */
  other: number;
  /** No explicit ContentUnit or inherited current Work language label. */
  missing: number;
}

export interface ContentUnitStorageRow {
  id: string;
  library_id: string;
  source_type: ContentUnitSourceType;
  source_id: string;
  work_id: string | null;
  asset_id: string | null;
  revision_id: string | null;
  parent_unit_id: string | null;
  ordinal: number;
  heading_path_json: string | null;
  anchor_json: string;
  text: string;
  language: string | null;
  token_count: number | null;
  content_hash: string;
  extractor_profile: string;
  chunk_profile: string;
  state: ContentUnit["state"];
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface ContentUnitSearchStorageRow extends ContentUnitStorageRow {
  score: number;
  excerpt: string;
  work_title: string | null;
}

export interface ContentUnitIndexStatsStorageRow {
  total: number | bigint;
  ready: number | bigint;
  context_only: number | bigint;
  pdf_count: number | bigint;
  annotation_count: number | bigint;
  evidence_count: number | bigint;
  zh_language_count: number | bigint;
  en_language_count: number | bigint;
  other_language_count: number | bigint;
  missing_language_count: number | bigint;
}

export interface KnowledgeChangeStorageRow {
  seq: number;
  library_id: string;
  source_type: KnowledgeChangeSourceType;
  source_id: string;
  change_kind: KnowledgeChangeKind;
  expected_revision_id: string | null;
  expected_content_hash: string | null;
  created_at: number;
}

export interface KnowledgeJobStorageRow {
  id: string;
  library_id: string;
  kind: KnowledgeJobKind;
  source_type: KnowledgeChangeSourceType;
  source_id: string;
  expected_revision_id: string | null;
  expected_content_hash: string | null;
  index_id: string | null;
  source_change_seq: number | null;
  dedupe_key: string;
  status: KnowledgeJobStatus;
  attempts: number;
  max_attempts: number;
  available_at: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  progress_json: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}
