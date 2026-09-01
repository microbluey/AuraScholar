import type { CanvasCitationRelation } from "@aurascholar/core";
import type {
  CanvasActiveWork,
  CanvasAnnotationIngressSource,
  CanvasGetActiveWorkCommandResult,
  CanvasGetAnnotationIngressSourceCommandResult,
  CanvasGetCitationRelationsCommandResult,
  CanvasIngressAnnotation,
  CanvasIngressWork,
  CanvasPersistCitationRelationsCommandResult,
} from "../../electron/canvas-command-contract";
import type { LibraryScopeToken } from "../../electron/library-read-command-contract";
import {
  MAX_CANVAS_INGRESS_ANNOTATION_ANCHOR_BYTES,
  MAX_CANVAS_INGRESS_ANNOTATION_CONTENT_BYTES,
  MAX_CANVAS_INGRESS_AUTHOR_ROWS,
  MAX_CANVAS_INGRESS_IDENTIFIER_BYTES,
  MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
  MAX_CANVAS_INGRESS_OUTPUT_BYTES,
} from "./canvas-ingress-limits";
import { canvasUtf8ByteLength } from "./canvas-workspace-document-limits";
import {
  MAX_LIBRARY_SCOPE_ID_BYTES,
  MAX_LIBRARY_SCOPE_TOKEN_BYTES,
  libraryScopeUtf8ByteLength,
} from "./library-scope-limits";

export const MAX_CANVAS_CITATION_RESULT_RELATIONS = 1_000;

/** Validates and clones Canvas page command responses received over IPC. */
export function decodeCanvasGetActiveWorkResult(
  value: unknown,
  requestedWorkId: string,
): CanvasGetActiveWorkCommandResult {
  const result = requireExactCanvasResult(value, "Canvas active work result", ["work"]);
  const work = result.work === null ? null : decodeCanvasActiveWork(result.work);
  const normalizedRequestedWorkId = requireCanvasIdentifier(requestedWorkId, "Requested work id");
  if (work && work.id !== normalizedRequestedWorkId) {
    throw new Error("Canvas active work result does not match the requested work");
  }
  const decoded = { work };
  assertCanvasIngressOutputSize(decoded);
  return decoded;
}

export function decodeCanvasGetAnnotationIngressSourceResult(
  value: unknown,
  requestedAnnotationId: string,
  requestedWorkId: string,
): CanvasGetAnnotationIngressSourceCommandResult {
  const result = requireExactCanvasResult(value, "Canvas annotation ingress result", ["source"]);
  const source = result.source === null ? null : decodeCanvasAnnotationIngressSource(result.source);
  const normalizedRequestedAnnotationId = requireCanvasIdentifier(
    requestedAnnotationId,
    "Requested annotation id",
  );
  const normalizedRequestedWorkId = requireCanvasIdentifier(requestedWorkId, "Requested work id");
  if (
    source &&
    (source.annotation.id !== normalizedRequestedAnnotationId ||
      source.annotation.work_id !== normalizedRequestedWorkId ||
      source.work.id !== normalizedRequestedWorkId)
  ) {
    throw new Error("Canvas annotation ingress result does not match the requested source");
  }
  const decoded = { source };
  assertCanvasIngressOutputSize(decoded);
  return decoded;
}

export function decodeCanvasGetCitationRelationsResult(
  value: unknown,
  requestedWorkIds: readonly string[],
  expectedScope: LibraryScopeToken,
): CanvasGetCitationRelationsCommandResult {
  const result = requireExactCanvasResult(value, "Canvas citation relations result", [
    "relations",
    "scope",
  ]);
  if (
    !Array.isArray(result.relations) ||
    result.relations.length > MAX_CANVAS_CITATION_RESULT_RELATIONS ||
    !isDenseArray(result.relations)
  ) {
    throw new Error(
      `Canvas citation relations are limited to ${MAX_CANVAS_CITATION_RESULT_RELATIONS}`,
    );
  }
  const requestedIds = new Set(
    requestedWorkIds.map((workId) => requireCanvasIdentifier(workId, "Requested work id")),
  );
  const relationKeys = new Set<string>();
  const relations = result.relations.map((relation, index) => {
    const decoded = decodeCanvasCitationRelation(relation, index);
    if (!requestedIds.has(decoded.citingWorkId) || !requestedIds.has(decoded.citedWorkId)) {
      throw new Error("Canvas citation relation is outside the requested work set");
    }
    const key = JSON.stringify([decoded.citingWorkId, decoded.citedWorkId]);
    if (relationKeys.has(key)) throw new Error("Canvas citation relations must be unique");
    relationKeys.add(key);
    return decoded;
  });
  const scope = decodeCanvasScopeToken(result.scope);
  const decodedExpectedScope = decodeCanvasScopeToken(expectedScope);
  assertCanvasScopeMatches(scope, decodedExpectedScope);
  return { relations, scope };
}

