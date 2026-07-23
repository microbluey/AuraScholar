import type {
  CanvasEdge,
  CanvasEdgeRelation,
  CanvasNode,
  CanvasPoint,
  CanvasWorkspaceDocument,
} from "@aurascholar/core";
import { createEdge, RELATION_LABELS } from "./model";

export const COLLAPSED_GROUP_DIMENSIONS = { width: 260, height: 48 } as const;

export const QUICK_SEMANTIC_RELATIONS = [
  { shortcut: "1", relationType: "cites", englishLabel: "Cites", label: "引用" },
  { shortcut: "2", relationType: "supports", englishLabel: "Supports", label: "支持" },
  { shortcut: "3", relationType: "contradicts", englishLabel: "Contradicts", label: "反驳" },
  { shortcut: "4", relationType: "extends", englishLabel: "Extends", label: "扩展" },
] as const satisfies readonly {
  shortcut: string;
  relationType: CanvasEdgeRelation;
  englishLabel: string;
  label: string;
}[];

export type QuickSemanticRelation = (typeof QUICK_SEMANTIC_RELATIONS)[number]["relationType"];

export interface PendingSemanticLink {
  position: CanvasPoint;
  sourceHandle?: string;
  sourceId: string;
  targetHandle?: string;
  targetId: string;
  workspaceId: string;
}

export type SemanticLinkFailure = "duplicate" | "missing-node" | "self-link" | "workspace-mismatch";

export type PlanSemanticLinkResult =
  | { status: "ready"; pending: PendingSemanticLink }
  | { status: SemanticLinkFailure };

export type ApplySemanticLinkResult =
  | {
      status: "created";
      document: CanvasWorkspaceDocument;
      edge: CanvasEdge;
    }
  | {
      status: SemanticLinkFailure;
      document: CanvasWorkspaceDocument;
    };

export interface SemanticLinkShortcutInput {
  altKey?: boolean;
  ctrlKey?: boolean;
  isComposing?: boolean;
  key: string;
  metaKey?: boolean;
  repeat?: boolean;
  targetIsEditable?: boolean;
}

export interface SemanticLinkHandles {
  sourceHandle: string;
  targetHandle: string;
}

function absoluteNodePosition(node: CanvasNode, allNodes: CanvasNode[]): CanvasPoint {
  if (!node.groupId) return node.position;
  const group = allNodes.find(
    (candidate) => candidate.id === node.groupId && candidate.type === "group",
  );
  if (!group) return node.position;
  return {
    x: group.position.x + node.position.x,
    y: group.position.y + node.position.y,
  };
}

function nodeCenter(node: CanvasNode, allNodes: CanvasNode[]): CanvasPoint {
  const position = absoluteNodePosition(node, allNodes);
  const dimensions =
    node.type === "group" && node.data.collapsed ? COLLAPSED_GROUP_DIMENSIONS : node.dimensions;
  return {
    x: position.x + dimensions.width / 2,
    y: position.y + dimensions.height / 2,
  };
}

function validateEndpoints(
  document: CanvasWorkspaceDocument,
  sourceId: string,
  targetId: string,
): SemanticLinkFailure | null {
  if (sourceId === targetId) return "self-link";
  if (
    !document.nodes.some((node) => node.id === sourceId) ||
    !document.nodes.some((node) => node.id === targetId)
  ) {
    return "missing-node";
  }
  if (document.edges.some((edge) => edge.sourceId === sourceId && edge.targetId === targetId)) {
    return "duplicate";
  }
  return null;
}

export function planSemanticLink(
  document: CanvasWorkspaceDocument,
  sourceId: string,
  targetId: string,
  handles: { sourceHandle?: string | null; targetHandle?: string | null } = {},
): PlanSemanticLinkResult {
  const failure = validateEndpoints(document, sourceId, targetId);
  if (failure) return { status: failure };

  const source = document.nodes.find((node) => node.id === sourceId)!;
  const target = document.nodes.find((node) => node.id === targetId)!;
  const sourceCenter = nodeCenter(source, document.nodes);
  const targetCenter = nodeCenter(target, document.nodes);

  return {
    status: "ready",
    pending: {
      workspaceId: document.workspaceId,
      sourceId,
      targetId,
      ...(handles.sourceHandle ? { sourceHandle: handles.sourceHandle } : {}),
      ...(handles.targetHandle ? { targetHandle: handles.targetHandle } : {}),
      position: {
        x: (sourceCenter.x + targetCenter.x) / 2,
        y: (sourceCenter.y + targetCenter.y) / 2,
      },
    },
  };
}

export function resolveSemanticLinkHandles(
  nodes: CanvasNode[],
  sourceId: string,
  targetId: string,
): SemanticLinkHandles {
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (!source || !target) {
    return { sourceHandle: "link-right", targetHandle: "link-left" };
  }
  const sourceCenter = nodeCenter(source, nodes);
  const targetCenter = nodeCenter(target, nodes);
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? { sourceHandle: "link-right", targetHandle: "link-left" }
      : { sourceHandle: "link-left", targetHandle: "link-right" };
  }
  return deltaY >= 0
    ? { sourceHandle: "link-bottom", targetHandle: "link-top" }
    : { sourceHandle: "link-top", targetHandle: "link-bottom" };
}

export function applySemanticLink(
  document: CanvasWorkspaceDocument,
  pending: PendingSemanticLink,
  relationType: QuickSemanticRelation,
  preparedEdge?: CanvasEdge,
): ApplySemanticLinkResult {
  if (document.workspaceId !== pending.workspaceId) {
    return { status: "workspace-mismatch", document };
  }
  const failure = validateEndpoints(document, pending.sourceId, pending.targetId);
  if (failure) return { status: failure, document };

  const edge = preparedEdge
    ? {
        ...preparedEdge,
        sourceId: pending.sourceId,
        targetId: pending.targetId,
        relationType,
        label: RELATION_LABELS[relationType],
      }
    : createEdge(pending.sourceId, pending.targetId, relationType);

  return {
    status: "created",
    edge,
    document: {
      ...document,
      edges: [...document.edges, edge],
      updatedAt: edge.updatedAt,
    },
  };
}

export function resolveSemanticLinkShortcut({
  altKey,
  ctrlKey,
  isComposing,
  key,
  metaKey,
  repeat,
  targetIsEditable,
}: SemanticLinkShortcutInput): QuickSemanticRelation | null {
  if (isComposing || repeat || altKey || ctrlKey || metaKey || targetIsEditable) return null;
  return QUICK_SEMANTIC_RELATIONS.find((option) => option.shortcut === key)?.relationType ?? null;
}
