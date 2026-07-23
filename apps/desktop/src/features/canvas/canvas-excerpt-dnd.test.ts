import {
  CANVAS_SCHEMA_VERSION,
  type CanvasEdge,
  type CanvasWorkspaceDocument,
  type PaperNode,
} from "@aurascholar/core";
import type { ReaderAnnotation } from "@aurascholar/reader";
import { describe, expect, it } from "vitest";
import {
  CANVAS_EXCERPT_DRAG_MIME,
  CANVAS_EXCERPT_DRAG_VERSION,
  CanvasExcerptDropError,
  applyCanvasExcerptDrop,
  isCanvasExcerptDragPayload,
  parseCanvasExcerptDragPayload,
  readCanvasExcerptDragPayload,
  serializeCanvasExcerptDragPayload,
  type CanvasExcerptDragPayload,
  writeCanvasExcerptDragPayload,
} from "./canvas-excerpt-dnd";

function paperNode(overrides: Partial<PaperNode> = {}): PaperNode {
  return {
    id: "paper-1",
    type: "paper",
    position: { x: 10, y: 20 },
    dimensions: { width: 320, height: 278 },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    data: {
      workId: "work-1",
      title: "A Paper",
      authors: ["A. Author"],
      year: 2024,
      annotationCount: 1,
    },
    ...overrides,
  };
}

function workspace(overrides: Partial<CanvasWorkspaceDocument> = {}): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "workspace-1",
    name: "Research",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [paperNode()],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function annotation(overrides: Partial<ReaderAnnotation> = {}): ReaderAnnotation {
  return {
    id: "annotation-1",
    type: "highlight",
    color: "#a9dc76",
    pageIndex: 4,
    anchor: {
      version: 1,
      pageIndex: 4,
      quote: { exact: "Selected evidence", prefix: "before ", suffix: " after" },
      position: { start: 7, end: 24 },
      quads: {
        pageIndex: 4,
        rects: [{ x1: 10, y1: 20, x2: 30, y2: 40 }],
      },
    },
    contentMd: "A useful note",
    ...overrides,
  };
}

function payload(overrides: Partial<CanvasExcerptDragPayload> = {}): CanvasExcerptDragPayload {
  return {
    version: CANVAS_EXCERPT_DRAG_VERSION,
    workspaceId: "workspace-1",
    sourceNodeId: "paper-1",
    workId: "work-1",
    attachmentId: "attachment-1",
    paperTitle: "A Paper",
    annotation: annotation(),
    ...overrides,
  };
}

function sequenceIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `unexpected-${index}`;
}

function expectDropError(action: () => unknown, code: CanvasExcerptDropError["code"]): void {
  try {
    action();
    throw new Error("Expected CanvasExcerptDropError");
  } catch (error) {
    expect(error).toBeInstanceOf(CanvasExcerptDropError);
    expect((error as CanvasExcerptDropError).code).toBe(code);
  }
}

describe("Canvas excerpt drag contract", () => {
  it("round-trips the custom MIME payload and can enforce the active workspace while reading", () => {
    const original = payload();
    const stored = new Map<string, string>();
    const transfer = {
      effectAllowed: "uninitialized",
      getData: (type: string) => stored.get(type) ?? "",
      setData: (type: string, value: string) => stored.set(type, value),
    } as unknown as DataTransfer;

    writeCanvasExcerptDragPayload(transfer, original);

    expect(transfer.effectAllowed).toBe("copy");
    expect(stored.has(CANVAS_EXCERPT_DRAG_MIME)).toBe(true);
    expect(readCanvasExcerptDragPayload(transfer, "workspace-1")).toEqual(original);
    expect(readCanvasExcerptDragPayload(transfer, "workspace-2")).toBeNull();
    expect(parseCanvasExcerptDragPayload(serializeCanvasExcerptDragPayload(original))).toEqual(
      original,
    );
  });

  it("strictly rejects incomplete, extended, or internally inconsistent payloads", () => {
    expect(parseCanvasExcerptDragPayload("{broken")).toBeNull();
    expect(
      isCanvasExcerptDragPayload({
        ...payload(),
        unexpected: true,
      }),
    ).toBe(false);
    expect(
      isCanvasExcerptDragPayload({
        ...payload(),
        version: 2,
      }),
    ).toBe(false);
    expect(
      isCanvasExcerptDragPayload({
        ...payload(),
        annotation: {
          ...annotation(),
          anchor: { version: 1, pageIndex: 99 },
        },
      }),
    ).toBe(false);
    expect(
      isCanvasExcerptDragPayload({
        ...payload(),
        annotation: {
          ...annotation(),
          ephemeralSelection: true,
        },
      }),
    ).toBe(false);
  });
});

