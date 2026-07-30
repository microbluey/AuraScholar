import {
  copyDiscoveryRecord,
  createDiscoverySearchStatuses,
  reconcileDiscoverySelection,
  toDiscoverySearchError,
} from "./discovery-search-controller-model";
import type {
  DiscoverySearchControllerDependencies,
  DiscoverySearchOperationResult,
  DiscoverySearchRequest,
  DiscoverySearchSnapshot,
} from "./discovery-search-controller-model";

export interface DiscoverySearchTicket<Query, Source extends PropertyKey> {
  controller: AbortController;
  generation: number;
  lifecycle: number;
  promise: Promise<DiscoverySearchOperationResult>;
  request: DiscoverySearchRequest<Query, Source>;
}

export interface DiscoveryLoadMoreTicket<
  Query,
  Source extends PropertyKey,
  Cursor,
> extends DiscoverySearchTicket<Query, Source> {
  cursorSnapshot: Partial<Record<Source, Cursor>>;
  sources: readonly Source[];
}

interface ExecutionContext<Query, Source extends PropertyKey, Result, Report, Cursor, Status> {
  dependencies: DiscoverySearchControllerDependencies<
    Query,
    Source,
    Result,
    Report,
    Cursor,
    Status
  >;
  getSnapshot(): DiscoverySearchSnapshot<Result, Source, Cursor, Status>;
  isCurrent(): boolean;
  release(): void;
  update(patch: Partial<DiscoverySearchSnapshot<Result, Source, Cursor, Status>>): void;
}

const stoppedResult: DiscoverySearchOperationResult = { status: "stopped" };

export async function executeDiscoverySearch<
  Query,
  Source extends PropertyKey,
  Result,
  Report,
  Cursor,
  Status,
>(
  context: ExecutionContext<Query, Source, Result, Report, Cursor, Status>,
  ticket: DiscoverySearchTicket<Query, Source>,
): Promise<DiscoverySearchOperationResult> {
  const { dependencies } = context;
  const startedAt = dependencies.now?.() ?? Date.now();
  try {
    const preview = dependencies.preview?.(ticket.request);
    if (preview) {
      if (!context.isCurrent()) return stoppedResult;
      const results = dependencies.mergeResults(preview.results);
      context.update({
        cursors: copyDiscoveryRecord(preview.cursors ?? {}),
        results,
        searching: false,
        selectedId: reconcileDiscoverySelection(
          results,
          null,
          dependencies.resultId,
          [],
          dependencies.resultKeys,
        ),
        sourceStatus: {
          ...searchStatuses(dependencies, []),
          ...preview.sourceStatus,
        },
      });
      if (context.isCurrent()) reportMessage(dependencies, preview.message ?? null);
      context.release();
      return { status: "applied" };
    }

    const settled = await Promise.allSettled(
      ticket.request.sources.map(async (source) => {
        try {
          const report = await dependencies.loadSource({
            kind: "search",
            query: ticket.request.query,
            signal: ticket.controller.signal,
            source,
          });
          publishSourceReport(context, report, source);
          return report;
        } catch (error) {
          publishSourceFailure(context, source);
          throw error;
        }
      }),
    );
    if (!context.isCurrent()) return stoppedResult;
    await wait(dependencies, startedAt, "search");
    if (!context.isCurrent()) return stoppedResult;

    const completed: Array<{ report: Report; source: Source }> = [];
    let sourceFailure: unknown;
    settled.forEach((item, index) => {
      const source = ticket.request.sources[index];
      if (source === undefined) return;
      if (item.status === "fulfilled") completed.push({ report: item.value as Report, source });
      else sourceFailure ??= item.reason;
    });
    const reports = completed.map(({ report }) => report);
    const snapshot = context.getSnapshot();
    const results = dependencies.mergeResults(snapshot.results);
    const cursors = copyDiscoveryRecord(snapshot.cursors);
    const sourceStatus = copyDiscoveryRecord(snapshot.sourceStatus) as Record<Source, Status>;
    const error = sourceFailure
      ? toDiscoverySearchError(sourceFailure, dependencies.toError)
      : null;
    context.update({
      cursors,
      results,
      searchError: error && results.length === 0 ? describeError(dependencies, error) : null,
      searching: false,
      selectedId: reconcileDiscoverySelection(
        results,
        snapshot.selectedId,
        dependencies.resultId,
        snapshot.results,
        dependencies.resultKeys,
      ),
      sourceStatus,
    });
    const message =
      error && results.length === 0
        ? dependencies.messages?.searchFailed?.(error, ticket.request)
        : dependencies.messages?.searchSucceeded?.(results, reports, ticket.request);
    if (context.isCurrent()) reportMessage(dependencies, message ?? null);
    context.release();
    if (error && results.length > 0) return { status: "partial", error };
    return error ? { status: "failed", error } : { status: "applied" };
  } catch (failure) {
    await waitAfterFailure(dependencies, startedAt, "search");
    if (!context.isCurrent()) return stoppedResult;
    const error = toDiscoverySearchError(failure, dependencies.toError);
    const sourceStatus = searchStatuses(dependencies, []);
    for (const source of ticket.request.sources) sourceStatus[source] = dependencies.statuses.error;
    context.update({
      searchError: describeError(dependencies, error),
      searching: false,
      sourceStatus,
    });
    if (context.isCurrent()) {
      reportMessage(
        dependencies,
        dependencies.messages?.searchFailed?.(error, ticket.request) ?? null,
      );
    }
    context.release();
    return { status: "failed", error };
  }
}

