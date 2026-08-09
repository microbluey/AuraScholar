import type { Database } from "../database.js";
import { buildFtsPrefixQuery } from "../fts.js";
import { newId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { withDatabaseWriteLock } from "./write-lock.js";

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

interface ContentUnitStorageRow {
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

interface ContentUnitSearchStorageRow extends ContentUnitStorageRow {
  score: number;
  excerpt: string;
  work_title: string | null;
}

interface ContentUnitIndexStatsStorageRow {
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

interface KnowledgeChangeStorageRow {
  seq: number;
  library_id: string;
  source_type: KnowledgeChangeSourceType;
  source_id: string;
  change_kind: KnowledgeChangeKind;
  expected_revision_id: string | null;
  expected_content_hash: string | null;
  created_at: number;
}

interface KnowledgeJobStorageRow {
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

/**
 * Appends an outbox record without acquiring a second lock or transaction.
 * Canonical repositories call this inside their existing savepoint so source
 * mutation and invalidation either commit or roll back together.
 */
export async function appendKnowledgeChangeInTransaction(
  db: Database,
  input: AppendKnowledgeChangeInput,
): Promise<KnowledgeChangeRow> {
  const normalized = normalizeChangeInput(input);
  await assertActiveLibrary(db, normalized.libraryId);
  await db.run(
    `INSERT INTO knowledge_changes
       (library_id, source_type, source_id, change_kind,
        expected_revision_id, expected_content_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized.libraryId,
      normalized.sourceType,
      normalized.sourceId,
      normalized.changeKind,
      normalized.expectedRevisionId,
      normalized.expectedContentHash,
      normalized.createdAt,
    ],
  );
  const seq = Number(await db.queryScalar("SELECT last_insert_rowid()"));
  if (!Number.isSafeInteger(seq) || seq <= 0) {
    throw new Error("Knowledge change did not receive a durable sequence number");
  }
  return {
    seq,
    libraryId: normalized.libraryId,
    sourceType: normalized.sourceType,
    sourceId: normalized.sourceId,
    changeKind: normalized.changeKind,
    expectedRevisionId: normalized.expectedRevisionId,
    expectedContentHash: normalized.expectedContentHash,
    createdAt: normalized.createdAt,
  };
}

export class KnowledgeChangesRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async append(input: Omit<AppendKnowledgeChangeInput, "libraryId">): Promise<KnowledgeChangeRow> {
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_change_append", () =>
        appendKnowledgeChangeInTransaction(this.db, { ...input, libraryId: this.libraryId }),
      ),
    );
  }

  async list(options: { afterSeq?: number; limit?: number } = {}): Promise<KnowledgeChangeRow[]> {
    const afterSeq = options.afterSeq ?? 0;
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new Error("afterSeq must be a non-negative integer");
    }
    const limit = normalizeLimit(options.limit, 100, "limit");
    const rows = await this.db.query<KnowledgeChangeStorageRow>(
      `SELECT seq, library_id, source_type, source_id, change_kind,
              expected_revision_id, expected_content_hash, created_at
       FROM knowledge_changes
       WHERE library_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`,
      [this.libraryId, afterSeq, limit],
    );
    return rows.map(toKnowledgeChangeRow);
  }
}

/** Durable, library-scoped queue for derived Knowledge Layer work. */
export class KnowledgeJobsRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async get(jobId: string): Promise<KnowledgeJobRow | null> {
    assertId(jobId, "Knowledge job id");
    return this.getInLibrary(jobId);
  }

  async list(
    options: {
      statuses?: readonly KnowledgeJobStatus[];
      sourceType?: KnowledgeChangeSourceType;
      sourceId?: string;
      limit?: number;
    } = {},
  ): Promise<KnowledgeJobRow[]> {
    const clauses = ["library_id = ?"];
    const params: unknown[] = [this.libraryId];
    if (options.statuses?.length) {
      for (const status of options.statuses) assertKnownStatus(status);
      clauses.push(`status IN (${options.statuses.map(() => "?").join(", ")})`);
      params.push(...options.statuses);
    }
    if (options.sourceType !== undefined) {
      assertKnownChangeSourceType(options.sourceType);
      clauses.push("source_type = ?");
      params.push(options.sourceType);
    }
    if (options.sourceId !== undefined) {
      assertId(options.sourceId, "Knowledge job source id");
      clauses.push("source_id = ?");
      params.push(options.sourceId);
    }
    const limit = normalizeLimit(options.limit, 100, "limit");
    params.push(limit);
    const rows = await this.db.query<KnowledgeJobStorageRow>(
      `SELECT ${KNOWLEDGE_JOB_COLUMNS}
       FROM knowledge_jobs
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
      params,
    );
    return rows.map(toKnowledgeJobRow);
  }

  /**
   * Enqueues a job once. A matching active dedupe key returns the existing
   * job, and a sourceChangeSeq can only ever produce one job.
   */
  async enqueue(
    input: EnqueueKnowledgeJobInput,
  ): Promise<{ job: KnowledgeJobRow; created: boolean }> {
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_enqueue", async () => {
        await assertActiveLibrary(this.db, this.libraryId);
        return this.enqueueInTransaction(input);
      }),
    );
  }

  /** Converts each not-yet-dispatched outbox row into exactly one durable job. */
  async dispatchPendingChanges(limit?: number): Promise<KnowledgeJobRow[]> {
    const normalizedLimit = normalizeLimit(limit, 100, "limit");
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_dispatch", async () => {
        await assertActiveLibrary(this.db, this.libraryId);
        const changes = await this.db.query<KnowledgeChangeStorageRow>(
          `SELECT change.seq, change.library_id, change.source_type, change.source_id,
                  change.change_kind, change.expected_revision_id,
                  change.expected_content_hash, change.created_at
           FROM knowledge_changes change
           LEFT JOIN knowledge_jobs job
             ON job.source_change_seq = change.seq
            AND job.library_id = change.library_id
           WHERE change.library_id = ? AND job.id IS NULL
           ORDER BY change.seq ASC
           LIMIT ?`,
          [this.libraryId, normalizedLimit],
        );
        const dispatched: KnowledgeJobRow[] = [];
        for (const row of changes) {
          const change = toKnowledgeChangeRow(row);
          const result = await this.enqueueInTransaction({
            kind: jobKindForChange(change.changeKind),
            sourceType: change.sourceType,
            sourceId: change.sourceId,
            expectedRevisionId: change.expectedRevisionId,
            expectedContentHash: change.expectedContentHash,
            sourceChangeSeq: change.seq,
            dedupeKey: `change:${change.seq}`,
            availableAt: change.createdAt,
          });
          if (result.created) dispatched.push(result.job);
        }
        return dispatched;
      }),
    );
  }

  /**
   * Reclaims an expired lease first, then atomically leases the next eligible
   * queued job. The caller must transition the returned job to running before
   * executing it.
   */
  async claimNext(
    owner: string,
    options: ClaimKnowledgeJobOptions = {},
  ): Promise<KnowledgeJobRow | null> {
    assertOwner(owner);
    const now = normalizeNow(options.now);
    const leaseMs = normalizeLeaseMs(options.leaseMs);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_claim", async () => {
        await assertActiveLibrary(this.db, this.libraryId);
        await this.recoverExpiredLeasesInTransaction(now);
        const candidates = await this.db.query<{
          id: string;
          attempts: number;
          status: KnowledgeJobStatus;
        }>(
          `SELECT id, attempts, status
           FROM knowledge_jobs
           WHERE library_id = ?
             AND status IN ('queued', 'retry-wait')
             AND available_at <= ?
             AND attempts < max_attempts
           ORDER BY available_at ASC, created_at ASC, id ASC
           LIMIT 1`,
          [this.libraryId, now],
        );
        const candidate = candidates[0];
        if (!candidate) return null;
        const changed = await this.db.run(
          `UPDATE knowledge_jobs
           SET status = 'leased', attempts = attempts + 1,
               lease_owner = ?, lease_expires_at = ?,
               updated_at = MAX(updated_at + 1, ?)
           WHERE id = ? AND library_id = ?
             AND status = ? AND available_at <= ? AND attempts = ?`,
          [
            owner,
            now + leaseMs,
            now,
            candidate.id,
            this.libraryId,
            candidate.status,
            now,
            candidate.attempts,
          ],
        );
        if (changed !== 1) return null;
        return this.getInLibrary(candidate.id);
      }),
    );
  }

  /** Marks a currently leased job as executing and extends its lease. */
  async start(
    jobId: string,
    owner: string,
    options: KnowledgeJobLeaseOptions = {},
  ): Promise<KnowledgeJobRow | null> {
    assertId(jobId, "Knowledge job id");
    assertOwner(owner);
    const now = normalizeNow(options.now);
    const leaseMs = normalizeLeaseMs(options.leaseMs);
    return withDatabaseWriteLock(this.db, async () => {
      const changed = await this.db.run(
        `UPDATE knowledge_jobs
         SET status = 'running', lease_expires_at = ?,
             updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ?
           AND status = 'leased' AND lease_owner = ? AND lease_expires_at > ?`,
        [now + leaseMs, now, jobId, this.libraryId, owner, now],
      );
      return changed === 1 ? this.getInLibrary(jobId) : null;
    });
  }

  /** Renews a live lease. A lost or expired lease returns null instead of mutating state. */
  async renewLease(
    jobId: string,
    owner: string,
    options: KnowledgeJobLeaseOptions = {},
  ): Promise<KnowledgeJobRow | null> {
    assertId(jobId, "Knowledge job id");
    assertOwner(owner);
    const now = normalizeNow(options.now);
    const leaseMs = normalizeLeaseMs(options.leaseMs);
    return withDatabaseWriteLock(this.db, async () => {
      const changed = await this.db.run(
        `UPDATE knowledge_jobs
         SET lease_expires_at = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ?
           AND status IN ('leased', 'running')
           AND lease_owner = ? AND lease_expires_at > ?`,
        [now + leaseMs, now, jobId, this.libraryId, owner, now],
      );
      return changed === 1 ? this.getInLibrary(jobId) : null;
    });
  }

  /** Completes a running job only while its owner still holds the lease. */
  async complete(
    jobId: string,
    owner: string,
    options: { now?: number; progress?: unknown | null } = {},
  ): Promise<KnowledgeJobRow | null> {
    assertId(jobId, "Knowledge job id");
    assertOwner(owner);
    const now = normalizeNow(options.now);
    const progressJson = serializeJson(options.progress, "Knowledge job progress");
    return withDatabaseWriteLock(this.db, async () => {
      const changed = await this.db.run(
        `UPDATE knowledge_jobs
         SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
             progress_json = ?, error = NULL, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ?
           AND status = 'running' AND lease_owner = ? AND lease_expires_at > ?`,
        [progressJson, now, jobId, this.libraryId, owner, now],
      );
      return changed === 1 ? this.getInLibrary(jobId) : null;
    });
  }

  /**
   * Persists a bounded error and either schedules the next retry or terminally
   * fails the job when its claim budget has been consumed.
   */
  async fail(
    jobId: string,
    owner: string,
    error: unknown,
    options: FailKnowledgeJobOptions = {},
  ): Promise<KnowledgeJobRow | null> {
    assertId(jobId, "Knowledge job id");
    assertOwner(owner);
    const now = normalizeNow(options.now);
    const message = summarizeKnowledgeJobError(error);
    const requestedDelay = options.retryDelayMs;
    if (
      requestedDelay !== undefined &&
      (!Number.isSafeInteger(requestedDelay) || requestedDelay < 0)
    ) {
      throw new Error("retryDelayMs must be a non-negative integer");
    }
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_fail", async () => {
        const jobs = await this.db.query<Pick<KnowledgeJobStorageRow, "attempts" | "max_attempts">>(
          `SELECT attempts, max_attempts
           FROM knowledge_jobs
           WHERE id = ? AND library_id = ?
             AND status IN ('leased', 'running')
             AND lease_owner = ? AND lease_expires_at > ?
           LIMIT 1`,
          [jobId, this.libraryId, owner, now],
        );
        const job = jobs[0];
        if (!job) return null;
        const terminal = job.attempts >= job.max_attempts;
        const retryDelay = requestedDelay ?? knowledgeJobRetryDelayMs(job.attempts);
        const changed = await this.db.run(
          `UPDATE knowledge_jobs
           SET status = ?, available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
               error = ?, updated_at = MAX(updated_at + 1, ?)
           WHERE id = ? AND library_id = ?
             AND status IN ('leased', 'running')
             AND lease_owner = ? AND lease_expires_at > ?`,
          [
            terminal ? "terminal-failed" : "retry-wait",
            terminal ? now : now + retryDelay,
            message,
            now,
            jobId,
            this.libraryId,
            owner,
            now,
          ],
        );
        return changed === 1 ? this.getInLibrary(jobId) : null;
      }),
    );
  }

  /** Cancels an active job. Supplying owner prevents another worker from cancelling it. */
  async cancel(
    jobId: string,
    options: CancelKnowledgeJobOptions = {},
  ): Promise<KnowledgeJobRow | null> {
    assertId(jobId, "Knowledge job id");
    if (options.owner !== undefined) assertOwner(options.owner);
    const now = normalizeNow(options.now);
    const ownerClause =
      options.owner === undefined ? "" : " AND lease_owner = ? AND lease_expires_at > ?";
    const params: unknown[] = [now, jobId, this.libraryId];
    if (options.owner !== undefined) params.push(options.owner, now);
    return withDatabaseWriteLock(this.db, async () => {
      const changed = await this.db.run(
        `UPDATE knowledge_jobs
         SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
             updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ?
           AND status IN ('queued', 'leased', 'running', 'retry-wait')${ownerClause}`,
        params,
      );
      return changed === 1 ? this.getInLibrary(jobId) : null;
    });
  }

  /** Cancels every active job for a canonical source; used by source deletion paths. */
  async cancelForSource(
    sourceType: KnowledgeChangeSourceType,
    sourceId: string,
    options: { now?: number } = {},
  ): Promise<number> {
    assertKnownChangeSourceType(sourceType);
    assertId(sourceId, "Knowledge job source id");
    const now = normalizeNow(options.now);
    return withDatabaseWriteLock(this.db, () =>
      this.db.run(
        `UPDATE knowledge_jobs
         SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
             updated_at = MAX(updated_at + 1, ?)
         WHERE library_id = ? AND source_type = ? AND source_id = ?
           AND status IN ('queued', 'leased', 'running', 'retry-wait')`,
        [now, this.libraryId, sourceType, sourceId],
      ),
    );
  }

  /** Moves abandoned leases back to retry-wait (or terminal-failed if exhausted). */
  async recoverExpiredLeases(now?: number): Promise<number> {
    const normalizedNow = normalizeNow(now);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_recover", async () => {
        await assertActiveLibrary(this.db, this.libraryId);
        return this.recoverExpiredLeasesInTransaction(normalizedNow);
      }),
    );
  }

  private async enqueueInTransaction(
    input: EnqueueKnowledgeJobInput,
  ): Promise<{ job: KnowledgeJobRow; created: boolean }> {
    const normalized = normalizeEnqueueInput(input);
    if (normalized.sourceChangeSeq !== null) {
      const change = await this.db.query<{ library_id: string }>(
        `SELECT library_id FROM knowledge_changes WHERE seq = ? LIMIT 1`,
        [normalized.sourceChangeSeq],
      );
      if (!change[0] || change[0].library_id !== this.libraryId) {
        throw new Error(`Knowledge change ${normalized.sourceChangeSeq} is outside this Library`);
      }
    }

    const id = newId();
    const now = Date.now();
    const created = await this.db.run(
      `INSERT OR IGNORE INTO knowledge_jobs
         (id, library_id, kind, source_type, source_id,
          expected_revision_id, expected_content_hash, index_id, source_change_seq,
          dedupe_key, status, attempts, max_attempts, available_at,
          lease_owner, lease_expires_at, progress_json, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
      [
        id,
        this.libraryId,
        normalized.kind,
        normalized.sourceType,
        normalized.sourceId,
        normalized.expectedRevisionId,
        normalized.expectedContentHash,
        normalized.indexId,
        normalized.sourceChangeSeq,
        normalized.dedupeKey,
        normalized.maxAttempts,
        normalized.availableAt,
        normalized.progressJson,
        now,
        now,
      ],
    );
    if (created === 1) {
      const job = await this.getInLibrary(id);
      if (!job) throw new Error(`Knowledge job ${id} was not readable after creation`);
      return { job, created: true };
    }

    const existing = await this.findExistingDedupeJob(normalized);
    if (!existing) {
      throw new Error("Knowledge job insert was ignored without a matching durable job");
    }
    return { job: existing, created: false };
  }

  private async findExistingDedupeJob(
    input: NormalizedEnqueueKnowledgeJobInput,
  ): Promise<KnowledgeJobRow | null> {
    if (input.sourceChangeSeq !== null) {
      const byChange = await this.db.query<KnowledgeJobStorageRow>(
        `SELECT ${KNOWLEDGE_JOB_COLUMNS}
         FROM knowledge_jobs
         WHERE library_id = ? AND source_change_seq = ?
         LIMIT 1`,
        [this.libraryId, input.sourceChangeSeq],
      );
      if (byChange[0]) return toKnowledgeJobRow(byChange[0]);
    }
    const active = await this.db.query<KnowledgeJobStorageRow>(
      `SELECT ${KNOWLEDGE_JOB_COLUMNS}
       FROM knowledge_jobs
       WHERE library_id = ? AND dedupe_key = ?
         AND status IN ('queued', 'leased', 'running', 'retry-wait')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [this.libraryId, input.dedupeKey],
    );
    return active[0] ? toKnowledgeJobRow(active[0]) : null;
  }

  private async recoverExpiredLeasesInTransaction(now: number): Promise<number> {
    const rows = await this.db.query<
      Pick<KnowledgeJobStorageRow, "id" | "attempts" | "max_attempts">
    >(
      `SELECT id, attempts, max_attempts
       FROM knowledge_jobs
       WHERE library_id = ?
         AND status IN ('leased', 'running')
         AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
       ORDER BY lease_expires_at ASC, id ASC`,
      [this.libraryId, now],
    );
    let recovered = 0;
    for (const row of rows) {
      const terminal = row.attempts >= row.max_attempts;
      const changed = await this.db.run(
        `UPDATE knowledge_jobs
         SET status = ?, available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
             error = COALESCE(error, 'Knowledge job lease expired before completion'),
             updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ?
           AND status IN ('leased', 'running') AND lease_expires_at <= ?`,
        [terminal ? "terminal-failed" : "retry-wait", now, now, row.id, this.libraryId, now],
      );
      recovered += changed;
    }
    return recovered;
  }

  private async getInLibrary(jobId: string): Promise<KnowledgeJobRow | null> {
    const rows = await this.db.query<KnowledgeJobStorageRow>(
      `SELECT ${KNOWLEDGE_JOB_COLUMNS}
       FROM knowledge_jobs
       WHERE id = ? AND library_id = ?
       LIMIT 1`,
      [jobId, this.libraryId],
    );
    return rows[0] ? toKnowledgeJobRow(rows[0]) : null;
  }
}

