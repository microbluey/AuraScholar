import {
  type CanvasEdge,
  type CanvasPoint,
  type CanvasWorkspaceDocument,
  type ExcerptNode,
  type PaperNode,
} from "@aurascholar/core";
import type { ReaderAnnotation } from "@aurascholar/reader";
import { createCanvasId } from "./model";
import { createExcerptNodeFromAnnotation } from "./excerpt-node";

export const CANVAS_EXCERPT_DRAG_MIME = "application/vnd.aurascholar.canvas-excerpt+json" as const;
export const CANVAS_EXCERPT_DRAG_VERSION = 1 as const;

export interface CanvasExcerptDragPayload {
  version: typeof CANVAS_EXCERPT_DRAG_VERSION;
  /** Workspace that was active when the persisted annotation drag began. */
  workspaceId: string;
  /** PaperNode that owns the annotation and will be connected to the excerpt. */
  sourceNodeId?: string;
  workId: string;
  attachmentId: string;
  paperTitle: string;
  /** A saved Reader annotation. Unsaved text selections are not accepted. */
  annotation: ReaderAnnotation;
}

export type CanvasExcerptDropErrorCode =
  | "invalid-payload"
  | "workspace-mismatch"
  | "source-paper-missing"
  | "source-work-mismatch"
  | "annotation-conflict"
  | "invalid-position"
  | "id-collision";

export class CanvasExcerptDropError extends Error {
  readonly code: CanvasExcerptDropErrorCode;

  constructor(code: CanvasExcerptDropErrorCode, message: string) {
    super(message);
    this.name = "CanvasExcerptDropError";
    this.code = code;
  }
}

export interface CanvasExcerptDropOptions {
  createId?: () => string;
  now?: () => number;
}

export interface CanvasExcerptDropResult {
  document: CanvasWorkspaceDocument;
  node: ExcerptNode;
  edge: CanvasEdge;
  createdNode: boolean;
  createdEdge: boolean;
}

const PAYLOAD_KEYS = [
  "annotation",
  "attachmentId",
  "paperTitle",
  "sourceNodeId",
  "version",
  "workId",
  "workspaceId",
] as const;
const ANNOTATION_KEYS = [
  "anchor",
  "color",
  "contentMd",
  "id",
  "orphaned",
  "pageIndex",
  "type",
] as const;
const ANCHOR_KEYS = ["pageIndex", "position", "quads", "quote", "version"] as const;
const QUADS_KEYS = ["pageIndex", "rects"] as const;
const RECT_KEYS = ["x1", "x2", "y1", "y2"] as const;
const QUOTE_KEYS = ["exact", "prefix", "suffix"] as const;
const POSITION_KEYS = ["end", "start"] as const;
const ANNOTATION_TYPES = new Set<ReaderAnnotation["type"]>([
  "highlight",
  "underline",
  "strikeout",
  "note",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPageIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositionSelector(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, POSITION_KEYS) &&
    isPageIndex(value.start) &&
    isPageIndex(value.end) &&
    value.end >= value.start
  );
}

function isQuoteSelector(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, QUOTE_KEYS) &&
    typeof value.exact === "string" &&
    typeof value.prefix === "string" &&
    typeof value.suffix === "string"
  );
}

function isQuadSelector(value: unknown, pageIndex: number): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, QUADS_KEYS) &&
    value.pageIndex === pageIndex &&
    Array.isArray(value.rects) &&
    value.rects.length > 0 &&
    value.rects.every(
      (rect) =>
        isRecord(rect) &&
        hasOnlyKeys(rect, RECT_KEYS) &&
        isFiniteNumber(rect.x1) &&
        isFiniteNumber(rect.x2) &&
        isFiniteNumber(rect.y1) &&
        isFiniteNumber(rect.y2),
    )
  );
}

function isAnnotationAnchor(value: unknown, pageIndex: number): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ANCHOR_KEYS) ||
    value.version !== 1 ||
    value.pageIndex !== pageIndex
  ) {
    return false;
  }
  if (value.quote !== undefined && !isQuoteSelector(value.quote)) return false;
  if (value.position !== undefined && !isPositionSelector(value.position)) return false;
  if (value.quads !== undefined && !isQuadSelector(value.quads, pageIndex)) return false;
  return true;
}

