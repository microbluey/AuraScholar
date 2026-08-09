import type { Database } from "../database.js";
import { newId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { withDatabaseWriteLock } from "./write-lock.js";
import * as Support from "./knowledge-index-support.js";

export * from "./knowledge-index-support.js";

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
    Support.assertId(libraryId, "Library id");
  }

  async get(indexId: string): Promise<Support.KnowledgeIndexRow | null> {
    Support.assertId(indexId, "Knowledge index id");
    return this.getInLibrary(indexId);
  }

  async getActive(): Promise<Support.KnowledgeIndexRow | null> {
    const rows = await this.db.query<Support.KnowledgeIndexStorageRow>(
      `SELECT ${Support.KNOWLEDGE_INDEX_COLUMNS}
       FROM knowledge_indexes
       WHERE library_id = ? AND status = 'active'
       LIMIT 1`,
      [this.libraryId],
    );
    return rows[0] ? Support.toKnowledgeIndexRow(rows[0]) : null;
  }

  /** Returns the Library's current durable Knowledge change high-water mark. */
  async getLatestSourceChangeSeq(): Promise<number> {
    const rows = await this.db.query<{ value: number | bigint }>(
      `SELECT COALESCE(MAX(seq), 0) AS value
       FROM knowledge_changes
       WHERE library_id = ?`,
      [this.libraryId],
    );
    return Support.toCount(rows[0]?.value, "Knowledge change high-water mark");
  }

  /** Selects an active generation only when its immutable source snapshot is current. */
  async getActiveCurrent(): Promise<Support.KnowledgeIndexRow | null> {
    const rows = await this.db.query<Support.KnowledgeIndexStorageRow>(
      `SELECT ${Support.KNOWLEDGE_INDEX_COLUMNS}
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
    return rows[0] ? Support.toKnowledgeIndexRow(rows[0]) : null;
  }

  async list(
    statuses?: readonly Support.KnowledgeIndexStatus[],
  ): Promise<Support.KnowledgeIndexRow[]> {
    const clauses = ["library_id = ?"];
    const params: unknown[] = [this.libraryId];
    if (statuses !== undefined) {
      if (statuses.length === 0) return [];
      for (const status of statuses) Support.assertKnownKnowledgeIndexStatus(status);
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    const rows = await this.db.query<Support.KnowledgeIndexStorageRow>(
      `SELECT ${Support.KNOWLEDGE_INDEX_COLUMNS}
       FROM knowledge_indexes
       WHERE ${clauses.join(" AND ")}
       ORDER BY generation DESC, id ASC`,
      params,
    );
    return rows.map(Support.toKnowledgeIndexRow);
  }

  /**
   * Captures every currently ready ContentUnit into a new immutable generation.
   * Full-text entries are ready immediately; hybrid entries stay pending until
   * the native adapter writes a physical vector and records its reference.
   */
  async begin(input: Support.BeginKnowledgeIndexInput): Promise<Support.KnowledgeIndexRow> {
    const normalized = Support.normalizeBeginInput(input);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_index_begin", async () => {
        await Support.assertActiveLibrary(this.db, this.libraryId);
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
        const entryStatus: Support.KnowledgeIndexEntryStatus =
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
    statuses?: readonly Support.KnowledgeIndexEntryStatus[],
  ): Promise<Support.KnowledgeIndexEntryRow[]> {
    await this.requireIndex(indexId);
    const clauses = ["index_id = ?"];
    const params: unknown[] = [indexId];
    if (statuses !== undefined) {
      if (statuses.length === 0) return [];
      for (const status of statuses) Support.assertKnownKnowledgeIndexEntryStatus(status);
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    const rows = await this.db.query<Support.KnowledgeIndexEntryStorageRow>(
      `SELECT ${Support.KNOWLEDGE_INDEX_ENTRY_COLUMNS}
       FROM knowledge_index_entries
       WHERE ${clauses.join(" AND ")}
       ORDER BY content_unit_id ASC`,
      params,
    );
    return rows.map(Support.toKnowledgeIndexEntryRow);
  }

  /** Returns only live, matching entries so an embedding worker never sees retired text. */
  async listPendingVectorEntries(
    indexId: string,
    options: { limit?: number } = {},
  ): Promise<Support.PendingKnowledgeIndexEntry[]> {
    const index = await this.requireIndex(indexId);
    if (index.mode !== "hybrid" || index.status !== "building") {
      throw new Error("Only a building hybrid Knowledge index has pending vector entries");
    }
    const limit = Support.normalizeLimit(options.limit, 100, "Pending Knowledge index entry limit");
    const rows = await this.db.query<Support.PendingKnowledgeIndexEntryStorageRow>(
      `SELECT ${Support.KNOWLEDGE_INDEX_ENTRY_SELECT_COLUMNS}, unit.source_id, unit.text
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
    return rows.map(Support.toPendingKnowledgeIndexEntry);
  }

  /**
   * Resolves exactly one pending entry for a physical-vector write. Keeping the
   * source id and text behind this library-scoped lookup prevents a desktop
   * adapter from accepting an arbitrary ContentUnit/vector pairing.
   */
  async getPendingVectorEntry(
    indexId: string,
    contentUnitId: string,
  ): Promise<Support.PendingKnowledgeIndexEntry | null> {
    Support.assertId(contentUnitId, "Knowledge index ContentUnit id");
    const index = await this.requireIndex(indexId);
    if (index.mode !== "hybrid" || index.status !== "building") {
      throw new Error("Only a building hybrid Knowledge index has pending vector entries");
    }
    const rows = await this.db.query<Support.PendingKnowledgeIndexEntryStorageRow>(
      `SELECT ${Support.KNOWLEDGE_INDEX_ENTRY_SELECT_COLUMNS}, unit.source_id, unit.text
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
    return rows[0] ? Support.toPendingKnowledgeIndexEntry(rows[0]) : null;
  }

  /** Records one physical vector only after its matching pending entry exists. */
  async markVectorReady(
    indexId: string,
    input: Support.MarkKnowledgeIndexVectorReadyInput,
  ): Promise<Support.KnowledgeIndexEntryRow> {
    Support.assertId(indexId, "Knowledge index id");
    Support.assertId(input.contentUnitId, "Knowledge index ContentUnit id");
    const vectorRef = Support.normalizeText(input.vectorRef, "Knowledge vector reference", 512);
    const now = Support.normalizeNow(input.now);
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
  async activate(
    indexId: string,
    options: { now?: number } = {},
  ): Promise<Support.KnowledgeIndexRow> {
    Support.assertId(indexId, "Knowledge index id");
    const now = Support.normalizeNow(options.now);
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
        const total = Support.toCount(counts[0]?.total, "Knowledge index entry count");
        const ready = Support.toCount(counts[0]?.ready, "ready Knowledge index entry count");
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
        if (Support.toCount(invalidRows[0]?.n, "invalid Knowledge index entry count") !== 0) {
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
    Support.assertId(indexId, "Knowledge index id");
    const now = Support.normalizeNow(options.now);
    const message = Support.summarizeIndexError(error);
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
    Support.assertId(indexId, "Knowledge index id");
    const now = Support.normalizeNow(options.now);
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
    Support.assertId(indexId, "Knowledge index id");
    const now = Support.normalizeNow(options.now);
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

  private async getInLibrary(indexId: string): Promise<Support.KnowledgeIndexRow | null> {
    const rows = await this.db.query<Support.KnowledgeIndexStorageRow>(
      `SELECT ${Support.KNOWLEDGE_INDEX_COLUMNS}
       FROM knowledge_indexes
       WHERE id = ? AND library_id = ?
       LIMIT 1`,
      [indexId, this.libraryId],
    );
    return rows[0] ? Support.toKnowledgeIndexRow(rows[0]) : null;
  }

  private async getEntry(
    indexId: string,
    contentUnitId: string,
  ): Promise<Support.KnowledgeIndexEntryRow | null> {
    const rows = await this.db.query<Support.KnowledgeIndexEntryStorageRow>(
      `SELECT ${Support.KNOWLEDGE_INDEX_ENTRY_SELECT_COLUMNS}
       FROM knowledge_index_entries entry
       JOIN knowledge_indexes index_generation ON index_generation.id = entry.index_id
       WHERE entry.index_id = ?
         AND entry.content_unit_id = ?
         AND index_generation.library_id = ?
       LIMIT 1`,
      [indexId, contentUnitId, this.libraryId],
    );
    return rows[0] ? Support.toKnowledgeIndexEntryRow(rows[0]) : null;
  }

  private async requireIndex(indexId: string): Promise<Support.KnowledgeIndexRow> {
    Support.assertId(indexId, "Knowledge index id");
    const index = await this.getInLibrary(indexId);
    if (!index) throw new Error("Knowledge index is missing or outside this Library");
    return index;
  }

  private async assertProfileForMode(
    mode: Support.KnowledgeIndexMode,
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
    const profile = await new Support.EmbeddingProfilesRepo(this.db).get(embeddingProfileId);
    if (!profile) throw new Error("Hybrid Knowledge index embedding profile is missing");
  }

  private async resolveSourceChangeSeq(requested: number | undefined): Promise<number> {
    const latest = await this.getLatestSourceChangeSeq();
    if (requested === undefined) return latest;
    Support.assertNonNegativeSafeInteger(requested, "Knowledge index source change sequence");
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
    const current = Support.toCount(generationRows[0]?.value, "Knowledge index generation");
    if (current >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Knowledge index generation exceeds safe integer precision");
    }
    return current + 1;
  }
}
