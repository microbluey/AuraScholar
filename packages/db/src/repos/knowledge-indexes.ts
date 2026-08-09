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

interface EmbeddingProfileStorageRow {
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

interface KnowledgeIndexStorageRow {
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

interface KnowledgeIndexEntryStorageRow {
  index_id: string;
  content_unit_id: string;
  content_hash: string;
  vector_ref: string | null;
  status: KnowledgeIndexEntryStatus;
  created_at: number | bigint;
  updated_at: number | bigint;
}

interface PendingKnowledgeIndexEntryStorageRow extends KnowledgeIndexEntryStorageRow {
  source_id: string;
  text: string;
}

const EMBEDDING_PROFILE_COLUMNS = `
  id, provider_kind, egress_mode, model_id, model_revision, dimension,
  distance_metric, normalization, chunk_profile_version, fingerprint, created_at`;

const KNOWLEDGE_INDEX_COLUMNS = `
  id, library_id, mode, embedding_profile_id, generation, status,
  source_change_seq, expected_count, indexed_count, created_at, activated_at,
  retired_at, error`;

const KNOWLEDGE_INDEX_ENTRY_COLUMNS = `
  index_id, content_unit_id, content_hash, vector_ref, status, created_at, updated_at`;

const KNOWLEDGE_INDEX_ENTRY_SELECT_COLUMNS = `
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

/**
 * Durable Library-scoped generation metadata. It deliberately does not create
 * a concrete vector table; the desktop adapter owns that optional native
 * capability and stores its row reference in `vectorRef` only after insertion.
 */
export class KnowledgeIndexesRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async get(indexId: string): Promise<KnowledgeIndexRow | null> {
    assertId(indexId, "Knowledge index id");
    return this.getInLibrary(indexId);
  }

  async getActive(): Promise<KnowledgeIndexRow | null> {
    const rows = await this.db.query<KnowledgeIndexStorageRow>(
      `SELECT ${KNOWLEDGE_INDEX_COLUMNS}
       FROM knowledge_indexes
       WHERE library_id = ? AND status = 'active'
       LIMIT 1`,
      [this.libraryId],
    );
    return rows[0] ? toKnowledgeIndexRow(rows[0]) : null;
  }

  /** Returns the Library's current durable Knowledge change high-water mark. */
  async getLatestSourceChangeSeq(): Promise<number> {
    const rows = await this.db.query<{ value: number | bigint }>(
      `SELECT COALESCE(MAX(seq), 0) AS value
       FROM knowledge_changes
       WHERE library_id = ?`,
      [this.libraryId],
    );
    return toCount(rows[0]?.value, "Knowledge change high-water mark");
  }

  /** Selects an active generation only when its immutable source snapshot is current. */
  async getActiveCurrent(): Promise<KnowledgeIndexRow | null> {
    const rows = await this.db.query<KnowledgeIndexStorageRow>(
      `SELECT ${KNOWLEDGE_INDEX_COLUMNS}
       FROM knowledge_indexes
       WHERE library_id = ?
         AND status = 'active'
         AND source_change_seq = (
           SELECT COALESCE(MAX(seq), 0)
           FROM knowledge_changes
           WHERE library_id = ?
         )
       LIMIT 1`,
      [this.libraryId, this.libraryId],
    );
    return rows[0] ? toKnowledgeIndexRow(rows[0]) : null;
  }

  async list(statuses?: readonly KnowledgeIndexStatus[]): Promise<KnowledgeIndexRow[]> {
    const clauses = ["library_id = ?"];
    const params: unknown[] = [this.libraryId];
    if (statuses !== undefined) {
      if (statuses.length === 0) return [];
      for (const status of statuses) assertKnownKnowledgeIndexStatus(status);
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    const rows = await this.db.query<KnowledgeIndexStorageRow>(
      `SELECT ${KNOWLEDGE_INDEX_COLUMNS}
       FROM knowledge_indexes
       WHERE ${clauses.join(" AND ")}
       ORDER BY generation DESC, id ASC`,
      params,
    );
    return rows.map(toKnowledgeIndexRow);
  }

  /**
   * Captures every currently ready ContentUnit into a new immutable generation.
   * Full-text entries are ready immediately; hybrid entries stay pending until
   * the native adapter writes a physical vector and records its reference.
   */
  async begin(input: BeginKnowledgeIndexInput): Promise<KnowledgeIndexRow> {
    const normalized = normalizeBeginInput(input);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_index_begin", async () => {
        await assertActiveLibrary(this.db, this.libraryId);
        await this.assertProfileForMode(normalized.mode, normalized.embeddingProfileId);
        const sourceChangeSeq = await this.resolveSourceChangeSeq(normalized.sourceChangeSeq);
        const units = await this.db.query<{ id: string; content_hash: string }>(
          `SELECT id, content_hash
           FROM content_units
           WHERE library_id = ? AND state = 'ready' AND deleted_at IS NULL
           ORDER BY id ASC`,
          [this.libraryId],
        );
        const generation = await this.nextGeneration();
        const indexId = newId();
        const entryStatus: KnowledgeIndexEntryStatus =
          normalized.mode === "fulltext" ? "ready" : "pending";
        const indexedCount = normalized.mode === "fulltext" ? units.length : 0;
        await this.db.run(
          `INSERT INTO knowledge_indexes
             (id, library_id, mode, embedding_profile_id, generation, status,
              source_change_seq, expected_count, indexed_count, created_at,
              activated_at, retired_at, error)
           VALUES (?, ?, ?, ?, ?, 'building', ?, ?, ?, ?, NULL, NULL, NULL)`,
          [
            indexId,
            this.libraryId,
            normalized.mode,
            normalized.embeddingProfileId,
            generation,
            sourceChangeSeq,
            units.length,
            indexedCount,
            normalized.now,
          ],
        );
        for (const unit of units) {
          await this.db.run(
            `INSERT INTO knowledge_index_entries
               (index_id, content_unit_id, content_hash, vector_ref, status, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?, ?)`,
            [indexId, unit.id, unit.content_hash, entryStatus, normalized.now, normalized.now],
          );
        }
        const index = await this.getInLibrary(indexId);
        if (!index) throw new Error("Knowledge index generation did not persist");
        return index;
      }),
    );
  }

  async listEntries(
    indexId: string,
    statuses?: readonly KnowledgeIndexEntryStatus[],
  ): Promise<KnowledgeIndexEntryRow[]> {
    await this.requireIndex(indexId);
    const clauses = ["index_id = ?"];
    const params: unknown[] = [indexId];
    if (statuses !== undefined) {
      if (statuses.length === 0) return [];
      for (const status of statuses) assertKnownKnowledgeIndexEntryStatus(status);
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    const rows = await this.db.query<KnowledgeIndexEntryStorageRow>(
      `SELECT ${KNOWLEDGE_INDEX_ENTRY_COLUMNS}
       FROM knowledge_index_entries
       WHERE ${clauses.join(" AND ")}
       ORDER BY content_unit_id ASC`,
      params,
    );
    return rows.map(toKnowledgeIndexEntryRow);
  }

  /** Returns only live, matching entries so an embedding worker never sees retired text. */
  async listPendingVectorEntries(
    indexId: string,
    options: { limit?: number } = {},
  ): Promise<PendingKnowledgeIndexEntry[]> {
    const index = await this.requireIndex(indexId);
    if (index.mode !== "hybrid" || index.status !== "building") {
      throw new Error("Only a building hybrid Knowledge index has pending vector entries");
    }
    const limit = normalizeLimit(options.limit, 100, "Pending Knowledge index entry limit");
    const rows = await this.db.query<PendingKnowledgeIndexEntryStorageRow>(
      `SELECT ${KNOWLEDGE_INDEX_ENTRY_SELECT_COLUMNS}, unit.source_id, unit.text
       FROM knowledge_index_entries entry
       JOIN content_units unit
         ON unit.id = entry.content_unit_id
        AND unit.library_id = ?
        AND unit.content_hash = entry.content_hash
        AND unit.state = 'ready'
        AND unit.deleted_at IS NULL
       WHERE entry.index_id = ? AND entry.status = 'pending'
       ORDER BY entry.content_unit_id ASC
       LIMIT ?`,
      [this.libraryId, indexId, limit],
    );
    return rows.map(toPendingKnowledgeIndexEntry);
  }

  /**
   * Resolves exactly one pending entry for a physical-vector write. Keeping the
   * source id and text behind this library-scoped lookup prevents a desktop
   * adapter from accepting an arbitrary ContentUnit/vector pairing.
   */
  async getPendingVectorEntry(
    indexId: string,
    contentUnitId: string,
  ): Promise<PendingKnowledgeIndexEntry | null> {
    assertId(contentUnitId, "Knowledge index ContentUnit id");
    const index = await this.requireIndex(indexId);
    if (index.mode !== "hybrid" || index.status !== "building") {
      throw new Error("Only a building hybrid Knowledge index has pending vector entries");
    }
    const rows = await this.db.query<PendingKnowledgeIndexEntryStorageRow>(
      `SELECT ${KNOWLEDGE_INDEX_ENTRY_SELECT_COLUMNS}, unit.source_id, unit.text
       FROM knowledge_index_entries entry
       JOIN content_units unit
         ON unit.id = entry.content_unit_id
        AND unit.library_id = ?
        AND unit.content_hash = entry.content_hash
        AND unit.state = 'ready'
        AND unit.deleted_at IS NULL
       WHERE entry.index_id = ?
         AND entry.content_unit_id = ?
         AND entry.status = 'pending'
       LIMIT 1`,
      [this.libraryId, indexId, contentUnitId],
    );
    return rows[0] ? toPendingKnowledgeIndexEntry(rows[0]) : null;
  }

  /** Records one physical vector only after its matching pending entry exists. */
  async markVectorReady(
    indexId: string,
    input: MarkKnowledgeIndexVectorReadyInput,
  ): Promise<KnowledgeIndexEntryRow> {
    assertId(indexId, "Knowledge index id");
    assertId(input.contentUnitId, "Knowledge index ContentUnit id");
    const vectorRef = normalizeText(input.vectorRef, "Knowledge vector reference", 512);
    const now = normalizeNow(input.now);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_index_vector_ready", async () => {
        const index = await this.requireIndex(indexId);
        if (index.mode !== "hybrid" || index.status !== "building") {
          throw new Error("Vectors can only be recorded for a building hybrid Knowledge index");
        }
        const duplicate = await this.db.query<{ content_unit_id: string }>(
          `SELECT content_unit_id
           FROM knowledge_index_entries
           WHERE index_id = ? AND vector_ref = ?
           LIMIT 1`,
          [indexId, vectorRef],
        );
        if (duplicate[0] && duplicate[0].content_unit_id !== input.contentUnitId) {
          throw new Error("Knowledge vector reference is already assigned inside this generation");
        }
        const changed = await this.db.run(
          `UPDATE knowledge_index_entries
           SET vector_ref = ?, status = 'ready', updated_at = MAX(updated_at + 1, ?)
           WHERE index_id = ? AND content_unit_id = ? AND status = 'pending'`,
          [vectorRef, now, indexId, input.contentUnitId],
        );
        if (changed !== 1) {
          throw new Error("Knowledge index entry is missing, retired, or already materialized");
        }
        const indexed = await this.db.run(
          `UPDATE knowledge_indexes
           SET indexed_count = indexed_count + 1
           WHERE id = ? AND library_id = ? AND status = 'building'
             AND indexed_count < expected_count`,
          [indexId, this.libraryId],
        );
        if (indexed !== 1) throw new Error("Knowledge index count could not be advanced");
        const entry = await this.getEntry(indexId, input.contentUnitId);
        if (!entry) throw new Error("Knowledge vector entry did not persist");
        return entry;
      }),
    );
  }

  /**
   * Atomically makes a complete generation current and retires the prior one.
   * Incomplete, deleted, or mismatched ContentUnits cannot be activated.
   */
  async activate(indexId: string, options: { now?: number } = {}): Promise<KnowledgeIndexRow> {
    assertId(indexId, "Knowledge index id");
    const now = normalizeNow(options.now);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_index_activate", async () => {
        const index = await this.requireIndex(indexId);
        if (index.status !== "building") {
          throw new Error("Only a building Knowledge index can be activated");
        }
        const latestSourceChangeSeq = await this.getLatestSourceChangeSeq();
        if (index.sourceChangeSeq !== latestSourceChangeSeq) {
          throw new Error("Knowledge index snapshot is stale and must be rebuilt");
        }
        const counts = await this.db.query<{
          total: number | bigint;
          ready: number | bigint;
        }>(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) AS ready
           FROM knowledge_index_entries
           WHERE index_id = ?`,
          [indexId],
        );
        const total = toCount(counts[0]?.total, "Knowledge index entry count");
        const ready = toCount(counts[0]?.ready, "ready Knowledge index entry count");
        if (total !== index.expectedCount || ready !== index.expectedCount) {
          throw new Error("Knowledge index cannot activate before every pinned entry is ready");
        }
        if (index.indexedCount !== index.expectedCount) {
          throw new Error("Knowledge index indexed count does not match its immutable snapshot");
        }
        const invalidRows = await this.db.query<{ n: number | bigint }>(
          `SELECT COUNT(*) AS n
           FROM knowledge_index_entries entry
           LEFT JOIN content_units unit ON unit.id = entry.content_unit_id
           WHERE entry.index_id = ?
             AND (
               unit.id IS NULL
               OR unit.library_id <> ?
               OR unit.deleted_at IS NOT NULL
               OR unit.state <> 'ready'
               OR unit.content_hash <> entry.content_hash
               OR entry.status <> 'ready'
               OR ( ? = 'hybrid' AND (entry.vector_ref IS NULL OR length(trim(entry.vector_ref)) = 0) )
             )`,
          [indexId, this.libraryId, index.mode],
        );
        if (toCount(invalidRows[0]?.n, "invalid Knowledge index entry count") !== 0) {
          throw new Error("Knowledge index cannot activate with stale or incompatible entries");
        }

