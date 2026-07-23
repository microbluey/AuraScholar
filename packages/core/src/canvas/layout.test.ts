import {
  CANVAS_SCHEMA_VERSION,
  type CanvasEdge,
  type CanvasNode,
  type CanvasWorkspaceDocument,
  type GroupNode,
  type IdeaNoteNode,
  type PaperNode,
} from "./types.js";
import { describe, expect, it } from "vitest";
import {
  applyCanvasLayout,
  CANVAS_GROUP_LAYOUT_PADDING,
  CANVAS_TIMELINE_HORIZONTAL_GAP,
  planCanvasLayout,
} from "./layout.js";

function paper(
  id: string,
  year: number | null,
  x: number,
  y: number,
  overrides: Partial<PaperNode> = {},
): PaperNode {
  return {
    id,
    type: "paper",
    position: { x, y },
    dimensions: { width: 200, height: 120 },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    data: {
      workId: `work-${id}`,
      title: id,
      authors: [],
      year,
      annotationCount: 0,
    },
    ...overrides,
  };
}

function group(id: string, collapsed = false, overrides: Partial<GroupNode> = {}): GroupNode {
  return {
    id,
    type: "group",
    position: { x: 100, y: 80 },
    dimensions: { width: 400, height: 300 },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    data: { title: id, collapsed },
    ...overrides,
  };
}

function note(id: string): IdeaNoteNode {
  return {
    id,
    type: "idea-note",
    position: { x: 0, y: 0 },
    dimensions: { width: 180, height: 100 },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    data: { title: id, contentMarkdown: "", hasEquations: false },
  };
}

function edge(
  id: string,
  sourceId: string,
  targetId: string,
  relationType: CanvasEdge["relationType"] = "cites",
): CanvasEdge {
  return {
    id,
    sourceId,
    targetId,
    relationType,
    createdAt: 1,
    updatedAt: 1,
  };
}

function workspace(nodes: CanvasNode[], edges: CanvasEdge[] = []): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "workspace-layout",
    name: "Layout",
    viewport: { x: -20, y: 30, zoom: 0.8 },
    nodes,
    edges,
    createdAt: 1,
    updatedAt: 1,
  };
}

function positions(
  plan: ReturnType<typeof planCanvasLayout>,
): Map<string, { x: number; y: number }> {
  expect(plan.status).toBe("success");
  if (plan.status !== "success") return new Map();
  return new Map(plan.nodePositions.map((update) => [update.nodeId, update.position]));
}

