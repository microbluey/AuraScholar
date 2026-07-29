import type { CitationGraph } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import {
  loadCitationGraphByDoi,
  type CitationGraphBuilder,
  type LoadCitationGraphOptions,
} from "./citation-graph";
import { getLibraryDb } from "./aura-db";

export interface CitationGraphPageSnapshot {
  graph: CitationGraph | null;
  inLibraryDois: Set<string>;
}

export interface LoadCitationGraphPageOptions {
  buildGraph?: CitationGraphBuilder;
  signal?: AbortSignal;
}

export interface CitationGraphPageScope {
  db: Database;
  libraryId: string;
}

export interface CitationGraphPageDataSource {
  loadGraph: (rawDoi: string, options: LoadCitationGraphOptions) => Promise<CitationGraph | null>;
  open: () => Promise<CitationGraphPageScope>;
}

const defaultDataSource: CitationGraphPageDataSource = {
  loadGraph: loadCitationGraphByDoi,
  open: getLibraryDb,
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
  const { db, libraryId } = await dataSource.open();
  throwIfAborted(signal);
  const graph = await dataSource.loadGraph(rawDoi, { buildGraph, db, signal });
  throwIfAborted(signal);
  if (!graph) return { graph: null, inLibraryDois: new Set() };

  const dois = [
    ...new Set(
      graph.nodes.map((node) => node.doi?.trim()).filter((doi): doi is string => Boolean(doi)),
    ),
  ];
  if (dois.length === 0) return { graph, inLibraryDois: new Set() };

  const placeholders = dois.map(() => "?").join(",");
  const rows = await db.query<{ doi: string }>(
    `SELECT doi
     FROM works
     WHERE library_id = ? AND doi IN (${placeholders}) AND deleted_at IS NULL`,
    [libraryId, ...dois],
  );
  throwIfAborted(signal);
  return { graph, inLibraryDois: new Set(rows.map((row) => row.doi)) };
}
