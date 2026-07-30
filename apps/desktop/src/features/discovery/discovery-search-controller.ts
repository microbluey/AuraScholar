import {
  copyDiscoveryRecord,
  copyDiscoveryRequest,
  createDiscoverySearchStatuses,
  createDiscoverySourceRecord,
  reconcileDiscoverySelection,
} from "./discovery-search-controller-model";
import type {
  DiscoverySearchControllerDependencies,
  DiscoverySearchOperationResult,
  DiscoverySearchRequest,
  DiscoverySearchSnapshot,
} from "./discovery-search-controller-model";
import {
  executeDiscoveryLoadMore,
  executeDiscoverySearch,
  type DiscoveryLoadMoreTicket,
  type DiscoverySearchTicket,
} from "./discovery-search-executor";

export type {
  DiscoverySearchControllerDependencies,
  DiscoverySearchInitialSnapshot,
  DiscoverySearchMessageDependencies,
  DiscoverySearchOperationResult,
  DiscoverySearchPreview,
  DiscoverySearchRequest,
  DiscoverySearchSnapshot,
  DiscoverySourceLoadInput,
} from "./discovery-search-controller-model";

type Listener = () => void;

const stoppedResult: DiscoverySearchOperationResult = { status: "stopped" };

/**
 * Owns the lifetime of a discovery search session and its pagination requests.
 *
 * A fresh search synchronously supersedes every older search and load-more
 * request. Async work may finish after supersession, but only a current ticket
 * can publish to the external-store snapshot.
 */
export class DiscoverySearchController<
  Query,
  Source extends PropertyKey,
  Result,
  Report,
  Cursor,
  Status,