export class ContentUnitsRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async get(
    contentUnitId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<ContentUnitRow | null> {
    assertId(contentUnitId, "ContentUnit id");
    const rows = await this.db.query<ContentUnitStorageRow>(
      `SELECT ${CONTENT_UNIT_COLUMNS}
       FROM content_units
       WHERE id = ? AND library_id = ?${options.includeDeleted ? "" : " AND deleted_at IS NULL"}
       LIMIT 1`,
      [contentUnitId, this.libraryId],
    );
    return rows[0] ? toContentUnitRow(rows[0]) : null;
  }

  async listForSource(
    sourceType: ContentUnitSourceType,
    sourceId: string,
    options: { revisionId?: string | null; includeDeleted?: boolean } = {},
  ): Promise<ContentUnitRow[]> {
    assertKnownContentUnitSourceType(sourceType);
    assertId(sourceId, "ContentUnit source id");
    const clauses = ["library_id = ?", "source_type = ?", "source_id = ?"];
    const params: unknown[] = [this.libraryId, sourceType, sourceId];
    if (options.revisionId !== undefined) {
      clauses.push("revision_id IS ?");
      params.push(options.revisionId);
    }
    if (!options.includeDeleted) clauses.push("deleted_at IS NULL");
    const rows = await this.db.query<ContentUnitStorageRow>(
      `SELECT ${CONTENT_UNIT_COLUMNS}
       FROM content_units
       WHERE ${clauses.join(" AND ")}
       ORDER BY ordinal ASC, id ASC`,
      params,
    );
    return rows.map(toContentUnitRow);
  }

  /**
   * Counts the live corpus without opening the FTS table. `ready` is the
   * citation-safe subset that a semantic index should include by default.
   */
  async getIndexStats(): Promise<ContentUnitIndexStats> {
    const rows = await this.db.query<ContentUnitIndexStatsStorageRow>(
      // Keep effective-language precedence aligned with ContentUnit search
      // hydration. This makes metadata corrections visible in the planner
      // without rebuilding a semantic index.
      `WITH active_units AS (
         SELECT unit.source_type,
                unit.state,
                COALESCE(NULLIF(trim(unit.language), ''), NULLIF(trim(work.language), '')) AS effective_language
           FROM content_units unit
           LEFT JOIN works work
             ON work.id = unit.work_id
            AND work.library_id = unit.library_id
            AND work.deleted_at IS NULL
          WHERE unit.library_id = ? AND unit.deleted_at IS NULL
       ),
       normalized_units AS (
         SELECT source_type,
                state,
                effective_language,
                lower(replace(effective_language, '_', '-')) AS normalized_language
           FROM active_units
       ),
       categorized_units AS (
         SELECT source_type,
                state,
                CASE
                  WHEN effective_language IS NULL THEN 'missing'
                  WHEN normalized_language = 'zh'
                    OR normalized_language LIKE 'zh-%'
                    OR normalized_language IN ('cmn', 'chi', 'zho', 'chinese', '中文', '汉语', '華語', '华语', '简体中文', '繁体中文')
                    THEN 'zh'
                  WHEN normalized_language = 'en'
                    OR normalized_language LIKE 'en-%'
                    OR normalized_language IN ('eng', 'english', '英语', '英文')
                    THEN 'en'
                  ELSE 'other'
                END AS language_category
           FROM normalized_units
       )
       SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN state = 'ready' THEN 1 ELSE 0 END), 0) AS ready,
              COALESCE(SUM(CASE WHEN state = 'context-only' THEN 1 ELSE 0 END), 0) AS context_only,
              COALESCE(SUM(CASE WHEN source_type = 'pdf' THEN 1 ELSE 0 END), 0) AS pdf_count,
              COALESCE(SUM(CASE WHEN source_type = 'annotation' THEN 1 ELSE 0 END), 0) AS annotation_count,
              COALESCE(SUM(CASE WHEN source_type = 'evidence' THEN 1 ELSE 0 END), 0) AS evidence_count,
              COALESCE(SUM(CASE WHEN state = 'ready' AND language_category = 'zh' THEN 1 ELSE 0 END), 0) AS zh_language_count,
              COALESCE(SUM(CASE WHEN state = 'ready' AND language_category = 'en' THEN 1 ELSE 0 END), 0) AS en_language_count,
              COALESCE(SUM(CASE WHEN state = 'ready' AND language_category = 'other' THEN 1 ELSE 0 END), 0) AS other_language_count,
              COALESCE(SUM(CASE WHEN state = 'ready' AND language_category = 'missing' THEN 1 ELSE 0 END), 0) AS missing_language_count
         FROM categorized_units`,
      [this.libraryId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error("ContentUnit index statistics query returned no row");
    }
    return {
      total: toContentUnitCount(row.total, "total ContentUnits"),
      ready: toContentUnitCount(row.ready, "ready ContentUnits"),
      contextOnly: toContentUnitCount(row.context_only, "context-only ContentUnits"),
      sourceCounts: {
        pdf: toContentUnitCount(row.pdf_count, "PDF ContentUnits"),
        annotation: toContentUnitCount(row.annotation_count, "annotation ContentUnits"),
        evidence: toContentUnitCount(row.evidence_count, "Evidence ContentUnits"),
      },
      languageCoverage: {
        zh: toContentUnitCount(row.zh_language_count, "Chinese-labelled ContentUnits"),
        en: toContentUnitCount(row.en_language_count, "English-labelled ContentUnits"),
        other: toContentUnitCount(row.other_language_count, "other-language ContentUnits"),
        missing: toContentUnitCount(row.missing_language_count, "unlabelled ContentUnits"),
      },
    };
  }

  /** Restores matching deterministic ContentUnits without overwriting their immutable payload. */
  async upsertMany(units: readonly ContentUnit[]): Promise<ContentUnit[]> {
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "content_units_upsert", async () => {
        await assertActiveLibrary(this.db, this.libraryId);
        await this.upsertManyInTransaction(units);
        return [...units];
      }),
    );
  }

  /**
   * Upserts an extractor result and retires any no-longer-emitted units for the
   * same source/revision in the same durable write.
   */
  async replaceForSource(input: ReplaceContentUnitsInput): Promise<ContentUnit[]> {
    assertKnownContentUnitSourceType(input.sourceType);
    assertId(input.sourceId, "ContentUnit source id");
    if (input.revisionId !== undefined && input.revisionId !== null) {
      assertId(input.revisionId, "ContentUnit revision id");
    }
    for (const unit of input.units) {
      assertContentUnit(unit, this.libraryId);
      if (unit.sourceType !== input.sourceType || unit.sourceId !== input.sourceId) {
        throw new Error("Replacement ContentUnits must belong to the requested source");
      }
      if (input.revisionId !== undefined && unit.revisionId !== input.revisionId) {
        throw new Error("Replacement ContentUnits must belong to the requested revision");
      }
    }
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "content_units_replace", async () => {
        await assertActiveLibrary(this.db, this.libraryId);
        await this.upsertManyInTransaction(input.units);
        const existing = await this.listForSourceInTransaction(
          input.sourceType,
          input.sourceId,
          input.revisionId,
        );
        const liveIds = new Set(input.units.map((unit) => unit.id));
        const now = Date.now();
        for (const unit of existing) {
          if (liveIds.has(unit.id)) continue;
          await this.db.run(
            `UPDATE content_units
             SET deleted_at = ?, updated_at = MAX(updated_at + 1, ?)
             WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
            [now, now, unit.id, this.libraryId],
          );
        }
        return [...input.units];
      }),
    );
  }

  async retireSource(input: {
    sourceType: ContentUnitSourceType;
    sourceId: string;
    revisionId?: string | null;
    now?: number;
  }): Promise<number> {
    assertKnownContentUnitSourceType(input.sourceType);
    assertId(input.sourceId, "ContentUnit source id");
    if (input.revisionId !== undefined && input.revisionId !== null) {
      assertId(input.revisionId, "ContentUnit revision id");
    }
    const now = normalizeNow(input.now);
    const revisionClause = input.revisionId === undefined ? "" : " AND revision_id IS ?";
    const params: unknown[] = [now, now, this.libraryId, input.sourceType, input.sourceId];
    if (input.revisionId !== undefined) params.push(input.revisionId);
    return withDatabaseWriteLock(this.db, () =>
      this.db.run(
        `UPDATE content_units
         SET deleted_at = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE library_id = ? AND source_type = ? AND source_id = ?
           AND deleted_at IS NULL${revisionClause}`,
        params,
      ),
    );
  }

  private async upsertManyInTransaction(units: readonly ContentUnit[]): Promise<void> {
    const ordered = orderContentUnitsForInsert(units);
    for (const unit of ordered) {
      assertContentUnit(unit, this.libraryId);
      const existing = await this.db.query<ContentUnitStorageRow>(
        `SELECT ${CONTENT_UNIT_COLUMNS}
         FROM content_units WHERE id = ? LIMIT 1`,
        [unit.id],
      );
      const stored = existing[0];
      if (stored) {
        if (stored.library_id !== this.libraryId) {
          throw new Error(`ContentUnit ${unit.id} is outside this Library`);
        }
        if (!matchesContentUnit(stored, unit)) {
          throw new Error(`ContentUnit ${unit.id} already exists with different immutable content`);
        }
        await this.db.run(
          `UPDATE content_units
           SET deleted_at = NULL, updated_at = MAX(updated_at + 1, ?)
           WHERE id = ? AND library_id = ?`,
          [Date.now(), unit.id, this.libraryId],
        );
        continue;
      }
      const now = Date.now();
      await this.db.run(
        `INSERT INTO content_units
           (id, library_id, source_type, source_id, work_id, asset_id, revision_id,
            parent_unit_id, ordinal, heading_path_json, anchor_json, text, language,
            token_count, content_hash, extractor_profile, chunk_profile, state,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          unit.id,
          unit.libraryId,
          unit.sourceType,
          unit.sourceId,
          unit.workId,
          unit.assetId,
          unit.revisionId,
          unit.parentUnitId,
          unit.ordinal,
          serializeJson(unit.headingPath, "ContentUnit heading path"),
          serializeJson(unit.anchor, "ContentUnit anchor"),
          unit.text,
          unit.language,
          unit.tokenCount,
          unit.contentHash,
          unit.extractorProfile,
          unit.chunkProfile,
          unit.state,
          now,
          now,
        ],
      );
    }
  }

  private async listForSourceInTransaction(
    sourceType: ContentUnitSourceType,
    sourceId: string,
    revisionId: string | null | undefined,
  ): Promise<ContentUnitRow[]> {
    const revisionClause = revisionId === undefined ? "" : " AND revision_id IS ?";
    const params: unknown[] = [this.libraryId, sourceType, sourceId];
    if (revisionId !== undefined) params.push(revisionId);
    const rows = await this.db.query<ContentUnitStorageRow>(
      `SELECT ${CONTENT_UNIT_COLUMNS}
       FROM content_units
       WHERE library_id = ? AND source_type = ? AND source_id = ?
         AND deleted_at IS NULL${revisionClause}
       ORDER BY ordinal ASC, id ASC`,
      params,
    );
    return rows.map(toContentUnitRow);
  }
}

