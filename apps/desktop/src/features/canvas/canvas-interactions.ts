import type { CanvasNode } from "@aurascholar/core";
import type { CanvasTool } from "./CanvasDock";

export type CanvasToolboxPanel = "library" | "details" | "overview";
export type CanvasNodePrimarySurface = "details" | "reader";

export const CANVAS_INTERACTIVE_TARGET_SELECTOR =
  "button, a, input, textarea, select, [contenteditable='true'], .react-flow__handle, [data-canvas-interactive]";

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
