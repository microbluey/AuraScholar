import {
  CANVAS_SCHEMA_VERSION,
  type CanvasWorkspaceDocument,
  type PaperNode,
} from "@aurascholar/core";
import type { ReaderAnnotation } from "@aurascholar/reader";
import { describe, expect, it } from "vitest";
import { CanvasExcerptDropError } from "./canvas-excerpt-dnd";
import {
  applyCanvasAnnotationIngress,
  type CanvasAnnotationIngressInput,
} from "./canvas-annotation-ingress";
import type { CanvasLibraryWork } from "./model";

const work: CanvasLibraryWork = {
  id: "work-1",
  title: "Grounded Research",
  abstract: "An abstract.",
  authorNames: ["Ada Scholar"],
  year: 2026,
  venue: "Test Journal",
  doi: "10.1000/grounded",
  readingStatus: "reading",
};

const annotation: ReaderAnnotation = {
  id: "annotation-1",
  type: "highlight",
  color: "yellow",
  pageIndex: 2,
  anchor: {
    version: 1,
    pageIndex: 2,
    quote: { exact: "Grounded evidence", prefix: "", suffix: "" },
  },
};

function workspace(overrides: Partial<CanvasWorkspaceDocument> = {}): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "workspace-1",
    name: "Research",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function input(
  overrides: Partial<CanvasAnnotationIngressInput> = {},
): CanvasAnnotationIngressInput {
  return {
    annotation,
    attachmentId: "attachment-1",
    workId: work.id,
    work,
    workspaceId: "workspace-1",
    ...overrides,
  };
}

function paper(id = "paper-1"): PaperNode {
  return {
    id,
    type: "paper",
    position: { x: 10, y: 20 },
    dimensions: { width: 320, height: 278 },
    tags: [],
    createdAt: 10,
    updatedAt: 10,
    data: {
      workId: work.id,
      title: work.title,
      authors: work.authorNames,
      year: work.year,
      annotationCount: 0,
    },
  };
}

function sequenceIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `unexpected-${index}`;
}

describe("applyCanvasAnnotationIngress", () => {
  it("creates one Paper, Excerpt, and provenance edge as one document update", () => {
    const original = workspace();
    const result = applyCanvasAnnotationIngress(original, input(), {
      createPaper: () => paper(),
      createId: sequenceIds("excerpt-1", "edge-1"),
      now: () => 20,
    });

    expect(original.nodes).toEqual([]);
    expect(original.edges).toEqual([]);
    expect(result.createdPaper).toBe(true);
    expect(result.createdNode).toBe(true);
    expect(result.createdEdge).toBe(true);
    expect(result.document.nodes).toEqual([result.paper, result.node]);
    expect(result.edge).toMatchObject({
      sourceId: result.paper.id,
      targetId: result.node.id,
      relationType: "derived-from",
    });
  });

  it("reuses the existing Paper and is idempotent on repeated handoff", () => {
    const original = workspace({ nodes: [paper()] });
    const first = applyCanvasAnnotationIngress(original, input(), {
      createPaper: () => {
        throw new Error("must not create a duplicate paper");
      },
      createId: sequenceIds("excerpt-1", "edge-1"),
      now: () => 20,
    });
    const repeated = applyCanvasAnnotationIngress(first.document, input(), {
      createPaper: () => {
        throw new Error("must not create a duplicate paper");
      },
      createId: () => "must-not-be-used",
      now: () => 30,
    });

    expect(first.createdPaper).toBe(false);
    expect(repeated.createdPaper).toBe(false);
    expect(repeated.createdNode).toBe(false);
    expect(repeated.createdEdge).toBe(false);
    expect(repeated.document).toBe(first.document);
    expect(repeated.node.id).toBe("excerpt-1");
  });

  it("prefers the Paper already linked to an existing Excerpt", () => {
    const linkedPaper = paper("paper-linked");
    const first = applyCanvasAnnotationIngress(workspace({ nodes: [linkedPaper] }), input(), {
      createId: sequenceIds("excerpt-1", "edge-1"),
      now: () => 20,
    });
    const duplicatePaper = paper("paper-first-in-array");
    const withDuplicate = {
      ...first.document,
      nodes: [duplicatePaper, ...first.document.nodes],
    };

    const repeated = applyCanvasAnnotationIngress(withDuplicate, input(), {
      createId: () => "must-not-be-used",
      now: () => 30,
    });

    expect(repeated.paper.id).toBe("paper-linked");
    expect(repeated.document).toBe(withDuplicate);
    expect(repeated.document.edges).toHaveLength(1);
  });

  it("recreates a missing Paper and repairs provenance for an existing Excerpt", () => {
    const complete = applyCanvasAnnotationIngress(workspace(), input(), {
      createPaper: () => paper("paper-old"),
      createId: sequenceIds("excerpt-1", "edge-old"),
      now: () => 20,
    });
    const withoutPaperOrEdge = workspace({
      nodes: [complete.node],
      updatedAt: 20,
    });

    const repaired = applyCanvasAnnotationIngress(withoutPaperOrEdge, input(), {
      createPaper: () => paper("paper-new"),
      createId: () => "edge-new",
      now: () => 30,
    });

    expect(repaired.createdPaper).toBe(true);
    expect(repaired.createdNode).toBe(false);
    expect(repaired.createdEdge).toBe(true);
    expect(repaired.document.nodes.map((node) => node.id)).toEqual(["excerpt-1", "paper-new"]);
    expect(repaired.edge).toMatchObject({
      id: "edge-new",
      sourceId: "paper-new",
      targetId: "excerpt-1",
    });
  });

  it("rejects route, annotation, and Library work mismatches without mutation", () => {
    const original = workspace();
    const mismatches: CanvasAnnotationIngressInput[] = [
      input({ expectedWorkId: "another-work" }),
      input({ workId: "another-work" }),
    ];

    for (const mismatch of mismatches) {
      expect(() =>
        applyCanvasAnnotationIngress(original, mismatch, {
          createPaper: () => paper(),
        }),
      ).toThrow(CanvasExcerptDropError);
      expect(original).toEqual(workspace());
    }
  });

  it("rejects a stale handoff after the active workspace changes", () => {
    const original = workspace({ workspaceId: "workspace-new" });

    expect(() =>
      applyCanvasAnnotationIngress(original, input(), {
        createPaper: () => paper(),
      }),
    ).toThrow("白板已经切换");
    expect(original.nodes).toEqual([]);
  });

  it("does not expose a partially created Paper when Excerpt creation fails", () => {
    const existing = applyCanvasAnnotationIngress(workspace(), input(), {
      createPaper: () => paper(),
      createId: sequenceIds("excerpt-1", "edge-1"),
      now: () => 20,
    });
    const conflicting = {
      ...existing.node,
      data: {
        ...existing.node.data,
        workId: "another-work",
      },
    };
    const original = workspace({ nodes: [conflicting] });

    expect(() =>
      applyCanvasAnnotationIngress(original, input(), {
        createPaper: () => paper("paper-new"),
      }),
    ).toThrow("同一批注标识");
    expect(original.nodes).toEqual([conflicting]);
    expect(original.edges).toEqual([]);
  });
});
