import type { CitationGraph } from "@aurascholar/core";

/**
 * A validated graph-cache entry. Its timestamp is main-process-owned and is
 * returned only so the renderer can apply the product cache TTL policy.
 */
export interface CitationGraphCacheEntry {
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

/** The renderer may supply a graph, but never a cache key or cache timestamp. */
export interface CitationGraphPutCachedCommandInput {
  doi: string;
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
