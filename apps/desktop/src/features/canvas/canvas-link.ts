import type {
  CanvasEdge,
  CanvasNode,
  CanvasPoint,
  CanvasWorkspaceDocument,
  IdeaNoteNode,
} from "@aurascholar/core";
import { createBlankIdeaNoteNode, createEdge } from "./model";

export const COLLAPSED_GROUP_DIMENSIONS = { width: 260, height: 48 } as const;

export type CanvasLinkFailure =
  | "duplicate"
  | "id-collision"
  | "invalid-position"
  | "missing-node"
  | "self-link"
  | "workspace-mismatch";

export interface PreparedCanvasLink {
  edge: CanvasEdge;
  sourceId: string;
  targetId: string;
  workspaceId: string;
}

export interface PreparedCanvasLinkedNote {
  edge: CanvasEdge;
  node: IdeaNoteNode;
  sourceId: string;
  workspaceId: string;
}

export type PrepareCanvasLinkResult =
  | { status: "ready"; prepared: PreparedCanvasLink }
  | { status: CanvasLinkFailure };

export type PrepareCanvasLinkedNoteResult =
  | { status: "ready"; prepared: PreparedCanvasLinkedNote }
  | { status: CanvasLinkFailure };

export type ApplyCanvasLinkResult =
  | {
      status: "created";
      document: CanvasWorkspaceDocument;
      edge: CanvasEdge;
    }
  | {
      status: CanvasLinkFailure;
      document: CanvasWorkspaceDocument;
    };

export type ApplyCanvasLinkedNoteResult =
  | {
      status: "created";
      document: CanvasWorkspaceDocument;
      edge: CanvasEdge;
      node: IdeaNoteNode;
    }
  | {
      status: CanvasLinkFailure;
      document: CanvasWorkspaceDocument;
    };

export interface CanvasLinkHandles {
  sourceHandle: string;
  targetHandle: string;
}

export function hasReciprocalCanvasLink(edges: CanvasEdge[], edge: CanvasEdge): boolean {
  return edges.some(
    (candidate) =>
      candidate.id !== edge.id &&
      candidate.sourceId === edge.targetId &&
      candidate.targetId === edge.sourceId,
  );
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
): CanvasLinkFailure | null {
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

export function prepareCanvasLink(
  document: CanvasWorkspaceDocument,
  sourceId: string,
  targetId: string,
): PrepareCanvasLinkResult {
  const failure = validateEndpoints(document, sourceId, targetId);
  if (failure) return { status: failure };

  return {
    status: "ready",
    prepared: {
      workspaceId: document.workspaceId,
      sourceId,
      targetId,
      edge: createEdge(sourceId, targetId),
    },
  };
}

export function applyCanvasLink(
  document: CanvasWorkspaceDocument,
  prepared: PreparedCanvasLink,
): ApplyCanvasLinkResult {
  if (document.workspaceId !== prepared.workspaceId) {
    return { status: "workspace-mismatch", document };
  }
  if (
    prepared.edge.sourceId !== prepared.sourceId ||
    prepared.edge.targetId !== prepared.targetId
  ) {
    return { status: "missing-node", document };
  }
  if (document.edges.some((edge) => edge.id === prepared.edge.id)) {
    return { status: "id-collision", document };
  }
  const failure = validateEndpoints(document, prepared.sourceId, prepared.targetId);
  if (failure) return { status: failure, document };

  return {
    status: "created",
    edge: prepared.edge,
    document: {
      ...document,
      edges: [...document.edges, prepared.edge],
      updatedAt: Math.max(document.updatedAt, prepared.edge.updatedAt),
    },
  };
}

export function prepareCanvasLinkedNote(
  document: CanvasWorkspaceDocument,
  sourceId: string,
  dropPosition: CanvasPoint,
): PrepareCanvasLinkedNoteResult {
  if (!document.nodes.some((node) => node.id === sourceId)) {
    return { status: "missing-node" };
  }
  if (!Number.isFinite(dropPosition.x) || !Number.isFinite(dropPosition.y)) {
    return { status: "invalid-position" };
  }

  const node = createBlankIdeaNoteNode(dropPosition);
  const edge = {
    ...createEdge(sourceId, node.id),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
  return {
    status: "ready",
    prepared: {
      workspaceId: document.workspaceId,
      sourceId,
      node,
      edge,
    },
  };
}

export function applyCanvasLinkedNote(
  document: CanvasWorkspaceDocument,
  prepared: PreparedCanvasLinkedNote,
): ApplyCanvasLinkedNoteResult {
  if (document.workspaceId !== prepared.workspaceId) {
    return { status: "workspace-mismatch", document };
  }
  if (!document.nodes.some((node) => node.id === prepared.sourceId)) {
    return { status: "missing-node", document };
  }
  if (
    prepared.node.type !== "idea-note" ||
    prepared.edge.sourceId !== prepared.sourceId ||
    prepared.edge.targetId !== prepared.node.id
  ) {
    return { status: "missing-node", document };
  }
  if (
    document.nodes.some((node) => node.id === prepared.node.id) ||
    document.edges.some((edge) => edge.id === prepared.edge.id)
  ) {
    return { status: "id-collision", document };
  }

  const updatedAt = Math.max(document.updatedAt, prepared.node.updatedAt, prepared.edge.updatedAt);
  return {
    status: "created",
    node: prepared.node,
    edge: prepared.edge,
    document: {
      ...document,
      nodes: [...document.nodes, prepared.node],
      edges: [...document.edges, prepared.edge],
      updatedAt,
    },
  };
}

export function resolveCanvasLinkHandles(
  nodes: CanvasNode[],
  sourceId: string,
  targetId: string,
): CanvasLinkHandles {
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