> {
  private active = false;
  private activeLoadMore: DiscoveryLoadMoreTicket<Query, Source, Cursor> | null = null;
  private activeRequest: DiscoverySearchRequest<Query, Source> | null = null;
  private activeSearch: DiscoverySearchTicket<Query, Source> | null = null;
  private generation = 0;
  private lifecycle = 0;
  private listeners = new Set<Listener>();
  private snapshot: DiscoverySearchSnapshot<Result, Source, Cursor, Status>;

  constructor(
    private readonly dependencies: DiscoverySearchControllerDependencies<
      Query,
      Source,
      Result,
      Report,
      Cursor,
      Status
    >,
  ) {
    const initialResults = dependencies.mergeResults(dependencies.initialSnapshot?.results ?? []);
    this.snapshot = {
      cursors: copyDiscoveryRecord(dependencies.initialSnapshot?.cursors ?? {}),
      loadingMore: false,
      loadMoreError: null,
      results: initialResults,
      searchError: null,
      searching: false,
      selectedId: reconcileDiscoverySelection(
        initialResults,
        dependencies.initialSnapshot?.selectedId ?? null,
        dependencies.resultId,
        dependencies.initialSnapshot?.results,
        dependencies.resultKeys,
      ),
      sourceStatus: {
        ...createDiscoverySourceRecord(dependencies.allSources, dependencies.statuses.idle),
        ...dependencies.initialSnapshot?.sourceStatus,
      },
    };
  }

  readonly getSnapshot = (): DiscoverySearchSnapshot<Result, Source, Cursor, Status> =>
    this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.cancelRequests();
    this.activeRequest = null;
  }

  cancel(): void {
    if (!this.active) return;
    this.cancelRequests();
  }

  private cancelRequests(): void {
    this.generation += 1;
    this.abortRequests();
    this.update({
      loadingMore: false,
      searching: false,
      sourceStatus: this.mapStatus(this.snapshot.sourceStatus, (status) =>
        Object.is(status, this.dependencies.statuses.searching)
          ? this.dependencies.statuses.stopped
          : status,
      ),
    });
  }

  search(input: DiscoverySearchRequest<Query, Source>): Promise<DiscoverySearchOperationResult> {
    if (!this.active) {
      return Promise.resolve({ status: "skipped", reason: "inactive" });
    }

    const request = copyDiscoveryRequest(input);
    this.generation += 1;
    this.abortRequests();
    this.activeRequest = request;

    const controller = new AbortController();
    const ticket: DiscoverySearchTicket<Query, Source> = {
      controller,
      generation: this.generation,
      lifecycle: this.lifecycle,
      promise: Promise.resolve(stoppedResult),
      request,
    };
    this.activeSearch = ticket;
    this.update({
      cursors: {},
      loadingMore: false,
      loadMoreError: null,
      results: [],
      searchError: null,
      searching: true,
      selectedId: null,
      sourceStatus: createDiscoverySearchStatuses(
        this.dependencies.allSources,
        request.sources,
        this.dependencies.statuses.idle,
        this.dependencies.statuses.searching,
      ),
    });
    this.publishMessage(null, ticket);
    if (!this.isCurrentSearch(ticket)) return Promise.resolve(stoppedResult);
    ticket.promise = executeDiscoverySearch(
      this.executionContext(
        () => this.isCurrentSearch(ticket),
        () => this.releaseSearch(ticket),
      ),
      ticket,
    );
    return ticket.promise;
  }

  loadMore(): Promise<DiscoverySearchOperationResult> {
    if (!this.active) {
      return Promise.resolve({ status: "skipped", reason: "inactive" });
    }
    if (this.activeLoadMore && this.isCurrent(this.activeLoadMore)) {
      return this.activeLoadMore.promise;
    }
    if (this.activeSearch && this.isCurrentSearch(this.activeSearch)) {
      return Promise.resolve({ status: "skipped", reason: "searching" });
    }
    const request = this.activeRequest;
    if (!request) {
      return Promise.resolve({ status: "skipped", reason: "no-active-search" });
    }

    const cursorSnapshot = copyDiscoveryRecord(this.snapshot.cursors);
    const sources = request.sources.filter((source) => {
      const cursor = cursorSnapshot[source];
      return cursor !== undefined && this.dependencies.hasMore(cursor);
    });
    if (sources.length === 0) {
      return Promise.resolve({ status: "skipped", reason: "no-more" });
    }

    const controller = new AbortController();
    const ticket: DiscoveryLoadMoreTicket<Query, Source, Cursor> = {
      controller,
      cursorSnapshot,
      generation: this.generation,
      lifecycle: this.lifecycle,
      promise: Promise.resolve(stoppedResult),
      request,
      sources,
    };
    this.activeLoadMore = ticket;
    this.update({ loadingMore: true, loadMoreError: null });
    if (!this.isCurrentLoadMore(ticket)) return Promise.resolve(stoppedResult);
    ticket.promise = executeDiscoveryLoadMore(
      this.executionContext(
        () => this.isCurrentLoadMore(ticket),
        () => this.releaseLoadMore(ticket),
      ),
      ticket,
    );
    return ticket.promise;
  }

  clear(): void {
    this.generation += 1;
    this.abortRequests();
    this.activeRequest = null;
    this.update({
      cursors: {},
      loadingMore: false,
      loadMoreError: null,
      results: [],
      searchError: null,
      searching: false,
      selectedId: null,
      sourceStatus: createDiscoverySourceRecord(
        this.dependencies.allSources,
        this.dependencies.statuses.idle,
      ),
    });
  }

  select(id: string | null): void {
    if (!this.active) return;
    const selectedId =
      id === null
        ? null
        : this.snapshot.results.some((result) => this.dependencies.resultId(result) === id)
          ? id
          : reconcileDiscoverySelection(
              this.snapshot.results,
              this.snapshot.selectedId,
              this.dependencies.resultId,
            );
    if (selectedId !== this.snapshot.selectedId) this.update({ selectedId });
  }

  updateResult(id: string, updater: (result: Result) => Result): void {
    if (!this.active) return;
    let updatedId: string | null = null;
    let changed = false;
    const updated = this.snapshot.results.map((result) => {
      if (this.dependencies.resultId(result) !== id) return result;
      const next = updater(result);
      updatedId = this.dependencies.resultId(next);
      changed ||= next !== result;
      return next;
    });
    if (!changed) return;
    const results = this.dependencies.mergeResults(updated);
    const preferred = this.snapshot.selectedId === id ? updatedId : this.snapshot.selectedId;
    this.update({
      results,
      selectedId: reconcileDiscoverySelection(
        results,
        preferred,
        this.dependencies.resultId,
        this.snapshot.results,
        this.dependencies.resultKeys,
      ),
    });
  }

  private abortRequests(): void {
    this.activeSearch?.controller.abort();
    this.activeLoadMore?.controller.abort();
    this.activeSearch = null;
    this.activeLoadMore = null;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // External-store observers cannot be allowed to corrupt controller state.
      }
    }
  }

  private executionContext(isCurrent: () => boolean, release: () => void) {
    return {
      dependencies: this.dependencies,
      getSnapshot: this.getSnapshot,
      isCurrent,
      release,
      update: (patch: Partial<DiscoverySearchSnapshot<Result, Source, Cursor, Status>>) =>
        this.update(patch),
    };
  }

  private isCurrent(ticket: DiscoverySearchTicket<Query, Source>): boolean {
    return (
      this.active &&
      ticket.lifecycle === this.lifecycle &&
      ticket.generation === this.generation &&
      !ticket.controller.signal.aborted
    );
  }

  private isCurrentLoadMore(ticket: DiscoveryLoadMoreTicket<Query, Source, Cursor>): boolean {
    return this.activeLoadMore === ticket && this.isCurrent(ticket);
  }

  private isCurrentSearch(ticket: DiscoverySearchTicket<Query, Source>): boolean {
    return this.activeSearch === ticket && this.isCurrent(ticket);
  }

  private mapStatus(
    input: Record<Source, Status>,
    mapper: (status: Status, source: Source) => Status,
  ): Record<Source, Status> {
    const output = copyDiscoveryRecord(input) as Record<Source, Status>;
    for (const source of this.dependencies.allSources)
      output[source] = mapper(input[source], source);
    return output;
  }

  private publishMessage(
    message: string | null,
    ticket: DiscoverySearchTicket<Query, Source>,
  ): void {
    if (!this.isCurrent(ticket)) return;
    try {
      this.dependencies.reportMessage?.(message);
    } catch {
      // Feedback is observational and must never invalidate committed state.
    }
  }

  private releaseLoadMore(ticket: DiscoveryLoadMoreTicket<Query, Source, Cursor>): void {
    if (this.activeLoadMore === ticket) this.activeLoadMore = null;
  }

  private releaseSearch(ticket: DiscoverySearchTicket<Query, Source>): void {
    if (this.activeSearch === ticket) this.activeSearch = null;
  }

  private update(patch: Partial<DiscoverySearchSnapshot<Result, Source, Cursor, Status>>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }
}

export function createDiscoverySearchController<
  Query,
  Source extends PropertyKey,
  Result,
  Report,
  Cursor,
  Status,
>(
  dependencies: DiscoverySearchControllerDependencies<
    Query,
    Source,
    Result,
    Report,
    Cursor,
    Status
  >,
): DiscoverySearchController<Query, Source, Result, Report, Cursor, Status> {
  return new DiscoverySearchController(dependencies);
}
