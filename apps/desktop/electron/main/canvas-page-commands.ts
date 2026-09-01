import type { CanvasCitationRelation } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type { WorkCitationRelation } from "@aurascholar/db/work-list";
import { MAX_CANVAS_INGRESS_IDENTIFIER_BYTES } from "../../src/shared/canvas-ingress-limits";
import { canvasUtf8ByteLength } from "../../src/shared/canvas-workspace-document-limits";
import type {
  CanvasGetActiveWorkCommandInput,
  CanvasGetActiveWorkCommandResult,
  CanvasGetAnnotationIngressSourceCommandInput,
  CanvasGetAnnotationIngressSourceCommandResult,
  CanvasGetCitationRelationsCommandInput,
  CanvasGetCitationRelationsCommandResult,
  CanvasPersistCitationRelationsCommandInput,
  CanvasPersistCitationRelationsCommandResult,
  DataCommandOutput,
  DataCommandRequest,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";
import {
  loadCanvasAnnotationIngressSource,
  loadCanvasIngressWork,
  requireBoundedCanvasIngressOutput,
  toCanvasActiveWork,
} from "./canvas-ingress-queries";

const MAX_CANVAS_CITATION_RELATIONS = 1_000;
// The scoped relation query binds every id twice plus two Library parameters.
const MAX_CANVAS_CITATION_WORK_IDS = 400;

type CanvasPageReadCommandName =
  | "canvas.getActiveWork"
  | "canvas.getAnnotationIngressSource"
  | "canvas.getCitationRelations";

type CanvasPageMutationCommandName = "canvas.persistCitationRelations";

type CanvasPageCommandName = CanvasPageReadCommandName | CanvasPageMutationCommandName;

export type CanvasPageCommandRequest = Extract<DataCommandRequest, { name: CanvasPageCommandName }>;

/**
 * Main-process Canvas ingress reads and citation persistence. The local
 * Library is resolved inside the database lease, which prevents a
 * renderer-supplied record id from crossing Library boundaries.
 */
export async function executeCanvasPageCommand(
  request: CanvasPageCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<CanvasPageCommandName>> {
  switch (request.name) {
    case "canvas.getActiveWork": {
      const input = parseCanvasGetActiveWorkInput(request.input);
      return executeCanvasPageQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadActiveWork(database, libraryId, input);
      });
    }
    case "canvas.getAnnotationIngressSource": {
      const input = parseCanvasGetAnnotationIngressSourceInput(request.input);
      return executeCanvasPageQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadAnnotationIngressSource(database, libraryId, input);
      });
    }
    case "canvas.getCitationRelations": {
      const input = parseCanvasGetCitationRelationsInput(request.input);
      return executeCanvasPageQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadCitationRelations(database, libraryId, input);
      });
    }
    case "canvas.persistCitationRelations": {
      const input = parseCanvasPersistCitationRelationsInput(request.input);
      return executeCanvasPageMutation(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return persistCitationRelations(database, libraryId, input);
      });
    }
  }
}

function executeCanvasPageQuery<K extends CanvasPageReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function executeCanvasPageMutation<K extends CanvasPageMutationCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  return dependencies.transaction(commandName, operation);
}

function parseCanvasGetActiveWorkInput(value: unknown): CanvasGetActiveWorkCommandInput {
  const input = requireExactCanvasInput(value, "canvas.getActiveWork", ["workId"]);
  return { workId: requireCanvasIngressRecordId(input.workId, "Work id") };
}

function parseCanvasGetAnnotationIngressSourceInput(
  value: unknown,
): CanvasGetAnnotationIngressSourceCommandInput {
  const input = requireExactCanvasInput(value, "canvas.getAnnotationIngressSource", [
    "annotationId",
    "workId",
  ]);
  return {
    annotationId: requireCanvasIngressRecordId(input.annotationId, "Annotation id"),
    workId: requireCanvasIngressRecordId(input.workId, "Work id"),
  };
}

function parseCanvasGetCitationRelationsInput(
  value: unknown,
): CanvasGetCitationRelationsCommandInput {
  const input = requireExactCanvasInput(value, "canvas.getCitationRelations", ["workIds"]);
  return { workIds: requireUniqueCanvasWorkIds(input.workIds) };
}

function parseCanvasPersistCitationRelationsInput(
  value: unknown,
): CanvasPersistCitationRelationsCommandInput {
  const input = requireExactCanvasInput(value, "canvas.persistCitationRelations", ["relations"]);
  return { relations: requireUniqueCanvasCitationRelations(input.relations) };
}

