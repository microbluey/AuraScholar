export interface DiscoverySearchRequest<Query, Source extends PropertyKey> {
  query: Query;
  sources: readonly Source[];
}

export interface DiscoverySourceLoadInput<Query, Source extends PropertyKey, Cursor> {
  cursor?: Cursor;
  kind: "search" | "load-more";
  query: Query;
  signal: AbortSignal;
  source: Source;
}

export interface DiscoverySearchPreview<Result, Source extends PropertyKey, Cursor, Status> {
  cursors?: Partial<Record<Source, Cursor>>;
  message?: string | null;
  results: readonly Result[];
  sourceStatus?: Partial<Record<Source, Status>>;
}

export interface DiscoverySearchSnapshot<Result, Source extends PropertyKey, Cursor, Status> {
  cursors: Partial<Record<Source, Cursor>>;
  loadingMore: boolean;
  loadMoreError: string | null;
  results: readonly Result[];
  searchError: string | null;
  searching: boolean;
  selectedId: string | null;
  sourceStatus: Record<Source, Status>;
}

export interface DiscoverySearchInitialSnapshot<
  Result,
  Source extends PropertyKey,
  Cursor,
  Status,
> {
  cursors?: Partial<Record<Source, Cursor>>;
  results?: readonly Result[];
  selectedId?: string | null;
  sourceStatus?: Partial<Record<Source, Status>>;
}

export interface DiscoverySearchMessageDependencies<
  Query,
  Source extends PropertyKey,
  Result,
  Report,
> {
  loadMoreFailed?(error: Error, request: DiscoverySearchRequest<Query, Source>): string | null;
  loadMoreSucceeded?(
    results: readonly Result[],
    reports: readonly Report[],
    request: DiscoverySearchRequest<Query, Source>,
  ): string | null;
  searchFailed?(error: Error, request: DiscoverySearchRequest<Query, Source>): string | null;
  searchSucceeded?(
    results: readonly Result[],
    reports: readonly Report[],
    request: DiscoverySearchRequest<Query, Source>,
  ): string | null;
}

export interface DiscoverySearchControllerDependencies<
  Query,
  Source extends PropertyKey,
  Result,
  Report,
  Cursor,
  Status,
> {
  allSources: readonly Source[];
  describeError(error: Error): string;
  getCursor(report: Report, source: Source): Cursor | undefined;
  getResults(report: Report): readonly Result[];
  getSourceStatus(report: Report, source: Source): Status;
  hasMore(cursor: Cursor): boolean;
  initialSnapshot?: DiscoverySearchInitialSnapshot<Result, Source, Cursor, Status>;
  loadSource(input: DiscoverySourceLoadInput<Query, Source, Cursor>): Promise<Report>;
  mergeResults(results: readonly Result[]): readonly Result[];
  messages?: DiscoverySearchMessageDependencies<Query, Source, Result, Report>;
  now?: () => number;
  preview?(
    request: DiscoverySearchRequest<Query, Source>,
  ): DiscoverySearchPreview<Result, Source, Cursor, Status> | null;
  reportMessage?(message: string | null): void;
  resultId(result: Result): string;
  resultKeys?(result: Result): readonly string[];
  statuses: {
    error: Status;
    idle: Status;
    searching: Status;
    stopped: Status;
  };
  toError?(error: unknown): Error;
  waitForMinimumElapsed?(startedAt: number, kind: "search" | "load-more"): Promise<void>;
}

export type DiscoverySearchOperationResult =
  | { status: "applied" }
  | { status: "partial"; error: Error }
  | { status: "failed"; error: Error }
  | {
      status: "skipped";
      reason: "inactive" | "no-active-search" | "no-more" | "searching";
    }
  | { status: "stopped" };

export function copyDiscoveryRecord<Source extends PropertyKey, Value>(
  input: Partial<Record<Source, Value>>,
): Partial<Record<Source, Value>> {
  return { ...input };
}

export function copyDiscoveryRequest<Query, Source extends PropertyKey>(
  input: DiscoverySearchRequest<Query, Source>,
): DiscoverySearchRequest<Query, Source> {
  return { query: input.query, sources: [...new Set(input.sources)] };
}

export function createDiscoverySourceRecord<Source extends PropertyKey, Status>(
  sources: readonly Source[],
  value: Status,
): Record<Source, Status> {
  const output = {} as Record<Source, Status>;
  for (const source of sources) output[source] = value;
  return output;
}

export function createDiscoverySearchStatuses<Source extends PropertyKey, Status>(
  allSources: readonly Source[],
  searchingSources: readonly Source[],
  idle: Status,
  searching: Status,
): Record<Source, Status> {
  const active = new Set(searchingSources);
  const output = {} as Record<Source, Status>;
  for (const source of allSources) output[source] = active.has(source) ? searching : idle;
  return output;
}

export function reconcileDiscoverySelection<Result>(
  results: readonly Result[],
  preferred: string | null,
  resultId: (result: Result) => string,
  previousResults: readonly Result[] = [],
  resultKeys?: (result: Result) => readonly string[],
): string | null {
  if (preferred && results.some((result) => resultId(result) === preferred)) return preferred;
  if (preferred && resultKeys) {
    const previous = previousResults.find((result) => resultId(result) === preferred);
    if (previous) {
      const previousKeys = new Set(resultKeys(previous));
      const replacement = results.find((result) =>
        resultKeys(result).some((key) => previousKeys.has(key)),
      );
      if (replacement) return resultId(replacement);
    }
  }
  const first = results[0];
  return first ? resultId(first) : null;
}

export function toDiscoverySearchError(
  error: unknown,
  normalize?: (error: unknown) => Error,
): Error {
  try {
    if (normalize) return normalize(error);
  } catch (normalizationFailure) {
    return normalizationFailure instanceof Error
      ? normalizationFailure
      : new Error("Discovery search failed");
  }
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Discovery search failed");
}
