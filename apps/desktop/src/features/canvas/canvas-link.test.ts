import {
  CANVAS_SCHEMA_VERSION,
  type CanvasNode,
  type CanvasWorkspaceDocument,
} from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import {
  applyCanvasLink,
  applyCanvasLinkedNote,
  hasReciprocalCanvasLink,
  prepareCanvasLink,
  prepareCanvasLinkedNote,
  resolveCanvasLinkHandles,
} from "./canvas-link";
import {
  createCanvasHistoryState,
  recordCanvasHistory,
  redoCanvasHistory,
  undoCanvasHistory,
} from "./canvas-history";
import { canvasEdgeFreeText, createEdge } from "./model";

function node(id: string, x: number, y: number, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: "idea-note",
    position: { x, y },
    dimensions: { width: 200, height: 100 },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    data: {
      title: id,
      contentMarkdown: "",
      hasEquations: false,
    },
    ...overrides,
  } as CanvasNode;
}

function workspace(overrides: Partial<CanvasWorkspaceDocument> = {}): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "workspace-a",
    name: "Canvas links",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [node("source", 0, 0), node("target", 400, 200)],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("plain canvas links", () => {
  it("hides legacy type labels while preserving authored edge text", () => {
    const legacy = { ...createEdge("source", "target", "supports"), label: "支持" };
    expect(canvasEdgeFreeText(legacy)).toBeUndefined();
    expect(canvasEdgeFreeText({ ...legacy, label: "补充实验结果" })).toBe("补充实验结果");
    expect(canvasEdgeFreeText({ ...createEdge("source", "target"), label: "支持" })).toBe("支持");
    expect(canvasEdgeFreeText({ ...createEdge("source", "target"), label: "关联" })).toBe("关联");
  });

  it("creates one untyped, unlabeled edge without mutating the input document", () => {
    const document = workspace();
    const plan = prepareCanvasLink(document, "source", "target");
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;

    const result = applyCanvasLink(document, plan.prepared);

    expect(result.status).toBe("created");
    expect(document.edges).toEqual([]);
    if (result.status !== "created") return;
    expect(result.document.edges).toHaveLength(1);
    expect(result.edge).toMatchObject({
      sourceId: "source",
      targetId: "target",
      relationType: "custom",
    });
    expect(result.edge.label).toBeUndefined();
  });

  it("rejects self links, missing nodes, duplicate directions and stale workspaces", () => {
    const document = workspace();
    expect(prepareCanvasLink(document, "source", "source")).toEqual({ status: "self-link" });
    expect(prepareCanvasLink(document, "source", "missing")).toEqual({
      status: "missing-node",
    });

    const plan = prepareCanvasLink(document, "source", "target");
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    const created = applyCanvasLink(document, plan.prepared);
    expect(created.status).toBe("created");
    if (created.status !== "created") return;
    expect(prepareCanvasLink(created.document, "source", "target")).toEqual({
      status: "duplicate",
    });
    expect(prepareCanvasLink(created.document, "target", "source").status).toBe("ready");
    expect(applyCanvasLink(workspace({ workspaceId: "workspace-b" }), plan.prepared).status).toBe(
      "workspace-mismatch",
    );
  });

  it("keeps document timestamps monotonic when a prepared link is applied later", () => {
    const original = workspace();
    const plan = prepareCanvasLink(original, "source", "target");
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    const newer = workspace({ updatedAt: plan.prepared.edge.updatedAt + 100 });

    const result = applyCanvasLink(newer, plan.prepared);

    expect(result.status).toBe("created");
    expect(result.document.updatedAt).toBe(newer.updatedAt);
  });

  it("atomically creates a blank idea note and its edge at the drop position", () => {
    const document = workspace();
    const plan = prepareCanvasLinkedNote(document, "source", { x: 640, y: 360 });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;

    const result = applyCanvasLinkedNote(document, plan.prepared);

    expect(result.status).toBe("created");
    expect(document.nodes).toHaveLength(2);
    expect(document.edges).toEqual([]);
    if (result.status !== "created") return;
    expect(result.node).toMatchObject({
      type: "idea-note",
      position: { x: 494, y: 262 },
      data: { title: "", contentMarkdown: "", hasEquations: false },
    });
    expect(result.edge).toMatchObject({
      sourceId: "source",
      targetId: result.node.id,
      relationType: "custom",
    });
    expect(result.edge.createdAt).toBe(result.node.createdAt);
    expect(result.edge.updatedAt).toBe(result.node.updatedAt);
    expect(result.edge.label).toBeUndefined();
    expect(result.document.nodes).toHaveLength(3);
    expect(result.document.edges).toHaveLength(1);
  });

  it("keeps document timestamps monotonic for a prepared linked note", () => {
    const original = workspace();
    const plan = prepareCanvasLinkedNote(original, "source", { x: 640, y: 360 });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    const newer = workspace({ updatedAt: plan.prepared.node.updatedAt + 100 });

    const result = applyCanvasLinkedNote(newer, plan.prepared);

    expect(result.status).toBe("created");
    expect(result.document.updatedAt).toBe(newer.updatedAt);
  });

  it("undoes and redoes a linked note and its edge as one history entry", () => {
    const original = workspace();
    const plan = prepareCanvasLinkedNote(original, "source", { x: 640, y: 360 });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    const applied = applyCanvasLinkedNote(original, plan.prepared);
    expect(applied.status).toBe("created");
    if (applied.status !== "created") return;

    const history = recordCanvasHistory(
      createCanvasHistoryState(original),
      original,
      applied.document,
      { label: "连线并新建笔记" },
      applied.document.updatedAt,
    );

    expect(history.past).toHaveLength(1);
    const undone = undoCanvasHistory(history, applied.document, applied.document.updatedAt + 1);
    expect(undone?.document.nodes).toEqual(original.nodes);
    expect(undone?.document.edges).toEqual(original.edges);
    const redone = undone
      ? redoCanvasHistory(undone.history, undone.document, applied.document.updatedAt + 2)
      : null;
    expect(redone?.document.nodes.some((node) => node.id === plan.prepared.node.id)).toBe(true);
    expect(redone?.document.edges.some((edge) => edge.id === plan.prepared.edge.id)).toBe(true);
  });

  it("rejects a non-finite blank-canvas drop before preparing any content", () => {
    expect(prepareCanvasLinkedNote(workspace(), "source", { x: Number.NaN, y: 200 })).toEqual({
      status: "invalid-position",
    });
  });

  it("never partially applies a stale or colliding linked-note operation", () => {
    const document = workspace();
    const plan = prepareCanvasLinkedNote(document, "source", { x: 300, y: 200 });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;

    const stale = workspace({ workspaceId: "workspace-b" });
    expect(applyCanvasLinkedNote(stale, plan.prepared)).toEqual({
      status: "workspace-mismatch",
      document: stale,
    });

    const withNodeCollision = workspace({ nodes: [...document.nodes, plan.prepared.node] });
    const collision = applyCanvasLinkedNote(withNodeCollision, plan.prepared);
    expect(collision.status).toBe("id-collision");
    expect(collision.document.edges).toEqual([]);
    expect(collision.document.nodes).toHaveLength(3);
  });

  it("routes persisted links through the nearest horizontal or vertical magnets", () => {
    expect(resolveCanvasLinkHandles(workspace().nodes, "source", "target")).toEqual({
      sourceHandle: "link-right",
      targetHandle: "link-left",
    });
    const verticalNodes = [node("source", 200, 500), node("target", 220, 0)];
    expect(resolveCanvasLinkHandles(verticalNodes, "source", "target")).toEqual({
      sourceHandle: "link-top",
      targetHandle: "link-bottom",
    });

    const collapsedGroupNodes = [
      node("group", 0, 0, {
        type: "group",
        dimensions: { width: 700, height: 500 },
        data: { title: "Collapsed", colorTheme: "accent", collapsed: true },
      }),
      node("target", 100, 300),
    ];
    expect(resolveCanvasLinkHandles(collapsedGroupNodes, "group", "target")).toEqual({
      sourceHandle: "link-bottom",
      targetHandle: "link-top",
    });
  });

  it("detects reciprocal directions so their rendered paths can be separated", () => {
    const forward = createEdge("source", "target");
    const reverse = createEdge("target", "source");

    expect(hasReciprocalCanvasLink([forward], forward)).toBe(false);
    expect(hasReciprocalCanvasLink([forward, reverse], forward)).toBe(true);
    expect(hasReciprocalCanvasLink([forward, reverse], reverse)).toBe(true);
  });
});