describe("canvas automatic layout", () => {
  it("orders a timeline by year with unknown years last and preserves the selection anchor", () => {
    const oldest = paper("oldest", 2020, 500, 300, {
      dimensions: { width: 250, height: 120 },
    });
    const newest = paper("newest", 2024, 100, 200, {
      dimensions: { width: 300, height: 120 },
    });
    const unknown = paper("aaa-unknown", null, 0, 100);
    const document = workspace([newest, unknown, oldest]);

    const plan = planCanvasLayout(
      document,
      new Set(["newest", "aaa-unknown", "oldest"]),
      "timeline",
    );
    const result = positions(plan);
    expect(result.get("oldest")).toEqual({ x: 0, y: 100 });
    expect(result.get("newest")).toEqual({
      x: 250 + CANVAS_TIMELINE_HORIZONTAL_GAP,
      y: 100,
    });
    expect(result.get("aaa-unknown")).toEqual({
      x: 250 + CANVAS_TIMELINE_HORIZONTAL_GAP + 300 + CANVAS_TIMELINE_HORIZONTAL_GAP,
      y: 100,
    });

    if (plan.status !== "success") return;
    const applied = applyCanvasLayout(document, plan, 500);
    expect(document.nodes.find((node) => node.id === "oldest")?.position).toEqual({
      x: 500,
      y: 300,
    });
    expect(applied.updatedAt).toBe(500);
    expect(applied.edges).toBe(document.edges);
    expect(applied.viewport).toBe(document.viewport);
  });

  it("puts cited papers left of citing papers across a multi-hop citation tree", () => {
    const a = paper("a", 2024, 600, 100);
    const b = paper("b", 2022, 350, 200);
    const c = paper("c", 2020, 100, 300);
    const d = paper("d", 2023, 700, 400);
    const document = workspace(
      [a, b, c, d],
      [
        edge("a-cites-b", "a", "b"),
        edge("b-cites-c", "b", "c"),
        edge("d-cites-b", "d", "b"),
        edge("ignored-support", "c", "a", "supports"),
      ],
    );

    const result = positions(
      planCanvasLayout(document, new Set(["a", "b", "c", "d"]), "citation-tree"),
    );
    expect(result.get("c")!.x).toBeLessThan(result.get("b")!.x);
    expect(result.get("b")!.x).toBeLessThan(result.get("a")!.x);
    expect(result.get("b")!.x).toBeLessThan(result.get("d")!.x);
    expect(result.get("a")!.x).toBe(result.get("d")!.x);
    expect(result.get("a")!.y).not.toBe(result.get("d")!.y);
  });

  it("condenses citation cycles into one stable column without overlapping cards", () => {
    const a = paper("a", 2024, 700, 300);
    const b = paper("b", 2023, 600, 100);
    const c = paper("c", 2020, 100, 200);
    const document = workspace(
      [a, b, c],
      [edge("a-cites-b", "a", "b"), edge("b-cites-a", "b", "a"), edge("b-cites-c", "b", "c")],
    );

    const result = positions(planCanvasLayout(document, new Set(["a", "b", "c"]), "citation-tree"));
    expect(result.get("c")!.x).toBeLessThan(result.get("a")!.x);
    expect(result.get("a")!.x).toBe(result.get("b")!.x);
    expect(Math.abs(result.get("a")!.y - result.get("b")!.y)).toBeGreaterThanOrEqual(
      a.dimensions.height,
    );
  });

  it("keeps grouped papers relative to their parent and expands the group only as needed", () => {
    const parent = group("group");
    const first = paper("first", 2020, 40, 60, { groupId: parent.id });
    const second = paper("second", 2024, 100, 100, { groupId: parent.id });
    const untouched = note("untouched");
    untouched.groupId = parent.id;
    untouched.position = { x: 20, y: 220 };
    const document = workspace(
      [parent, first, second, untouched],
      [edge("preserved", "first", "second")],
    );
    const originalEdges = document.edges;
    const originalViewport = document.viewport;

    const plan = planCanvasLayout(document, new Set(["first", "second"]), "timeline");
    expect(plan.status).toBe("success");
    if (plan.status !== "success") return;
    expect(plan.parentGroupId).toBe(parent.id);
    expect(plan.groupResize?.dimensions.width).toBe(
      40 +
        first.dimensions.width +
        CANVAS_TIMELINE_HORIZONTAL_GAP +
        second.dimensions.width +
        CANVAS_GROUP_LAYOUT_PADDING,
    );

    const applied = applyCanvasLayout(document, plan, 700);
    expect(applied.nodes.find((node) => node.id === "first")?.groupId).toBe(parent.id);
    expect(applied.nodes.find((node) => node.id === "second")?.groupId).toBe(parent.id);
    expect(applied.nodes.find((node) => node.id === "untouched")).toBe(untouched);
    expect(applied.nodes.find((node) => node.id === parent.id)?.dimensions.width).toBe(
      plan.groupResize?.dimensions.width,
    );
    expect(applied.edges).toBe(originalEdges);
    expect(applied.viewport).toBe(originalViewport);
  });

  it("returns explicit errors for unsafe or meaningless selections", () => {
    const expandedGroup = group("expanded");
    const collapsedGroup = group("collapsed", true);
    const rootPaper = paper("root", 2020, 0, 0);
    const groupedPaper = paper("grouped", 2021, 20, 30, { groupId: expandedGroup.id });
    const collapsedPaper = paper("hidden", 2022, 20, 30, { groupId: collapsedGroup.id });
    const document = workspace([
      expandedGroup,
      collapsedGroup,
      rootPaper,
      groupedPaper,
      collapsedPaper,
      note("note"),
    ]);

    expect(planCanvasLayout(document, new Set(["root"]), "timeline")).toMatchObject({
      status: "error",
      reason: "selection-too-small",
    });
    expect(planCanvasLayout(document, new Set(["root", "missing"]), "timeline")).toMatchObject({
      status: "error",
      reason: "missing-node",
    });
    expect(planCanvasLayout(document, new Set(["root", "note"]), "timeline")).toMatchObject({
      status: "error",
      reason: "mixed-node-types",
    });
    expect(planCanvasLayout(document, new Set(["root", "grouped"]), "timeline")).toMatchObject({
      status: "error",
      reason: "mixed-parent",
    });
    expect(
      planCanvasLayout(
        document,
        new Set(["hidden", paper("other", 2023, 0, 0, { groupId: collapsedGroup.id }).id]),
        "timeline",
      ),
    ).toMatchObject({ status: "error", reason: "missing-node" });

    const collapsedDocument = workspace([
      collapsedGroup,
      collapsedPaper,
      paper("other-hidden", 2023, 0, 0, { groupId: collapsedGroup.id }),
    ]);
    expect(
      planCanvasLayout(collapsedDocument, new Set(["hidden", "other-hidden"]), "timeline"),
    ).toMatchObject({ status: "error", reason: "collapsed-parent-group" });
    const orphanedDocument = workspace([
      paper("orphan-a", 2020, 0, 0, { groupId: "missing-group" }),
      paper("orphan-b", 2021, 20, 20, { groupId: "missing-group" }),
    ]);
    expect(
      planCanvasLayout(orphanedDocument, new Set(["orphan-a", "orphan-b"]), "timeline"),
    ).toMatchObject({ status: "error", reason: "missing-parent-group" });
    expect(
      planCanvasLayout(
        workspace([rootPaper, paper("other", 2021, 20, 20)]),
        new Set(["root", "other"]),
        "citation-tree",
      ),
    ).toMatchObject({ status: "error", reason: "no-citation-edges" });
  });

  it("rejects stale plans from another workspace without changing the document", () => {
    const source = workspace([paper("a", 2020, 400, 0), paper("b", 2021, 0, 0)]);
    const plan = planCanvasLayout(source, new Set(["a", "b"]), "timeline");
    expect(plan.status).toBe("success");
    if (plan.status !== "success") return;
    const target = { ...source, workspaceId: "workspace-other" };

    expect(applyCanvasLayout(target, plan, 900)).toBe(target);
  });
});