/**
 * Searches the derived, immutable ContentUnit corpus. The result carries the
 * original source identifiers and anchor so callers can navigate back to the
 * exact PDF/evidence/annotation location without a second lookup.
 */
export class ContentUnitSearchRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async search(input: SearchContentUnitsInput): Promise<ContentUnitSearchResult[]> {
    if (typeof input.query !== "string") throw new Error("ContentUnit query must be a string");
    const ftsQuery = buildFtsPrefixQuery(input.query, 24);
    if (!ftsQuery) return [];

    const limit = normalizeLimit(input.limit, 20, "ContentUnit search limit");
    const clauses = ["content_units_fts MATCH ?", "unit.library_id = ?", "unit.deleted_at IS NULL"];
    const params: unknown[] = [ftsQuery, this.libraryId];

    if (!input.includeContextOnly) clauses.push("unit.state = 'ready'");
    if (input.sourceTypes !== undefined) {
      if (input.sourceTypes.length === 0) return [];
      for (const sourceType of input.sourceTypes) assertKnownContentUnitSourceType(sourceType);
      clauses.push(`unit.source_type IN (${input.sourceTypes.map(() => "?").join(", ")})`);
      params.push(...input.sourceTypes);
    }

    addContentUnitSearchIdClause(clauses, params, "unit.source_id", input.sourceId, "source id");
    addContentUnitSearchIdClause(clauses, params, "unit.work_id", input.workId, "work id");
    addContentUnitSearchIdClause(clauses, params, "unit.asset_id", input.assetId, "asset id");
    addContentUnitSearchIdClause(
      clauses,
      params,
      "unit.revision_id",
      input.revisionId,
      "revision id",
    );
    params.push(limit);

