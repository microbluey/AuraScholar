import type { CanvasNode, CanvasWorkspaceDocument } from "@aurascholar/core";
import { isApplePlatform } from "../../shortcut-labels";
import type { CanvasTool } from "./CanvasDock";

export type CanvasToolboxPanel = "library" | "details" | "overview";
export type CanvasNodePrimarySurface = "details" | "reader";

export const CANVAS_INTERACTIVE_TARGET_SELECTOR =
  "button, a, input, textarea, select, [contenteditable='true'], .react-flow__handle, [data-canvas-interactive]";
export const CANVAS_KEYBOARD_DELETE_BLOCKING_SELECTOR =
  "button, a, input, textarea, select, [contenteditable='true'], [role='dialog'], [role='textbox'], .canvas-node-menu, .canvas-semantic-link-menu, .canvas-dock__menu, .canvas-reader-drawer";

export function primarySurfaceForCanvasNode(
  node: Pick<CanvasNode, "type">,
): CanvasNodePrimarySurface {
  return node.type === "paper" || node.type === "excerpt" ? "reader" : "details";
}

export interface CanvasNodeActivationIntent {
  additive: boolean;
  button: number;
  connectionInProgress: boolean;
  interactiveTarget: boolean;
  pendingSemanticLink: boolean;
  tool: CanvasTool;
}

export function shouldActivateCanvasNode(intent: CanvasNodeActivationIntent): boolean {
  return (
    intent.tool === "select" &&
    intent.button === 0 &&
    !intent.additive &&
    !intent.connectionInProgress &&
    !intent.pendingSemanticLink &&
    !intent.interactiveTarget
  );
}

export function isCanvasContextMenuShortcut(input: {
  composing: boolean;
  key: string;
  repeat: boolean;
  shiftKey: boolean;
}): boolean {
  if (input.composing || input.repeat) return false;
  return input.key === "ContextMenu" || (input.key === "F10" && input.shiftKey);
}

export function isCanvasSelectionDeleteShortcut(input: {
  blockedSurface: boolean;
  composing: boolean;
  defaultPrevented: boolean;
  key: string;
  repeat: boolean;
  withinCanvas: boolean;
}): boolean {
  return (
    input.withinCanvas &&
    !input.blockedSurface &&
    !input.composing &&
    !input.defaultPrevented &&
    !input.repeat &&
    (input.key === "Delete" || input.key === "Backspace")
  );
}

export function isCanvasLayoutShortcut(
  input: {
    altKey: boolean;
    blockedSurface: boolean;
    composing: boolean;
    ctrlKey: boolean;
    defaultPrevented: boolean;
    key: string;
    metaKey: boolean;
    repeat: boolean;
    shiftKey: boolean;
    withinCanvas: boolean;
  },
  platform = globalThis.navigator?.platform ?? "",
): boolean {
  if (
    !input.withinCanvas ||
    input.blockedSurface ||
    input.composing ||
    input.defaultPrevented ||
    input.repeat ||
    input.altKey ||
    !input.shiftKey ||
    input.key.toLocaleLowerCase() !== "l"
  ) {
    return false;
  }
  return isApplePlatform(platform)
    ? input.metaKey && !input.ctrlKey
    : input.ctrlKey && !input.metaKey;
}

export interface CanvasSelectionDeletionPlan {
  deletedEndpointIds: Set<string>;
  edgeSelected: boolean;
  removedNodeIds: Set<string>;
  selectedGroupIds: Set<string>;
}

export function planCanvasSelectionDeletion(
  document: CanvasWorkspaceDocument,
  selectedNodeIds: ReadonlySet<string>,
  selectedEdgeId: string | null,
): CanvasSelectionDeletionPlan {
  const selectedTargets = document.nodes.filter((node) => selectedNodeIds.has(node.id));
  const selectedGroupIds = new Set(
    selectedTargets.filter((node) => node.type === "group").map((node) => node.id),
  );
  const removedNodeIds = new Set(
    selectedTargets
      .filter(
        (node) => node.type !== "group" && (!node.groupId || !selectedGroupIds.has(node.groupId)),
      )
      .map((node) => node.id),
  );

  return {
    deletedEndpointIds: new Set([...selectedGroupIds, ...removedNodeIds]),
    edgeSelected: Boolean(
      selectedEdgeId && document.edges.some((edge) => edge.id === selectedEdgeId),
    ),
    removedNodeIds,
    selectedGroupIds,
  };
}

export function applyCanvasSelectionDeletion(
  document: CanvasWorkspaceDocument,
  selectedNodeIds: ReadonlySet<string>,
  selectedEdgeId: string | null,
  timestamp = Date.now(),
): CanvasWorkspaceDocument {
  const { deletedEndpointIds, edgeSelected, selectedGroupIds } = planCanvasSelectionDeletion(
    document,
    selectedNodeIds,
    selectedEdgeId,
  );
  const selectedGroups = new Map(
    document.nodes
      .filter((node) => node.type === "group" && selectedGroupIds.has(node.id))
      .map((node) => [node.id, node] as const),
  );
  if (!deletedEndpointIds.size && !edgeSelected) return document;

  return {
    ...document,
    nodes: document.nodes
      .filter((node) => !deletedEndpointIds.has(node.id))
      .map((node) => {
        const group = node.groupId ? selectedGroups.get(node.groupId) : undefined;
        return group
          ? {
              ...node,
              groupId: undefined,
              position: {
                x: group.position.x + node.position.x,
                y: group.position.y + node.position.y,
              },
              updatedAt: timestamp,
            }
          : node;
      }),
    edges: document.edges.filter(
      (edge) =>
        edge.id !== selectedEdgeId &&
        !deletedEndpointIds.has(edge.sourceId) &&
        !deletedEndpointIds.has(edge.targetId),
    ),
    updatedAt: timestamp,
  };
}

export interface CanvasMenuPoint {
  x: number;
  y: number;
}

export function clampCanvasMenuPoint(
  point: CanvasMenuPoint,
  bounds: { height: number; width: number },
  menuSize: { height: number; width: number },
  padding = 12,
): CanvasMenuPoint {
  return {
    x: Math.min(
      Math.max(point.x, padding),
      Math.max(padding, bounds.width - menuSize.width - padding),
    ),
    y: Math.min(
      Math.max(point.y, padding),
      Math.max(padding, bounds.height - menuSize.height - padding),
    ),
  };
}
