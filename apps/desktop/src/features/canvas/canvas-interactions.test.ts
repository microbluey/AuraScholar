import { describe, expect, it } from "vitest";
import {
  clampCanvasMenuPoint,
  isCanvasContextMenuShortcut,
  primarySurfaceForCanvasNode,
  shouldActivateCanvasNode,
} from "./canvas-interactions";

describe("canvas node interactions", () => {
  it("routes document-backed nodes to the reader and authored nodes to details", () => {
    expect(primarySurfaceForCanvasNode({ type: "paper" })).toBe("reader");
    expect(primarySurfaceForCanvasNode({ type: "excerpt" })).toBe("reader");
    expect(primarySurfaceForCanvasNode({ type: "idea-note" })).toBe("details");
    expect(primarySurfaceForCanvasNode({ type: "ai-synth" })).toBe("details");
    expect(primarySurfaceForCanvasNode({ type: "group" })).toBe("details");
  });

  it("activates only an unmodified primary click in select mode", () => {
    const base = {
      additive: false,
      button: 0,
      connectionInProgress: false,
      interactiveTarget: false,
      pendingSemanticLink: false,
      tool: "select" as const,
    };
    expect(shouldActivateCanvasNode(base)).toBe(true);
    expect(shouldActivateCanvasNode({ ...base, additive: true })).toBe(false);
    expect(shouldActivateCanvasNode({ ...base, button: 2 })).toBe(false);
    expect(shouldActivateCanvasNode({ ...base, interactiveTarget: true })).toBe(false);
    expect(shouldActivateCanvasNode({ ...base, connectionInProgress: true })).toBe(false);
    expect(shouldActivateCanvasNode({ ...base, pendingSemanticLink: true })).toBe(false);
    expect(shouldActivateCanvasNode({ ...base, tool: "pan" })).toBe(false);
    expect(shouldActivateCanvasNode({ ...base, tool: "connect" })).toBe(false);
  });

  it("recognizes native keyboard context-menu shortcuts", () => {
    expect(
      isCanvasContextMenuShortcut({
        composing: false,
        key: "ContextMenu",
        repeat: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isCanvasContextMenuShortcut({
        composing: false,
        key: "F10",
        repeat: false,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(
      isCanvasContextMenuShortcut({
        composing: false,
        key: "F10",
        repeat: false,
        shiftKey: false,
      }),
    ).toBe(false);
    expect(
      isCanvasContextMenuShortcut({
        composing: true,
        key: "ContextMenu",
        repeat: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });

  it("keeps context menus inside the visible workspace", () => {
    expect(
      clampCanvasMenuPoint(
        { x: -40, y: 900 },
        { width: 800, height: 600 },
        { width: 232, height: 280 },
      ),
    ).toEqual({ x: 12, y: 308 });
    expect(
      clampCanvasMenuPoint(
        { x: 400, y: 200 },
        { width: 800, height: 600 },
        { width: 232, height: 280 },
      ),
    ).toEqual({ x: 400, y: 200 });
  });
});