    const rows = await this.db.query<ContentUnitSearchStorageRow>(
      `SELECT ${CONTENT_UNIT_SELECT_COLUMNS},
              -bm25(content_units_fts) AS score,
              snippet(content_units_fts, 0, '', '', '…', 32) AS excerpt,
              work.title AS work_title
       FROM content_units_fts
       JOIN content_units unit ON unit.rowid = content_units_fts.rowid
       LEFT JOIN works work
         ON work.id = unit.work_id
        AND work.library_id = unit.library_id
        AND work.deleted_at IS NULL
       WHERE ${clauses.join(" AND ")}
       ORDER BY score DESC, unit.id ASC
       LIMIT ?`,
      params,
    );
    return rows.map(toContentUnitSearchResult);
  }

  /**
   * Resolves the canonical source allowlist before a vector backend sees a
   * query. Only citation-safe ready units are included because context-only
   * units never receive vectors in a hybrid generation.
   */
  async listReadySourceIds(
    input: Omit<SearchContentUnitsInput, "limit" | "query"> = {},
  ): Promise<string[]> {
    const clauses = ["unit.library_id = ?", "unit.deleted_at IS NULL", "unit.state = 'ready'"];
    const params: unknown[] = [this.libraryId];
    appendContentUnitScopeClauses(clauses, params, input);
    const rows = await this.db.query<{ source_id: string }>(
      `SELECT DISTINCT unit.source_id
       FROM content_units unit
       WHERE ${clauses.join(" AND ")}
       ORDER BY unit.source_id ASC`,
      params,
    );
    return rows.map((row) => row.source_id);
  }

  /**
   * Hydrates semantic-only candidates after a vector store has already
   * enforced its generation/source scope. The same canonical filters are
   * repeated here so a result cannot escape a work, asset, or source filter.
   */
  async findReadyByIds(input: {
    contentUnitIds: readonly string[];
    sourceTypes?: readonly ContentUnitSourceType[];
    sourceId?: string;
    workId?: string;
    assetId?: string;
    revisionId?: string;
  }): Promise<ContentUnitSearchResult[]> {
    if (!Array.isArray(input.contentUnitIds)) {
      throw new Error("ContentUnit lookup ids must be an array");
    }
    const contentUnitIds = [...new Set(input.contentUnitIds)];
    if (contentUnitIds.length === 0) return [];
    if (contentUnitIds.length > 1_000) {
      throw new Error("ContentUnit lookup is limited to 1000 ids");
    }
    for (const id of contentUnitIds) assertId(id, "ContentUnit lookup id");

    const clauses = [
      "unit.library_id = ?",
      "unit.deleted_at IS NULL",
      "unit.state = 'ready'",
      `unit.id IN (${contentUnitIds.map(() => "?").join(", ")})`,
    ];
    const params: unknown[] = [this.libraryId, ...contentUnitIds];
    appendContentUnitScopeClauses(clauses, params, input);
    const rows = await this.db.query<ContentUnitSearchStorageRow>(
      `SELECT ${CONTENT_UNIT_SELECT_COLUMNS},
              0 AS score,
              CASE
                WHEN length(unit.text) > 240 THEN substr(unit.text, 1, 239) || '…'
                ELSE unit.text
              END AS excerpt,
              work.title AS work_title
       FROM content_units unit
       LEFT JOIN works work
         ON work.id = unit.work_id
        AND work.library_id = unit.library_id
        AND work.deleted_at IS NULL
       WHERE ${clauses.join(" AND ")}`,
      params,
    );
    return rows.map(toContentUnitSearchResult);
  }
}