function publishSourceReport<Query, Source extends PropertyKey, Result, Report, Cursor, Status>(
  context: ExecutionContext<Query, Source, Result, Report, Cursor, Status>,
  report: Report,
  source: Source,
): void {
  if (!context.isCurrent()) return;
  const { dependencies } = context;
  const snapshot = context.getSnapshot();
  const results = dependencies.mergeResults([
    ...snapshot.results,
    ...dependencies.getResults(report),
  ]);
  const cursors = copyDiscoveryRecord(snapshot.cursors);
  const cursor = dependencies.getCursor(report, source);
  if (cursor === undefined) delete cursors[source];
  else cursors[source] = cursor;
  context.update({
    cursors,
    results,
    selectedId: reconcileDiscoverySelection(
      results,
      snapshot.selectedId,
      dependencies.resultId,
      snapshot.results,
      dependencies.resultKeys,
    ),
    sourceStatus: {
      ...snapshot.sourceStatus,
      [source]: dependencies.getSourceStatus(report, source),
    },
  });
}

function publishSourceFailure<Query, Source extends PropertyKey, Result, Report, Cursor, Status>(
  context: ExecutionContext<Query, Source, Result, Report, Cursor, Status>,
  source: Source,
): void {
  if (!context.isCurrent()) return;
  const snapshot = context.getSnapshot();
  context.update({
    sourceStatus: {
      ...snapshot.sourceStatus,
      [source]: context.dependencies.statuses.error,
    },
  });
}

export async function executeDiscoveryLoadMore<
  Query,
  Source extends PropertyKey,
  Result,
  Report,
  Cursor,
  Status,
