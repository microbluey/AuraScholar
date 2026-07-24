import {
  CANVAS_SCHEMA_VERSION,
  type CanvasNode,
  type CanvasWorkspaceDocument,
} from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import { buildCanvasLinkTargetOptions } from "./canvas-link-target";

function note(id: string, x: number, y: number, overrides: Partial<CanvasNode> = {}): CanvasNode {
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
    name: "Link targets",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [note("source", 0, 0), note("near", 250, 0), note("far", 900, 0)],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("canvas link target search", () => {
  it("excludes the source and ranks empty-query results by distance from the drop point", () => {
    const options = buildCanvasLinkTargetOptions(workspace(), "source", "", { x: 300, y: 40 });

    expect(options.map((option) => option.nodeId)).toEqual(["near", "far"]);
    expect(options.some((option) => option.nodeId === "source")).toBe(false);
    expect(options[0]?.distance).toBeLessThan(options[1]?.distance ?? 0);
  });

  it("uses absolute child coordinates and marks hidden targets that require group expansion", () => {
    const group = note("group", 500, 300, {
      type: "group",
      dimensions: { width: 600, height: 400 },
      data: { title: "方法论", colorTheme: "accent", collapsed: true },
    });
    const child = note("child", 30, 40, { groupId: group.id });
    const document = workspace({ nodes: [note("source", 0, 0), group, child] });

    expect(
      buildCanvasLinkTargetOptions(document, "source", "", { x: 630, y: 390 })[0],
    ).toMatchObject({
      nodeId: "child",
      groupLabel: "方法论",
      parentGroupId: "group",
      requiresExpand: true,
    });
  });

  it("matches every query token across title, metadata, tags, group and type", () => {
    const group = note("group", 300, 200, {
      type: "group",
      dimensions: { width: 500, height: 300 },
      data: { title: "因果推断", colorTheme: "accent", collapsed: false },
    });
    const paper = note("paper", 20, 40, {
      type: "paper",
      groupId: group.id,
      tags: ["核心", "方法"],
      data: {
        workId: "work-1",
        title: "Causal Representation Learning",
        authors: ["J. Pearl"],
        year: 2022,
        venue: "JMLR",
        annotationCount: 0,
      },
    });
    const document = workspace({ nodes: [note("source", 0, 0), group, paper] });

    expect(
      buildCanvasLinkTargetOptions(document, "source", "causal 2022 核心 因果 paper", {
        x: 0,
        y: 0,
      }).map((option) => option.nodeId),
    ).toEqual(["paper"]);
  });

  it("marks existing directed links, ranks them after available targets and allows reverse links", () => {
    const document = workspace({
      edges: [
        {
          id: "edge-existing",
          sourceId: "source",
          targetId: "near",
          relationType: "supports",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "edge-reverse",
          sourceId: "far",
          targetId: "source",
          relationType: "cites",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const options = buildCanvasLinkTargetOptions(document, "source", "", { x: 300, y: 40 });
    expect(options.map((option) => option.nodeId)).toEqual(["far", "near"]);
    expect(options.find((option) => option.nodeId === "near")?.existingEdgeId).toBe(
      "edge-existing",
    );
    expect(options.find((option) => option.nodeId === "far")?.existingEdgeId).toBeUndefined();
  });

  it("clamps the result limit to a non-negative integer", () => {
    const document = workspace();
    expect(buildCanvasLinkTargetOptions(document, "source", "", { x: 0, y: 0 }, -1)).toEqual([]);
    expect(buildCanvasLinkTargetOptions(document, "source", "", { x: 0, y: 0 }, 1.8)).toHaveLength(
      1,
    );
  });
});