export function decodeCanvasPersistCitationRelationsResult(
  value: unknown,
  relationCount: number,
  expectedScope: LibraryScopeToken,
): CanvasPersistCitationRelationsCommandResult {
  const result = requireExactCanvasResult(value, "Canvas persist citation relations result", [
    "persisted",
    "scope",
  ]);
  if (
    !Number.isSafeInteger(relationCount) ||
    relationCount < 0 ||
    !Number.isSafeInteger(result.persisted) ||
    (result.persisted as number) < 0 ||
    (result.persisted as number) > relationCount
  ) {
    throw new Error("Canvas persist citation relations result is invalid");
  }
  const scope = decodeCanvasScopeToken(result.scope);
  const decodedExpectedScope = decodeCanvasScopeToken(expectedScope);
  assertCanvasScopeMatches(scope, decodedExpectedScope);
  return { persisted: result.persisted as number, scope };
}

function decodeCanvasScopeToken(value: unknown): LibraryScopeToken {
  const scope = requireExactCanvasResult(value, "Canvas Library scope", [
    "libraryId",
    "scopeToken",
  ]);
  return {
    libraryId: requireCanvasScopeField(
      scope.libraryId,
      "Canvas Library id",
      MAX_LIBRARY_SCOPE_ID_BYTES,
    ),
    scopeToken: requireCanvasScopeToken(scope.scopeToken),
  };
}

function requireCanvasScopeToken(value: unknown): string {
  return requireCanvasScopeField(
    value,
    "Canvas Library scope token",
    MAX_LIBRARY_SCOPE_TOKEN_BYTES,
  );
}