        await this.db.run(
          `UPDATE knowledge_indexes
           SET status = 'retired', retired_at = COALESCE(retired_at, ?)
           WHERE library_id = ? AND status = 'active' AND id <> ?`,
          [now, this.libraryId, indexId],
        );
        const activated = await this.db.run(
          `UPDATE knowledge_indexes
           SET status = 'active', activated_at = ?, retired_at = NULL, error = NULL
           WHERE id = ? AND library_id = ? AND status = 'building'`,
          [now, indexId, this.libraryId],
        );
        if (activated !== 1) throw new Error("Knowledge index activation was superseded");
        const active = await this.getInLibrary(indexId);
        if (!active) throw new Error("Active Knowledge index did not persist");
        return active;
      }),
    );
  }

  /** Marks a failed build without disturbing the previously active generation. */
  async fail(indexId: string, error: unknown, options: { now?: number } = {}): Promise<boolean> {
    assertId(indexId, "Knowledge index id");
    const now = normalizeNow(options.now);
    const message = summarizeIndexError(error);
    return withDatabaseWriteLock(this.db, async () => {
      const changed = await this.db.run(
        `UPDATE knowledge_indexes
         SET status = 'failed', error = ?, retired_at = ?
         WHERE id = ? AND library_id = ? AND status = 'building'`,
        [message, now, indexId, this.libraryId],
      );
      return changed === 1;
    });
  }

  /** Explicitly stops serving an active or building generation. */
  async retire(indexId: string, options: { now?: number } = {}): Promise<boolean> {
    assertId(indexId, "Knowledge index id");
    const now = normalizeNow(options.now);
    return withDatabaseWriteLock(this.db, async () => {
      const changed = await this.db.run(
        `UPDATE knowledge_indexes
         SET status = 'retired', retired_at = COALESCE(retired_at, ?)
         WHERE id = ? AND library_id = ? AND status IN ('building', 'active')`,
        [now, indexId, this.libraryId],
      );
      return changed === 1;
    });
  }

  /**
   * Called only after the native adapter has removed an old physical namespace.
   * The generation record remains as a monotonic audit marker, but no longer
   * retains entry mappings or counts as materialized derived data.
   */
  async markGarbageCollected(indexId: string, options: { now?: number } = {}): Promise<boolean> {
    assertId(indexId, "Knowledge index id");
    const now = normalizeNow(options.now);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_index_gc", async () => {
        const index = await this.requireIndex(indexId);
        if (index.status !== "retired" && index.status !== "failed") {
          throw new Error("Only retired or failed Knowledge indexes can be garbage-collected");
        }
        await this.db.run(`DELETE FROM knowledge_index_entries WHERE index_id = ?`, [indexId]);
        const changed = await this.db.run(
          `UPDATE knowledge_indexes
           SET status = 'garbage-collected', indexed_count = 0,
               retired_at = COALESCE(retired_at, ?)
           WHERE id = ? AND library_id = ?
             AND status IN ('retired', 'failed')`,
          [now, indexId, this.libraryId],
        );
        return changed === 1;
      }),
    );
  }

  private async getInLibrary(indexId: string): Promise<KnowledgeIndexRow | null> {
    const rows = await this.db.query<KnowledgeIndexStorageRow>(
      `SELECT ${KNOWLEDGE_INDEX_COLUMNS}
       FROM knowledge_indexes
       WHERE id = ? AND library_id = ?
       LIMIT 1`,
      [indexId, this.libraryId],
    );
    return rows[0] ? toKnowledgeIndexRow(rows[0]) : null;
  }

  private async getEntry(
    indexId: string,
    contentUnitId: string,
  ): Promise<KnowledgeIndexEntryRow | null> {
    const rows = await this.db.query<KnowledgeIndexEntryStorageRow>(
      `SELECT ${KNOWLEDGE_INDEX_ENTRY_SELECT_COLUMNS}
       FROM knowledge_index_entries entry
       JOIN knowledge_indexes index_generation ON index_generation.id = entry.index_id
       WHERE entry.index_id = ?
         AND entry.content_unit_id = ?
         AND index_generation.library_id = ?
       LIMIT 1`,
      [indexId, contentUnitId, this.libraryId],
    );
    return rows[0] ? toKnowledgeIndexEntryRow(rows[0]) : null;
  }

  private async requireIndex(indexId: string): Promise<KnowledgeIndexRow> {
    assertId(indexId, "Knowledge index id");
    const index = await this.getInLibrary(indexId);
    if (!index) throw new Error("Knowledge index is missing or outside this Library");
    return index;
  }

  private async assertProfileForMode(
    mode: KnowledgeIndexMode,
    embeddingProfileId: string | null,
  ): Promise<void> {
    if (mode === "fulltext") {
      if (embeddingProfileId !== null) {
        throw new Error("Full-text Knowledge indexes must not select an embedding profile");
      }
      return;
    }
    if (!embeddingProfileId) {
      throw new Error("Hybrid Knowledge indexes require an embedding profile");
    }
    const profile = await new EmbeddingProfilesRepo(this.db).get(embeddingProfileId);
    if (!profile) throw new Error("Hybrid Knowledge index embedding profile is missing");
  }

  private async resolveSourceChangeSeq(requested: number | undefined): Promise<number> {
    const latest = await this.getLatestSourceChangeSeq();
    if (requested === undefined) return latest;
    assertNonNegativeSafeInteger(requested, "Knowledge index source change sequence");
    if (requested > latest) {
      throw new Error("Knowledge index source change sequence is ahead of this Library's outbox");
    }
    return requested;
  }

  private async nextGeneration(): Promise<number> {
    const generationRows = await this.db.query<{ value: number | bigint }>(
      `SELECT COALESCE(MAX(generation), 0) AS value
       FROM knowledge_indexes
       WHERE library_id = ?`,
      [this.libraryId],
    );
    const current = toCount(generationRows[0]?.value, "Knowledge index generation");
    if (current >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Knowledge index generation exceeds safe integer precision");
    }
    return current + 1;
  }
}

