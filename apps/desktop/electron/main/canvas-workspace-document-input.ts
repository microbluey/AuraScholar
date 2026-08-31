import { Buffer } from "node:buffer";
import { CANVAS_SCHEMA_VERSION, type CanvasJsonValue } from "@aurascholar/core";
import {
  MAX_CANVAS_EDGE_LABEL_BYTES,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_JSON_COLLECTION_ITEMS,
  MAX_CANVAS_JSON_DEPTH,
  MAX_CANVAS_JSON_KEY_BYTES,
  MAX_CANVAS_JSON_TEXT_BYTES,
  MAX_CANVAS_NODE_TAG_BYTES,
  MAX_CANVAS_NODE_TAGS,
  MAX_CANVAS_NODES,
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
  MAX_CANVAS_WORKSPACE_NAME_BYTES,
  STORED_CANVAS_EDGE_RELATIONS,
  STORED_CANVAS_NODE_TYPES,
  type StoredCanvasEdge,
  type StoredCanvasEdgeRelation,
  type StoredCanvasEdgeStyle,
  type StoredCanvasNode,
  type StoredCanvasNodeType,
  type StoredCanvasWorkspaceDocument,
} from "@aurascholar/db";
import { isRecord, requireRecordId } from "./data-command-runtime";
export function parseCanvasWorkspaceDocument(value: unknown): StoredCanvasWorkspaceDocument {
  const document = requireExactCanvasObject(
    value,
    "Canvas workspace document",
    ["schemaVersion", "workspaceId", "name", "viewport", "nodes", "edges", "createdAt", "updatedAt"],
    ["description"],
  );
  if (document.schemaVersion !== CANVAS_SCHEMA_VERSION) {
    throw new Error(`Canvas schema version must be ${CANVAS_SCHEMA_VERSION}`);
  }
  const nodes = requireCanvasNodes(document.nodes);
  const edges = requireCanvasEdges(document.edges);
  assertCanvasWorkspaceTopology(nodes, edges);
  const result: StoredCanvasWorkspaceDocument = {
    createdAt: requireCanvasTimestamp(document.createdAt, "Canvas workspace createdAt"),
    edges,
    name: requireSavedCanvasWorkspaceName(document.name),
    nodes,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    updatedAt: requireCanvasTimestamp(document.updatedAt, "Canvas workspace updatedAt"),
    viewport: requireCanvasViewport(document.viewport),
    workspaceId: requireRecordId(document.workspaceId, "Canvas workspace id"),
    ...(document.description === undefined
      ? {}
      : {
          description: requireCanvasText(
            document.description,
            "Canvas workspace description",
            MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
          ),
        }
        ),
  };
  assertCanvasWorkspacePayloadSize(result);
  return result;
}
function requireSavedCanvasWorkspaceName(value: unknown): string {
  const name = requireCanvasText(value, "Canvas workspace name", MAX_CANVAS_WORKSPACE_NAME_BYTES);
  if (!name.trim()) throw new Error("Canvas workspace name is required");
  return name;
}
function requireCanvasViewport(value: unknown): { x: number; y: number; zoom: number } {
  const viewport = requireExactCanvasObject(value, "Canvas viewport", ["x", "y", "zoom"]);
  const zoom = requireCanvasFiniteNumber(viewport.zoom, "Canvas viewport.zoom");
  if (zoom <= 0) throw new Error("Canvas viewport.zoom must be > 0");
  return {
    x: requireCanvasFiniteNumber(viewport.x, "Canvas viewport.x"),
    y: requireCanvasFiniteNumber(viewport.y, "Canvas viewport.y"),
    zoom,
  };
}
function requireCanvasNodes(value: unknown): StoredCanvasNode[] {
  if (!Array.isArray(value) || value.length > MAX_CANVAS_NODES) {
    throw new Error(`Canvas nodes are limited to ${MAX_CANVAS_NODES}`);
  }
  return value.map((node, index) => requireCanvasNode(node, index));
}
function requireCanvasNode(value: unknown, index: number): StoredCanvasNode {
  const node = requireExactCanvasObject(
    value,
    `Canvas node at index ${index}`,
    ["id", "type", "position", "dimensions", "tags", "createdAt", "updatedAt", "data"],
    ["groupId"],
  );
  const type = requireCanvasNodeType(node.type, index);
  return {
    createdAt: requireCanvasTimestamp(node.createdAt, `Canvas node ${index} createdAt`),
    data: requireCanvasNodeData(type, node.data, index),
    dimensions: requireCanvasDimensions(node.dimensions, index),
    id: requireRecordId(node.id, `Canvas node id at index ${index}`),
    position: requireCanvasPoint(node.position, index),
    tags: requireCanvasTags(node.tags, index),
    type,
    updatedAt: requireCanvasTimestamp(node.updatedAt, `Canvas node ${index} updatedAt`),
    ...(node.groupId === undefined
      ? {}
      : { groupId: requireRecordId(node.groupId, `Canvas node group id at index ${index}`) }),
  };
}
function requireCanvasNodeType(value: unknown, index: number): StoredCanvasNodeType {
  if (typeof value !== "string" || !STORED_CANVAS_NODE_TYPES.includes(value as StoredCanvasNodeType)) {
    throw new Error(`Canvas node type at index ${index} is invalid`);
  }
  return value as StoredCanvasNodeType;
}
function requireCanvasPoint(value: unknown, index: number): { x: number; y: number } {
  const point = requireExactCanvasObject(value, `Canvas node position at index ${index}`, ["x", "y"]);
  return {
    x: requireCanvasFiniteNumber(point.x, `Canvas node ${index} position.x`),
    y: requireCanvasFiniteNumber(point.y, `Canvas node ${index} position.y`),
  };
}
function requireCanvasDimensions(value: unknown, index: number): { width: number; height: number } {
  const dimensions = requireExactCanvasObject(value, `Canvas node dimensions at index ${index}`, [
    "width",
    "height",
  ]);
  const width = requireCanvasFiniteNumber(dimensions.width, `Canvas node ${index} dimensions.width`);
  const height = requireCanvasFiniteNumber(dimensions.height, `Canvas node ${index} dimensions.height`);
  if (width <= 0 || height <= 0) {
    throw new Error(`Canvas node ${index} dimensions must be > 0`);
  }
  return { height, width };
}
function requireCanvasTags(value: unknown, index: number): string[] {
  if (!Array.isArray(value) || value.length > MAX_CANVAS_NODE_TAGS) {
    throw new Error(`Canvas node tags at index ${index} are invalid`);
  }
  return value.map((tag, tagIndex) =>
    requireCanvasText(tag, `Canvas node ${index} tag at index ${tagIndex}`, MAX_CANVAS_NODE_TAG_BYTES),
  );
}
function requireCanvasNodeData(
  type: StoredCanvasNodeType,
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
    return value.map((item, itemIndex) =>
      cloneCanvasJsonValue(item, `${label}[${itemIndex}]`, depth + 1),
    );
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

function requireCanvasDataText(data: Record<string, CanvasJsonValue>, field: string, index: number): void {
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
  if (
    typeof value !== "string" ||
    !["yellow", "green", "blue", "pink", "purple", "orange"].includes(value)
  ) {
    throw new Error(`Canvas node ${index} data.highlightColor is invalid`);
  }
}

function requireCanvasSynthesisType(value: unknown, index: number): void {
  if (
    typeof value !== "string" ||
    !["methodology_matrix", "contradiction_analysis", "research_gap", "tldr"].includes(value)
  ) {
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

function requireCanvasEdges(value: unknown): StoredCanvasEdge[] {
  if (!Array.isArray(value) || value.length > MAX_CANVAS_EDGES) {
    throw new Error(`Canvas edges are limited to ${MAX_CANVAS_EDGES}`);
  }
  return value.map((edge, index) => requireCanvasEdge(edge, index));
}

function requireCanvasEdge(value: unknown, index: number): StoredCanvasEdge {
  const edge = requireExactCanvasObject(
    value,
    `Canvas edge at index ${index}`,
    ["id", "sourceId", "targetId", "relationType", "createdAt", "updatedAt"],
    ["label", "style"],
  );
  return {
    createdAt: requireCanvasTimestamp(edge.createdAt, `Canvas edge ${index} createdAt`),
    id: requireRecordId(edge.id, `Canvas edge id at index ${index}`),
    relationType: requireCanvasEdgeRelation(edge.relationType, index),
    sourceId: requireRecordId(edge.sourceId, `Canvas edge source id at index ${index}`),
    targetId: requireRecordId(edge.targetId, `Canvas edge target id at index ${index}`),
    updatedAt: requireCanvasTimestamp(edge.updatedAt, `Canvas edge ${index} updatedAt`),
    ...(edge.label === undefined
      ? {}
      : {
          label: requireCanvasText(
            edge.label,
            `Canvas edge label at index ${index}`,
            MAX_CANVAS_EDGE_LABEL_BYTES,
          ),
        }
        ),
    ...(edge.style === undefined ? {} : { style: requireCanvasEdgeStyle(edge.style, index) }),
  };
}

function requireCanvasEdgeRelation(value: unknown, index: number): StoredCanvasEdgeRelation {
  if (
    typeof value !== "string" ||
    !STORED_CANVAS_EDGE_RELATIONS.includes(value as StoredCanvasEdgeRelation)
  ) {
    throw new Error(`Canvas edge relation at index ${index} is invalid`);
  }
  return value as StoredCanvasEdgeRelation;
}

function requireCanvasEdgeStyle(value: unknown, index: number): StoredCanvasEdgeStyle {
  const style = requireExactCanvasObject(value, `Canvas edge style at index ${index}`, [], [
    "stroke",
    "animated",
  ]);
  if (style.stroke !== undefined) {
    requireCanvasText(style.stroke, `Canvas edge style stroke at index ${index}`, MAX_CANVAS_EDGE_LABEL_BYTES);
  }
  if (style.animated !== undefined && typeof style.animated !== "boolean") {
    throw new Error(`Canvas edge style animation at index ${index} is invalid`);
  }
  return {
    ...(style.stroke === undefined ? {} : { stroke: style.stroke as string }),
    ...(style.animated === undefined ? {} : { animated: style.animated as boolean }),
  };
}

function assertCanvasWorkspaceTopology(nodes: StoredCanvasNode[], edges: StoredCanvasEdge[]): void {
  const nodeIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Duplicate canvas node id ${node.id}`);
    nodeIds.add(node.id);
    if (node.type === "group") groupIds.add(node.id);
  }
  for (const node of nodes) {
    if (!node.groupId) continue;
    if (node.groupId === node.id || node.type === "group" || !groupIds.has(node.groupId)) {
      throw new Error(`Canvas node ${node.id} references an invalid group`);
    }
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate canvas edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      throw new Error(`Canvas edge ${edge.id} references a node outside its workspace`);
    }
  }
}

function assertCanvasWorkspacePayloadSize(document: StoredCanvasWorkspaceDocument): void {
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized, "utf8") > MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES) {
    throw new Error(`Canvas workspace payload is limited to ${MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES} bytes`);
  }
}

function requireExactCanvasObject(
  value: unknown,
  label: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  const allowedFields = [...requiredFields, ...optionalFields];
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowedFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireCanvasTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireCanvasFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireCanvasText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
