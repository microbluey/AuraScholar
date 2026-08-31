import {
  MAX_CANVAS_EDGE_LABEL_BYTES,
  MAX_CANVAS_NODE_TAG_BYTES,
  MAX_CANVAS_NODE_TAGS,
} from "./canvas-workspace-bounds.js";
import type {
  StoredCanvasEdge,
  StoredCanvasEdgeRelation,
  StoredCanvasEdgeStyle,
  StoredCanvasNode,
  StoredCanvasNodeType,
  StoredCanvasViewport,
} from "./canvas.js";

export interface CanvasBoundedNodeRow {
  created_at: number;
  data_json: string;
  group_id: string | null;
  height: number;
  id: string;
  pos_x: number;
  pos_y: number;
  tags_json: string;
  type: string;
  updated_at: number;
  width: number;
}

export interface CanvasBoundedEdgeRow {
  created_at: number;
  id: string;
  label: string | null;
  relation_type: string;
  source_id: string;
  style_json: string | null;
  target_id: string;
  updated_at: number;
}

const utf8Encoder = new TextEncoder();

export function parseCanvasViewport(value: string, workspaceId: string): StoredCanvasViewport {
  const parsed = parseJson(value, `Canvas workspace ${workspaceId} viewport`);
  if (!isRecord(parsed)) throw new Error(`Canvas workspace ${workspaceId} viewport is invalid`);
  assertFiniteNumber(parsed.x, `Canvas workspace ${workspaceId} viewport.x`);
  assertFiniteNumber(parsed.y, `Canvas workspace ${workspaceId} viewport.y`);
  assertFiniteNumber(parsed.zoom, `Canvas workspace ${workspaceId} viewport.zoom`);
  if (parsed.zoom <= 0) {
    throw new Error(`Canvas workspace ${workspaceId} viewport.zoom must be > 0`);
  }
  return { x: parsed.x, y: parsed.y, zoom: parsed.zoom };
}

export function toStoredCanvasNode(
  row: CanvasBoundedNodeRow,
  nodeTypeSet: ReadonlySet<string>,
): StoredCanvasNode {
  if (!nodeTypeSet.has(row.type)) throw new Error(`Unsupported canvas node type ${row.type}`);
  return {
    id: row.id,
    type: row.type as StoredCanvasNodeType,
    position: { x: row.pos_x, y: row.pos_y },
    dimensions: { width: row.width, height: row.height },
    ...(row.group_id === null ? {} : { groupId: row.group_id }),
    tags: parseTags(row.tags_json, row.id),
    data: parseJson(row.data_json, `Canvas node ${row.id} data`),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toStoredCanvasEdge(
  row: CanvasBoundedEdgeRow,
  edgeRelationSet: ReadonlySet<string>,
): StoredCanvasEdge {
  if (!edgeRelationSet.has(row.relation_type)) {
    throw new Error(`Unsupported canvas edge relation ${row.relation_type}`);
  }
  const style = parseEdgeStyle(row.style_json, row.id);
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relationType: row.relation_type as StoredCanvasEdgeRelation,
    ...(row.label === null ? {} : { label: row.label }),
    ...(style === undefined ? {} : { style }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Authoritative JSON-size check after SQL has made materialization safe. */
export function requireCanvasWorkspaceSerializedOutput<T>(
  output: T,
  maximumBytes: number,
  label: string,
): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error(`${label} cannot be serialized`);
  }
  if (utf8Encoder.encode(serialized).byteLength > maximumBytes) {
    throw new Error(`${label} is limited to ${maximumBytes} bytes`);
  }
  return output;
}

function parseTags(value: string, nodeId: string): string[] {
  const parsed = parseJson(value, `Canvas node ${nodeId} tags`);
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_CANVAS_NODE_TAGS ||
    !parsed.every(
      (tag) => typeof tag === "string" && utf8Encoder.encode(tag).byteLength <= MAX_CANVAS_NODE_TAG_BYTES,
    )
  ) {
    throw new Error(`Canvas node ${nodeId} tags are invalid`);
  }
  return parsed;
}

function parseEdgeStyle(value: string | null, edgeId: string): StoredCanvasEdgeStyle | undefined {
  if (value === null) return undefined;
  const parsed = parseJson(value, `Canvas edge ${edgeId} style`);
  if (!isRecord(parsed)) throw new Error(`Canvas edge ${edgeId} style is invalid`);
  if (
    parsed.stroke !== undefined &&
    (typeof parsed.stroke !== "string" ||
      utf8Encoder.encode(parsed.stroke).byteLength > MAX_CANVAS_EDGE_LABEL_BYTES)
  ) {
    throw new Error(`Canvas edge ${edgeId} style.stroke is invalid`);
  }
  if (parsed.animated !== undefined && typeof parsed.animated !== "boolean") {
    throw new Error(`Canvas edge ${edgeId} style.animated is invalid`);
  }
  return {
    ...(typeof parsed.stroke === "string" ? { stroke: parsed.stroke } : {}),
    ...(typeof parsed.animated === "boolean" ? { animated: parsed.animated } : {}),
  };
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} contains invalid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}
