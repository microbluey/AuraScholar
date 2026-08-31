import {
  CANVAS_SCHEMA_VERSION,
  type CanvasEdgeRelation,
  type CanvasNodeType,
} from "@aurascholar/core";
import type {
  CanvasWorkspaceDocumentDto,
  CanvasWorkspaceEdgeDto,
  CanvasWorkspaceEdgeStyleDto,
  CanvasWorkspaceNodeDto,
} from "../../electron/canvas-command-contract";
import { decodeCanvasWorkspaceNodeData } from "./canvas-workspace-document-node-data-codec";
import {
  canvasUtf8ByteLength,
  MAX_CANVAS_EDGE_LABEL_BYTES,
  MAX_CANVAS_EDGES,
  MAX_CANVAS_NODE_TAG_BYTES,
  MAX_CANVAS_NODE_TAGS,
  MAX_CANVAS_NODES,
  MAX_CANVAS_RECORD_ID_BYTES,
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
  MAX_CANVAS_WORKSPACE_NAME_BYTES,
} from "./canvas-workspace-document-limits";

export {
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
} from "./canvas-workspace-document-limits";

export const CANVAS_WORKSPACE_NODE_TYPES = [
  "paper",
  "excerpt",
  "ai-synth",
  "idea-note",
  "group",
] as const satisfies readonly CanvasNodeType[];
export const CANVAS_WORKSPACE_EDGE_RELATIONS = [
  "cites",
  "supports",
  "contradicts",
  "extends",
  "derived-from",
  "custom",
] as const satisfies readonly CanvasEdgeRelation[];

/**
 * Validates and clones the full Canvas IPC/local-storage document shape.
 * It rejects invalid data rather than cropping fields, including compatible
 * JSON extension fields inside node data.
 */
export function decodeCanvasWorkspaceDocument(value: unknown): CanvasWorkspaceDocumentDto {
  const document = requireExactCanvasObject(
    value,
    "Canvas workspace document",
    [
      "schemaVersion",
      "workspaceId",
      "name",
      "viewport",
      "nodes",
      "edges",
      "createdAt",
      "updatedAt",
    ],
    ["description"],
  );
  if (document.schemaVersion !== CANVAS_SCHEMA_VERSION) {
    throw new Error(`Canvas schema version must be ${CANVAS_SCHEMA_VERSION}`);
  }

  const nodes = requireCanvasNodes(document.nodes);
  const edges = requireCanvasEdges(document.edges);
  assertCanvasWorkspaceTopology(nodes, edges);
  const result: CanvasWorkspaceDocumentDto = {
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
        }),
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

function requireCanvasNodes(value: unknown): CanvasWorkspaceNodeDto[] {
  if (!Array.isArray(value) || value.length > MAX_CANVAS_NODES || !isDenseArray(value)) {
    throw new Error(`Canvas nodes are limited to ${MAX_CANVAS_NODES}`);
  }
  return value.map((node, index) => requireCanvasNode(node, index));
}

