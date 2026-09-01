import type { CitationGraph } from "@aurascholar/core";
import type { CitationGraphCacheEntry } from "../../electron/data-command-contract";
import {
  decodeCitationGraph,
  decodeCitationGraphGetCachedResult,
  decodeCitationGraphPutCachedResult,
} from "../shared/citation-graph-command-result-codec";
import {
  citationGraphCenterDoi,
  citationGraphMatchesDoi,
  citationGraphUtf8ByteLength,
  MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES,
  normalizeCitationGraphDoi,
} from "../shared/citation-graph-limits";
import { buildScholarlyCitationGraph } from "./scholarly-data";

export { normalizeCitationGraphDoi } from "../shared/citation-graph-limits";

export const CITATION_GRAPH_CACHE_TTL_MS = 7 * 86_400_000;

export type CitationGraphBuilder = (
  doi: string,
  signal?: AbortSignal,
) => Promise<CitationGraph | null | undefined>;

export interface LoadCitationGraphOptions {
  buildGraph?: CitationGraphBuilder;
  cacheTtlMs?: number;
  cache?: CitationGraphCacheDataSource;
  forceRefresh?: boolean;
  now?: () => number;
  signal?: AbortSignal;
}

/** Testable cache boundary; main owns the cache key and record mutations. */
export interface CitationGraphCacheDataSource {
  getCached: (rawDoi: string) => Promise<CitationGraphCacheEntry | null>;
  putCached: (doi: string, graph: CitationGraph) => Promise<boolean>;
}

export function isCitationGraph(value: unknown): value is CitationGraph {
  try {
    decodeCitationGraph(value);
    return true;
  } catch {
    return false;
  }
}

export function parseCachedCitationGraph(payload: string): CitationGraph | null {
  if (typeof payload !== "string") return null;
  try {
    if (citationGraphUtf8ByteLength(payload) > MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES) return null;
    const parsed: unknown = JSON.parse(payload);
    return decodeCitationGraph(parsed);
  } catch {
    return null;
  }
}

/**
 * Applies the renderer-owned cache freshness policy. A future timestamp is
 * never fresh: otherwise a negative age would satisfy the TTL indefinitely.
 */
export function isFreshCitationGraphCacheEntry(
  entry: CitationGraphCacheEntry,
  now: number,
  cacheTtlMs: number,
): boolean {
  if (
    !Number.isFinite(now) ||
    now < 0 ||
    !Number.isFinite(cacheTtlMs) ||
    cacheTtlMs <= 0 ||
    !Number.isSafeInteger(entry.fetchedAt) ||
    entry.fetchedAt < 0
  ) {
    return false;
  }
  const age = now - entry.fetchedAt;
  return Number.isFinite(age) && age >= 0 && age < cacheTtlMs;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Request aborted");
  error.name = "AbortError";
  throw error;
}

async function defaultBuildGraph(doi: string, signal?: AbortSignal): Promise<CitationGraph | null> {
  return (await buildScholarlyCitationGraph({ doi }, signal)).graph;
}

const defaultCacheDataSource: CitationGraphCacheDataSource = {
  async getCached(rawDoi) {
    const result = await window.aura.data.command("citationGraph.getCached", { doi: rawDoi });
    return decodeCitationGraphGetCachedResult(result, rawDoi).entry;
  },
  async putCached(doi, graph) {
    const result = await window.aura.data.command("citationGraph.putCached", { doi, graph });
    return decodeCitationGraphPutCachedResult(result).stored;
  },
};

export async function loadCitationGraphByDoi(
  rawDoi: string,
  options: LoadCitationGraphOptions = {},
): Promise<CitationGraph | null> {
  const doi = normalizeCitationGraphDoi(rawDoi);
  if (!doi) return null;
  const signal = options.signal;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? CITATION_GRAPH_CACHE_TTL_MS;
  const cache = options.cache ?? defaultCacheDataSource;
  throwIfAborted(signal);

  if (!options.forceRefresh) {
    // The raw value is intentional: main resolves the normalized key and its
    // historical raw-key variant atomically before returning an entry.
    const entry = await cache.getCached(rawDoi);
    throwIfAborted(signal);
    if (
      entry &&
      isFreshCitationGraphCacheEntry(entry, now(), cacheTtlMs) &&
      isCitationGraph(entry.graph) &&
      citationGraphMatchesDoi(entry.graph, doi)
    ) {
      return entry.graph;
    }
  }

  const overriddenGraph = options.buildGraph ? await options.buildGraph(doi, signal) : undefined;
  const graph =
    overriddenGraph === undefined ? await defaultBuildGraph(doi, signal) : overriddenGraph;
  throwIfAborted(signal);
  if (!isCitationGraph(graph)) return null;

  // A graph without a center DOI is still useful for the current view, but it
  // is not safe to persist or reuse as a DOI-keyed cache entry. A present DOI
  // that names a different work indicates a bad response and is rejected.
  const centerDoi = citationGraphCenterDoi(graph);
  if (centerDoi !== null) {
    if (centerDoi !== doi) return null;
    await cache.putCached(doi, graph);
  }
  throwIfAborted(signal);
  return graph;
}
