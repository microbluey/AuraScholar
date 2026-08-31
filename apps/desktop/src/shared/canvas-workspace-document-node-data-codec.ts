import {
  type AISynthesisType,
  type CanvasJsonValue,
  type CanvasNodeType,
  type ExcerptHighlightColor,
} from "@aurascholar/core";
import {
  canvasUtf8ByteLength,
  MAX_CANVAS_JSON_COLLECTION_ITEMS,
  MAX_CANVAS_JSON_DEPTH,
  MAX_CANVAS_JSON_KEY_BYTES,
  MAX_CANVAS_JSON_TEXT_BYTES,
  MAX_CANVAS_DATA_RECORD_ID_LENGTH,
} from "./canvas-workspace-document-limits";

const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
  "orange",
] as const satisfies readonly ExcerptHighlightColor[];
const SYNTHESIS_TYPES = [
  "methodology_matrix",
  "contradiction_analysis",
  "research_gap",
  "tldr",
] as const satisfies readonly AISynthesisType[];

/** Clones compatible JSON extension fields while checking each card's required data. */
export function decodeCanvasWorkspaceNodeData(
  type: CanvasNodeType,
  value: unknown,
  index: number,
): CanvasJsonValue {
  const data = requireCanvasJsonRecord(value, `Canvas node data at index ${index}`);
  switch (type) {
    case "paper":
      requireCanvasDataRecordId(data, "workId", index);
      requireCanvasDataText(data, "title", index);
      requireCanvasDataStringArray(data, "authors", index);
      requireCanvasDataNullableNumber(data, "year", index);
      requireCanvasDataOptionalText(data, "venue", index);
      requireCanvasDataOptionalText(data, "doi", index);
      requireCanvasDataOptionalText(data, "abstractSnippet", index);
      requireCanvasDataOptionalText(data, "oaPdfUrl", index);
      requireCanvasDataOptionalText(data, "localPdfPath", index);
      requireCanvasDataNumber(data, "annotationCount", index);
      break;
    case "excerpt":
      requireCanvasDataRecordId(data, "workId", index);
      requireCanvasDataText(data, "paperTitle", index);
      requireCanvasDataText(data, "highlightText", index);
      requireCanvasHighlightColor(data.highlightColor, index);
      requireCanvasDataPageIndex(data, "pageIndex", index);
      requireCanvasDataOptionalRecordId(data, "annotationId", index);
      requireCanvasDataOptionalRecordId(data, "attachmentId", index);
      requireCanvasDataOptionalText(data, "marginNote", index);
      break;
    case "ai-synth":
      requireCanvasDataStringArray(data, "sourceNodeIds", index);
      requireCanvasSynthesisType(data.synthType, index);
      requireCanvasDataText(data, "title", index);
      requireCanvasDataText(data, "contentMarkdown", index);
      requireCanvasStructuredTable(data.structuredTable, index);
      requireCanvasDataOptionalText(data, "modelName", index);
      break;
    case "idea-note":
      requireCanvasDataOptionalText(data, "title", index);
      requireCanvasDataText(data, "contentMarkdown", index);
      requireCanvasDataBoolean(data, "hasEquations", index);
      break;
    case "group":
      requireCanvasDataText(data, "title", index);
      requireCanvasDataOptionalText(data, "colorTheme", index);
      requireCanvasDataOptionalBoolean(data, "collapsed", index);
      break;
  }
  return data;
}

function requireCanvasJsonRecord(value: unknown, label: string): Record<string, CanvasJsonValue> {
  const json = cloneCanvasJsonValue(value, label, 0);
  if (!isRecord(json)) throw new Error(`${label} must be an object`);
  return json as Record<string, CanvasJsonValue>;
}

function cloneCanvasJsonValue(value: unknown, label: string, depth: number): CanvasJsonValue {
  if (depth > MAX_CANVAS_JSON_DEPTH) throw new Error(`${label} is nested too deeply`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return requireCanvasText(value, label, MAX_CANVAS_JSON_TEXT_BYTES);
  if (typeof value === "number") return requireCanvasFiniteNumber(value, label);
  if (Array.isArray(value)) {
    if (value.length > MAX_CANVAS_JSON_COLLECTION_ITEMS) {
      throw new Error(`${label} has too many items`);
    }
    const result: CanvasJsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new Error(`${label} must not be sparse`);
      result.push(cloneCanvasJsonValue(value[index], `${label}[${index}]`, depth + 1));
    }
    return result;
  }
  if (!isRecord(value)) throw new Error(`${label} must be JSON-serializable`);

  const keys = Object.keys(value);
  if (keys.length > MAX_CANVAS_JSON_COLLECTION_ITEMS) {
    throw new Error(`${label} has too many fields`);
  }
  const result = Object.create(null) as Record<string, CanvasJsonValue>;
  for (const key of keys) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error(`${label} has an unsafe field`);
    }
    requireCanvasText(key, `${label} field name`, MAX_CANVAS_JSON_KEY_BYTES);
    const fieldValue = value[key];
    if (fieldValue === undefined) continue;
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: cloneCanvasJsonValue(fieldValue, `${label}.${key}`, depth + 1),
      writable: true,
    });
  }
  return result;
}

