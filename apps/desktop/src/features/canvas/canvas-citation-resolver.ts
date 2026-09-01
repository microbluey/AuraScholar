import type { CanvasCitationRelation, CitationGraph } from "@aurascholar/core";
import type { LibraryScopeToken } from "../../../electron/data-command-contract";
import {
  loadCitationGraphByDoi,
  loadCitationGraphSnapshotByDoi,
  type CitationGraphSnapshotBuilder,
} from "../../services/citation-graph";
import {
  CITATION_GRAPH_PROVIDER,
  CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  CITATION_GRAPH_PROVIDER_VERSION,
  citationGraphProvenanceBindsGraph,
  type CitationGraphProvider,
  type CitationGraphSnapshot,
} from "../../shared/citation-graph-provenance";
import {
  decodeCanvasGetCitationRelationsResult,
  decodeCanvasPersistCitationRelationsResult,
} from "../../shared/canvas-page-command-result-codec";
import {
  canvasCitationRelationsFromGraph,
  mergeCanvasCitationRelations,
  normalizeCitationDoi,
  type CanvasCitationPaperIdentity,
} from "./canvas-citation";
import { getActiveLibraryCommandScopeToken } from "../../services/library-command-scope";

export const MAX_CANVAS_CITATION_GRAPH_LOADS = 12;
/**
 * The main-process local-relation query needs two SQLite bind parameters per
 * work id. Keep this in lockstep with its scoped-command validation, but fail
 * before starting any IPC or remote graph work so an oversized canvas has a
 * clear, recoverable error.
 */
export const MAX_CANVAS_CITATION_WORK_IDS = 400;
/**
 * Keep a graph's Cartesian DOI matches from producing an oversized IPC batch.
 * This is an explicit failure, never a silent truncation, so `truncated`
 * continues to describe only the bounded DOI graph-load budget.
 */
export const MAX_CANVAS_CITATION_RELATIONS_TO_PERSIST = 1000;

export interface CanvasCitationResolution {
  graphCount: number;
  relations: CanvasCitationRelation[];
  source: "graph" | "library" | "mixed" | "none";
  truncated: boolean;
}