function requireCanvasNode(value: unknown, index: number): CanvasWorkspaceNodeDto {
  const node = requireExactCanvasObject(
    value,
    `Canvas node at index ${index}`,
    ["id", "type", "position", "dimensions", "tags", "createdAt", "updatedAt", "data"],
    ["groupId"],
  );
  const type = requireCanvasNodeType(node.type, index);
  return {
    createdAt: requireCanvasTimestamp(node.createdAt, `Canvas node ${index} createdAt`),
    data: decodeCanvasWorkspaceNodeData(type, node.data, index),
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

function requireCanvasNodeType(value: unknown, index: number): CanvasNodeType {
  if (typeof value !== "string" || !CANVAS_WORKSPACE_NODE_TYPES.includes(value as CanvasNodeType)) {
    throw new Error(`Canvas node type at index ${index} is invalid`);
  }
  return value as CanvasNodeType;
}

function requireCanvasPoint(value: unknown, index: number): { x: number; y: number } {
  const point = requireExactCanvasObject(value, `Canvas node position at index ${index}`, [
    "x",
    "y",
  ]);
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
  const width = requireCanvasFiniteNumber(
    dimensions.width,
    `Canvas node ${index} dimensions.width`,
  );
  const height = requireCanvasFiniteNumber(
    dimensions.height,
    `Canvas node ${index} dimensions.height`,
  );
  if (width <= 0 || height <= 0) {
    throw new Error(`Canvas node ${index} dimensions must be > 0`);
  }
  return { height, width };
}

function requireCanvasTags(value: unknown, index: number): string[] {
  if (!Array.isArray(value) || value.length > MAX_CANVAS_NODE_TAGS || !isDenseArray(value)) {
    throw new Error(`Canvas node tags at index ${index} are invalid`);
  }
  return Array.from({ length: value.length }, (_, tagIndex) =>
    requireCanvasText(
      value[tagIndex],
      `Canvas node ${index} tag at index ${tagIndex}`,
      MAX_CANVAS_NODE_TAG_BYTES,
    ),
  );
}

function requireCanvasEdges(value: unknown): CanvasWorkspaceEdgeDto[] {
  if (!Array.isArray(value) || value.length > MAX_CANVAS_EDGES || !isDenseArray(value)) {
    throw new Error(`Canvas edges are limited to ${MAX_CANVAS_EDGES}`);
  }
  return value.map((edge, index) => requireCanvasEdge(edge, index));
}

function requireCanvasEdge(value: unknown, index: number): CanvasWorkspaceEdgeDto {
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
        }),
    ...(edge.style === undefined ? {} : { style: requireCanvasEdgeStyle(edge.style, index) }),
  };
}

function requireCanvasEdgeRelation(value: unknown, index: number): CanvasEdgeRelation {
  if (
    typeof value !== "string" ||
    !CANVAS_WORKSPACE_EDGE_RELATIONS.includes(value as CanvasEdgeRelation)
  ) {
    throw new Error(`Canvas edge relation at index ${index} is invalid`);
  }
  return value as CanvasEdgeRelation;
}

function requireCanvasEdgeStyle(value: unknown, index: number): CanvasWorkspaceEdgeStyleDto {
  const style = requireExactCanvasObject(
    value,
    `Canvas edge style at index ${index}`,
    [],
    ["stroke", "animated"],
  );
  if (style.stroke !== undefined) {
    requireCanvasText(
      style.stroke,
      `Canvas edge style stroke at index ${index}`,
      MAX_CANVAS_EDGE_LABEL_BYTES,
    );
  }
  if (style.animated !== undefined && typeof style.animated !== "boolean") {
    throw new Error(`Canvas edge style animation at index ${index} is invalid`);
  }
  return {
    ...(style.stroke === undefined ? {} : { stroke: style.stroke as string }),
    ...(style.animated === undefined ? {} : { animated: style.animated as boolean }),
  };
}

function assertCanvasWorkspaceTopology(
  nodes: CanvasWorkspaceNodeDto[],
  edges: CanvasWorkspaceEdgeDto[],
): void {
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

function assertCanvasWorkspacePayloadSize(document: CanvasWorkspaceDocumentDto): void {
  const serialized = JSON.stringify(document);
  if (canvasUtf8ByteLength(serialized) > MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES) {
    throw new Error(
      `Canvas workspace payload is limited to ${MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES} bytes`,
    );
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

function requireRecordId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  const id = value.trim();
  if (canvasUtf8ByteLength(id) > MAX_CANVAS_RECORD_ID_BYTES) {
    throw new Error(`${label} is too long`);
  }
  return id;
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
  if (typeof value !== "string" || canvasUtf8ByteLength(value) > maxBytes) {
    throw new Error(`${label} is invalid`);
  }
  return value;
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
