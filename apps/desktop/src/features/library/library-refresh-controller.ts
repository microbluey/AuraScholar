export type LibraryRefreshResult<Query, Data> =
  | {
      status: "applied";
      query: Query;
      data: Data;
    }
  | {
      status: "failed";
      query: Query;
      error: Error;
    }
  | {
      status: "stopped";
      query: Query;
    };

export interface LibraryRefreshControllerDependencies<Query, Data> {
  getQuery(): Query;
  load(query: Query): Promise<Data>;
  apply(data: Data, query: Query): void;
  isSameQuery?(left: Query, right: Query): boolean;
  reportFailure?(error: Error, query: Query): void;
  toError?(error: unknown): Error;
}

type RefreshBatch<Query, Data> = {
  dirty: boolean;
  latestQuery: Query;
  lifecycle: number;
  promise: Promise<LibraryRefreshResult<Query, Data>>;
  settled: boolean;
};

function defaultToError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Library refresh failed");
}

/**
 * Serializes library reads while retaining only the newest requested query.
 *
 * Queries are expected to be immutable values. A refresh called during an
 * active read joins that batch and waits for the final trailing query.
 */
export class LibraryRefreshController<Query, Data> {
  private active = false;
  private currentBatch: RefreshBatch<Query, Data> | null = null;
  private lifecycle = 0;
  private loadQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: LibraryRefreshControllerDependencies<Query, Data>) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
  }

  refresh(): Promise<LibraryRefreshResult<Query, Data>> {
    const query = this.dependencies.getQuery();
    if (!this.active) return Promise.resolve({ status: "stopped", query });

    const current = this.currentBatch;
    if (current && current.lifecycle === this.lifecycle && !current.settled) {
      current.latestQuery = query;
      current.dirty = true;
      return current.promise;
    }

    const batch: RefreshBatch<Query, Data> = {
      dirty: true,
      latestQuery: query,
      lifecycle: this.lifecycle,
      promise: Promise.resolve({ status: "stopped", query }),
      settled: false,
    };

    const run = this.loadQueue.then(
      () => this.drain(batch),
      () => this.drain(batch),
    );
    this.loadQueue = run.then(
      () => undefined,
      () => undefined,
    );
    batch.promise = run.finally(() => {
      if (this.currentBatch === batch) this.currentBatch = null;
    });
    this.currentBatch = batch;
    return batch.promise;
  }

  private async drain(
    batch: RefreshBatch<Query, Data>,
  ): Promise<LibraryRefreshResult<Query, Data>> {
    try {
      while (this.isCurrent(batch.lifecycle)) {
        const query = batch.latestQuery;
        batch.dirty = false;
        let data: Data | undefined;
        let failed = false;
        let failure: unknown;
        try {
          data = await this.dependencies.load(query);
        } catch (error) {
          failed = true;
          failure = error;
        }

        if (!this.isCurrent(batch.lifecycle)) {
          return { status: "stopped", query: batch.latestQuery };
        }
        const currentQuery = this.dependencies.getQuery();
        if (
          !this.isSameQuery(batch.latestQuery, currentQuery) ||
          !this.isSameQuery(query, currentQuery)
        ) {
          batch.latestQuery = currentQuery;
          batch.dirty = true;
        }
        if (batch.dirty) continue;

        // Mark the batch before invoking callbacks. A callback can synchronously
        // request another refresh, which must become a new serialized batch.
        batch.settled = true;
        if (failed) return this.publishFailure(failure, query);
        try {
          this.dependencies.apply(data as Data, query);
          return { status: "applied", query, data: data as Data };
        } catch (error) {
          return this.publishFailure(error, query);
        }
      }
      return { status: "stopped", query: batch.latestQuery };
    } finally {
      batch.settled = true;
    }
  }

  private publishFailure(error: unknown, query: Query): LibraryRefreshResult<Query, Data> {
    let normalized: Error;
    try {
      normalized = (this.dependencies.toError ?? defaultToError)(error);
    } catch (normalizationError) {
      normalized = defaultToError(normalizationError);
    }
    try {
      this.dependencies.reportFailure?.(normalized, query);
    } catch {
      // Reporting is observational and must not turn a typed refresh result into
      // an unhandled rejection.
    }
    return { status: "failed", query, error: normalized };
  }

  private isCurrent(lifecycle: number): boolean {
    return this.active && lifecycle === this.lifecycle;
  }

  private isSameQuery(left: Query, right: Query): boolean {
    return (this.dependencies.isSameQuery ?? Object.is)(left, right);
  }
}

export function createLibraryRefreshController<Query, Data>(
  dependencies: LibraryRefreshControllerDependencies<Query, Data>,
): LibraryRefreshController<Query, Data> {
  return new LibraryRefreshController(dependencies);
}
