import { newId } from "./ids.js";
import type {
  FailKnowledgeJobOptions,
  KnowledgeJobLeaseOptions,
  KnowledgeJobRow,
} from "./repos/knowledge.js";

/** The durable queue surface a worker needs; easy to exercise with a fake in tests. */
export interface KnowledgeJobQueue {
  dispatchPendingChanges(limit?: number): Promise<readonly KnowledgeJobRow[]>;
  claimNext(owner: string, options?: KnowledgeJobLeaseOptions): Promise<KnowledgeJobRow | null>;
  start(
    jobId: string,
    owner: string,
    options?: KnowledgeJobLeaseOptions,
  ): Promise<KnowledgeJobRow | null>;
  renewLease(
    jobId: string,
    owner: string,
    options?: KnowledgeJobLeaseOptions,
  ): Promise<KnowledgeJobRow | null>;
  complete(
    jobId: string,
    owner: string,
    options?: { now?: number; progress?: unknown | null },
  ): Promise<KnowledgeJobRow | null>;
  fail(
    jobId: string,
    owner: string,
    error: unknown,
    options?: FailKnowledgeJobOptions,
  ): Promise<KnowledgeJobRow | null>;
}

/** Executor implementations resolve current source state before producing derived data. */
export interface KnowledgeJobExecutor {
  execute(job: KnowledgeJobRow, signal: AbortSignal): Promise<void | { progress?: unknown | null }>;
}

export interface KnowledgeJobWorkerOptions {
  owner?: string;
  leaseMs?: number;
  /** Number of outbox records materialized before each claim. */
  dispatchLimit?: number;
  /** Defaults to half the lease, bounded so tiny leases still get a heartbeat. */
  heartbeatMs?: number;
}

export type KnowledgeJobWorkerResult =
  | { kind: "idle" }
  | { kind: "completed"; job: KnowledgeJobRow }
  | { kind: "failed"; job: KnowledgeJobRow | null }
  | { kind: "lost-lease"; job: KnowledgeJobRow };

/**
 * Runs one durable job at a time. It never owns an extractor implementation,
 * so desktop main can supply PDF/FTS handlers without coupling DB state to the
 * renderer's PDF runtime. Losing a lease aborts execution and deliberately
 * avoids finalising a job another worker may already own.
 */
export class KnowledgeJobWorker {
  private inFlight: Promise<KnowledgeJobWorkerResult> | null = null;
  private readonly owner: string;
  private readonly leaseMs: number;
  private readonly dispatchLimit: number;
  private readonly heartbeatMs: number;

  constructor(
    private readonly queue: KnowledgeJobQueue,
    private readonly executor: KnowledgeJobExecutor,
    options: KnowledgeJobWorkerOptions = {},
  ) {
    this.owner = options.owner?.trim() || `knowledge-worker:${newId()}`;
    this.leaseMs = normalizeLeaseMs(options.leaseMs);
    this.dispatchLimit = normalizeDispatchLimit(options.dispatchLimit);
    this.heartbeatMs = normalizeHeartbeatMs(options.heartbeatMs, this.leaseMs);
  }

  /** Idempotent under concurrent callers: they await the same in-flight pass. */
  async runOnce(): Promise<KnowledgeJobWorkerResult> {
    if (this.inFlight) return this.inFlight;
    const run = this.runOnceUnlocked();
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
    }
  }

  private async runOnceUnlocked(): Promise<KnowledgeJobWorkerResult> {
    await this.queue.dispatchPendingChanges(this.dispatchLimit);
    const claimed = await this.queue.claimNext(this.owner, { leaseMs: this.leaseMs });
    if (!claimed) return { kind: "idle" };

    const running = await this.queue.start(claimed.id, this.owner, { leaseMs: this.leaseMs });
    if (!running) return { kind: "lost-lease", job: claimed };

    const controller = new AbortController();
    let leaseLost = false;
    let heartbeatRunning = false;
    const heartbeat = async () => {
      if (heartbeatRunning || leaseLost) return;
      heartbeatRunning = true;
      try {
        const renewed = await this.queue.renewLease(running.id, this.owner, {
          leaseMs: this.leaseMs,
        });
        if (!renewed) {
          leaseLost = true;
          controller.abort(new Error("Knowledge job lease was lost"));
        }
      } catch {
        // A transient coordinator/database error should let the original lease
        // expire naturally; the next worker will recover it durably.
      } finally {
        heartbeatRunning = false;
      }
    };
    const timer = setInterval(() => {
      void heartbeat();
    }, this.heartbeatMs);

    try {
      const execution = await this.executor.execute(running, controller.signal);
      if (leaseLost) return { kind: "lost-lease", job: running };
      const completed = await this.queue.complete(running.id, this.owner, {
        progress: execution?.progress ?? null,
      });
      return completed
        ? { kind: "completed", job: completed }
        : { kind: "lost-lease", job: running };
    } catch (error) {
      if (leaseLost) return { kind: "lost-lease", job: running };
      const failed = await this.queue.fail(running.id, this.owner, error);
      return { kind: "failed", job: failed };
    } finally {
      clearInterval(timer);
    }
  }
}

function normalizeLeaseMs(value: number | undefined): number {
  const leaseMs = value ?? 60_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60_000) {
    throw new Error("leaseMs must be an integer between 1000 and 86400000");
  }
  return leaseMs;
}

function normalizeDispatchLimit(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("dispatchLimit must be an integer between 1 and 1000");
  }
  return limit;
}

function normalizeHeartbeatMs(value: number | undefined, leaseMs: number): number {
  const heartbeat = value ?? Math.max(500, Math.floor(leaseMs / 2));
  if (!Number.isSafeInteger(heartbeat) || heartbeat < 250 || heartbeat >= leaseMs) {
    throw new Error("heartbeatMs must be an integer from 250 up to less than leaseMs");
  }
  return heartbeat;
}
