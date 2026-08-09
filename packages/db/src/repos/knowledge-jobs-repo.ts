import type { Database } from "../database.js";
import { newId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { withDatabaseWriteLock } from "./write-lock.js";
import * as Contract from "./knowledge-contract.js";
import * as Queue from "./knowledge-queue-support.js";
import * as Utils from "./knowledge-utils.js";

/** Durable, library-scoped queue for derived Knowledge Layer work. */
export class KnowledgeJobsRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    Utils.assertId(libraryId, "Library id");
  }

  async get(jobId: string): Promise<Contract.KnowledgeJobRow | null> {
    Utils.assertId(jobId, "Knowledge job id");
    return this.getInLibrary(jobId);
  }

  async list(
    options: {
      statuses?: readonly Contract.KnowledgeJobStatus[];
      sourceType?: Contract.KnowledgeChangeSourceType;
      sourceId?: string;
      limit?: number;
    } = {},
  ): Promise<Contract.KnowledgeJobRow[]> {
    const clauses = ["library_id = ?"];
    const params: unknown[] = [this.libraryId];
    if (options.statuses?.length) {
      for (const status of options.statuses) Utils.assertKnownStatus(status);
      clauses.push(`status IN (${options.statuses.map(() => "?").join(", ")})`);
      params.push(...options.statuses);
    }
    if (options.sourceType !== undefined) {
      Utils.assertKnownChangeSourceType(options.sourceType);
      clauses.push("source_type = ?");
      params.push(options.sourceType);
    }
    if (options.sourceId !== undefined) {
      Utils.assertId(options.sourceId, "Knowledge job source id");
      clauses.push("source_id = ?");
      params.push(options.sourceId);
    }
    const limit = Utils.normalizeLimit(options.limit, 100, "limit");
    params.push(limit);
    const rows = await this.db.query<Contract.KnowledgeJobStorageRow>(
      `SELECT ${Queue.KNOWLEDGE_JOB_COLUMNS}
       FROM knowledge_jobs
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
      params,
    );
    return rows.map(Queue.toKnowledgeJobRow);
  }

  /**
   * Enqueues a job once. A matching active dedupe key returns the existing
   * job, and a sourceChangeSeq can only ever produce one job.
   */
  async enqueue(
    input: Contract.EnqueueKnowledgeJobInput,
  ): Promise<{ job: Contract.KnowledgeJobRow; created: boolean }> {
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_enqueue", async () => {
        await Utils.assertActiveLibrary(this.db, this.libraryId);
        return this.enqueueInTransaction(input);
      }),
    );
  }

  /** Converts each not-yet-dispatched outbox row into exactly one durable job. */
  async dispatchPendingChanges(limit?: number): Promise<Contract.KnowledgeJobRow[]> {
    const normalizedLimit = Utils.normalizeLimit(limit, 100, "limit");
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_dispatch", async () => {
        await Utils.assertActiveLibrary(this.db, this.libraryId);
        const changes = await this.db.query<Contract.KnowledgeChangeStorageRow>(
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
        const dispatched: Contract.KnowledgeJobRow[] = [];
        for (const row of changes) {
          const change = Queue.toKnowledgeChangeRow(row);
          const result = await this.enqueueInTransaction({
            kind: Queue.jobKindForChange(change.changeKind),
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
    options: Contract.ClaimKnowledgeJobOptions = {},
  ): Promise<Contract.KnowledgeJobRow | null> {
    Utils.assertOwner(owner);
    const now = Utils.normalizeNow(options.now);
    const leaseMs = Utils.normalizeLeaseMs(options.leaseMs);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_claim", async () => {
        await Utils.assertActiveLibrary(this.db, this.libraryId);
        await this.recoverExpiredLeasesInTransaction(now);
        const candidates = await this.db.query<{
          id: string;
          attempts: number;
          status: Contract.KnowledgeJobStatus;
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
    options: Contract.KnowledgeJobLeaseOptions = {},
  ): Promise<Contract.KnowledgeJobRow | null> {
    Utils.assertId(jobId, "Knowledge job id");
    Utils.assertOwner(owner);
    const now = Utils.normalizeNow(options.now);
    const leaseMs = Utils.normalizeLeaseMs(options.leaseMs);
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
    options: Contract.KnowledgeJobLeaseOptions = {},
  ): Promise<Contract.KnowledgeJobRow | null> {
    Utils.assertId(jobId, "Knowledge job id");
    Utils.assertOwner(owner);
    const now = Utils.normalizeNow(options.now);
    const leaseMs = Utils.normalizeLeaseMs(options.leaseMs);
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
  ): Promise<Contract.KnowledgeJobRow | null> {
    Utils.assertId(jobId, "Knowledge job id");
    Utils.assertOwner(owner);
    const now = Utils.normalizeNow(options.now);
    const progressJson = Utils.serializeJson(options.progress, "Knowledge job progress");
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
    options: Contract.FailKnowledgeJobOptions = {},
  ): Promise<Contract.KnowledgeJobRow | null> {
    Utils.assertId(jobId, "Knowledge job id");
    Utils.assertOwner(owner);
    const now = Utils.normalizeNow(options.now);
    const message = Queue.summarizeKnowledgeJobError(error);
    const requestedDelay = options.retryDelayMs;
    if (
      requestedDelay !== undefined &&
      (!Number.isSafeInteger(requestedDelay) || requestedDelay < 0)
    ) {
      throw new Error("retryDelayMs must be a non-negative integer");
    }
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_fail", async () => {
        const jobs = await this.db.query<
          Pick<Contract.KnowledgeJobStorageRow, "attempts" | "max_attempts">
        >(
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
        const retryDelay = requestedDelay ?? Queue.knowledgeJobRetryDelayMs(job.attempts);
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
    options: Contract.CancelKnowledgeJobOptions = {},
  ): Promise<Contract.KnowledgeJobRow | null> {
    Utils.assertId(jobId, "Knowledge job id");
    if (options.owner !== undefined) Utils.assertOwner(options.owner);
    const now = Utils.normalizeNow(options.now);
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
    sourceType: Contract.KnowledgeChangeSourceType,
    sourceId: string,
    options: { now?: number } = {},
  ): Promise<number> {
    Utils.assertKnownChangeSourceType(sourceType);
    Utils.assertId(sourceId, "Knowledge job source id");
    const now = Utils.normalizeNow(options.now);
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
    const normalizedNow = Utils.normalizeNow(now);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "knowledge_job_recover", async () => {
        await Utils.assertActiveLibrary(this.db, this.libraryId);
        return this.recoverExpiredLeasesInTransaction(normalizedNow);
      }),
    );
  }

  private async enqueueInTransaction(
    input: Contract.EnqueueKnowledgeJobInput,
  ): Promise<{ job: Contract.KnowledgeJobRow; created: boolean }> {
    const normalized = Queue.normalizeEnqueueInput(input);
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
    input: Queue.NormalizedEnqueueKnowledgeJobInput,
  ): Promise<Contract.KnowledgeJobRow | null> {
    if (input.sourceChangeSeq !== null) {
      const byChange = await this.db.query<Contract.KnowledgeJobStorageRow>(
        `SELECT ${Queue.KNOWLEDGE_JOB_COLUMNS}
         FROM knowledge_jobs
         WHERE library_id = ? AND source_change_seq = ?
         LIMIT 1`,
        [this.libraryId, input.sourceChangeSeq],
      );
      if (byChange[0]) return Queue.toKnowledgeJobRow(byChange[0]);
    }
    const active = await this.db.query<Contract.KnowledgeJobStorageRow>(
      `SELECT ${Queue.KNOWLEDGE_JOB_COLUMNS}
       FROM knowledge_jobs
       WHERE library_id = ? AND dedupe_key = ?
         AND status IN ('queued', 'leased', 'running', 'retry-wait')
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [this.libraryId, input.dedupeKey],
    );
    return active[0] ? Queue.toKnowledgeJobRow(active[0]) : null;
  }

  private async recoverExpiredLeasesInTransaction(now: number): Promise<number> {
    const rows = await this.db.query<
      Pick<Contract.KnowledgeJobStorageRow, "id" | "attempts" | "max_attempts">
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

  private async getInLibrary(jobId: string): Promise<Contract.KnowledgeJobRow | null> {
    const rows = await this.db.query<Contract.KnowledgeJobStorageRow>(
      `SELECT ${Queue.KNOWLEDGE_JOB_COLUMNS}
       FROM knowledge_jobs
       WHERE id = ? AND library_id = ?
       LIMIT 1`,
      [jobId, this.libraryId],
    );
    return rows[0] ? Queue.toKnowledgeJobRow(rows[0]) : null;
  }
}
