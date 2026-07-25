import type { CanvasCitationRelation, CitationGraph } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import { citationRelationsForWorks, type WorkCitationRelation } from "@aurascholar/db/work-list";
import { getDb } from "../../services/aura-db";
import { loadCitationGraphByDoi } from "../../services/citation-graph";
import {
  canvasCitationRelationsFromGraph,
  mergeCanvasCitationRelations,
  normalizeCitationDoi,
  type CanvasCitationPaperIdentity,
} from "./canvas-citation";

export const MAX_CANVAS_CITATION_GRAPH_LOADS = 12;

export interface CanvasCitationResolution {
  graphCount: number;
  relations: CanvasCitationRelation[];
  source: "graph" | "library" | "mixed" | "none";
  truncated: boolean;
}

export interface ResolveCanvasCitationRelationsOptions {
  db?: Database;
  listLocalRelations?: (db: Database, workIds: string[]) => Promise<WorkCitationRelation[]>;
  loadGraph?: (doi: string, signal?: AbortSignal) => Promise<CitationGraph | null>;
  maxGraphLoads?: number;
  persistRelation?: (db: Database, relation: CanvasCitationRelation) => Promise<void>;
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

async function defaultPersistRelation(
  db: Database,
  relation: CanvasCitationRelation,
): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO citations (citing_work_id, cited_work_id, source)
     SELECT ?, ?, 'openalex'
     WHERE EXISTS (
       SELECT 1 FROM works WHERE id = ? AND deleted_at IS NULL
     )
       AND EXISTS (
         SELECT 1 FROM works WHERE id = ? AND deleted_at IS NULL
       )`,
    [relation.citingWorkId, relation.citedWorkId, relation.citingWorkId, relation.citedWorkId],
  );
}

export async function resolveCanvasCitationRelations(
  selectedPapers: readonly CanvasCitationPaperIdentity[],
  options: ResolveCanvasCitationRelationsOptions = {},
): Promise<CanvasCitationResolution> {
  const signal = options.signal;
  throwIfAborted(signal);
  const db = options.db ?? (await getDb());
  throwIfAborted(signal);

  const workIds = [...new Set(selectedPapers.map((paper) => paper.workId).filter(Boolean))].sort(
    compareText,
  );
  const localRelations = await (options.listLocalRelations ?? citationRelationsForWorks)(
    db,
    workIds,
  );
  throwIfAborted(signal);
  const normalizedLocalRelations = mergeCanvasCitationRelations(localRelations);
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
  const graphRelations: CanvasCitationRelation[][] = [];
  let graphCount = 0;
  let firstError: unknown;

  for (const doi of dois) {
    throwIfAborted(signal);
    try {
      const graph = await loadGraph(doi, signal);
      throwIfAborted(signal);
      if (!graph) continue;
      graphCount += 1;
      graphRelations.push(canvasCitationRelationsFromGraph(graph, selectedPapers));
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw abortError();
      firstError ??= error;
    }
  }

  const newGraphRelations = mergeCanvasCitationRelations(...graphRelations);
  if (newGraphRelations.length > 0) {
    const persistRelation = options.persistRelation ?? defaultPersistRelation;
    for (const relation of newGraphRelations) {
      throwIfAborted(signal);
      await persistRelation(db, relation);
    }
  }
  throwIfAborted(signal);

  const relations = mergeCanvasCitationRelations(normalizedLocalRelations, newGraphRelations);
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