>(
  context: ExecutionContext<Query, Source, Result, Report, Cursor, Status>,
  ticket: DiscoveryLoadMoreTicket<Query, Source, Cursor>,
): Promise<DiscoverySearchOperationResult> {
  const { dependencies } = context;
  const startedAt = dependencies.now?.() ?? Date.now();
  try {
    const settled = await Promise.allSettled(
      ticket.sources.map(async (source) => {
        try {
          const report = await dependencies.loadSource({
            cursor: ticket.cursorSnapshot[source],
            kind: "load-more",
            query: ticket.request.query,
            signal: ticket.controller.signal,
            source,
          });
          publishSourceReport(context, report, source);
          return report;
        } catch (error) {
          publishSourceFailure(context, source);
          throw error;
        }
      }),
    );
    if (!context.isCurrent()) return stoppedResult;
    await wait(dependencies, startedAt, "load-more");
    if (!context.isCurrent()) return stoppedResult;

    const completed: Array<{ report: Report; source: Source }> = [];
    let sourceFailure: unknown;
    settled.forEach((item, index) => {
      const source = ticket.sources[index];
      if (source === undefined) return;
      if (item.status === "fulfilled") completed.push({ report: item.value as Report, source });
      else sourceFailure ??= item.reason;
    });
    const reports = completed.map(({ report }) => report);
    const snapshot = context.getSnapshot();
    const results = snapshot.results;
    const cursors = copyDiscoveryRecord(snapshot.cursors);
    const sourceStatus = copyDiscoveryRecord(snapshot.sourceStatus) as Record<Source, Status>;
    const error = sourceFailure
      ? toDiscoverySearchError(sourceFailure, dependencies.toError)
      : null;
    context.update({
      cursors,
      loadingMore: false,
      loadMoreError: error ? describeError(dependencies, error) : null,
      results,
      selectedId: reconcileDiscoverySelection(
        results,
        snapshot.selectedId,
        dependencies.resultId,
        snapshot.results,
        dependencies.resultKeys,
      ),
      sourceStatus,
    });
    const message = error
      ? dependencies.messages?.loadMoreFailed?.(error, ticket.request)
      : dependencies.messages?.loadMoreSucceeded?.(results, reports, ticket.request);
    if (context.isCurrent()) reportMessage(dependencies, message ?? null);
    context.release();
    return error ? { status: "failed", error } : { status: "applied" };
  } catch (failure) {
    await waitAfterFailure(dependencies, startedAt, "load-more");
    if (!context.isCurrent()) return stoppedResult;
    const error = toDiscoverySearchError(failure, dependencies.toError);
    context.update({
      loadingMore: false,
      loadMoreError: describeError(dependencies, error),
    });
    if (context.isCurrent()) {
      reportMessage(
        dependencies,
        dependencies.messages?.loadMoreFailed?.(error, ticket.request) ?? null,
      );
    }
    context.release();
    return { status: "failed", error };
  }
}

function describeError<Query, Source extends PropertyKey, Result, Report, Cursor, Status>(
  dependencies: DiscoverySearchControllerDependencies<
    Query,
    Source,
    Result,
    Report,
    Cursor,
    Status
  >,
  error: Error,
): string {
  try {
    return dependencies.describeError(error);
  } catch {
    return error.message || "Discovery search failed";
  }
}

function reportMessage<Query, Source extends PropertyKey, Result, Report, Cursor, Status>(
  dependencies: DiscoverySearchControllerDependencies<
    Query,
    Source,
    Result,
    Report,
    Cursor,
    Status
  >,
  message: string | null,
): void {
  try {
    dependencies.reportMessage?.(message);
  } catch {
    // Feedback is observational and cannot invalidate committed state.
  }
}

function searchStatuses<Query, Source extends PropertyKey, Result, Report, Cursor, Status>(
  dependencies: DiscoverySearchControllerDependencies<
    Query,
    Source,
    Result,
    Report,
    Cursor,
    Status
  >,
  searching: readonly Source[],
): Record<Source, Status> {
  return createDiscoverySearchStatuses(
    dependencies.allSources,
    searching,
    dependencies.statuses.idle,
    dependencies.statuses.searching,
  );
}

async function wait<Query, Source extends PropertyKey, Result, Report, Cursor, Status>(
  dependencies: DiscoverySearchControllerDependencies<
    Query,
    Source,
    Result,
    Report,
    Cursor,
    Status
  >,
  startedAt: number,
  kind: "search" | "load-more",
): Promise<void> {
  await dependencies.waitForMinimumElapsed?.(startedAt, kind);
}

async function waitAfterFailure<Query, Source extends PropertyKey, Result, Report, Cursor, Status>(
  dependencies: DiscoverySearchControllerDependencies<
    Query,
    Source,
    Result,
    Report,
    Cursor,
    Status
  >,
  startedAt: number,
  kind: "search" | "load-more",
): Promise<void> {
  try {
    await wait(dependencies, startedAt, kind);
  } catch {
    // Preserve the original operation failure.
  }
}