function isPersistedReaderAnnotation(value: unknown): value is ReaderAnnotation {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ANNOTATION_KEYS) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.type) ||
    !ANNOTATION_TYPES.has(value.type as ReaderAnnotation["type"]) ||
    !isNonEmptyString(value.color) ||
    !isPageIndex(value.pageIndex) ||
    !isAnnotationAnchor(value.anchor, value.pageIndex)
  ) {
    return false;
  }
  if (value.contentMd !== undefined && typeof value.contentMd !== "string") return false;
  if (value.orphaned !== undefined && typeof value.orphaned !== "boolean") return false;
  return true;
}

export function isCanvasExcerptDragPayload(value: unknown): value is CanvasExcerptDragPayload {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, PAYLOAD_KEYS) &&
    value.version === CANVAS_EXCERPT_DRAG_VERSION &&
    isNonEmptyString(value.workspaceId) &&
    (value.sourceNodeId === undefined || isNonEmptyString(value.sourceNodeId)) &&
    isNonEmptyString(value.workId) &&
    isNonEmptyString(value.attachmentId) &&
    isNonEmptyString(value.paperTitle) &&
    isPersistedReaderAnnotation(value.annotation)
  );
}

function assertCanvasExcerptDragPayload(value: unknown): asserts value is CanvasExcerptDragPayload {
  if (!isCanvasExcerptDragPayload(value)) {
    throw new CanvasExcerptDropError("invalid-payload", "摘录拖拽数据格式无效");
  }
}

export function serializeCanvasExcerptDragPayload(payload: CanvasExcerptDragPayload): string {
  assertCanvasExcerptDragPayload(payload);
  return JSON.stringify(payload);
}

export function parseCanvasExcerptDragPayload(serialized: string): CanvasExcerptDragPayload | null {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isCanvasExcerptDragPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCanvasExcerptDragPayload(
  dataTransfer: DataTransfer,
  payload: CanvasExcerptDragPayload,
): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(CANVAS_EXCERPT_DRAG_MIME, serializeCanvasExcerptDragPayload(payload));
}

export function readCanvasExcerptDragPayload(
  dataTransfer: DataTransfer,
  expectedWorkspaceId?: string,
): CanvasExcerptDragPayload | null {
  const serialized = dataTransfer.getData(CANVAS_EXCERPT_DRAG_MIME);
  if (!serialized) return null;
  const payload = parseCanvasExcerptDragPayload(serialized);
  if (
    !payload ||
    (expectedWorkspaceId !== undefined && payload.workspaceId !== expectedWorkspaceId)
  ) {
    return null;
  }
  return payload;
}

function sourcePaperFor(
  document: CanvasWorkspaceDocument,
  payload: CanvasExcerptDragPayload,
): PaperNode {
  const source = document.nodes.find((node) => node.id === payload.sourceNodeId);
  if (!source || source.type !== "paper") {
    throw new CanvasExcerptDropError(
      "source-paper-missing",
      "摘录来源文献卡已不存在，无法加入白板",
    );
  }
  if (source.data.workId !== payload.workId) {
    throw new CanvasExcerptDropError("source-work-mismatch", "摘录与来源文献卡不属于同一篇文献");
  }
  return source;
}

function matchingDerivedEdge(edge: CanvasEdge, sourceId: string, targetId: string): boolean {
  return (
    edge.sourceId === sourceId && edge.targetId === targetId && edge.relationType === "derived-from"
  );
}

function uniqueId(
  document: CanvasWorkspaceDocument,
  createId: () => string,
  reservedIds: ReadonlySet<string> = new Set(),
): string {
  const existingIds = new Set([
    ...document.nodes.map((node) => node.id),
    ...document.edges.map((edge) => edge.id),
    ...reservedIds,
  ]);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = createId();
    if (isNonEmptyString(id) && !existingIds.has(id)) return id;
  }
  throw new CanvasExcerptDropError("id-collision", "无法为摘录卡生成唯一标识");
}