function requireExactCanvasInput(
  value: unknown,
  commandName: CanvasPageCommandName,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireUniqueCanvasWorkIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CANVAS_CITATION_WORK_IDS) {
    throw new Error(`Canvas citation work ids are limited to ${MAX_CANVAS_CITATION_WORK_IDS}`);
  }
  const workIds = value.map((workId, index) =>
    requireCanvasIngressRecordId(workId, `Work id at index ${index}`),
  );
  if (new Set(workIds).size !== workIds.length) {
    throw new Error("Canvas citation work ids must be unique");
  }
  return workIds;
}

function requireUniqueCanvasCitationRelations(value: unknown): CanvasCitationRelation[] {
  if (!Array.isArray(value) || value.length > MAX_CANVAS_CITATION_RELATIONS) {
    throw new Error(`Canvas citation relations are limited to ${MAX_CANVAS_CITATION_RELATIONS}`);
  }
  const relations = value.map((relation, index) => {
    if (
      !isRecord(relation) ||
      Object.keys(relation).length !== 2 ||
      !Object.hasOwn(relation, "citingWorkId") ||
      !Object.hasOwn(relation, "citedWorkId")
    ) {
      throw new Error(`Canvas citation relation at index ${index} is invalid`);
    }
    const citingWorkId = requireCanvasIngressRecordId(
      relation.citingWorkId,
      `Citing work id at index ${index}`,
    );
    const citedWorkId = requireCanvasIngressRecordId(
      relation.citedWorkId,
      `Cited work id at index ${index}`,
    );
    if (citingWorkId === citedWorkId) {
      throw new Error("Canvas citation relations cannot cite themselves");
    }
    return { citingWorkId, citedWorkId };
  });
  const keys = relations.map(({ citingWorkId, citedWorkId }) =>
    JSON.stringify([citingWorkId, citedWorkId]),
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("Canvas citation relations must be unique");
  }
  return relations;
}

/** Matches renderer-side Canvas ingress decoding and SQL byte predicates. */
function requireCanvasIngressRecordId(value: unknown, label: string): string {
  const id = requireRecordId(value, label);
  if (canvasUtf8ByteLength(id) > MAX_CANVAS_INGRESS_IDENTIFIER_BYTES) {
    throw new Error(`${label} is too long`);
  }
  return id;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function loadActiveWork(
  database: Database,
  libraryId: string,
  input: CanvasGetActiveWorkCommandInput,
): Promise<CanvasGetActiveWorkCommandResult> {
  const work = await loadCanvasIngressWork(database, libraryId, input.workId);
  return requireBoundedCanvasIngressOutput({ work: work ? toCanvasActiveWork(work) : null });
}

async function loadAnnotationIngressSource(
  database: Database,
  libraryId: string,
  input: CanvasGetAnnotationIngressSourceCommandInput,
): Promise<CanvasGetAnnotationIngressSourceCommandResult> {
  const source = await loadCanvasAnnotationIngressSource(database, libraryId, input);
  return requireBoundedCanvasIngressOutput({ source });
}

async function loadCitationRelations(
  database: Database,
  libraryId: string,
  input: CanvasGetCitationRelationsCommandInput,
): Promise<CanvasGetCitationRelationsCommandResult> {
  if (input.workIds.length === 0) return { relations: [] };
  const placeholders = input.workIds.map(() => "?").join(",");
  // Ask SQLite for one more row than the contract permits so we can reject a
  // dense selected subgraph explicitly without materializing it over IPC.
  const relations = await database.query<WorkCitationRelation>(
    `SELECT DISTINCT
       c.citing_work_id AS citingWorkId,
       c.cited_work_id AS citedWorkId
     FROM citations c
     JOIN works citing ON citing.id = c.citing_work_id AND citing.deleted_at IS NULL
     JOIN works cited ON cited.id = c.cited_work_id AND cited.deleted_at IS NULL
     WHERE citing.library_id = ?
       AND cited.library_id = ?
       AND c.citing_work_id IN (${placeholders})
       AND c.cited_work_id IN (${placeholders})
       AND c.citing_work_id <> c.cited_work_id
     ORDER BY c.citing_work_id, c.cited_work_id
     LIMIT ?`,
    [libraryId, libraryId, ...input.workIds, ...input.workIds, MAX_CANVAS_CITATION_RELATIONS + 1],
  );
  if (relations.length > MAX_CANVAS_CITATION_RELATIONS) {
    throw new Error(`Canvas citation relations are limited to ${MAX_CANVAS_CITATION_RELATIONS}`);
  }
  return {
    relations,
  };
}

async function persistCitationRelations(
  database: Database,
  libraryId: string,
  input: CanvasPersistCitationRelationsCommandInput,
): Promise<CanvasPersistCitationRelationsCommandResult> {
  let persisted = 0;
  for (const relation of input.relations) {
    // Keep the legacy INSERT OR IGNORE semantics, but commit the whole batch
    // under one main-process transaction rather than renderer-owned IPC calls.
    persisted += await database.run(
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
  return { persisted };
}
