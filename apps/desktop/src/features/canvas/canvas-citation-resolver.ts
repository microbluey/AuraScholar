import type { CanvasCitationRelation, CitationGraph } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import { citationRelationsForWorks, type WorkCitationRelation } from "@aurascholar/db/work-list";
import { getLibraryDb } from "../../services/aura-db";
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
  libraryId?: string;
  listLocalRelations?: (
    db: Database,
    libraryId: string,
    workIds: string[],
  ) => Promise<WorkCitationRelation[]>;
  loadGraph?: (doi: string, signal?: AbortSignal) => Promise<CitationGraph | null>;
  maxGraphLoads?: number;
  persistRelation?: (
    db: Database,
    libraryId: string,
    relation: CanvasCitationRelation,
  ) => Promise<void>;
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
  libraryId: string,
  relation: CanvasCitationRelation,
): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO citations (citing_work_id, cited_work_id, source)
     SELECT ?, ?, 'openalex'
     FROM works citing
     JOIN works cited ON cited.id = ?
     WHERE citing.id = ?
       AND citing.library_id = ?
       AND cited.library_id = ?
       AND citing.deleted_at IS NULL
       AND cited.deleted_at IS NULL`,
    [
      relation.citingWorkId,
      relation.citedWorkId,
      relation.citedWorkId,
      relation.citingWorkId,
      libraryId,
      libraryId,
    ],
  );
}

export async function resolveCanvasCitationRelations(
  selectedPapers: readonly CanvasCitationPaperIdentity[],
  options: ResolveCanvasCitationRelationsOptions = {},
): Promise<CanvasCitationResolution> {
  const signal = options.signal;
  throwIfAborted(signal);
  const context = options.db
    ? { db: options.db, libraryId: options.libraryId?.trim() ?? "" }
    : await getLibraryDb();
  if (!context.libraryId) {
    throw new Error("libraryId is required when resolving citations with an injected database");
  }
  const { db, libraryId } = context;
  throwIfAborted(signal);

  const workIds = [...new Set(selectedPapers.map((paper) => paper.workId).filter(Boolean))].sort(
    compareText,
  );
  const localRelations = await (options.listLocalRelations ?? citationRelationsForWorks)(
    db,
    libraryId,
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
      await persistRelation(db, libraryId, relation);
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
