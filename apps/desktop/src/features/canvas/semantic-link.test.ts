import {
  CANVAS_SCHEMA_VERSION,
  type CanvasNode,
  type CanvasWorkspaceDocument,
} from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import {
  applySemanticLink,
  planSemanticLink,
  QUICK_SEMANTIC_RELATIONS,
  resolveSemanticLinkHandles,
  resolveSemanticLinkShortcut,
} from "./semantic-link";

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
    name: "Semantic links",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [node("source", 0, 0), node("target", 400, 200)],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("semantic canvas links", () => {
  it("keeps the four quick relations and numeric shortcuts in a stable order", () => {
    expect(QUICK_SEMANTIC_RELATIONS).toEqual([
      { shortcut: "1", relationType: "cites", englishLabel: "Cites", label: "引用" },
      { shortcut: "2", relationType: "supports", englishLabel: "Supports", label: "支持" },
      {
        shortcut: "3",
        relationType: "contradicts",
        englishLabel: "Contradicts",
        label: "反驳",
      },
      { shortcut: "4", relationType: "extends", englishLabel: "Extends", label: "扩展" },
    ]);
  });

  it("plans the pill menu between absolute endpoint centers", () => {
    const document = workspace({
      nodes: [
        node("group", 100, 80, {
          type: "group",
          dimensions: { width: 500, height: 300 },
          data: { title: "Group", colorTheme: "accent", collapsed: false },
        }),
        node("source", 20, 30, { groupId: "group" }),
        node("target", 700, 280),
      ],
    });

    expect(planSemanticLink(document, "source", "target")).toEqual({
      status: "ready",
      pending: {
        workspaceId: "workspace-a",
        sourceId: "source",
        targetId: "target",
        position: { x: 510, y: 245 },
      },
    });
  });

  it("routes persisted links through the nearest horizontal or vertical magnets", () => {
    expect(resolveSemanticLinkHandles(workspace().nodes, "source", "target")).toEqual({
      sourceHandle: "link-right",
      targetHandle: "link-left",
    });
    const verticalNodes = [node("source", 200, 500), node("target", 220, 0)];
    expect(resolveSemanticLinkHandles(verticalNodes, "source", "target")).toEqual({
      sourceHandle: "link-top",
      targetHandle: "link-bottom",
    });
    expect(resolveSemanticLinkHandles(verticalNodes, "missing", "target")).toEqual({
      sourceHandle: "link-right",
      targetHandle: "link-left",
    });

    const collapsedGroupNodes = [
      node("group", 0, 0, {
        type: "group",
        dimensions: { width: 700, height: 500 },
        data: { title: "Collapsed", colorTheme: "accent", collapsed: true },
      }),
      node("target", 100, 300),
    ];
    expect(resolveSemanticLinkHandles(collapsedGroupNodes, "group", "target")).toEqual({
      sourceHandle: "link-bottom",
      targetHandle: "link-top",
    });
  });

  it("creates one canonical semantic edge without mutating the input document", () => {
    const document = workspace();
    const plan = planSemanticLink(document, "source", "target");
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;

    const result = applySemanticLink(document, plan.pending, "supports");

    expect(result.status).toBe("created");
    expect(document.edges).toEqual([]);
    if (result.status !== "created") return;
    expect(result.document.edges).toHaveLength(1);
    expect(result.edge).toMatchObject({
      sourceId: "source",
      targetId: "target",
      relationType: "supports",
      label: "支持",
    });
  });

  it("rejects self links, missing nodes, and duplicate directed edges", () => {
    const document = workspace();
    expect(planSemanticLink(document, "source", "source")).toEqual({ status: "self-link" });
    expect(planSemanticLink(document, "source", "missing")).toEqual({ status: "missing-node" });

    const plan = planSemanticLink(document, "source", "target");
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    const created = applySemanticLink(document, plan.pending, "cites");
    expect(created.status).toBe("created");
    if (created.status !== "created") return;
    expect(planSemanticLink(created.document, "source", "target")).toEqual({
      status: "duplicate",
    });
    expect(planSemanticLink(created.document, "target", "source").status).toBe("ready");
  });

  it("does not commit a pending relation after the active workspace changes", () => {
    const document = workspace();
    const plan = planSemanticLink(document, "source", "target");
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    const nextWorkspace = workspace({ workspaceId: "workspace-b" });

    expect(applySemanticLink(nextWorkspace, plan.pending, "extends")).toEqual({
      status: "workspace-mismatch",
      document: nextWorkspace,
    });
  });

  it("maps only unmodified non-composing number keys to quick relations", () => {
    expect(resolveSemanticLinkShortcut({ key: "1" })).toBe("cites");
    expect(resolveSemanticLinkShortcut({ key: "4" })).toBe("extends");
    expect(resolveSemanticLinkShortcut({ key: "5" })).toBeNull();
    expect(resolveSemanticLinkShortcut({ key: "2", isComposing: true })).toBeNull();
    expect(resolveSemanticLinkShortcut({ key: "2", metaKey: true })).toBeNull();
    expect(resolveSemanticLinkShortcut({ key: "2", targetIsEditable: true })).toBeNull();
    expect(resolveSemanticLinkShortcut({ key: "2", repeat: true })).toBeNull();
  });
});
