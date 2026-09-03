import type { Database } from "../database.js";
import type {
  KnowledgeChangeSourceType,
  KnowledgeJobKind,
  KnowledgeJobRow,
} from "./knowledge-contract.js";

/** The immutable claim identity a durable worker must fence on every write. */
export type KnowledgeJobLeaseSnapshot = Pick<
  KnowledgeJobRow,
  "id" | "libraryId" | "attempts" | "leaseOwner" | "leaseExpiresAt"
> &
  Partial<Pick<KnowledgeJobRow, "kind" | "sourceType" | "sourceId" | "indexId">>;

/** The immutable queue target that a derived write is allowed to mutate. */
export interface KnowledgeJobLeaseTarget {
  kind: KnowledgeJobKind;
  sourceType: KnowledgeChangeSourceType;
  sourceId: string;
  indexId: string | null;
}

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
  await assertLeaseQuery(database, job, targetFromSnapshot(job), now);
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

/** Fences a write to an explicitly supplied queue target, including its index generation. */
export async function assertKnowledgeJobLeaseForTarget(
  database: Database,
  job: KnowledgeJobLeaseSnapshot,
  target: KnowledgeJobLeaseTarget,
  now = Date.now(),
): Promise<void> {
  if (!isValidTarget(target)) throw new KnowledgeJobLeaseLostError(job.id);
  await assertLeaseQuery(database, job, target, now);
}

/** Convenience binding for the native semantic-index generation boundary. */
export async function assertKnowledgeJobLeaseForIndex(
  database: Database,
  job: KnowledgeJobLeaseSnapshot,
  libraryId: string,
  indexId: string,
  now = Date.now(),
): Promise<void> {
  if (job.libraryId !== libraryId) throw new KnowledgeJobLeaseLostError(job.id);
  await assertKnowledgeJobLeaseForTarget(
    database,
    job,
    { kind: "embed", sourceType: "library", sourceId: libraryId, indexId },
    now,
  );
}

async function assertLeaseQuery(
  database: Database,
  job: KnowledgeJobLeaseSnapshot,
  target: KnowledgeJobLeaseTarget | undefined,
  now: number,
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

  const targetSql = target
    ? `AND kind = ? AND source_type = ? AND source_id = ?${
        target.indexId === null ? " AND index_id IS NULL" : " AND index_id = ?"
      }`
    : "";
  const params: unknown[] = [job.id, job.libraryId];
  if (target) {
    params.push(target.kind, target.sourceType, target.sourceId);
    if (target.indexId !== null) params.push(target.indexId);
  }
  params.push(job.attempts, job.leaseOwner, now);
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM knowledge_jobs
     WHERE id = ? AND library_id = ?
       ${targetSql}
       AND status IN ('leased', 'running')
       AND attempts = ? AND lease_owner = ? AND lease_expires_at > ?
     LIMIT 1`,
    params,
  );
  if (!rows[0]) throw new KnowledgeJobLeaseLostError(job.id);
}

function targetFromSnapshot(job: KnowledgeJobLeaseSnapshot): KnowledgeJobLeaseTarget | undefined {
  const hasTarget =
    job.kind !== undefined ||
    job.sourceType !== undefined ||
    job.sourceId !== undefined ||
    job.indexId !== undefined;
  if (!hasTarget) return undefined;
  if (
    job.kind === undefined ||
    job.sourceType === undefined ||
    job.sourceId === undefined ||
    job.indexId === undefined
  ) {
    throw new KnowledgeJobLeaseLostError(job.id);
  }
  return {
    kind: job.kind,
    sourceType: job.sourceType,
    sourceId: job.sourceId,
    indexId: job.indexId,
  };
}

function isValidTarget(target: KnowledgeJobLeaseTarget): boolean {
  return (
    typeof target.kind === "string" &&
    target.kind.length > 0 &&
    typeof target.sourceType === "string" &&
    target.sourceType.length > 0 &&
    typeof target.sourceId === "string" &&
    target.sourceId.length > 0 &&
    (target.indexId === null || (typeof target.indexId === "string" && target.indexId.length > 0))
  );
}

export function isKnowledgeJobLeaseLostError(error: unknown): error is KnowledgeJobLeaseLostError {
  return (
    error instanceof KnowledgeJobLeaseLostError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "KNOWLEDGE_JOB_LEASE_LOST")
  );
}
