import { type CanvasWorkspaceDocument } from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import {
  CANVAS_HISTORY_LIMIT,
  createCanvasHistoryState,
  reconcileCanvasHistory,
  recordCanvasHistory,
  redoCanvasHistory,
  sealCanvasHistory,
  undoCanvasHistory,
} from "./canvas-history";
import { createIdeaNoteNode, createPreviewWorkspace } from "./model";

function addNote(
  document: CanvasWorkspaceDocument,
  id: string,
  timestamp: number,
): CanvasWorkspaceDocument {
  return {
    ...document,
    nodes: [
      ...document.nodes,
      {
        ...createIdeaNoteNode({ x: timestamp, y: timestamp }),
        id,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    updatedAt: timestamp,
  };
}

function reverseObjectKeyOrder<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}

describe("canvas workspace history", () => {
  it("undoes and redoes content while preserving the current viewport and metadata", () => {
    const original = createPreviewWorkspace();
    const edited = addNote(original, "history-note", 100);
    const history = recordCanvasHistory(
      createCanvasHistoryState(original),
      original,
      edited,
      { label: "新建研究笔记" },
      100,
    );
    const current = {
      ...edited,
      name: "Renamed workspace",
      viewport: { x: 80, y: -30, zoom: 1.4 },
    };

    const undone = undoCanvasHistory(history, current, 200);
    expect(undone).not.toBeNull();
    expect(undone?.label).toBe("新建研究笔记");
    expect(undone?.document.nodes).toEqual(original.nodes);
    expect(undone?.document.name).toBe("Renamed workspace");
    expect(undone?.document.viewport).toEqual(current.viewport);
    expect(undone?.document.updatedAt).toBe(200);

    const redone = redoCanvasHistory(undone!.history, undone!.document, 300);
    expect(redone?.document.nodes.some((node) => node.id === "history-note")).toBe(true);
    expect(redone?.document.viewport).toEqual(current.viewport);
    expect(redone?.label).toBe("新建研究笔记");
  });

  it("coalesces a rapid edit series into one undo step", () => {
    const original = createPreviewWorkspace();
    const first = addNote(original, "first", 100);
    const second = addNote(first, "second", 200);
    const mutation = { label: "编辑卡片", mergeKey: "edit:note-1", mergeWindowMs: 500 };
    const firstHistory = recordCanvasHistory(
      createCanvasHistoryState(original),
      original,
      first,
      mutation,
      100,
    );
    const mergedHistory = recordCanvasHistory(firstHistory, first, second, mutation, 400);

    expect(mergedHistory.past).toHaveLength(1);
    expect(undoCanvasHistory(mergedHistory, second, 500)?.document.nodes).toEqual(original.nodes);

    const separatedHistory = recordCanvasHistory(
      mergedHistory,
      second,
      addNote(second, "third", 3),
      mutation,
      901,
    );
    expect(separatedHistory.past).toHaveLength(2);
  });

  it("clears redo after a new branch instead of merging across the undo boundary", () => {
    const original = createPreviewWorkspace();
    const first = addNote(original, "first", 100);
    const second = addNote(first, "second", 200);
    const mutation = { label: "移动卡片", mergeKey: "drag:1", mergeWindowMs: Infinity };
    const firstHistory = recordCanvasHistory(
      createCanvasHistoryState(original),
      original,
      first,
      mutation,
      100,
    );
    const secondHistory = recordCanvasHistory(
      firstHistory,
      first,
      second,
      { label: "新建研究笔记" },
      200,
    );
    const undone = undoCanvasHistory(secondHistory, second, 300)!;
    const branched = addNote(undone.document, "branch", 400);
    const branchedHistory = recordCanvasHistory(
      undone.history,
      undone.document,
      branched,
      mutation,
      400,
    );

    expect(branchedHistory.future).toEqual([]);
    expect(branchedHistory.past).toHaveLength(2);
    expect(undoCanvasHistory(branchedHistory, branched, 500)?.document.nodes).toEqual(
      undone.document.nodes,
    );
  });

  it("ignores viewport-only updates and keeps at most the configured number of steps", () => {
    const original = createPreviewWorkspace();
    const viewportOnly = {
      ...original,
      viewport: { x: 20, y: 30, zoom: 1.2 },
      updatedAt: 20,
    };
    expect(
      recordCanvasHistory(
        createCanvasHistoryState(original),
        original,
        viewportOnly,
        { label: "移动视口" },
        20,
      ),
    ).toEqual(createCanvasHistoryState(original));

    let history = createCanvasHistoryState(original);
    let current = original;
    for (let index = 0; index < CANVAS_HISTORY_LIMIT + 5; index += 1) {
      const next = addNote(current, `note-${index}`, index + 1);
      history = recordCanvasHistory(history, current, next, { label: `操作 ${index}` }, index + 1);
      current = next;
    }
    expect(history.past).toHaveLength(CANVAS_HISTORY_LIMIT);
    expect(history.past[0]?.label).toBe("操作 5");
  });

  it("uses the default merge window and seals a transaction across workspace switches", () => {
    const original = createPreviewWorkspace();
    const first = addNote(original, "first", 100);
    const second = addNote(first, "second", 200);
    const mutation = { label: "编辑卡片", mergeKey: "edit:note-1" };
    const firstHistory = recordCanvasHistory(
      createCanvasHistoryState(original),
      original,
      first,
      mutation,
      100,
    );
    const outsideDefaultWindow = recordCanvasHistory(
      firstHistory,
      first,
      second,
      mutation,
      100 + 901,
    );
    expect(outsideDefaultWindow.past).toHaveLength(2);

    const sealed = sealCanvasHistory(firstHistory);
    const afterSwitchBack = recordCanvasHistory(sealed, first, second, mutation, 200);
    expect(afterSwitchBack.past).toHaveLength(2);
  });

  it("resets a workspace history when reloaded content no longer matches its present state", () => {
    const original = createPreviewWorkspace();
    const edited = addNote(original, "edited", 100);
    const history = recordCanvasHistory(
      createCanvasHistoryState(original),
      original,
      edited,
      { label: "新建研究笔记" },
      100,
    );

    const reloadedEquivalent = {
      ...edited,
      nodes: edited.nodes.map((node) => ({ ...node })),
      edges: edited.edges.map((edge) => ({ ...edge })),
    };
    const preserved = reconcileCanvasHistory(history, reloadedEquivalent);
    expect(preserved.past).toHaveLength(1);
    expect(undoCanvasHistory(preserved, reloadedEquivalent, 150)?.document.nodes).toEqual(
      original.nodes,
    );

    const externalVersion = addNote(original, "external", 200);
    const reconciled = reconcileCanvasHistory(history, externalVersion);
    expect(reconciled.past).toEqual([]);
    expect(reconciled.future).toEqual([]);
    expect(reconciled.workspaceId).toBe(externalVersion.workspaceId);
  });

  it("preserves history when persistence reloads equivalent objects with a different key order", () => {
    const original = createPreviewWorkspace();
    const edited = addNote(original, "reordered-note", 100);
    const history = sealCanvasHistory(
      recordCanvasHistory(
        createCanvasHistoryState(original),
        original,
        edited,
        { label: "新建研究笔记" },
        100,
      ),
    );
    const reloadedEquivalent: CanvasWorkspaceDocument = {
      ...edited,
      nodes: edited.nodes.map(
        (node) =>
          reverseObjectKeyOrder({
            ...node,
            position: reverseObjectKeyOrder(node.position),
            dimensions: reverseObjectKeyOrder(node.dimensions),
            data: reverseObjectKeyOrder(node.data),
          }) as typeof node,
      ),
      edges: edited.edges.map(
        (edge) =>
          reverseObjectKeyOrder({
            ...edge,
            ...(edge.style ? { style: reverseObjectKeyOrder(edge.style) } : {}),
          }) as typeof edge,
      ),
    };

    const reconciled = reconcileCanvasHistory(history, reloadedEquivalent);
    expect(reconciled.past).toHaveLength(1);
    expect(
      undoCanvasHistory(reconciled, reloadedEquivalent, 150)?.document.nodes.some(
        (node) => node.id === "reordered-note",
      ),
    ).toBe(false);
  });

  it("keeps group view state out of history and preserves the current collapsed state on undo", () => {
    const original = createPreviewWorkspace();
    const edited = addNote(original, "content-note", 100);
    const history = recordCanvasHistory(
      createCanvasHistoryState(original),
      original,
      edited,
      { label: "新建研究笔记" },
      100,
    );
    const group = edited.nodes.find((node) => node.type === "group");
    if (!group || group.type !== "group") throw new Error("Expected a preview group");
    const viewUpdatedAt = group.updatedAt + 1_000;
    const viewOnlyDocument: CanvasWorkspaceDocument = {
      ...edited,
      nodes: edited.nodes.map((node) =>
        node.id === group.id && node.type === "group"
          ? {
              ...node,
              data: { ...node.data, collapsed: true },
              updatedAt: viewUpdatedAt,
            }
          : node,
      ),
      updatedAt: viewUpdatedAt,
    };

    const reconciled = reconcileCanvasHistory(history, viewOnlyDocument);
    expect(reconciled.past).toHaveLength(1);
    expect(reconciled.future).toEqual([]);

    const undone = undoCanvasHistory(reconciled, viewOnlyDocument, viewUpdatedAt + 1);
    expect(undone?.document.nodes.some((node) => node.id === "content-note")).toBe(false);
    const undoneGroup = undone?.document.nodes.find((node) => node.id === group.id);
    expect(undoneGroup?.type).toBe("group");
    if (undoneGroup?.type !== "group") throw new Error("Expected the group after undo");
    expect(undoneGroup.data.collapsed).toBe(true);
    expect(undoneGroup.updatedAt).toBe(viewUpdatedAt);
  });

  it("never applies one workspace history to another workspace", () => {
    const original = createPreviewWorkspace();
    const edited = addNote(original, "edited", 100);
    const history = recordCanvasHistory(
      createCanvasHistoryState(original),
      original,
      edited,
      { label: "新建研究笔记" },
      100,
    );
    const otherWorkspace = {
      ...edited,
      workspaceId: "canvas:other-workspace",
    };

    expect(undoCanvasHistory(history, otherWorkspace, 200)).toBeNull();
    expect(reconcileCanvasHistory(history, otherWorkspace).past).toEqual([]);
  });
});
