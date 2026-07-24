import {
  CANVAS_SCHEMA_VERSION,
  type AISynthNode,
  type CanvasEdge,
  type CanvasNode,
  type CanvasWorkspaceDocument,
  type ExcerptNode,
  type PaperNode,
} from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import {
  applyCompletedCanvasSynthesis,
  canvasSynthesisSourceFingerprint,
  type CanvasSynthesisSourceSnapshot,
  type CompletedCanvasSynthesis,
} from "./synthesis";

function paperNode(id = "paper-1"): PaperNode {
  return {
    id,
    type: "paper",
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 278 },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    data: {
      workId: `work-${id}`,
      title: "Paper",
      authors: ["A. Author"],
      year: 2025,
      annotationCount: 0,
    },
  };
}

function excerptNode(id = "excerpt-1"): ExcerptNode {
  return {
    id,
    type: "excerpt",
    position: { x: 400, y: 0 },
    dimensions: { width: 300, height: 220 },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    data: {
      workId: "work-paper-1",
      paperTitle: "Paper",
      highlightText: "Evidence",
      highlightColor: "yellow",
      pageIndex: 0,
    },
  };
}

function completedNode(overrides: Partial<AISynthNode> = {}): AISynthNode {
  return {
    id: "synth-1",
    type: "ai-synth",
    position: { x: 200, y: 400 },
    dimensions: { width: 320, height: 232 },
    tags: [],
    createdAt: 10,
    updatedAt: 11,
    data: {
      sourceNodeIds: ["untrusted-service-source"],
      synthType: "methodology_matrix",
      title: "Methodology synthesis",
      contentMarkdown: "Synthesis",
    },
    ...overrides,
  };
}

function existingEdge(overrides: Partial<CanvasEdge> = {}): CanvasEdge {
  return {
    id: "edge-existing",
    sourceId: "paper-1",
    targetId: "excerpt-1",
    relationType: "derived-from",
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  };
}

function workspace(overrides: Partial<CanvasWorkspaceDocument> = {}): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "workspace-1",
    name: "Research",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [paperNode(), excerptNode()],
    edges: [existingEdge()],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function sourceSnapshot(node: PaperNode | ExcerptNode): CanvasSynthesisSourceSnapshot {
  return {
    id: node.id,
    type: node.type,
    inputFingerprint: canvasSynthesisSourceFingerprint(node),
  };
}

function completion(overrides: Partial<CompletedCanvasSynthesis> = {}): CompletedCanvasSynthesis {
  const paper = paperNode();
  const excerpt = excerptNode();
  return {
    requestId: "request-1",
    activeRequestId: "request-1",
    workspaceId: "workspace-1",
    sourceSnapshot: [sourceSnapshot(paper), sourceSnapshot(excerpt)],
    completedNode: completedNode(),
    provenanceEdgeIds: ["edge-provenance-1", "edge-provenance-2"],
    ...overrides,
  };
}

function expectUnchanged(
  document: CanvasWorkspaceDocument,
  request: CompletedCanvasSynthesis,
  status: Exclude<ReturnType<typeof applyCompletedCanvasSynthesis>["status"], "applied">,
): void {
  const result = applyCompletedCanvasSynthesis(document, request);
  expect(result).toEqual({ document, status });
  expect(result.document).toBe(document);
}