function requireCanvasScopeField(value: unknown, label: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    libraryScopeUtf8ByteLength(value) > maximumBytes
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertCanvasScopeMatches(actual: LibraryScopeToken, expected: LibraryScopeToken): void {
  if (actual.libraryId !== expected.libraryId || actual.scopeToken !== expected.scopeToken) {
    throw new Error("Canvas Library scope does not match the request");
  }
}

function decodeCanvasActiveWork(value: unknown): CanvasActiveWork {
  const work = requireExactCanvasResult(value, "Canvas active work", [
    "abstract",
    "authorNames",
    "doi",
    "id",
    "reading_status",
    "title",
    "venue_name",
    "year",
  ]);
  return decodeCanvasActiveWorkFields(work);
}

function decodeCanvasActiveWorkFields(work: Record<string, unknown>): CanvasActiveWork {
  return {
    abstract: requireNullableCanvasText(
      work.abstract,
      "Canvas active work abstract",
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
    ),
    authorNames: requireCanvasAuthorNames(work.authorNames),
    doi: requireNullableCanvasText(
      work.doi,
      "Canvas active work DOI",
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
    ),
    id: requireCanvasIdentifier(work.id, "Canvas active work id"),
    reading_status: requireRequiredCanvasText(
      work.reading_status,
      "Canvas active work reading status",
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
    ),
    title: requireRequiredCanvasText(
      work.title,
      "Canvas active work title",
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
    ),
    venue_name: requireNullableCanvasText(
      work.venue_name,
      "Canvas active work venue",
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
    ),
    year: requireNullableSafeInteger(work.year, "Canvas active work year"),
  };
}

function decodeCanvasAnnotationIngressSource(value: unknown): CanvasAnnotationIngressSource {
  const source = requireExactCanvasResult(value, "Canvas annotation ingress source", [
    "annotation",
    "work",
  ]);
  const annotation = requireExactCanvasResult(source.annotation, "Canvas ingress annotation", [
    "anchor_json",
    "attachment_id",
    "color",
    "content_md",
    "id",
    "orphaned",
    "page_index",
    "type",
    "work_id",
  ]);
  const work = requireExactCanvasResult(source.work, "Canvas ingress work", [
    "abstract",
    "authorNames",
    "deleted_at",
    "doi",
    "id",
    "reading_status",
    "title",
    "venue_name",
    "year",
  ]);
  return {
    annotation: decodeCanvasIngressAnnotation(annotation),
    work: decodeCanvasIngressWork(work),
  };
}

function decodeCanvasIngressAnnotation(value: Record<string, unknown>): CanvasIngressAnnotation {
  if (value.orphaned !== 0 && value.orphaned !== 1) {
    throw new Error("Canvas ingress annotation orphaned flag is invalid");
  }
  return {
    anchor_json: requireNullableCanvasText(
      value.anchor_json,
      "Canvas ingress annotation anchor",
      MAX_CANVAS_INGRESS_ANNOTATION_ANCHOR_BYTES,
    ),
    attachment_id: requireCanvasIdentifier(
      value.attachment_id,
      "Canvas ingress annotation attachment id",
    ),
    color: requireNullableCanvasText(
      value.color,
      "Canvas ingress annotation color",
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
    ),
    content_md: requireNullableCanvasText(
      value.content_md,
      "Canvas ingress annotation content",
      MAX_CANVAS_INGRESS_ANNOTATION_CONTENT_BYTES,
    ),
    id: requireCanvasIdentifier(value.id, "Canvas ingress annotation id"),
    orphaned: value.orphaned,
    page_index: requireNonnegativeSafeInteger(
      value.page_index,
      "Canvas ingress annotation page index",
    ),
    type: requireRequiredCanvasText(
      value.type,
      "Canvas ingress annotation type",
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
    ),
    work_id: requireCanvasIdentifier(value.work_id, "Canvas ingress annotation work id"),
  };
}

function decodeCanvasIngressWork(value: Record<string, unknown>): CanvasIngressWork {
  return {
    ...decodeCanvasActiveWorkFields(value),
    deleted_at: requireNullableNonnegativeSafeInteger(
      value.deleted_at,
      "Canvas ingress work deleted timestamp",
    ),
  };
}

function decodeCanvasCitationRelation(value: unknown, index: number): CanvasCitationRelation {
  const relation = requireExactCanvasResult(value, `Canvas citation relation at index ${index}`, [
    "citedWorkId",
    "citingWorkId",
  ]);
  const citedWorkId = requireCanvasIdentifier(
    relation.citedWorkId,
    `Canvas cited work id at index ${index}`,
  );
  const citingWorkId = requireCanvasIdentifier(
    relation.citingWorkId,
    `Canvas citing work id at index ${index}`,
  );
  if (citingWorkId === citedWorkId)
    throw new Error("Canvas citation relations cannot cite themselves");
  return { citedWorkId, citingWorkId };
}

function requireCanvasAuthorNames(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_CANVAS_INGRESS_AUTHOR_ROWS ||
    !isDenseArray(value)
  ) {
    throw new Error(`Canvas active work authors are limited to ${MAX_CANVAS_INGRESS_AUTHOR_ROWS}`);
  }
  return value.map((author, index) =>
    requireCanvasText(
      author,
      `Canvas active work author at index ${index}`,
      MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES,
    ),
  );
}

function requireCanvasIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const identifier = value.trim();
  if (canvasUtf8ByteLength(identifier) > MAX_CANVAS_INGRESS_IDENTIFIER_BYTES) {
    throw new Error(`${label} is too long`);
  }
  return identifier;
}

function requireRequiredCanvasText(value: unknown, label: string, maximumBytes: number): string {
  const text = requireCanvasText(value, label, maximumBytes);
  if (!text.trim()) throw new Error(`${label} is required`);
  return text;
}

function requireNullableCanvasText(
  value: unknown,
  label: string,
  maximumBytes: number,
): string | null {
  return value === null ? null : requireCanvasText(value, label, maximumBytes);
}

function requireCanvasText(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== "string" || canvasUtf8ByteLength(value) > maximumBytes) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireNullableSafeInteger(value: unknown, label: string): number | null {
  return value === null ? null : requireSafeInteger(value, label);
}

function requireNullableNonnegativeSafeInteger(value: unknown, label: string): number | null {
  return value === null ? null : requireNonnegativeSafeInteger(value, label);
}

function requireNonnegativeSafeInteger(value: unknown, label: string): number {
  const number = requireSafeInteger(value, label);
  if (number < 0) throw new Error(`${label} is invalid`);
  return number;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is invalid`);
  return value as number;
}

function requireExactCanvasResult(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertCanvasIngressOutputSize(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (canvasUtf8ByteLength(serialized) > MAX_CANVAS_INGRESS_OUTPUT_BYTES) {
    throw new Error(`Canvas ingress output is limited to ${MAX_CANVAS_INGRESS_OUTPUT_BYTES} bytes`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}
