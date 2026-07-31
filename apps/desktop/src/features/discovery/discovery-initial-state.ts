import type { DiscoverySource } from "@aurascholar/core";
import type { DiscoveryResultWithLibrary } from "../../services/discovery";
import { isDesktopRuntime } from "../../services/aura-platform";
import { initialFulltextTask, type FulltextTask } from "../../services/fulltext";
import type { DiscoverySourceStatus } from "./discovery-search-model";

export type DiscoveryInitialMode = "home" | "opensource";

export interface DiscoveryInitialState {
  mode: DiscoveryInitialMode;
  pendingTask: FulltextTask | null;
  query: string;
  results: DiscoveryResultWithLibrary[];
  selectedId: string | null;
  sourceStatus: Record<DiscoverySource, DiscoverySourceStatus>;
}

export interface DiscoveryInitialStateOptions {
  allSources: readonly DiscoverySource[];
  previewQuery: string;
  previewResults: DiscoveryResultWithLibrary[];
}

export function previewDiscoverySourceStatus(
  allSources: readonly DiscoverySource[],
  activeSources: readonly DiscoverySource[] = allSources,
): Record<DiscoverySource, DiscoverySourceStatus> {
  const active = new Set(activeSources);
  return Object.fromEntries(
    allSources.map((source) => [
      source,
      active.has(source) ? (source === "arxiv" ? "empty" : "done") : "idle",
    ]),
  ) as Record<DiscoverySource, DiscoverySourceStatus>;
}

export function createDiscoveryInitialState({
  allSources,
  previewQuery,
  previewResults,
}: DiscoveryInitialStateOptions): DiscoveryInitialState {
  const desktopRuntime = isDesktopRuntime();
  const pendingTask = pendingFulltextTaskFromHash();
  const idleStatus = () =>
    Object.fromEntries(allSources.map((source) => [source, "idle"])) as Record<
      DiscoverySource,
      DiscoverySourceStatus
    >;
  return {
    mode: desktopRuntime ? "home" : "opensource",
    pendingTask,
    query: pendingTask?.title.trim() || (desktopRuntime ? "" : previewQuery),
    results: pendingTask || desktopRuntime ? [] : previewResults,
    selectedId: pendingTask || desktopRuntime ? null : (previewResults[0]?.id ?? null),
    sourceStatus:
      pendingTask || desktopRuntime
        ? idleStatus()
        : previewDiscoverySourceStatus(allSources, allSources),
  };
}

function pendingFulltextTaskFromHash(): FulltextTask | null {
  if (typeof window === "undefined") return null;
  const queryIndex = window.location.hash.indexOf("?");
  if (queryIndex < 0) return null;
  return initialFulltextTask(window.location.hash.slice(queryIndex + 1));
}