describe("applyCompletedCanvasSynthesis", () => {
  it("fingerprints the canonical prompt input rather than equivalent source whitespace", () => {
    const original = paperNode();
    original.data = { ...original.data, abstractSnippet: "  Evidence\nwith   spacing  " };
    const equivalent = paperNode();
    equivalent.data = { ...equivalent.data, abstractSnippet: "Evidence with spacing" };

    expect(canvasSynthesisSourceFingerprint(equivalent)).toBe(
      canvasSynthesisSourceFingerprint(original),
    );
  });

  it("atomically appends the completed node and provenance edges from the request snapshot", () => {
    const document = workspace();
    const result = applyCompletedCanvasSynthesis(document, completion());

    expect(result.status).toBe("applied");
    expect(result.document).not.toBe(document);
    expect(document.nodes).toHaveLength(2);
    expect(document.edges).toHaveLength(1);
    expect(result.document.nodes).toHaveLength(3);
    expect(result.document.edges).toHaveLength(3);
    expect(result.document.updatedAt).toBe(11);

    const appendedNode = result.document.nodes.at(-1);
    expect(appendedNode?.type).toBe("ai-synth");
    if (appendedNode?.type !== "ai-synth") throw new Error("Expected an AI synthesis node");
    expect(appendedNode.data.sourceNodeIds).toEqual(["paper-1", "excerpt-1"]);
    expect(appendedNode.data.sourceNodeIds).not.toContain("untrusted-service-source");
    expect(result.document.edges.slice(-2)).toEqual([
      {
        id: "edge-provenance-1",
        sourceId: "paper-1",
        targetId: "synth-1",
        relationType: "derived-from",
        label: "合成来源",
        createdAt: 11,
        updatedAt: 11,
      },
      {
        id: "edge-provenance-2",
        sourceId: "excerpt-1",
        targetId: "synth-1",
        relationType: "derived-from",
        label: "合成来源",
        createdAt: 11,
        updatedAt: 11,
      },
    ]);
  });

  it("rejects a superseded or cleared active request", () => {
    const document = workspace();
    expectUnchanged(document, completion({ activeRequestId: "request-2" }), "stale-request");
    expectUnchanged(document, completion({ activeRequestId: null }), "stale-request");
    expectUnchanged(document, completion({ requestId: "", activeRequestId: "" }), "stale-request");
  });

  it("rejects a completion captured for another workspace", () => {
    const document = workspace();
    expectUnchanged(document, completion({ workspaceId: "workspace-2" }), "workspace-mismatch");
  });

  it("rejects duplicate, malformed, or edge-count-mismatched source snapshots", () => {
    const document = workspace();
    expectUnchanged(
      document,
      completion({
        sourceSnapshot: [sourceSnapshot(paperNode())],
        provenanceEdgeIds: ["edge-provenance-1"],
      }),
      "invalid-source-snapshot",
    );
    expectUnchanged(
      document,
      completion({
        sourceSnapshot: [sourceSnapshot(paperNode()), sourceSnapshot(paperNode())],
      }),
      "invalid-source-snapshot",
    );
    expectUnchanged(
      document,
      completion({ provenanceEdgeIds: ["edge-provenance-1"] }),
      "invalid-source-snapshot",
    );
    expectUnchanged(
      document,
      completion({
        sourceSnapshot: [
          {
            ...sourceSnapshot(paperNode()),
            type: "idea-note",
          },
        ] as unknown as CompletedCanvasSynthesis["sourceSnapshot"],
        provenanceEdgeIds: ["edge-provenance-1"],
      }),
      "invalid-source-snapshot",
    );
    expectUnchanged(
      document,
      completion({
        sourceSnapshot: [
          { ...sourceSnapshot(paperNode()), inputFingerprint: "" },
          sourceSnapshot(excerptNode()),
        ],
      }),
      "invalid-source-snapshot",
    );
  });

  it("rejects atomically when any captured source was removed or changed type", () => {
    const removed = workspace({ nodes: [paperNode()] });
    expectUnchanged(removed, completion(), "source-changed");

    const changedType: CanvasNode = {
      id: "paper-1",
      type: "idea-note",
      position: { x: 0, y: 0 },
      dimensions: { width: 292, height: 196 },
      tags: [],
      createdAt: 1,
      updatedAt: 3,
      data: { contentMarkdown: "Replacement", hasEquations: false },
    };
    const changed = workspace({ nodes: [changedType, excerptNode()] });
    expectUnchanged(changed, completion(), "source-changed");
  });

  it("rejects atomically when AI-visible source content changed during synthesis", () => {
    const editedPaper = paperNode();
    editedPaper.data = { ...editedPaper.data, title: "Edited while AI was working" };
    const changed = workspace({ nodes: [editedPaper, excerptNode()] });

    expectUnchanged(changed, completion(), "source-changed");
  });

  it("accepts a completion after layout-only source changes", () => {
    const movedPaper = {
      ...paperNode(),
      position: { x: 900, y: 500 },
      updatedAt: 99,
    };
    const movedExcerpt = {
      ...excerptNode(),
      position: { x: 1200, y: 500 },
      updatedAt: 100,
    };
    const moved = workspace({ nodes: [movedPaper, movedExcerpt], updatedAt: 100 });

    const result = applyCompletedCanvasSynthesis(moved, completion());
    expect(result.status).toBe("applied");
    expect(result.document.nodes.at(-1)?.position).toEqual({ x: 1050, y: 888 });
  });

  it.each([
    {
      name: "completed node id already belongs to a node",
      request: completion({ completedNode: completedNode({ id: "paper-1" }) }),
    },
    {
      name: "completed node id already belongs to an edge",
      request: completion({ completedNode: completedNode({ id: "edge-existing" }) }),
    },
    {
      name: "a provenance edge id is occupied",
      request: completion({
        provenanceEdgeIds: ["edge-existing", "edge-provenance-2"],
      }),
    },
    {
      name: "generated node and edge ids collide",
      request: completion({
        completedNode: completedNode({ id: "generated-id" }),
        provenanceEdgeIds: ["generated-id", "edge-provenance-2"],
      }),
    },
    {
      name: "generated edge ids are duplicated",
      request: completion({
        provenanceEdgeIds: ["edge-provenance-1", "edge-provenance-1"],
      }),
    },
  ])("rejects when $name", ({ request }) => {
    expectUnchanged(workspace(), request, "id-conflict");
  });
});