function appendContentUnitScopeClauses(
  clauses: string[],
  params: unknown[],
  input: {
    sourceTypes?: readonly ContentUnitSourceType[];
    sourceId?: string;
    workId?: string;
    assetId?: string;
    revisionId?: string;
  },
): void {
  if (input.sourceTypes !== undefined) {
    if (input.sourceTypes.length === 0) {
      clauses.push("0 = 1");
    } else {
      for (const sourceType of input.sourceTypes) assertKnownContentUnitSourceType(sourceType);
      clauses.push(`unit.source_type IN (${input.sourceTypes.map(() => "?").join(", ")})`);
      params.push(...input.sourceTypes);
    }
  }
  addContentUnitSearchIdClause(clauses, params, "unit.source_id", input.sourceId, "source id");
  addContentUnitSearchIdClause(clauses, params, "unit.work_id", input.workId, "work id");
  addContentUnitSearchIdClause(clauses, params, "unit.asset_id", input.assetId, "asset id");
  addContentUnitSearchIdClause(
    clauses,
    params,
    "unit.revision_id",
    input.revisionId,
    "revision id",
  );
}

/** Exponential retry backoff, capped at one hour to retain eventual recovery. */
export function knowledgeJobRetryDelayMs(attempts: number): number {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error("attempts must be a positive integer");
  }
  return Math.min(60_000 * 2 ** Math.min(attempts - 1, 10), 60 * 60_000);
}

