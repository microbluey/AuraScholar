import {
  CANVAS_SCHEMA_VERSION,
  type CanvasWorkspaceDocument,
  type PaperNode,
} from "@aurascholar/core";
import type { ReaderAnnotation } from "@aurascholar/reader";
import { describe, expect, it } from "vitest";
import {
  CANVAS_EXCERPT_DRAG_VERSION,
  applyCanvasExcerptDrop,
  type CanvasExcerptDragPayload,
} from "./canvas-excerpt-dnd";
import { commitCanvasExcerptDrop } from "./canvas-excerpt-commit";

const annotation: ReaderAnnotation = {
  id: "annotation-1",
  type: "highlight",
  color: "yellow",
  pageIndex: 0,
  anchor: {
    version: 1,
    pageIndex: 0,
    quote: { exact: "Evidence", prefix: "", suffix: "" },
  },
};

function paper(id = "paper-1"): PaperNode {
  return {
    id,
    type: "paper",
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 278 },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    data: {
      workId: "work-1",
      title: "Paper",
      authors: [],
      year: null,
      annotationCount: 0,
    },
  };
}

function workspace(overrides: Partial<CanvasWorkspaceDocument> = {}): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "workspace-1",
    name: "Research",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [paper()],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function payload(): CanvasExcerptDragPayload {
  return {
    version: CANVAS_EXCERPT_DRAG_VERSION,
    workspaceId: "workspace-1",
    sourceNodeId: "paper-1",
    workId: "work-1",
    attachmentId: "attachment-1",
    paperTitle: "Paper",
    annotation,
  };
}

function sequenceIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `unexpected-${index}`;
}

describe("commitCanvasExcerptDrop", () => {
  it("rejects without reporting success when the update boundary does not run", () => {
    const result = commitCanvasExcerptDrop(
      () => false,
      () => {
        throw new Error("must not run");
      },
    );

    expect(result).toEqual({ status: "rejected" });
  });

  it("reports a live-document failure instead of using a stale render plan", () => {
    const live = workspace({ nodes: [] });
    const result = commitCanvasExcerptDrop(
      (updater) => {
        updater(live);
        return false;
      },
      (current) => applyCanvasExcerptDrop(current, payload(), { x: 20, y: 30 }),
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toMatchObject({ code: "source-paper-missing" });
    }
  });

  it("reports an update-boundary exception as a failed commit", () => {
    const failure = new Error("workspace update failed");
    const result = commitCanvasExcerptDrop(
      () => {
        throw failure;
      },
      () => {
        throw new Error("must not run");
      },
    );

    expect(result).toEqual({ status: "failed", error: failure });
  });

  it("returns the node from the live document when the same annotation already exists", () => {
    const first = applyCanvasExcerptDrop(
      workspace(),
      payload(),
      { x: 20, y: 30 },
      {
        createId: sequenceIds("live-excerpt", "live-edge"),
        now: () => 10,
      },
    );
    const result = commitCanvasExcerptDrop(
      (updater) => {
        expect(updater(first.document)).toBe(first.document);
        return false;
      },
      (current) =>
        applyCanvasExcerptDrop(
          current,
          payload(),
          { x: 900, y: 900 },
          {
            createId: () => "ghost-id",
            now: () => 20,
          },
        ),
    );

    expect(result.status).toBe("committed");
    if (result.status === "committed") {
      expect(result.accepted).toBe(false);
      expect(result.changed).toBe(false);
      expect(result.result.node.id).toBe("live-excerpt");
    }
  });

  it("requires the update boundary to accept a document mutation", () => {
    const result = commitCanvasExcerptDrop(
      (updater) => {
        updater(workspace());
        return false;
      },
      (current) =>
        applyCanvasExcerptDrop(
          current,
          payload(),
          { x: 20, y: 30 },
          {
            createId: sequenceIds("excerpt-1", "edge-1"),
            now: () => 10,
          },
        ),
    );

    expect(result).toEqual({ status: "rejected" });
  });

  it("treats duplicate-edge cleanup as a committed mutation", () => {
    const first = applyCanvasExcerptDrop(
      workspace(),
      payload(),
      { x: 20, y: 30 },
      {
        createId: sequenceIds("excerpt-1", "edge-1"),
        now: () => 10,
      },
    );
    const duplicateEdge = { ...first.edge, id: "edge-duplicate" };
    const live = {
      ...first.document,
      edges: [...first.document.edges, duplicateEdge],
    };
    let committed: CanvasWorkspaceDocument | undefined;
    const result = commitCanvasExcerptDrop(
      (updater) => {
        committed = updater(live);
        return committed !== live;
      },
      (current) =>
        applyCanvasExcerptDrop(
          current,
          payload(),
          { x: 20, y: 30 },
          {
            now: () => 20,
          },
        ),
    );

    expect(result.status).toBe("committed");
    expect(committed?.edges).toEqual([first.edge]);
    if (result.status === "committed") expect(result.changed).toBe(true);
  });
});
