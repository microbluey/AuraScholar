import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type {
  DiscoveryQuery,
  DiscoverySort,
  DiscoverySource,
  SourceCursor,
} from "@aurascholar/core";
import { mergeDiscoveryResults } from "@aurascholar/core";
import type {
  DiscoveryResultWithLibrary,
  DiscoverySearchReportWithLibrary,
} from "../../services/discovery";
import { describeSafeError } from "../../services/sensitive-text";
import {
  createDiscoverySearchController,
  type DiscoverySearchInitialSnapshot,
  type DiscoverySearchOperationResult,
} from "./discovery-search-controller";
import type { DiscoverySearchController } from "./discovery-search-controller";
import {
  discoverySearchMessage,
  mergeDiscoveryStatus,
  uiSourceStatus,
  type DiscoverySourceStatus,
} from "./discovery-search-model";
import { discoveryResultIdentityKeys, sameDiscoveryResultIdentity } from "./discovery-result-model";

const MIN_SEARCH_BUSY_MS = 350;
const MIN_LOAD_MORE_BUSY_MS = 250;

export interface DiscoverySearchSessionQuery {
  query: DiscoveryQuery;
  sort: DiscoverySort;
}

type SearchController = DiscoverySearchController<
  DiscoverySearchSessionQuery,
  DiscoverySource,
  DiscoveryResultWithLibrary,
  DiscoverySearchReportWithLibrary,
  SourceCursor,
  DiscoverySourceStatus
>;

export interface DiscoverySearchInput {
  query: DiscoveryQuery;
  sort: DiscoverySort;
  sources: readonly DiscoverySource[];
}

export interface DiscoverySearchPreviewConfig {
  message: string;
  results: readonly DiscoveryResultWithLibrary[];
  sourceStatus(
    sources: readonly DiscoverySource[],
  ): Partial<Record<DiscoverySource, DiscoverySourceStatus>>;
}

export interface UseDiscoverySearchControllerOptions {
  allSources: readonly DiscoverySource[];
  initialSnapshot?: DiscoverySearchInitialSnapshot<
    DiscoveryResultWithLibrary,
    DiscoverySource,
    SourceCursor,
    DiscoverySourceStatus
  >;
  onMessage(message: string | null): void;
  preview?: DiscoverySearchPreviewConfig;
}

export function useDiscoverySearchController({
  allSources,
  initialSnapshot,
  onMessage,
  preview,
}: UseDiscoverySearchControllerOptions) {
  const controllerRef = useRef<SearchController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createDiscoverySearchController({
      allSources,
      describeError: (error) => describeSafeError(error),
      getCursor: (report, source) => report.cursors[source],
      getResults: (report) => report.results,
      getSourceStatus: (report, source) =>
        uiSourceStatus(report.sources[source]?.status ?? "empty"),
      hasMore: (cursor) => cursor.hasMore,
      initialSnapshot,
      loadSource: async ({ cursor, kind, query, signal, source }) => {
        const smokeFailure = consumeDiscoverySearchSmokeFailure(kind);
        if (smokeFailure) throw smokeFailure;
        const { searchDiscoveryDetailed } = await import("../../services/discovery");
        return searchDiscoveryDetailed(query.query, [source], signal, {
          cursors: cursor ? { [source]: cursor } : undefined,
          sort: query.sort,
        });
      },
      mergeResults: mergeDiscoverySearchResults,
      messages: {
        loadMoreFailed: (error) => `加载更多失败:${describeSafeError(error)}`,
        searchFailed: (error) => `检索失败:${describeSafeError(error)}`,
        searchSucceeded: (results, reports) => discoverySearchMessage(results.length, reports),
      },
      preview: preview
        ? (request) => ({
            message: preview.message,
            results: preview.results,
            sourceStatus: preview.sourceStatus(request.sources),
          })
        : undefined,
      reportMessage: onMessage,
      isSameResult: sameDiscoveryResultIdentity,
      resultId: (result) => result.id,
      resultKeys: discoveryResultIdentityKeys,
      statuses: {
        error: "error",
        idle: "idle",
        searching: "searching",
        stopped: "stopped",
      },
      toError: (error) => (error instanceof Error ? error : new Error(describeSafeError(error))),
      waitForMinimumElapsed,
    });
  }
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  const search = useCallback(
    ({ query, sort, sources }: DiscoverySearchInput) =>
      controller.search({ query: { query, sort }, sources }),
    [controller],
  );
  const loadMore = useCallback(() => controller.loadMore(), [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);
  const clear = useCallback(() => controller.clear(), [controller]);
  const select = useCallback((id: string | null) => controller.select(id), [controller]);
  const hasResult = useCallback(
    (reference: DiscoveryResultWithLibrary) => controller.hasResult(reference),
    [controller],
  );
  const updateResult = useCallback(
    (id: string, updater: (result: DiscoveryResultWithLibrary) => DiscoveryResultWithLibrary) =>
      controller.updateResult(id, updater),
    [controller],
  );
  const updateResultByIdentity = useCallback(
    (
      reference: DiscoveryResultWithLibrary,
      updater: (result: DiscoveryResultWithLibrary) => DiscoveryResultWithLibrary,
    ) => controller.updateResultByIdentity(reference, updater),
    [controller],
  );

  return {
    ...snapshot,
    cancel,
    clear,
    hasResult,
    loadMore,
    search,
    select,
    updateResult,
    updateResultByIdentity,
  };
}

async function waitForMinimumElapsed(
  startedAt: number,
  kind: "search" | "load-more",
): Promise<void> {
  const minimumMs = kind === "search" ? MIN_SEARCH_BUSY_MS : MIN_LOAD_MORE_BUSY_MS;
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

interface DiscoverySearchSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_LOAD_MORE__?: unknown;
  __AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SEARCH__?: unknown;
}

function consumeDiscoverySearchSmokeFailure(kind: "search" | "load-more"): Error | null {
  const target = window as DiscoverySearchSmokeWindow;
  const key =
    kind === "search"
      ? "__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SEARCH__"
      : "__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_LOAD_MORE__";
  const failure = target[key];
  if (failure == null) return null;
  delete target[key];
  return failure instanceof Error ? failure : new Error(describeSafeError(failure));
}

export function discoverySearchApplied(result: DiscoverySearchOperationResult): boolean {
  return result.status === "applied" || result.status === "partial";
}

export function mergeDiscoverySearchResults(
  results: readonly DiscoveryResultWithLibrary[],
  query: DiscoverySearchSessionQuery | null,
): readonly DiscoveryResultWithLibrary[] {
  return mergeDiscoveryResults([...results], mergeDiscoveryStatus, query?.sort ?? "relevance");
}
