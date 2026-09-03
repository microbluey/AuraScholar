import type { Database } from "../database.js";
import type { KnowledgeJobRow } from "./knowledge-contract.js";

/** The immutable claim identity a durable worker must fence on every write. */
export type KnowledgeJobLeaseSnapshot = Pick<
  KnowledgeJobRow,
  "id" | "libraryId" | "attempts" | "leaseOwner" | "leaseExpiresAt"
>;

/** Raised when a worker tries to write after its queue claim was replaced. */
export class KnowledgeJobLeaseLostError extends Error {
  readonly code = "KNOWLEDGE_JOB_LEASE_LOST" as const;

  constructor(jobId: string) {
    super(`Knowledge job lease is no longer owned: ${jobId}`);
    this.name = "KnowledgeJobLeaseLostError";
  }
}

/**
 * Fences a durable executor write against a newer claim, cancellation, or
 * expiry. `attempts` is the monotonic claim epoch already maintained by the
 * queue, so reusing an owner string cannot let an old worker pass the check.
 * Call this inside the same transaction as the derived write.
 */
export async function assertKnowledgeJobLease(
  database: Database,
  job: KnowledgeJobLeaseSnapshot,
  now = Date.now(),
): Promise<void> {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("Knowledge job lease timestamp must be a non-negative integer");
  }
  if (
    !job.leaseOwner ||
    !Number.isSafeInteger(job.attempts) ||
    job.attempts < 1 ||
    !Number.isSafeInteger(job.leaseExpiresAt ?? Number.NaN)
  ) {
    throw new KnowledgeJobLeaseLostError(job.id);
  }

  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM knowledge_jobs
     WHERE id = ? AND library_id = ?
       AND status IN ('leased', 'running')
       AND attempts = ? AND lease_owner = ? AND lease_expires_at > ?
     LIMIT 1`,
    [job.id, job.libraryId, job.attempts, job.leaseOwner, now],
  );
  if (!rows[0]) throw new KnowledgeJobLeaseLostError(job.id);
}

/** Adds the caller's Library binding before authorizing a derived write. */
export async function assertKnowledgeJobLeaseForLibrary(
  database: Database,
  job: KnowledgeJobLeaseSnapshot,
  libraryId: string,
  now = Date.now(),
): Promise<void> {
  if (job.libraryId !== libraryId) throw new KnowledgeJobLeaseLostError(job.id);
  await assertKnowledgeJobLease(database, job, now);
}

export function isKnowledgeJobLeaseLostError(error: unknown): error is KnowledgeJobLeaseLostError {
  return (
    error instanceof KnowledgeJobLeaseLostError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "KNOWLEDGE_JOB_LEASE_LOST")
  );
}