/** Keeps durable diagnostics actionable without retaining an unbounded stack or payload. */
export function summarizeKnowledgeJobError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (safeJson(error) ?? "Unknown knowledge job failure");
  const compact = raw.replace(/\s+/g, " ").trim();
  return (compact || "Unknown knowledge job failure").slice(0, 2_000);
}

interface NormalizedChangeInput {
  libraryId: string;
  sourceType: KnowledgeChangeSourceType;
  sourceId: string;
  changeKind: KnowledgeChangeKind;
  expectedRevisionId: string | null;
  expectedContentHash: string | null;
  createdAt: number;
}

interface NormalizedEnqueueKnowledgeJobInput {
  kind: KnowledgeJobKind;
  sourceType: KnowledgeChangeSourceType;
  sourceId: string;
  expectedRevisionId: string | null;
  expectedContentHash: string | null;
  indexId: string | null;
  sourceChangeSeq: number | null;
  dedupeKey: string;
  maxAttempts: number;
  availableAt: number;
  progressJson: string | null;
}

const CONTENT_UNIT_COLUMNS = `id, library_id, source_type, source_id, work_id, asset_id,
  revision_id, parent_unit_id, ordinal, heading_path_json, anchor_json, text, language,
  token_count, content_hash, extractor_profile, chunk_profile, state,
  created_at, updated_at, deleted_at`;

