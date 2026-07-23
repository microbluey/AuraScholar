import { describe, expect, it } from "vitest";
import {
  applyCanvasSelectionDeletion,
  clampCanvasMenuPoint,
  isCanvasContextMenuShortcut,
  isCanvasSelectionDeleteShortcut,
  planCanvasSelectionDeletion,
  primarySurfaceForCanvasNode,
  shouldActivateCanvasNode,
} from "./canvas-interactions";
import { createPreviewWorkspace } from "./model";

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

  it("deletes a canvas selection only from an unblocked canvas keyboard surface", () => {
    const base = {
      blockedSurface: false,
      composing: false,
      defaultPrevented: false,
      key: "Delete",
      repeat: false,
      withinCanvas: true,
    };
    expect(isCanvasSelectionDeleteShortcut(base)).toBe(true);
    expect(isCanvasSelectionDeleteShortcut({ ...base, key: "Backspace" })).toBe(true);
    expect(isCanvasSelectionDeleteShortcut({ ...base, key: "Enter" })).toBe(false);
    expect(isCanvasSelectionDeleteShortcut({ ...base, blockedSurface: true })).toBe(false);
    expect(isCanvasSelectionDeleteShortcut({ ...base, composing: true })).toBe(false);
    expect(isCanvasSelectionDeleteShortcut({ ...base, defaultPrevented: true })).toBe(false);
    expect(isCanvasSelectionDeleteShortcut({ ...base, repeat: true })).toBe(false);
    expect(isCanvasSelectionDeleteShortcut({ ...base, withinCanvas: false })).toBe(false);
  });

  it("removes selected cards and their relationships without touching other cards", () => {
    const document = createPreviewWorkspace();
    const paper = document.nodes.find((node) => node.type === "paper");
    expect(paper).toBeDefined();

    const result = applyCanvasSelectionDeletion(document, new Set([paper!.id]), null, 500);
    expect(result.nodes.some((node) => node.id === paper!.id)).toBe(false);
    expect(
      result.edges.some((edge) => edge.sourceId === paper!.id || edge.targetId === paper!.id),
    ).toBe(false);
    expect(result.nodes.length).toBe(document.nodes.length - 1);
    expect(result.updatedAt).toBe(500);
  });

  it("ungroups and preserves every child even when a selected child overlaps the group selection", () => {
    const document = createPreviewWorkspace();
    const group = document.nodes.find((node) => node.type === "group");
    const child = document.nodes.find((node) => node.groupId === group?.id);
    expect(group).toBeDefined();
    expect(child).toBeDefined();

    const result = applyCanvasSelectionDeletion(
      document,
      new Set([group!.id, child!.id]),
      null,
      600,
    );
    const plan = planCanvasSelectionDeletion(document, new Set([group!.id, child!.id]), null);
    const preservedChild = result.nodes.find((node) => node.id === child!.id);
    expect(plan.removedNodeIds.has(child!.id)).toBe(false);
    expect(plan.selectedGroupIds.has(group!.id)).toBe(true);
    expect(result.nodes.some((node) => node.id === group!.id)).toBe(false);
    expect(preservedChild).toMatchObject({
      groupId: undefined,
      position: {
        x: group!.position.x + child!.position.x,
        y: group!.position.y + child!.position.y,
      },
      updatedAt: 600,
    });
  });

  it("deletes only the selected relationship when no card is selected", () => {
    const document = createPreviewWorkspace();
    const edge = document.edges[0];
    expect(edge).toBeDefined();

    const result = applyCanvasSelectionDeletion(document, new Set(), edge!.id, 700);
    expect(result.nodes).toEqual(document.nodes);
    expect(result.edges.some((candidate) => candidate.id === edge!.id)).toBe(false);
    expect(result.edges.length).toBe(document.edges.length - 1);
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