function normalizeEmbeddingProfileInput(input: EmbeddingProfileInput): EmbeddingProfileInput & {
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

function normalizeBeginInput(input: BeginKnowledgeIndexInput): BeginKnowledgeIndexInput & {
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

function toEmbeddingProfileRow(row: EmbeddingProfileStorageRow): EmbeddingProfileRow {
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

function toKnowledgeIndexRow(row: KnowledgeIndexStorageRow): KnowledgeIndexRow {
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

function toKnowledgeIndexEntryRow(row: KnowledgeIndexEntryStorageRow): KnowledgeIndexEntryRow {
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

function toPendingKnowledgeIndexEntry(
  row: PendingKnowledgeIndexEntryStorageRow,
): PendingKnowledgeIndexEntry {
  return { ...toKnowledgeIndexEntryRow(row), sourceId: row.source_id, text: row.text };
}

function sameEmbeddingProfile(
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

function summarizeIndexError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Index build failed";
  return message.replace(/\s+/g, " ").trim().slice(0, 1024) || "Index build failed";
}

function assertKnownKnowledgeIndexStatus(status: KnowledgeIndexStatus): void {
  if (!KNOWLEDGE_INDEX_STATUSES.includes(status)) {
    throw new Error(`Unsupported Knowledge index status: ${String(status)}`);
  }
}

function assertKnownKnowledgeIndexEntryStatus(status: KnowledgeIndexEntryStatus): void {
  if (!KNOWLEDGE_INDEX_ENTRY_STATUSES.includes(status)) {
    throw new Error(`Unsupported Knowledge index entry status: ${String(status)}`);
  }
}

async function assertActiveLibrary(db: Database, libraryId: string): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [libraryId],
  );
  if (!rows[0]) throw new Error(`Library ${libraryId} is missing or removed`);
}

function normalizeText(value: string, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a non-empty string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must be a non-empty string`);
  if (normalized.length > maxLength)
    throw new Error(`${label} must be at most ${maxLength} characters`);
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined,
  label: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  return normalizeText(value, label, maxLength);
}

function normalizeNow(value: number | undefined): number {
  const now = value ?? Date.now();
  assertNonNegativeSafeInteger(now, "Timestamp");
  return now;
}

function normalizeLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error(`${label} must be an integer between 1 and 1000`);
  }
  return limit;
}

function assertId(value: string, label: string): void {
  normalizeText(value, label, 512);
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function toCount(value: number | bigint | null | undefined, label: string): number {
  const numeric = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return numeric;
}