const CONTENT_UNIT_SELECT_COLUMNS = CONTENT_UNIT_COLUMNS.split(",")
  .map((column) => {
    const name = column.trim();
    // ContentUnits can carry an explicit language label, while older units
    // inherit the current Work metadata at retrieval time. This keeps a
    // language correction useful immediately without changing unit identity
    // or forcing a vector rebuild.
    if (name === "language") {
      return "COALESCE(NULLIF(trim(unit.language), ''), NULLIF(trim(work.language), '')) AS language";
    }
    return `unit.${name}`;
  })
  .join(", ");

const KNOWLEDGE_JOB_COLUMNS = `id, library_id, kind, source_type, source_id,
  expected_revision_id, expected_content_hash, index_id, source_change_seq,
  dedupe_key, status, attempts, max_attempts, available_at, lease_owner,
  lease_expires_at, progress_json, error, created_at, updated_at`;

function normalizeChangeInput(input: AppendKnowledgeChangeInput): NormalizedChangeInput {
  assertId(input.libraryId, "Library id");
  assertKnownChangeSourceType(input.sourceType);
  assertId(input.sourceId, "Knowledge change source id");
  assertKnownChangeKind(input.changeKind);
  const expectedRevisionId = normalizeOptionalId(input.expectedRevisionId, "Expected revision id");
  const expectedContentHash = normalizeOptionalHash(
    input.expectedContentHash,
    "Expected content hash",
  );
  const createdAt = normalizeNow(input.createdAt);
  return {
    libraryId: input.libraryId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    changeKind: input.changeKind,
    expectedRevisionId,
    expectedContentHash,
    createdAt,
  };
}

function normalizeEnqueueInput(
  input: EnqueueKnowledgeJobInput,
): NormalizedEnqueueKnowledgeJobInput {
  assertKnownJobKind(input.kind);
  assertKnownChangeSourceType(input.sourceType);
  assertId(input.sourceId, "Knowledge job source id");
  const expectedRevisionId = normalizeOptionalId(input.expectedRevisionId, "Expected revision id");
  const expectedContentHash = normalizeOptionalHash(
    input.expectedContentHash,
    "Expected content hash",
  );
  const indexId = normalizeOptionalId(input.indexId, "Knowledge index id");
  const sourceChangeSeq = input.sourceChangeSeq ?? null;
  if (
    sourceChangeSeq !== null &&
    (!Number.isSafeInteger(sourceChangeSeq) || sourceChangeSeq <= 0)
  ) {
    throw new Error("sourceChangeSeq must be a positive integer or null");
  }
  const dedupeKey = (input.dedupeKey ?? makeDefaultDedupeKey(input)).trim();
  if (!dedupeKey || dedupeKey.length > 1_024) {
    throw new Error("Knowledge job dedupe key must be a non-empty string up to 1024 characters");
  }
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0 || maxAttempts > 100) {
    throw new Error("maxAttempts must be an integer between 1 and 100");
  }
  return {
    kind: input.kind,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    expectedRevisionId,
    expectedContentHash,
    indexId,
    sourceChangeSeq,
    dedupeKey,
    maxAttempts,
    availableAt: normalizeNow(input.availableAt),
    progressJson: serializeJson(input.progress, "Knowledge job progress"),
  };
}

function makeDefaultDedupeKey(input: EnqueueKnowledgeJobInput): string {
  return [
    input.kind,
    input.sourceType,
    input.sourceId,
    input.expectedRevisionId ?? "",
    input.expectedContentHash ?? "",
    input.indexId ?? "",
  ].join("|");
}

function jobKindForChange(changeKind: KnowledgeChangeKind): KnowledgeJobKind {
  switch (changeKind) {
    case "delete":
      return "remove";
    case "reindex":
      return "reindex";
    case "upsert":
      return "extract";
  }
}

function toKnowledgeChangeRow(row: KnowledgeChangeStorageRow): KnowledgeChangeRow {
  return {
    seq: row.seq,
    libraryId: row.library_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    changeKind: row.change_kind,
    expectedRevisionId: row.expected_revision_id,
    expectedContentHash: row.expected_content_hash,
    createdAt: row.created_at,
  };
}

