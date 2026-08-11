import type { CitationGraph } from "@aurascholar/core";
import {
  loadCitationGraphByDoi,
  normalizeCitationGraphDoi,
  type CitationGraphBuilder,
  type LoadCitationGraphOptions,
} from "./citation-graph";

export interface CitationGraphPageSnapshot {
  graph: CitationGraph | null;
  inLibraryDois: Set<string>;
}

export interface LoadCitationGraphPageOptions {
  buildGraph?: CitationGraphBuilder;
  signal?: AbortSignal;
}

export interface CitationGraphPageDataSource {
  getActiveLibraryDois: (dois: string[]) => Promise<string[]>;
  loadGraph: (rawDoi: string, options: LoadCitationGraphOptions) => Promise<CitationGraph | null>;
}

const defaultDataSource: CitationGraphPageDataSource = {
  async getActiveLibraryDois(dois) {
    return (await window.aura.data.command("citationGraph.getActiveLibraryDois", { dois })).dois;
  },
  loadGraph: loadCitationGraphByDoi,
};

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export async function loadCitationGraphPageSnapshot(
  rawDoi: string,
  options: LoadCitationGraphPageOptions = {},
  dataSource: CitationGraphPageDataSource = defaultDataSource,
): Promise<CitationGraphPageSnapshot> {
  const { buildGraph, signal } = options;
  throwIfAborted(signal);
  const graph = await dataSource.loadGraph(rawDoi, { buildGraph, signal });
  throwIfAborted(signal);
  if (!graph) return { graph: null, inLibraryDois: new Set() };

  const graphDois = graph.nodes.flatMap((node) => {
    if (!node.doi) return [];
    const normalizedDoi = normalizeCitationGraphDoi(node.doi);
    return normalizedDoi ? [{ normalizedDoi, rawDoi: node.doi }] : [];
  });
  const dois = [...new Set(graphDois.map(({ normalizedDoi }) => normalizedDoi))];
  if (dois.length === 0) return { graph, inLibraryDois: new Set() };

  const activeLibraryDois = await dataSource.getActiveLibraryDois(dois);
  throwIfAborted(signal);
  const activeNormalizedDois = new Set(
    activeLibraryDois
      .map((doi) => normalizeCitationGraphDoi(doi))
      .filter((doi): doi is string => Boolean(doi)),
  );
  return {
    graph,
    // View rendering compares this set against each graph node's original DOI,
    // so map active canonical results back to their raw graph-node forms.
    inLibraryDois: new Set(
      graphDois
        .filter(({ normalizedDoi }) => activeNormalizedDois.has(normalizedDoi))
        .map(({ rawDoi }) => rawDoi),
    ),
  };
}
