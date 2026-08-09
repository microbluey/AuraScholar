import type { Database } from "../database.js";
import { newId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { withDatabaseWriteLock } from "./write-lock.js";

export const EMBEDDING_EGRESS_MODES = ["local", "remote"] as const;
export type EmbeddingEgressMode = (typeof EMBEDDING_EGRESS_MODES)[number];

export const EMBEDDING_DISTANCE_METRICS = ["cosine", "dot", "l2"] as const;
export type EmbeddingDistanceMetric = (typeof EMBEDDING_DISTANCE_METRICS)[number];

export const EMBEDDING_NORMALIZATIONS = ["l2", "none"] as const;
export type EmbeddingNormalization = (typeof EMBEDDING_NORMALIZATIONS)[number];

export const KNOWLEDGE_INDEX_MODES = ["fulltext", "hybrid"] as const;
export type KnowledgeIndexMode = (typeof KNOWLEDGE_INDEX_MODES)[number];

export const KNOWLEDGE_INDEX_STATUSES = [
  "building",
  "active",
  "retired",
  "failed",
  "garbage-collected",
] as const;
export type KnowledgeIndexStatus = (typeof KNOWLEDGE_INDEX_STATUSES)[number];

export const KNOWLEDGE_INDEX_ENTRY_STATUSES = ["pending", "ready", "retired"] as const;
export type KnowledgeIndexEntryStatus = (typeof KNOWLEDGE_INDEX_ENTRY_STATUSES)[number];

/**
 * Fingerprints are caller-provided hashes/identifiers of every compatibility
 * input (provider, model/revision, dimension, normalization, distance, and
 * chunk profile). A matching dimension alone is intentionally insufficient.
 */
export interface EmbeddingProfileInput {
  providerKind: string;
  egressMode: EmbeddingEgressMode;
  modelId: string;
  modelRevision?: string | null;
  dimension: number;
  distanceMetric: EmbeddingDistanceMetric;
  normalization: EmbeddingNormalization;
  chunkProfileVersion: string;
  fingerprint: string;
  createdAt?: number;
}

export interface EmbeddingProfileRow {
  id: string;
  providerKind: string;
  egressMode: EmbeddingEgressMode;
  modelId: string;
  modelRevision: string | null;
  dimension: number;
  distanceMetric: EmbeddingDistanceMetric;
  normalization: EmbeddingNormalization;
  chunkProfileVersion: string;
  fingerprint: string;
  createdAt: number;
}

export interface BeginKnowledgeIndexInput {
  mode: KnowledgeIndexMode;
  /** Required only for a hybrid generation. */
  embeddingProfileId?: string | null;
  /** A stable outbox high-water mark; defaults to the latest local sequence. */
  sourceChangeSeq?: number;
  now?: number;
}

export interface KnowledgeIndexRow {
  id: string;
  libraryId: string;
  mode: KnowledgeIndexMode;
  embeddingProfileId: string | null;
  generation: number;
  status: KnowledgeIndexStatus;
  sourceChangeSeq: number;
  expectedCount: number;
  indexedCount: number;
  createdAt: number;
  activatedAt: number | null;
  retiredAt: number | null;
  error: string | null;
}

export interface KnowledgeIndexEntryRow {
  indexId: string;
  contentUnitId: string;
  contentHash: string;
  vectorRef: string | null;
  status: KnowledgeIndexEntryStatus;
  createdAt: number;
  updatedAt: number;
}

/** A pending ContentUnit snapshot consumed by a future embedding worker. */
export interface PendingKnowledgeIndexEntry extends KnowledgeIndexEntryRow {
  sourceId: string;
  text: string;
}

export interface MarkKnowledgeIndexVectorReadyInput {
  contentUnitId: string;
  /** Adapter-owned physical reference, e.g. a sqlite-vec rowid. */
  vectorRef: string;
  now?: number;
}

/** @internal */
export interface EmbeddingProfileStorageRow {
  id: string;
  provider_kind: string;
  egress_mode: EmbeddingEgressMode;
  model_id: string;
  model_revision: string | null;
  dimension: number | bigint;
  distance_metric: EmbeddingDistanceMetric;
  normalization: EmbeddingNormalization;
  chunk_profile_version: string;
  fingerprint: string;
  created_at: number | bigint;
}

/** @internal */
export interface KnowledgeIndexStorageRow {
  id: string;
  library_id: string;
  mode: KnowledgeIndexMode;
  embedding_profile_id: string | null;
  generation: number | bigint;
  status: KnowledgeIndexStatus;
  source_change_seq: number | bigint;
  expected_count: number | bigint;
  indexed_count: number | bigint;
  created_at: number | bigint;
  activated_at: number | bigint | null;
  retired_at: number | bigint | null;
  error: string | null;
}

/** @internal */
export interface KnowledgeIndexEntryStorageRow {
  index_id: string;
  content_unit_id: string;
  content_hash: string;
  vector_ref: string | null;
  status: KnowledgeIndexEntryStatus;
  created_at: number | bigint;
  updated_at: number | bigint;
}

/** @internal */
export interface PendingKnowledgeIndexEntryStorageRow extends KnowledgeIndexEntryStorageRow {
  source_id: string;
  text: string;
}

/** @internal */
export const EMBEDDING_PROFILE_COLUMNS = `
  id, provider_kind, egress_mode, model_id, model_revision, dimension,
  distance_metric, normalization, chunk_profile_version, fingerprint, created_at`;

/** @internal */
export const KNOWLEDGE_INDEX_COLUMNS = `
  id, library_id, mode, embedding_profile_id, generation, status,
  source_change_seq, expected_count, indexed_count, created_at, activated_at,
  retired_at, error`;

/** @internal */
export const KNOWLEDGE_INDEX_ENTRY_COLUMNS = `
  index_id, content_unit_id, content_hash, vector_ref, status, created_at, updated_at`;

/** @internal */
export const KNOWLEDGE_INDEX_ENTRY_SELECT_COLUMNS = `
  entry.index_id, entry.content_unit_id, entry.content_hash, entry.vector_ref,
  entry.status, entry.created_at, entry.updated_at`;

/** Global profile catalog. It contains configuration fingerprints, never source text. */
export class EmbeddingProfilesRepo {
  constructor(private readonly db: Database) {}

  async get(profileId: string): Promise<EmbeddingProfileRow | null> {
    assertId(profileId, "Embedding profile id");
    const rows = await this.db.query<EmbeddingProfileStorageRow>(
      `SELECT ${EMBEDDING_PROFILE_COLUMNS}
       FROM embedding_profiles
       WHERE id = ?
       LIMIT 1`,
      [profileId],
    );
    return rows[0] ? toEmbeddingProfileRow(rows[0]) : null;
  }

  async register(input: EmbeddingProfileInput): Promise<EmbeddingProfileRow> {
    const normalized = normalizeEmbeddingProfileInput(input);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "embedding_profile_register", async () => {
        const existingRows = await this.db.query<EmbeddingProfileStorageRow>(
          `SELECT ${EMBEDDING_PROFILE_COLUMNS}
           FROM embedding_profiles
           WHERE fingerprint = ?
           LIMIT 1`,
          [normalized.fingerprint],
        );
        const existing = existingRows[0] ? toEmbeddingProfileRow(existingRows[0]) : null;
        if (existing) {
          if (!sameEmbeddingProfile(existing, normalized)) {
            throw new Error(
              "Embedding profile fingerprint conflicts with a different immutable profile",
            );
          }
          return existing;
        }

        const id = newId();
        await this.db.run(
          `INSERT INTO embedding_profiles
             (id, provider_kind, egress_mode, model_id, model_revision, dimension,
              distance_metric, normalization, chunk_profile_version, fingerprint, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            normalized.providerKind,
            normalized.egressMode,
            normalized.modelId,
            normalized.modelRevision,
            normalized.dimension,
            normalized.distanceMetric,
            normalized.normalization,
            normalized.chunkProfileVersion,
            normalized.fingerprint,
            normalized.createdAt,
          ],
        );
        const profile = await this.get(id);
        if (!profile) throw new Error("Embedding profile write did not persist");
        return profile;
      }),
    );
  }
}

/** @internal */
export function normalizeEmbeddingProfileInput(
  input: EmbeddingProfileInput,
): EmbeddingProfileInput & {
  modelRevision: string | null;
  createdAt: number;
} {
  const providerKind = normalizeText(input.providerKind, "Embedding provider kind", 128);
  const modelId = normalizeText(input.modelId, "Embedding model id", 512);
  const modelRevision = normalizeOptionalText(input.modelRevision, "Embedding model revision", 512);
  const chunkProfileVersion = normalizeText(
    input.chunkProfileVersion,
    "Embedding chunk profile version",
    512,
  );
  const fingerprint = normalizeText(input.fingerprint, "Embedding profile fingerprint", 512);
  assertPositiveSafeInteger(input.dimension, "Embedding dimension");
  if (input.dimension > 8_192) throw new Error("Embedding dimension must not exceed 8192");
  if (!EMBEDDING_EGRESS_MODES.includes(input.egressMode)) {
    throw new Error(`Unsupported embedding egress mode: ${String(input.egressMode)}`);
  }
  if (!EMBEDDING_DISTANCE_METRICS.includes(input.distanceMetric)) {
    throw new Error(`Unsupported embedding distance metric: ${String(input.distanceMetric)}`);
  }
  if (!EMBEDDING_NORMALIZATIONS.includes(input.normalization)) {
    throw new Error(`Unsupported embedding normalization: ${String(input.normalization)}`);
  }
  return {
    ...input,
    providerKind,
    modelId,
    modelRevision,
    chunkProfileVersion,
    fingerprint,
    createdAt: normalizeNow(input.createdAt),
  };
}

/** @internal */
export function normalizeBeginInput(input: BeginKnowledgeIndexInput): BeginKnowledgeIndexInput & {
  embeddingProfileId: string | null;
  now: number;
} {
  if (!KNOWLEDGE_INDEX_MODES.includes(input.mode)) {
    throw new Error(`Unsupported Knowledge index mode: ${String(input.mode)}`);
  }
  const embeddingProfileId =
    input.embeddingProfileId === undefined || input.embeddingProfileId === null
      ? null
      : normalizeText(input.embeddingProfileId, "Knowledge index embedding profile id", 512);
  if (input.sourceChangeSeq !== undefined) {
    assertNonNegativeSafeInteger(input.sourceChangeSeq, "Knowledge index source change sequence");
  }
  return { ...input, embeddingProfileId, now: normalizeNow(input.now) };
}

/** @internal */
export function toEmbeddingProfileRow(row: EmbeddingProfileStorageRow): EmbeddingProfileRow {
  return {
    id: row.id,
    providerKind: row.provider_kind,
    egressMode: row.egress_mode,
    modelId: row.model_id,
    modelRevision: row.model_revision,
    dimension: toCount(row.dimension, "Embedding profile dimension"),
    distanceMetric: row.distance_metric,
    normalization: row.normalization,
    chunkProfileVersion: row.chunk_profile_version,
    fingerprint: row.fingerprint,
    createdAt: toCount(row.created_at, "Embedding profile created time"),
  };
}

/** @internal */
export function toKnowledgeIndexRow(row: KnowledgeIndexStorageRow): KnowledgeIndexRow {
  return {
    id: row.id,
    libraryId: row.library_id,
    mode: row.mode,
    embeddingProfileId: row.embedding_profile_id,
    generation: toCount(row.generation, "Knowledge index generation"),
    status: row.status,
    sourceChangeSeq: toCount(row.source_change_seq, "Knowledge index source change sequence"),
    expectedCount: toCount(row.expected_count, "Knowledge index expected count"),
    indexedCount: toCount(row.indexed_count, "Knowledge index indexed count"),
    createdAt: toCount(row.created_at, "Knowledge index created time"),
    activatedAt:
      row.activated_at === null
        ? null
        : toCount(row.activated_at, "Knowledge index activation time"),
    retiredAt:
      row.retired_at === null ? null : toCount(row.retired_at, "Knowledge index retirement time"),
    error: row.error,
  };
}

/** @internal */
export function toKnowledgeIndexEntryRow(
  row: KnowledgeIndexEntryStorageRow,
): KnowledgeIndexEntryRow {
  return {
    indexId: row.index_id,
    contentUnitId: row.content_unit_id,
    contentHash: row.content_hash,
    vectorRef: row.vector_ref,
    status: row.status,
    createdAt: toCount(row.created_at, "Knowledge index entry created time"),
    updatedAt: toCount(row.updated_at, "Knowledge index entry updated time"),
  };
}

/** @internal */
export function toPendingKnowledgeIndexEntry(
  row: PendingKnowledgeIndexEntryStorageRow,
): PendingKnowledgeIndexEntry {
  return { ...toKnowledgeIndexEntryRow(row), sourceId: row.source_id, text: row.text };
}

/** @internal */
export function sameEmbeddingProfile(
  stored: EmbeddingProfileRow,
  input: ReturnType<typeof normalizeEmbeddingProfileInput>,
): boolean {
  return (
    stored.providerKind === input.providerKind &&
    stored.egressMode === input.egressMode &&
    stored.modelId === input.modelId &&
    stored.modelRevision === input.modelRevision &&
    stored.dimension === input.dimension &&
    stored.distanceMetric === input.distanceMetric &&
    stored.normalization === input.normalization &&
    stored.chunkProfileVersion === input.chunkProfileVersion
  );
}

/** @internal */
export function summarizeIndexError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Index build failed";
  return message.replace(/\s+/g, " ").trim().slice(0, 1024) || "Index build failed";
}

/** @internal */
export function assertKnownKnowledgeIndexStatus(status: KnowledgeIndexStatus): void {
  if (!KNOWLEDGE_INDEX_STATUSES.includes(status)) {
    throw new Error(`Unsupported Knowledge index status: ${String(status)}`);
  }
}

/** @internal */
export function assertKnownKnowledgeIndexEntryStatus(status: KnowledgeIndexEntryStatus): void {
  if (!KNOWLEDGE_INDEX_ENTRY_STATUSES.includes(status)) {
    throw new Error(`Unsupported Knowledge index entry status: ${String(status)}`);
  }
}

/** @internal */
export async function assertActiveLibrary(db: Database, libraryId: string): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [libraryId],
  );
  if (!rows[0]) throw new Error(`Library ${libraryId} is missing or removed`);
}

/** @internal */
export function normalizeText(value: string, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a non-empty string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must be a non-empty string`);
  if (normalized.length > maxLength)
    throw new Error(`${label} must be at most ${maxLength} characters`);
  return normalized;
}

/** @internal */
export function normalizeOptionalText(
  value: string | null | undefined,
  label: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeText(value, label, maxLength);
}

/** @internal */
export function normalizeNow(value: number | undefined): number {
  const now = value ?? Date.now();
  assertNonNegativeSafeInteger(now, "Timestamp");
  return now;
}

/** @internal */
export function normalizeLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error(`${label} must be an integer between 1 and 1000`);
  }
  return limit;
}

/** @internal */
export function assertId(value: string, label: string): void {
  normalizeText(value, label, 512);
}

/** @internal */
export function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

/** @internal */
export function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

/** @internal */
export function toCount(value: number | bigint | null | undefined, label: string): number {
  const numeric = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return numeric;
}