export interface ResolveCanvasCitationRelationsOptions {
  getLibraryScope?: () => Promise<LibraryScopeToken>;
  listLocalRelations?: (workIds: string[]) => Promise<CanvasCitationRelation[]>;
  loadGraph?: (doi: string, signal?: AbortSignal) => Promise<CitationGraph | null>;
  loadGraphSnapshot?: CitationGraphSnapshotBuilder;
  maxGraphLoads?: number;
  persistRelations?: (relations: CanvasCitationRelation[]) => Promise<void>;
  signal?: AbortSignal;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function abortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function assertCanvasCitationRelationLimit(relations: readonly CanvasCitationRelation[]): void {
  if (relations.length > MAX_CANVAS_CITATION_RELATIONS_TO_PERSIST) {
    throw new Error(
      `引用关系过多（最多 ${MAX_CANVAS_CITATION_RELATIONS_TO_PERSIST} 条），请缩小画布选择范围后重试。`,
    );
  }
}

async function loadLocalCanvasCitationRelations(
  workIds: string[],
  expectedScope: LibraryScopeToken,
): Promise<CanvasCitationRelation[]> {
  return decodeCanvasGetCitationRelationsResult(
    await window.aura.data.command("canvas.getCitationRelations", {
      expectedScope,
      workIds,
    }),
    workIds,
    expectedScope,
  ).relations;
}

async function persistCanvasCitationRelations(
  relations: CanvasCitationRelation[],
  expectedScope: LibraryScopeToken,
  provider: CitationGraphProvider,
): Promise<void> {
  decodeCanvasPersistCitationRelationsResult(
    await window.aura.data.command("canvas.persistCitationRelations", {
      expectedScope,
      provider,
      relations,
    }),
    relations.length,
    expectedScope,
    provider,
  );
}

export async function resolveCanvasCitationRelations(
  selectedPapers: readonly CanvasCitationPaperIdentity[],
  options: ResolveCanvasCitationRelationsOptions = {},
): Promise<CanvasCitationResolution> {
  const signal = options.signal;
  throwIfAborted(signal);

  const workIds = [...new Set(selectedPapers.map((paper) => paper.workId).filter(Boolean))].sort(
    compareText,
  );
  if (workIds.length > MAX_CANVAS_CITATION_WORK_IDS) {
    throw new Error(
      `画布论文过多（最多 ${MAX_CANVAS_CITATION_WORK_IDS} 篇），请缩小画布选择范围后重试。`,
    );
  }
  let expectedScope: LibraryScopeToken | undefined;
  const captureScope = async (): Promise<LibraryScopeToken> => {
    expectedScope ??= await (options.getLibraryScope ?? getActiveLibraryCommandScopeToken)();
    return expectedScope;
  };
  // Capture before any graph work whenever a default scoped read or write may
  // be used. Fully injected seams can remain I/O-free in unit/integration use.
  if (workIds.length > 0 && (!options.listLocalRelations || !options.persistRelations)) {
    await captureScope();
    throwIfAborted(signal);
  }
  const localRelations = workIds.length
    ? await (options.listLocalRelations
        ? options.listLocalRelations(workIds)
        : loadLocalCanvasCitationRelations(workIds, await captureScope()))
    : [];
  throwIfAborted(signal);
  const normalizedLocalRelations = mergeCanvasCitationRelations(localRelations);
  assertCanvasCitationRelationLimit(normalizedLocalRelations);
  const locallyConnectedWorkIds = new Set(
    normalizedLocalRelations.flatMap((relation) => [relation.citingWorkId, relation.citedWorkId]),
  );

  const allDois = [
    ...new Set(
      selectedPapers
        .filter(
          (paper) =>
            normalizedLocalRelations.length === 0 || !locallyConnectedWorkIds.has(paper.workId),
        )
        .map((paper) => normalizeCitationDoi(paper.doi))
        .filter((doi): doi is string => Boolean(doi)),
    ),
  ].sort(compareText);
  const maxGraphLoads = Math.max(
    0,
    Math.floor(options.maxGraphLoads ?? MAX_CANVAS_CITATION_GRAPH_LOADS),
  );
  const dois = allDois.slice(0, maxGraphLoads);
  const loadGraph =
    options.loadGraph ??
    ((doi: string, requestSignal?: AbortSignal) =>
      loadCitationGraphByDoi(doi, { signal: requestSignal }));
  const loadGraphSnapshot =
    options.loadGraphSnapshot ??
    (options.loadGraph
      ? async (doi: string, requestSignal?: AbortSignal): Promise<CitationGraphSnapshot | null> => {
          const graph = await loadGraph(doi, requestSignal);
          if (!graph) return null;
          const centerDoi = normalizeCitationDoi(
            graph.nodes.find((node) => node.relation === "center")?.doi,
          );
          // The graph-only seam has no trustworthy provider envelope. It may
          // be retained for compatibility only when its center is explicitly
          // bound to the requested DOI; otherwise keep it untrusted so it
          // cannot contribute expansion relations.
          return {
            graph,
            provenance:
              centerDoi === doi
                ? {
                    capturedAt: 0,
                    centerDoi,
                    provider: CITATION_GRAPH_PROVIDER,
                    providerVersion: CITATION_GRAPH_PROVIDER_VERSION,
                    requestedDoi: doi,
                    schemaVersion: CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
                  }
                : null,
          };
        }
      : (doi: string, requestSignal?: AbortSignal) =>
          loadCitationGraphSnapshotByDoi(doi, { signal: requestSignal }));
  const graphRelations: CanvasCitationRelation[][] = [];
  let graphCount = 0;
  let firstError: unknown;
  let graphProvider: CitationGraphProvider | undefined;

  for (const doi of dois) {
    throwIfAborted(signal);
    let snapshot: CitationGraphSnapshot | null | undefined;
    try {
      snapshot = await loadGraphSnapshot(doi, signal);
      throwIfAborted(signal);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw abortError();
      firstError ??= error;
      continue;
    }
    if (!snapshot) continue;

    // Provider consistency is a layout-wide invariant. Keep this check
    // outside the recoverable per-DOI error boundary: a mixed-provider graph
    // must fail closed even when an earlier graph already produced relations.
    const graph = snapshot.graph;
    if (!snapshot.provenance) {
      firstError ??= new Error("Citation graph provenance is missing");
      continue;
    }
    if (!citationGraphProvenanceBindsGraph(graph, snapshot.provenance, doi)) {
      firstError ??= new Error("Citation graph provenance is invalid");
      continue;
    }
    const provider = snapshot.provenance.provider;
    if (graphProvider && graphProvider !== provider) {
      throw new Error("Citation graph providers must match within one layout");
    }
    graphProvider = provider;
    graphCount += 1;
    try {
      graphRelations.push(canvasCitationRelationsFromGraph(graph, selectedPapers));
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw abortError();
      firstError ??= error;
    }
  }

  const newGraphRelations = mergeCanvasCitationRelations(...graphRelations);
  throwIfAborted(signal);
  assertCanvasCitationRelationLimit(newGraphRelations);
  const relations = mergeCanvasCitationRelations(normalizedLocalRelations, newGraphRelations);
  assertCanvasCitationRelationLimit(relations);
  if (newGraphRelations.length > 0) {
    throwIfAborted(signal);
    if (options.persistRelations) {
      await options.persistRelations(newGraphRelations);
    } else {
      if (!graphProvider) throw new Error("Citation graph provenance is missing");
      await persistCanvasCitationRelations(newGraphRelations, await captureScope(), graphProvider);
    }
  }
  throwIfAborted(signal);

  if (relations.length > 0) {
    return {
      graphCount,
      relations,
      source:
        normalizedLocalRelations.length > 0 && newGraphRelations.length > 0
          ? "mixed"
          : normalizedLocalRelations.length > 0
            ? "library"
            : "graph",
      truncated: allDois.length > dois.length,
    };
  }

  if (firstError) throw firstError;
  return {
    graphCount,
    relations: [],
    source: "none",
    truncated: allDois.length > dois.length,
  };
}
