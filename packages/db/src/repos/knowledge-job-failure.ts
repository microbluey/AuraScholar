import type { Database } from "../database.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { withDatabaseWriteLock } from "./write-lock.js";
import * as Contract from "./knowledge-contract.js";
import * as Queue from "./knowledge-queue-support.js";
import * as Utils from "./knowledge-utils.js";

/** Finalizes a worker failure only while the same claim epoch is still live. */
export async function failKnowledgeJob(
  database: Database,
  libraryId: string,
  jobId: string,
  owner: string,
  error: unknown,
  options: Contract.FailKnowledgeJobOptions = {},
): Promise<Contract.KnowledgeJobRow | null> {
  Utils.assertId(jobId, "Knowledge job id");
  Utils.assertOwner(owner);
  const now = Utils.normalizeNow(options.now);
  const expectedAttempts = Utils.normalizeExpectedAttempts(options.expectedAttempts);
  const attemptsClause = expectedAttempts === undefined ? "" : " AND attempts = ?";
  const message = Queue.summarizeKnowledgeJobError(error);
  const requestedDelay = options.retryDelayMs;
  if (
    requestedDelay !== undefined &&
    (!Number.isSafeInteger(requestedDelay) || requestedDelay < 0)
  ) {
    throw new Error("retryDelayMs must be a non-negative integer");
  }
  return withDatabaseWriteLock(database, () =>
    withDatabaseSavepoint(database, "knowledge_job_fail", async () => {
      const jobs = await database.query<
        Pick<Contract.KnowledgeJobStorageRow, "attempts" | "max_attempts">
      >(
        `SELECT attempts, max_attempts
         FROM knowledge_jobs
         WHERE id = ? AND library_id = ?
           AND status IN ('leased', 'running')
           AND lease_owner = ? AND lease_expires_at > ?${attemptsClause}
         LIMIT 1`,
        [
          jobId,
          libraryId,
          owner,
          now,
          ...(expectedAttempts === undefined ? [] : [expectedAttempts]),
        ],
      );
      const job = jobs[0];
      if (!job) return null;
      const terminal = job.attempts >= job.max_attempts;
      const retryDelay = requestedDelay ?? Queue.knowledgeJobRetryDelayMs(job.attempts);
      const changed = await database.run(
        `UPDATE knowledge_jobs
         SET status = ?, available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
             error = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ?
           AND status IN ('leased', 'running')
           AND lease_owner = ? AND lease_expires_at > ?${attemptsClause}`,
        [
          terminal ? "terminal-failed" : "retry-wait",
          terminal ? now : now + retryDelay,
          message,
          now,
          jobId,
          libraryId,
          owner,
          now,
          ...(expectedAttempts === undefined ? [] : [expectedAttempts]),
        ],
      );
      return changed === 1 ? getInLibrary(database, libraryId, jobId) : null;
    }),
  );
}

async function getInLibrary(
  database: Database,
  libraryId: string,
  jobId: string,
): Promise<Contract.KnowledgeJobRow | null> {
  const rows = await database.query<Contract.KnowledgeJobStorageRow>(
    `SELECT ${Queue.KNOWLEDGE_JOB_COLUMNS}
     FROM knowledge_jobs
     WHERE id = ? AND library_id = ?
     LIMIT 1`,
    [jobId, libraryId],
  );
  return rows[0] ? Queue.toKnowledgeJobRow(rows[0]) : null;
}