function requireCanvasDataRecordId(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  requireRecordId(data[field], `Canvas node ${index} data.${field}`);
}

function requireCanvasDataOptionalRecordId(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  if (data[field] !== undefined) requireRecordId(data[field], `Canvas node ${index} data.${field}`);
}

function requireCanvasDataText(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  requireCanvasText(data[field], `Canvas node ${index} data.${field}`, MAX_CANVAS_JSON_TEXT_BYTES);
}

function requireCanvasDataOptionalText(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  if (data[field] !== undefined) requireCanvasDataText(data, field, index);
}

function requireCanvasDataStringArray(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  const value = data[field];
  if (!Array.isArray(value) || value.length > MAX_CANVAS_JSON_COLLECTION_ITEMS) {
    throw new Error(`Canvas node ${index} data.${field} is invalid`);
  }
  value.forEach((item, itemIndex) =>
    requireCanvasText(
      item,
      `Canvas node ${index} data.${field}[${itemIndex}]`,
      MAX_CANVAS_JSON_TEXT_BYTES,
    ),
  );
}

function requireCanvasDataNullableNumber(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  if (data[field] !== null) requireCanvasDataNumber(data, field, index);
}

function requireCanvasDataNumber(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  requireCanvasFiniteNumber(data[field], `Canvas node ${index} data.${field}`);
}

function requireCanvasDataPageIndex(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  const value = data[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Canvas node ${index} data.${field} is invalid`);
  }
}

function requireCanvasDataBoolean(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  if (typeof data[field] !== "boolean") {
    throw new Error(`Canvas node ${index} data.${field} is invalid`);
  }
}

function requireCanvasDataOptionalBoolean(
  data: Record<string, CanvasJsonValue>,
  field: string,
  index: number,
): void {
  if (data[field] !== undefined) requireCanvasDataBoolean(data, field, index);
}

function requireCanvasHighlightColor(value: unknown, index: number): void {
  if (typeof value !== "string" || !HIGHLIGHT_COLORS.includes(value as ExcerptHighlightColor)) {
    throw new Error(`Canvas node ${index} data.highlightColor is invalid`);
  }
}

function requireCanvasSynthesisType(value: unknown, index: number): void {
  if (typeof value !== "string" || !SYNTHESIS_TYPES.includes(value as AISynthesisType)) {
    throw new Error(`Canvas node ${index} data.synthType is invalid`);
  }
}

function requireCanvasStructuredTable(value: unknown, index: number): void {
  if (value === undefined) return;
  const table = requireExactCanvasObject(value, `Canvas node ${index} structured table`, [
    "headers",
    "rows",
  ]);
  if (!Array.isArray(table.headers) || table.headers.length < 2 || table.headers.length > 8) {
    throw new Error(`Canvas node ${index} data.structuredTable is invalid`);
  }
  const headers = table.headers;
  headers.forEach((header, headerIndex) =>
    requireCanvasText(
      header,
      `Canvas node ${index} data.structuredTable.headers[${headerIndex}]`,
      MAX_CANVAS_JSON_TEXT_BYTES,
    ),
  );
  if (!Array.isArray(table.rows) || table.rows.length > 12) {
    throw new Error(`Canvas node ${index} data.structuredTable is invalid`);
  }
  table.rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== headers.length) {
      throw new Error(`Canvas node ${index} data.structuredTable.rows[${rowIndex}] is invalid`);
    }
    row.forEach((cell, cellIndex) =>
      requireCanvasText(
        cell,
        `Canvas node ${index} data.structuredTable.rows[${rowIndex}][${cellIndex}]`,
        MAX_CANVAS_JSON_TEXT_BYTES,
      ),
    );
  });
}

function requireExactCanvasObject(
  value: unknown,
  label: string,
  requiredFields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !requiredFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireRecordId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  const id = value.trim();
  if (id.length > MAX_CANVAS_DATA_RECORD_ID_LENGTH) {
    throw new Error(`${label} is too long`);
  }
  return id;
}

function requireCanvasFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireCanvasText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || canvasUtf8ByteLength(value) > maxBytes) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