function changeTimestamp(now: () => number): number {
  const value = now();
  if (!isFiniteNumber(value)) {
    throw new CanvasExcerptDropError("invalid-payload", "摘录卡时间戳无效");
  }
  return value;
}

function derivedEdge(id: string, sourceId: string, targetId: string, now: number): CanvasEdge {
  return {
    id,
    sourceId,
    targetId,
    relationType: "derived-from",
    label: "源自",
    createdAt: now,
    updatedAt: now,
  };
}

function validatePosition(position: CanvasPoint): void {
  if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
    throw new CanvasExcerptDropError("invalid-position", "摘录卡落点坐标无效");
  }
}

/**
 * Atomically applies a persisted Reader annotation drop to a Canvas document.
 * The returned document either contains both the ExcerptNode and its
 * Paper→Excerpt derived-from edge, or the input document remains untouched.
 */
export function applyCanvasExcerptDrop(
  document: CanvasWorkspaceDocument,
  payload: CanvasExcerptDragPayload,
  dropPosition: CanvasPoint,
  options: CanvasExcerptDropOptions = {},
): CanvasExcerptDropResult {
  assertCanvasExcerptDragPayload(payload);
  validatePosition(dropPosition);
  if (document.workspaceId !== payload.workspaceId) {
    throw new CanvasExcerptDropError(
      "workspace-mismatch",
      "摘录拖拽开始后白板已切换，本次加入已取消",
    );
  }
  const source = sourcePaperFor(document, payload);
  const createId = options.createId ?? createCanvasId;
  const now = options.now ?? Date.now;

  const existingNode = document.nodes.find(
    (node): node is ExcerptNode =>
      node.type === "excerpt" && node.data.annotationId === payload.annotation.id,
  );
  if (existingNode) {
    if (existingNode.data.workId !== payload.workId) {
      throw new CanvasExcerptDropError("annotation-conflict", "同一批注标识已被另一篇文献使用");
    }

    const matchingEdges = document.edges.filter((edge) =>
      matchingDerivedEdge(edge, source.id, existingNode.id),
    );
    const firstEdge = matchingEdges[0];
    if (firstEdge) {
      if (matchingEdges.length === 1) {
        return {
          document,
          node: existingNode,
          edge: firstEdge,
          createdNode: false,
          createdEdge: false,
        };
      }
      const timestamp = changeTimestamp(now);
      let keptMatchingEdge = false;
      const deduplicatedEdges = document.edges.filter((edge) => {
        if (!matchingDerivedEdge(edge, source.id, existingNode.id)) return true;
        if (!keptMatchingEdge) {
          keptMatchingEdge = true;
          return true;
        }
        return false;
      });
      return {
        document: { ...document, edges: deduplicatedEdges, updatedAt: timestamp },
        node: existingNode,
        edge: firstEdge,
        createdNode: false,
        createdEdge: false,
      };
    }

    const timestamp = changeTimestamp(now);
    const edge = derivedEdge(uniqueId(document, createId), source.id, existingNode.id, timestamp);
    return {
      document: {
        ...document,
        edges: [...document.edges, edge],
        updatedAt: timestamp,
      },
      node: existingNode,
      edge,
      createdNode: false,
      createdEdge: true,
    };
  }

  const timestamp = changeTimestamp(now);
  const nodeId = uniqueId(document, createId);
  const edgeId = uniqueId(document, createId, new Set([nodeId]));
  const node = createExcerptNodeFromAnnotation({
    annotation: payload.annotation,
    attachmentId: payload.attachmentId,
    id: nodeId,
    now: timestamp,
    // DataTransfer payloads are untrusted page input. The Canvas already owns
    // the authoritative PaperNode metadata, so never copy a spoofable title.
    paperTitle: source.data.title,
    position: dropPosition,
    workId: payload.workId,
  });
  const edge = derivedEdge(edgeId, source.id, node.id, timestamp);
  return {
    document: {
      ...document,
      nodes: [...document.nodes, node],
      edges: [...document.edges, edge],
      updatedAt: timestamp,
    },
    node,
    edge,
    createdNode: true,
    createdEdge: true,
  };
}
