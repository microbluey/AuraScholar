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
import {
  citationGraphProvenanceMatches,
  createOpenAlexCitationGraphProvenance,
  type CitationGraphProvenance,
  type CitationGraphSnapshot,
} from "../shared/citation-graph-provenance";

export { normalizeCitationGraphDoi } from "../shared/citation-graph-limits";

export const CITATION_GRAPH_CACHE_TTL_MS = 7 * 86_400_000;

export type CitationGraphBuilder = (
  doi: string,
  signal?: AbortSignal,
) => Promise<CitationGraph | null | undefined>;

export type CitationGraphSnapshotBuilder = (
  doi: string,
  signal?: AbortSignal,
) => Promise<CitationGraphSnapshot | null | undefined>;

export interface LoadCitationGraphOptions {
  buildGraph?: CitationGraphBuilder;
  buildSnapshot?: CitationGraphSnapshotBuilder;
  cacheTtlMs?: number;
  cache?: CitationGraphCacheDataSource;
  forceRefresh?: boolean;
  now?: () => number;
  signal?: AbortSignal;
}

/** Testable cache boundary; main owns the cache key and record mutations. */
export interface CitationGraphCacheDataSource {
  getCached: (rawDoi: string) => Promise<CitationGraphCacheEntry | null>;
  putCached: (
    doi: string,
    graph: CitationGraph,
    provenance: CitationGraphProvenance,
    expectedCacheVersion?: number | null,
  ) => Promise<boolean>;
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

async function defaultBuildSnapshot(
  doi: string,
  signal?: AbortSignal,
): Promise<CitationGraphSnapshot | null> {
  const result = await buildScholarlyCitationGraph({ doi }, signal);
  return result.graph === null ? null : { graph: result.graph, provenance: result.provenance };
}

const defaultCacheDataSource: CitationGraphCacheDataSource = {
  async getCached(rawDoi) {
    const result = await window.aura.data.command("citationGraph.getCached", { doi: rawDoi });
    return decodeCitationGraphGetCachedResult(result, rawDoi).entry;
  },
  async putCached(doi, graph, provenance, expectedCacheVersion) {
    const result = await window.aura.data.command("citationGraph.putCached", {
      doi,
      expectedCacheVersion: expectedCacheVersion ?? null,
      graph,
      provenance,
    });
    return decodeCitationGraphPutCachedResult(result).stored;
  },
};

export async function loadCitationGraphByDoi(
  rawDoi: string,
  options: LoadCitationGraphOptions = {},
): Promise<CitationGraph | null> {
  const snapshot = await loadCitationGraphSnapshotByDoi(rawDoi, options);
  return snapshot?.graph ?? null;
}

/**
 * Loads a graph together with its validated provider contract. The legacy
 * graph-only API above remains available to views that only need topology.
 */
export async function loadCitationGraphSnapshotByDoi(
  rawDoi: string,
  options: LoadCitationGraphOptions = {},
): Promise<CitationGraphSnapshot | null> {
  const doi = normalizeCitationGraphDoi(rawDoi);
  if (!doi) return null;
  const signal = options.signal;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? CITATION_GRAPH_CACHE_TTL_MS;
  const cache = options.cache ?? defaultCacheDataSource;
  throwIfAborted(signal);
  // A graph-only builder predates the provenance envelope and is the sole
  // compatibility seam allowed to receive a locally synthesized OpenAlex
  // envelope. An explicit snapshot with `provenance: null` is intentional
  // display-only data and must not be silently promoted to cacheable trust.
  const legacyGraphBuilder = !options.buildSnapshot && Boolean(options.buildGraph);

  // Always take a cache snapshot, including force refreshes. Force refresh
  // bypasses reuse, but the snapshot is still required to prevent a slow
  // remote build from overwriting a newer result.
  const entry = await cache.getCached(rawDoi);
  throwIfAborted(signal);
  const expectedCacheVersion = entry?.cacheVersion ?? null;
  if (!options.forceRefresh) {
    if (
      entry &&
      isFreshCitationGraphCacheEntry(entry, now(), cacheTtlMs) &&
      isCitationGraph(entry.graph) &&
      citationGraphMatchesDoi(entry.graph, doi) &&
      citationGraphProvenanceMatches(entry.graph, entry.provenance, doi)
    ) {
      return { graph: entry.graph, provenance: entry.provenance };
    }
  }

  let builtSnapshot: CitationGraphSnapshot | null | undefined;
  if (options.buildSnapshot) {
    const overriddenSnapshot = await options.buildSnapshot(doi, signal);
    builtSnapshot =
      overriddenSnapshot === undefined
        ? await defaultBuildSnapshot(doi, signal)
        : overriddenSnapshot;
  } else if (options.buildGraph) {
    const overriddenGraph = await options.buildGraph(doi, signal);
    // Preserve the historical hook semantics: an installed optional hook may
    // return `undefined` when it is inactive (the smoke hook does this in a
    // normal desktop build), in which case the main OpenAlex builder remains
    // the source of truth. `null` is the explicit no-result response.
    builtSnapshot =
      overriddenGraph === undefined
        ? await defaultBuildSnapshot(doi, signal)
        : overriddenGraph === null
          ? null
          : { graph: overriddenGraph, provenance: null };
  } else {
    builtSnapshot = await defaultBuildSnapshot(doi, signal);
  }
  throwIfAborted(signal);
  if (!builtSnapshot || !isCitationGraph(builtSnapshot.graph)) return null;
  const graph = builtSnapshot.graph;
  const centerDoi = citationGraphCenterDoi(graph);
  let provenance = builtSnapshot.provenance;
  if (provenance !== null && !citationGraphProvenanceMatches(graph, provenance, doi)) {
    return null;
  }
  if (legacyGraphBuilder && centerDoi === doi && provenance === null) {
    // Test seams and older local callers may provide only topology. Main still
    // owns the real provider contract; this fallback is never used by the
    // default IPC builder and keeps those seams display/cache-compatible.
    provenance = createOpenAlexCitationGraphProvenance({
      capturedAt: now(),
      centerDoi,
      requestedDoi: doi,
    });
  }

  // A graph without a center DOI is still useful for the current view, but it
  // is not safe to persist or reuse as a DOI-keyed cache entry. A present DOI
  // that names a different work indicates a bad response and is rejected.
  if (centerDoi !== null) {
    if (centerDoi !== doi) return null;
    if (provenance) {
      await cache.putCached(doi, graph, provenance, expectedCacheVersion);
    }
  }
  throwIfAborted(signal);
  return { graph, provenance };
}