describe("applyCanvasExcerptDrop", () => {
  it("atomically adds an ExcerptNode and a Paper→Excerpt derived-from edge", () => {
    const original = workspace();
    const dragPayload = payload();
    const result = applyCanvasExcerptDrop(
      original,
      dragPayload,
      { x: 400, y: 500 },
      {
        createId: sequenceIds("excerpt-1", "edge-1"),
        now: () => 123,
      },
    );

    expect(original.nodes).toHaveLength(1);
    expect(original.edges).toHaveLength(0);
    expect(result).toMatchObject({
      createdNode: true,
      createdEdge: true,
      node: {
        id: "excerpt-1",
        position: { x: 400, y: 500 },
        data: {
          workId: "work-1",
          paperTitle: "A Paper",
          highlightText: "Selected evidence",
          highlightColor: "green",
          annotationId: "annotation-1",
          attachmentId: "attachment-1",
          marginNote: "A useful note",
        },
      },
      edge: {
        id: "edge-1",
        sourceId: "paper-1",
        targetId: "excerpt-1",
        relationType: "derived-from",
      },
    });
    expect(result.document.nodes).toHaveLength(2);
    expect(result.document.edges).toEqual([result.edge]);
    expect(result.document.updatedAt).toBe(123);
    expect(result.node.data.anchor).toEqual(dragPayload.annotation.anchor);
    expect(result.node.data.anchor).not.toBe(dragPayload.annotation.anchor);
  });

  it("uses the authoritative PaperNode title instead of untrusted drag metadata", () => {
    const result = applyCanvasExcerptDrop(
      workspace(),
      payload({ paperTitle: "Spoofed title from DataTransfer" }),
      { x: 40, y: 50 },
      {
        createId: sequenceIds("excerpt-1", "edge-1"),
        now: () => 10,
      },
    );

    expect(result.node.data.paperTitle).toBe("A Paper");
  });

  it("rejects a drop after workspace switching without changing either document", () => {
    const original = workspace();

    expectDropError(
      () =>
        applyCanvasExcerptDrop(original, payload({ workspaceId: "workspace-before-switch" }), {
          x: 1,
          y: 2,
        }),
      "workspace-mismatch",
    );
    expect(original.nodes).toHaveLength(1);
    expect(original.edges).toHaveLength(0);
  });

  it("requires a PaperNode source belonging to the same Library work", () => {
    expectDropError(
      () =>
        applyCanvasExcerptDrop(workspace(), payload({ sourceNodeId: undefined }), { x: 1, y: 2 }),
      "source-paper-missing",
    );
    expectDropError(
      () => applyCanvasExcerptDrop(workspace({ nodes: [] }), payload(), { x: 1, y: 2 }),
      "source-paper-missing",
    );
    expectDropError(
      () =>
        applyCanvasExcerptDrop(workspace(), payload({ workId: "another-work" }), { x: 1, y: 2 }),
      "source-work-mismatch",
    );
  });

  it("returns the existing annotation node and does not create a duplicate edge", () => {
    const first = applyCanvasExcerptDrop(
      workspace(),
      payload(),
      { x: 40, y: 50 },
      {
        createId: sequenceIds("excerpt-1", "edge-1"),
        now: () => 10,
      },
    );

    const repeated = applyCanvasExcerptDrop(
      first.document,
      payload(),
      { x: 900, y: 900 },
      {
        createId: () => "must-not-be-used",
        now: () => 20,
      },
    );

    expect(repeated.document).toBe(first.document);
    expect(repeated.node).toBe(first.node);
    expect(repeated.edge).toBe(first.edge);
    expect(repeated.createdNode).toBe(false);
    expect(repeated.createdEdge).toBe(false);
    expect(repeated.document.nodes).toHaveLength(2);
    expect(repeated.document.edges).toHaveLength(1);
    expect(repeated.node.position).toEqual({ x: 40, y: 50 });
  });

  it("repairs a missing derived edge and collapses duplicate derived edges", () => {
    const first = applyCanvasExcerptDrop(
      workspace(),
      payload(),
      { x: 40, y: 50 },
      {
        createId: sequenceIds("excerpt-1", "edge-1"),
        now: () => 10,
      },
    );
    const withoutEdge = { ...first.document, edges: [] };
    const repaired = applyCanvasExcerptDrop(
      withoutEdge,
      payload(),
      { x: 0, y: 0 },
      {
        createId: () => "edge-repaired",
        now: () => 20,
      },
    );
    expect(repaired.createdNode).toBe(false);
    expect(repaired.createdEdge).toBe(true);
    expect(repaired.document.edges).toHaveLength(1);

    const duplicate: CanvasEdge = {
      ...repaired.edge,
      id: "edge-duplicate",
      createdAt: 21,
      updatedAt: 21,
    };
    const deduplicated = applyCanvasExcerptDrop(
      { ...repaired.document, edges: [...repaired.document.edges, duplicate] },
      payload(),
      { x: 0, y: 0 },
      { now: () => 30 },
    );
    expect(deduplicated.createdNode).toBe(false);
    expect(deduplicated.createdEdge).toBe(false);
    expect(deduplicated.document.edges).toEqual([repaired.edge]);
    expect(deduplicated.document.updatedAt).toBe(30);
  });

  it("rejects an annotation id collision across different Library works", () => {
    const existing = applyCanvasExcerptDrop(
      workspace(),
      payload(),
      { x: 40, y: 50 },
      {
        createId: sequenceIds("excerpt-1", "edge-1"),
        now: () => 10,
      },
    ).document;
    const anotherPaper = paperNode({
      id: "paper-2",
      data: { ...paperNode().data, workId: "work-2", title: "Another Paper" },
    });

    expectDropError(
      () =>
        applyCanvasExcerptDrop(
          { ...existing, nodes: [...existing.nodes, anotherPaper] },
          payload({
            sourceNodeId: "paper-2",
            workId: "work-2",
            paperTitle: "Another Paper",
          }),
          { x: 1, y: 2 },
        ),
      "annotation-conflict",
    );
  });

  it("rejects non-finite drop positions", () => {
    expectDropError(
      () => applyCanvasExcerptDrop(workspace(), payload(), { x: Number.NaN, y: 2 }),
      "invalid-position",
    );
  });
});