function toKnowledgeJobRow(row: KnowledgeJobStorageRow): KnowledgeJobRow {
  return {
    id: row.id,
    libraryId: row.library_id,
    kind: row.kind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    expectedRevisionId: row.expected_revision_id,
    expectedContentHash: row.expected_content_hash,
    indexId: row.index_id,
    sourceChangeSeq: row.source_change_seq,
    dedupeKey: row.dedupe_key,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    progress: row.progress_json === null ? null : (JSON.parse(row.progress_json) as unknown),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toContentUnitCount(value: number | bigint, label: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid ${label} count`);
  }
  return count;
}

function toContentUnitRow(row: ContentUnitStorageRow): ContentUnitRow {
  return {
    id: row.id,
    libraryId: row.library_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    workId: row.work_id,
    assetId: row.asset_id,
    revisionId: row.revision_id,
    parentUnitId: row.parent_unit_id,
    ordinal: row.ordinal,
    headingPath:
      row.heading_path_json === null ? null : (JSON.parse(row.heading_path_json) as string[]),
    anchor: JSON.parse(row.anchor_json) as ContentUnit["anchor"],
    text: row.text,
    language: row.language,
    tokenCount: row.token_count,
    contentHash: row.content_hash,
    extractorProfile: row.extractor_profile,
    chunkProfile: row.chunk_profile,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toContentUnitSearchResult(row: ContentUnitSearchStorageRow): ContentUnitSearchResult {
  return {
    ...toContentUnitRow(row),
    score: Number(row.score),
    excerpt: row.excerpt,
    workTitle: row.work_title ?? null,
  };
}

function addContentUnitSearchIdClause(
  clauses: string[],
  params: unknown[],
  column: string,
  value: string | undefined,
  label: string,
): void {
  if (value === undefined) return;
  assertId(value, `ContentUnit ${label}`);
  clauses.push(`${column} = ?`);
  params.push(value);
}

function orderContentUnitsForInsert(units: readonly ContentUnit[]): ContentUnit[] {
  const byId = new Map<string, ContentUnit>();
  for (const unit of units) {
    if (byId.has(unit.id)) throw new Error(`ContentUnit ${unit.id} was submitted more than once`);
    byId.set(unit.id, unit);
  }
  const ordered: ContentUnit[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (unit: ContentUnit) => {
    if (visited.has(unit.id)) return;
    if (visiting.has(unit.id)) throw new Error("ContentUnit parents must not form a cycle");
    visiting.add(unit.id);
    if (unit.parentUnitId) {
      const parent = byId.get(unit.parentUnitId);
      if (parent) visit(parent);
    }
    visiting.delete(unit.id);
    visited.add(unit.id);
    ordered.push(unit);
  };
  for (const unit of units) visit(unit);
  return ordered;
}

function assertContentUnit(unit: ContentUnit, libraryId: string): void {
  assertId(unit.id, "ContentUnit id");
  if (unit.libraryId !== libraryId) throw new Error("ContentUnit belongs to a different Library");
  assertKnownContentUnitSourceType(unit.sourceType);
  assertId(unit.sourceId, "ContentUnit source id");
  if (!Number.isSafeInteger(unit.ordinal) || unit.ordinal < 0) {
    throw new Error("ContentUnit ordinal must be a non-negative integer");
  }
  if (!unit.text.trim()) throw new Error("ContentUnit text must not be empty");
  if (!/^[0-9a-f]{64}$/.test(unit.contentHash)) {
    throw new Error("ContentUnit content hash must be a lowercase SHA-256 value");
  }
  assertId(unit.extractorProfile, "ContentUnit extractor profile");
  assertId(unit.chunkProfile, "ContentUnit chunk profile");
  if (!CONTENT_UNIT_STATES.includes(unit.state)) {
    throw new Error(`Unsupported ContentUnit state: ${unit.state}`);
  }
}

function matchesContentUnit(row: ContentUnitStorageRow, unit: ContentUnit): boolean {
  return (
    row.library_id === unit.libraryId &&
    row.source_type === unit.sourceType &&
    row.source_id === unit.sourceId &&
    row.work_id === unit.workId &&
    row.asset_id === unit.assetId &&
    row.revision_id === unit.revisionId &&
    row.parent_unit_id === unit.parentUnitId &&
    row.ordinal === unit.ordinal &&
    row.heading_path_json === serializeJson(unit.headingPath, "ContentUnit heading path") &&
    row.anchor_json === serializeJson(unit.anchor, "ContentUnit anchor") &&
    row.text === unit.text &&
    row.language === unit.language &&
    row.token_count === unit.tokenCount &&
    row.content_hash === unit.contentHash &&
    row.extractor_profile === unit.extractorProfile &&
    row.chunk_profile === unit.chunkProfile &&
    row.state === unit.state
  );
}

function serializeJson(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("value is not JSON serializable");
    return encoded;
  } catch {
    throw new Error(`${label} must be JSON serializable`);
  }
}

function safeJson(value: unknown): string | null {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? null : encoded;
  } catch {
    return null;
  }
}

async function assertActiveLibrary(db: Database, libraryId: string): Promise<void> {
  const libraries = await db.query<{ id: string }>(
    `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [libraryId],
  );
  if (!libraries[0]) throw new Error(`Library ${libraryId} is missing or removed`);
}

function normalizeOptionalId(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null) return null;
  assertId(value, label);
  return value;
}

function normalizeOptionalHash(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value`);
  }
  return value;
}

function normalizeNow(value: number | undefined): number {
  const now = value ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("now must be a non-negative integer");
  return now;
}

function normalizeLeaseMs(value: number | undefined): number {
  const leaseMs = value ?? 60_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60_000) {
    throw new Error("leaseMs must be an integer between 1000 and 86400000");
  }
  return leaseMs;
}

function normalizeLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error(`${label} must be an integer between 1 and 1000`);
  }
  return limit;
}

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertOwner(value: string): void {
  assertId(value, "Knowledge job lease owner");
  if (value.length > 512)
    throw new Error("Knowledge job lease owner must be at most 512 characters");
}

function assertKnownChangeSourceType(value: string): asserts value is KnowledgeChangeSourceType {
  if (!KNOWLEDGE_CHANGE_SOURCE_TYPES.includes(value as KnowledgeChangeSourceType)) {
    throw new Error(`Unsupported Knowledge change source type: ${value}`);
  }
}

function assertKnownChangeKind(value: string): asserts value is KnowledgeChangeKind {
  if (!KNOWLEDGE_CHANGE_KINDS.includes(value as KnowledgeChangeKind)) {
    throw new Error(`Unsupported Knowledge change kind: ${value}`);
  }
}

function assertKnownJobKind(value: string): asserts value is KnowledgeJobKind {
  if (!KNOWLEDGE_JOB_KINDS.includes(value as KnowledgeJobKind)) {
    throw new Error(`Unsupported Knowledge job kind: ${value}`);
  }
}

function assertKnownStatus(value: string): asserts value is KnowledgeJobStatus {
  if (!KNOWLEDGE_JOB_STATUSES.includes(value as KnowledgeJobStatus)) {
    throw new Error(`Unsupported Knowledge job status: ${value}`);
  }
}

function assertKnownContentUnitSourceType(value: string): asserts value is ContentUnitSourceType {
  if (!CONTENT_UNIT_SOURCE_TYPES.includes(value as ContentUnitSourceType)) {
    throw new Error(`Unsupported ContentUnit source type: ${value}`);
  }
}
