import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import {
  assertEvidenceShelfListBudget,
  EvidenceShelfRepo,
  MAX_EVIDENCE_SHELF_LIST_BYTES,
  MAX_EVIDENCE_SHELF_LIST_ROWS,
  readEvidenceShelfListBudget,
} from "@aurascholar/db";
import {
  CONTENT_UNIT_SOURCE_TYPES,
  ContentUnitsRepo,
  type ContentUnitRow,
} from "@aurascholar/db/repos/knowledge";
import type {
  ClearEvidenceShelfCommandInput,
  DataCommandOutput,
  DataCommandRequest,
  EvidenceShelfItem,
  EvidenceShelfPreviewPayload,
  ListEvidenceShelfCommandInput,
  RemoveEvidenceShelfCommandInput,
  ResolveEvidenceShelfForSaveCommandInput,
  StageEvidenceShelfCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";
import {
  executeEvidenceShelfPromotionCommand,
  type EvidenceShelfPromotionCommandRequest,
} from "./evidence-shelf-promotion-command";

type EvidenceShelfCommandName =
  | "evidenceShelf.clear"
  | "evidenceShelf.list"
  | "evidenceShelf.remove"
  | "evidenceShelf.resolveForSave"
  | "evidenceShelf.stage"
  | "evidenceShelf.promote";

type EvidenceShelfCommandRequest =
  | Extract<
      DataCommandRequest,
      { name: Exclude<EvidenceShelfCommandName, "evidenceShelf.promote"> }
    >
  | EvidenceShelfPromotionCommandRequest;

const MAX_PREVIEW_TEXT_LENGTH = 256 * 1024;
const MAX_PREVIEW_HEADING_LENGTH = 256;
const MAX_PREVIEW_HEADINGS = 64;
/** Keep a hostile/accidentally unbounded Shelf from flooding the renderer. */
export const MAX_EVIDENCE_SHELF_ROWS = MAX_EVIDENCE_SHELF_LIST_ROWS;
export const MAX_EVIDENCE_SHELF_OUTPUT_BYTES = MAX_EVIDENCE_SHELF_LIST_BYTES;
const PREVIEW_FIELDS = [
  "contentUnitId",
  "excerpt",
  "headingPath",
  "language",
  "ordinal",
  "sourceId",
  "sourceType",
  "text",
  "tokenCount",
  "workTitle",
] as const;

export async function executeEvidenceShelfCommand(
  request: EvidenceShelfCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<EvidenceShelfCommandName>> {
  switch (request.name) {
    case "evidenceShelf.promote":
      return executeEvidenceShelfPromotionCommand(request, dependencies);
    case "evidenceShelf.list": {
      const input = parseListInput(request.input);
      return executeShelfQuery(dependencies, request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const budget = await readEvidenceShelfListBudget(
          database,
          input.libraryId,
          input.projectId,
        );
        assertEvidenceShelfListBudget(budget);
        const items = await new EvidenceShelfRepo(database, input.libraryId).list({
          limit: MAX_EVIDENCE_SHELF_ROWS + 1,
          projectId: input.projectId,
        });
        if (items.length > MAX_EVIDENCE_SHELF_ROWS) {
          throw new Error(`Evidence shelf items are limited to ${MAX_EVIDENCE_SHELF_ROWS}`);
        }
        if (items.length !== budget.rowCount) {
          throw new Error("Evidence shelf list changed during bounded read");
        }
        return requireBoundedShelfOutput({ items: items.map(toShelfItem) });
      });
    }
    case "evidenceShelf.stage": {
      const input = parseStageInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const canonical = await new ContentUnitsRepo(database, input.libraryId).get(
          input.contentUnitId,
        );
        if (!canonical) {
          throw new Error(`ContentUnit ${input.contentUnitId} is missing or not citation-safe`);
        }
        const staged = await new EvidenceShelfRepo(database, input.libraryId).stage({
          ...input,
          // The ContentUnit id is authoritative. Keep the user-visible excerpt
          // bounded but derive every provenance-bearing field from canonical DB
          // state before the repository persists the snapshot.
          previewPayload: await canonicalPreviewPayload(database, canonical),
        });
        return { created: staged.created, item: toShelfItem(staged.item) };
      });
    }
    case "evidenceShelf.remove": {
      const input = parseRemoveInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const removed = await new EvidenceShelfRepo(database, input.libraryId).remove(input);
        return { removed };
      });
    }
    case "evidenceShelf.clear": {
      const input = parseClearInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const removed = await new EvidenceShelfRepo(database, input.libraryId).clear(
          input.projectId,
        );
        return { removed };
      });
    }
    case "evidenceShelf.resolveForSave": {
      const input = parseResolveInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const resolved = await new EvidenceShelfRepo(database, input.libraryId).resolveForSave({
          expectedRevisionId: input.expectedRevisionId,
          expectedSourceContentHash: input.expectedSourceContentHash,
          itemId: input.itemId,
          projectId: input.projectId,
        });
        return { item: resolved.item ? toShelfItem(resolved.item) : null, stale: resolved.stale };
      });
    }
  }
}

function requireBoundedShelfOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Evidence shelf output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVIDENCE_SHELF_OUTPUT_BYTES) {
    throw new Error(`Evidence shelf output is limited to ${MAX_EVIDENCE_SHELF_OUTPUT_BYTES} bytes`);
  }
  return output;
}

function executeShelfQuery<K extends "evidenceShelf.list">(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function parseListInput(value: unknown): ListEvidenceShelfCommandInput {
  const input = exactInput(value, "evidenceShelf.list", ["libraryId", "projectId"]);
  return {
    libraryId: requireRecordId(input.libraryId, "Library id"),
    projectId: requireRecordId(input.projectId, "Research project id"),
  };
}

function parseStageInput(value: unknown): StageEvidenceShelfCommandInput {
  const input = exactInput(value, "evidenceShelf.stage", [
    "anchorSnapshot",
    "contentUnitId",
    "libraryId",
    "previewPayload",
    "projectId",
  ]);
  const contentUnitId = requireRecordId(input.contentUnitId, "ContentUnit id");
  const previewPayload = parsePreviewPayload(input.previewPayload, contentUnitId);
  if (!isJsonObject(input.anchorSnapshot))
    throw new Error("Evidence shelf anchor snapshot is invalid");
  return {
    anchorSnapshot: input.anchorSnapshot,
    contentUnitId,
    libraryId: requireRecordId(input.libraryId, "Library id"),
    previewPayload,
    projectId: requireRecordId(input.projectId, "Research project id"),
  };
}

function parseRemoveInput(value: unknown): RemoveEvidenceShelfCommandInput {
  const input = exactInput(value, "evidenceShelf.remove", [
    "expectedUpdatedAt",
    "itemId",
    "libraryId",
    "projectId",
  ]);
  return {
    expectedUpdatedAt: requireInteger(input.expectedUpdatedAt, "Shelf item version", 0),
    itemId: requireRecordId(input.itemId, "Evidence shelf item id"),
    libraryId: requireRecordId(input.libraryId, "Library id"),
    projectId: requireRecordId(input.projectId, "Research project id"),
  };
}

function parseClearInput(value: unknown): ClearEvidenceShelfCommandInput {
  const input = exactInput(value, "evidenceShelf.clear", ["libraryId", "projectId"]);
  return {
    libraryId: requireRecordId(input.libraryId, "Library id"),
    projectId: requireRecordId(input.projectId, "Research project id"),
  };
}

function parseResolveInput(value: unknown): ResolveEvidenceShelfForSaveCommandInput {
  const input = exactInput(value, "evidenceShelf.resolveForSave", [
    "expectedRevisionId",
    "expectedSourceContentHash",
    "itemId",
    "libraryId",
    "projectId",
  ]);
  const expectedRevisionId =
    input.expectedRevisionId === null
      ? null
      : requireRecordId(input.expectedRevisionId, "Expected revision id");
  const expectedSourceContentHash = requireHash(input.expectedSourceContentHash);
  return {
    expectedRevisionId,
    expectedSourceContentHash,
    itemId: requireRecordId(input.itemId, "Evidence shelf item id"),
    libraryId: requireRecordId(input.libraryId, "Library id"),
    projectId: requireRecordId(input.projectId, "Research project id"),
  };
}

function parsePreviewPayload(
  value: unknown,
  expectedContentUnitId?: string,
): EvidenceShelfPreviewPayload {
  const strict = expectedContentUnitId !== undefined;
  if (
    !isRecord(value) ||
    (strict &&
      (Object.keys(value).length !== PREVIEW_FIELDS.length ||
        Object.keys(value).some(
          (field) => !(PREVIEW_FIELDS as readonly string[]).includes(field),
        ) ||
        PREVIEW_FIELDS.some((field) => !Object.hasOwn(value, field))))
  ) {
    throw new Error("Evidence shelf preview payload is invalid");
  }
  const sourceType = previewField(value, "sourceType", "source_type");
  if (
    !CONTENT_UNIT_SOURCE_TYPES.includes(sourceType as (typeof CONTENT_UNIT_SOURCE_TYPES)[number])
  ) {
    throw new Error("Evidence shelf preview source type is invalid");
  }
  const payload: EvidenceShelfPreviewPayload = {
    contentUnitId: requireRecordId(
      previewField(value, "contentUnitId", "content_unit_id"),
      "Preview ContentUnit id",
    ),
    excerpt: boundedText(
      previewField(value, "excerpt"),
      "Preview excerpt",
      MAX_PREVIEW_TEXT_LENGTH,
    ),
    headingPath: parseHeadingPath(previewField(value, "headingPath", "heading_path")),
    language: nullableText(previewField(value, "language"), "Preview language", 128),
    ordinal: requireInteger(previewField(value, "ordinal"), "Preview ordinal", 0),
    sourceId: requireRecordId(previewField(value, "sourceId", "source_id"), "Preview source id"),
    sourceType: sourceType as EvidenceShelfPreviewPayload["sourceType"],
    text: boundedText(previewField(value, "text"), "Preview text", MAX_PREVIEW_TEXT_LENGTH),
    tokenCount: nullableInteger(
      previewField(value, "tokenCount", "token_count"),
      "Preview token count",
      0,
    ),
    workTitle: nullableText(
      previewField(value, "workTitle", "work_title"),
      "Preview Work title",
      4_096,
    ),
  };
  if (expectedContentUnitId !== undefined && payload.contentUnitId !== expectedContentUnitId) {
    throw new Error("Evidence shelf preview ContentUnit id does not match the staged result");
  }
  return payload;
}

function previewField(
  value: Record<string, unknown>,
  camelField: string,
  snakeField = camelField,
): unknown {
  const hasCamel = Object.hasOwn(value, camelField);
  const hasSnake = snakeField !== camelField && Object.hasOwn(value, snakeField);
  if (!hasCamel && !hasSnake) throw new Error("Evidence shelf preview payload is invalid");
  if (hasCamel && hasSnake && !samePreviewValue(value[camelField], value[snakeField])) {
    throw new Error("Evidence shelf preview aliases disagree");
  }
  return hasCamel ? value[camelField] : value[snakeField];
}

function samePreviewValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

async function canonicalPreviewPayload(
  database: Database,
  unit: ContentUnitRow,
): Promise<EvidenceShelfPreviewPayload> {
  let workTitle: string | null = null;
  let workLanguage: string | null = null;
  if (unit.workId) {
    const rows = await database.query<{ language: string | null; title: string }>(
      `SELECT title, language FROM works
       WHERE id = ? AND library_id = ? AND deleted_at IS NULL LIMIT 1`,
      [unit.workId, unit.libraryId],
    );
    workTitle = rows[0]?.title ?? null;
    workLanguage = rows[0]?.language?.trim() || null;
  }
  return {
    contentUnitId: unit.id,
    excerpt: unit.text.length > 240 ? `${unit.text.slice(0, 239)}…` : unit.text,
    headingPath: unit.headingPath,
    language: unit.language?.trim() || workLanguage,
    ordinal: unit.ordinal,
    sourceId: unit.sourceId,
    sourceType: unit.sourceType,
    text: unit.text,
    tokenCount: unit.tokenCount,
    workTitle,
  };
}

function toShelfItem(item: {
  id: string;
  libraryId: string;
  projectId: string;
  workId: string | null;
  assetId: string | null;
  revisionId: string | null;
  anchorSnapshot: unknown;
  previewPayload: unknown;
  sourceContentHash: string;
  status: string;
  currentRevisionId: string | null;
  currentSourceContentHash: string | null;
  isStale: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}): EvidenceShelfItem {
  const status = item.status === "stale" ? "stale" : item.status === "staged" ? "staged" : null;
  if (!status) throw new Error("Evidence shelf item status is invalid");
  const previewPayload = parsePreviewPayload(item.previewPayload);
  if (!isJsonObject(item.anchorSnapshot))
    throw new Error("Evidence shelf anchor snapshot is invalid");
  if (typeof item.isStale !== "boolean") throw new Error("Evidence shelf stale state is invalid");
  const currentRevisionId = nullableRecordId(item.currentRevisionId, "Current revision id");
  const currentSourceContentHash =
    item.currentSourceContentHash === null ? null : requireHash(item.currentSourceContentHash);
  return {
    anchorSnapshot: item.anchorSnapshot,
    assetId: nullableRecordId(item.assetId, "Document asset id"),
    createdAt: requireInteger(item.createdAt, "Shelf item creation time", 0),
    currentRevisionId,
    currentSourceContentHash,
    deletedAt: nullableInteger(item.deletedAt, "Shelf item deletion time", 0),
    id: requireRecordId(item.id, "Evidence shelf item id"),
    libraryId: requireRecordId(item.libraryId, "Library id"),
    previewPayload,
    projectId: requireRecordId(item.projectId, "Research project id"),
    revisionId: nullableRecordId(item.revisionId, "Document revision id"),
    sourceContentHash: requireHash(item.sourceContentHash),
    status: item.isStale ? "stale" : status,
    updatedAt: requireInteger(item.updatedAt, "Shelf item update time", 0),
    workId: nullableRecordId(item.workId, "Work id"),
    isStale: item.isStale,
  };
}

function exactInput(
  value: unknown,
  commandName: EvidenceShelfCommandName,
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableText(value: unknown, label: string, max: number): string | null {
  if (value === null) return null;
  return boundedText(value, label, max);
}

function parseHeadingPath(value: unknown): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_PREVIEW_HEADINGS) {
    throw new Error("Preview heading path is invalid");
  }
  return value.map((part) => boundedText(part, "Preview heading", MAX_PREVIEW_HEADING_LENGTH));
}

function nullableInteger(value: unknown, label: string, minimum: number): number | null {
  if (value === null) return null;
  return requireInteger(value, label, minimum);
}

function nullableRecordId(value: unknown, label: string): string | null {
  return value === null ? null : requireRecordId(value, label);
}

function requireInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireHash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Evidence shelf source content hash is invalid");
  }
  return value;
}
