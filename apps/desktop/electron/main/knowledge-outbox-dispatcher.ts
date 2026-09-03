import {
  KnowledgeJobWorker,
  KnowledgeJobsRepo,
  requireLocalLibraryId,
  type FailKnowledgeJobOptions,
  type KnowledgeJobLeaseOptions,
  type KnowledgeJobQueue,
  type KnowledgeJobRow,
} from "@aurascholar/db";
import { withMainDatabase } from "./db";
import { knowledgeJobExecutor } from "./knowledge-executor-runtime";

/**
 * Main-process owner for durable Knowledge work. Each pass first materializes
 * canonical outbox rows, then consumes exactly one leased job. This keeps PDF
 * extraction recoverable across app restarts while leaving future FTS/vector
 * consumers as independent job kinds.
 */
export class KnowledgeOutboxDispatcher {
  private active = false;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly worker: KnowledgeJobWorker;

  constructor(
    private readonly options: {
      batchSize?: number;
      pollMs?: number;
    } = {},
  ) {
    this.worker = new KnowledgeJobWorker(new MainProcessKnowledgeQueue(), knowledgeJobExecutor, {
      dispatchLimit: normalizeBatchSize(options.batchSize),
    });
  }

  start(): void {
    if (this.active) return;
    this.stopped = false;
    this.active = true;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    this.active = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  async flush(): Promise<number> {
    const batchSize = normalizeBatchSize(this.options.batchSize);
    return withMainDatabase(async (database) => {
      const libraryId = await requireLocalLibraryId(database);
      const jobs = new KnowledgeJobsRepo(database, libraryId);
      return (await jobs.dispatchPendingChanges(batchSize)).length;
    });
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runScheduledPass();
    }, delay);
  }

  private async runScheduledPass(): Promise<void> {
    let delay = normalizePollMs(this.options.pollMs);
    try {
      const result = await this.worker.runOnce();
      // Keep draining immediately while work is available, but yield between
      // jobs so file extraction never monopolizes the Electron event loop.
      if (result.kind !== "idle") delay = 0;
    } catch {
      // Jobs remain in the outbox and the next interval retries the handoff.
      // Do not surface startup/transient storage errors to the renderer here.
    } finally {
      if (!this.stopped) this.schedule(delay);
    }
  }
}

/** Adapter that resolves the active local Library for every queue operation. */
class MainProcessKnowledgeQueue implements KnowledgeJobQueue {
  async dispatchPendingChanges(limit?: number): Promise<readonly KnowledgeJobRow[]> {
    return this.withRepo((jobs) => jobs.dispatchPendingChanges(limit));
  }

  async claimNext(
    owner: string,
    options?: KnowledgeJobLeaseOptions,
  ): Promise<KnowledgeJobRow | null> {
    return this.withRepo((jobs) => jobs.claimNext(owner, options));
  }

  async start(
    jobId: string,
    owner: string,
    options?: KnowledgeJobLeaseOptions,
  ): Promise<KnowledgeJobRow | null> {
    return this.withRepo((jobs) => jobs.start(jobId, owner, options));
  }

  async renewLease(
    jobId: string,
    owner: string,
    options?: KnowledgeJobLeaseOptions,
  ): Promise<KnowledgeJobRow | null> {
    return this.withRepo((jobs) => jobs.renewLease(jobId, owner, options));
  }

  async complete(
    jobId: string,
    owner: string,
    options?: { now?: number; progress?: unknown | null; expectedAttempts?: number },
  ): Promise<KnowledgeJobRow | null> {
    return this.withRepo((jobs) => jobs.complete(jobId, owner, options));
  }

  async fail(
    jobId: string,
    owner: string,
    error: unknown,
    options?: FailKnowledgeJobOptions,
  ): Promise<KnowledgeJobRow | null> {
    return this.withRepo((jobs) => jobs.fail(jobId, owner, error, options));
  }

  private async withRepo<T>(operation: (jobs: KnowledgeJobsRepo) => Promise<T>): Promise<T> {
    return withMainDatabase(async (database) => {
      const libraryId = await requireLocalLibraryId(database);
      return operation(new KnowledgeJobsRepo(database, libraryId));
    });
  }
}

export const knowledgeOutboxDispatcher = new KnowledgeOutboxDispatcher();

function normalizeBatchSize(value: number | undefined): number {
  const batchSize = value ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("Knowledge outbox batch size must be an integer between 1 and 1000");
  }
  return batchSize;
}

function normalizePollMs(value: number | undefined): number {
  const pollMs = value ?? 5_000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 250 || pollMs > 60_000) {
    throw new Error("Knowledge outbox poll interval must be an integer between 250 and 60000");
  }
  return pollMs;
}
