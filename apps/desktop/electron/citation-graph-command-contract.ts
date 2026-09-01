import type { CitationGraph } from "@aurascholar/core";

/**
 * A validated graph-cache entry. Both the freshness timestamp and the
 * compare-and-swap version are main-process-owned; the renderer uses the
 * former for TTL decisions and the latter to guard a write after remote work.
 */
export interface CitationGraphCacheEntry {
  /** Monotonic compare-and-swap token owned by the main-process database. */
  cacheVersion: number;
  fetchedAt: number;
  graph: CitationGraph;
}

/**
 * `doi` intentionally remains the caller's raw DOI text. The main process
 * derives the normalized cache key and legacy compatibility key itself.
 */
export interface CitationGraphGetCachedCommandInput {
  doi: string;
}

export interface CitationGraphGetCachedCommandResult {
  entry: CitationGraphCacheEntry | null;
}

/**
 * The renderer may supply a graph and the cache version it observed before
 * doing remote work. Main uses that observation as a compare-and-swap guard;
 * it never accepts a renderer-generated cache version. Omitted values are
 * treated as `null` for older renderers, which permits insertion only when no
 * canonical row exists.
 */
export interface CitationGraphPutCachedCommandInput {
  doi: string;
  expectedCacheVersion?: number | null;
  graph: CitationGraph;
}

export interface CitationGraphPutCachedCommandResult {
  stored: boolean;
}

/** DOI membership is derived from the durable active local Library. */
export interface CitationGraphGetActiveLibraryDoisCommandInput {
  dois: string[];
}

export interface CitationGraphGetActiveLibraryDoisCommandResult {
  dois: string[];
  libraryId: string;
}

/**
 * Citation-graph cache and active-Library membership commands. Cache records
 * are process-wide runtime data; membership reads resolve Library scope in
 * the main process.
 */
export interface CitationGraphDataCommandMap {
  "citationGraph.getCached": {
    input: CitationGraphGetCachedCommandInput;
    output: CitationGraphGetCachedCommandResult;
  };
  "citationGraph.putCached": {
    input: CitationGraphPutCachedCommandInput;
    output: CitationGraphPutCachedCommandResult;
  };
  "citationGraph.getActiveLibraryDois": {
    input: CitationGraphGetActiveLibraryDoisCommandInput;
    output: CitationGraphGetActiveLibraryDoisCommandResult;
  };
}
