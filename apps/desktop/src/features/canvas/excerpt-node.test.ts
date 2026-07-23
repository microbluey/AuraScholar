import type { ReaderAnnotation } from "@aurascholar/reader";
import { describe, expect, it } from "vitest";
import { createExcerptNodeFromAnnotation, mapReaderAnnotationColor } from "./excerpt-node";

function annotation(overrides: Partial<ReaderAnnotation> = {}): ReaderAnnotation {
  return {
    id: "annotation-1",
    type: "highlight",
    color: "#AB9DF2",
    pageIndex: 2,
    anchor: {
      version: 1,
      pageIndex: 2,
      quote: {
        exact: "  Evidence survives layout changes.  ",
        prefix: "Before ",
        suffix: " After",
      },
      position: { start: 10, end: 43 },
      quads: {
        pageIndex: 2,
        rects: [{ x1: 1, y1: 2, x2: 3, y2: 4 }],
      },
    },
    contentMd: "  Compare this claim with the baseline.  ",
    ...overrides,
  };
}

describe("Canvas excerpt node", () => {
  it("maps Reader palette keys and persisted hex colors", () => {
    expect(mapReaderAnnotationColor("green")).toBe("green");
    expect(mapReaderAnnotationColor(" #78DCE8 ")).toBe("blue");
    expect(mapReaderAnnotationColor("rgb(1 2 3)")).toBe("yellow");
  });

  it("copies a saved annotation into an ExcerptNode without retaining anchor references", () => {
    const readerAnnotation = annotation();
    const node = createExcerptNodeFromAnnotation({
      annotation: readerAnnotation,
      attachmentId: "attachment-1",
      id: "excerpt-1",
      now: 100,
      paperTitle: "  A Paper  ",
      position: { x: 120, y: 240 },
      workId: "work-1",
    });

    expect(node).toMatchObject({
      id: "excerpt-1",
      type: "excerpt",
      position: { x: 120, y: 240 },
      dimensions: { width: 300, height: 216 },
      createdAt: 100,
      updatedAt: 100,
      data: {
        workId: "work-1",
        paperTitle: "A Paper",
        highlightText: "Evidence survives layout changes.",
        highlightColor: "purple",
        pageIndex: 2,
        annotationId: "annotation-1",
        attachmentId: "attachment-1",
        marginNote: "Compare this claim with the baseline.",
      },
    });
    expect(node.data.anchor).toEqual(readerAnnotation.anchor);
    expect(node.data.anchor).not.toBe(readerAnnotation.anchor);

    readerAnnotation.anchor.quote!.exact = "mutated in Reader";
    readerAnnotation.anchor.quads!.rects[0]!.x1 = 999;
    expect(node.data.anchor).toMatchObject({
      quote: { exact: "  Evidence survives layout changes.  " },
      quads: { rects: [{ x1: 1 }] },
    });
  });

  it("falls back to a note or page label when an annotation has no exact quote", () => {
    const noteNode = createExcerptNodeFromAnnotation({
      annotation: annotation({
        anchor: { version: 1, pageIndex: 2 },
        contentMd: "  A margin thought  ",
      }),
      attachmentId: "attachment-1",
      id: "excerpt-note",
      now: 100,
      paperTitle: "Paper",
      position: { x: 0, y: 0 },
      workId: "work-1",
    });
    const emptyNode = createExcerptNodeFromAnnotation({
      annotation: annotation({
        anchor: { version: 1, pageIndex: 2 },
        contentMd: " ",
      }),
      attachmentId: "attachment-1",
      id: "excerpt-empty",
      now: 100,
      paperTitle: "Paper",
      position: { x: 0, y: 0 },
      workId: "work-1",
    });

    expect(noteNode.data.highlightText).toBe("A margin thought");
    expect(noteNode.data.marginNote).toBeUndefined();
    expect(emptyNode.data.highlightText).toBe("第 3 页批注");
  });
});
