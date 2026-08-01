import { describe, expect, it } from "vitest";
import { parseSourceAnchor } from "./source-anchor.js";

describe("parseSourceAnchor", () => {
  it("parses a revision-bound PDF anchor with every selector", () => {
    expect(
      parseSourceAnchor({
        version: 1,
        kind: "pdf",
        revisionId: "revision-pdf-1",
        pageIndex: 3,
        quads: {
          pageIndex: 3,
          rects: [{ x1: 10, y1: 20, x2: 110, y2: 32 }],
        },
        quote: {
          exact: "Grounded evidence",
          prefix: "Before ",
          suffix: " after",
        },
        position: { start: 42, end: 59 },
      }),
    ).toEqual({
      version: 1,
      kind: "pdf",
      revisionId: "revision-pdf-1",
      pageIndex: 3,
      quads: {
        pageIndex: 3,
        rects: [{ x1: 10, y1: 20, x2: 110, y2: 32 }],
      },
      quote: {
        exact: "Grounded evidence",
        prefix: "Before ",
        suffix: " after",
      },
      position: { start: 42, end: 59 },
    });
  });

  it.each(["html", "docx", "markdown"] as const)(
    "parses a revision-bound %s structural anchor",
    (kind) => {
      expect(
        parseSourceAnchor({
          version: 1,
          kind,
          revisionId: `revision-${kind}-1`,
          headingPath: ["Methods", "Evaluation"],
          blockPath: ["section-2", "paragraph-4"],
          structuralHint: "main > section:nth-of-type(2)",
          quote: { exact: "Evaluation protocol" },
        }),
      ).toEqual({
        version: 1,
        kind,
        revisionId: `revision-${kind}-1`,
        headingPath: ["Methods", "Evaluation"],
        blockPath: ["section-2", "paragraph-4"],
        structuralHint: "main > section:nth-of-type(2)",
        quote: { exact: "Evaluation protocol", prefix: "", suffix: "" },
      });
    },
  );

  it("parses a revision-bound EPUB anchor", () => {
    expect(
      parseSourceAnchor({
        version: 1,
        kind: "epub",
        revisionId: "revision-epub-1",
        cfi: "epubcfi(/6/14!/4/2/8)",
        position: { start: 7, end: 7 },
      }),
    ).toEqual({
      version: 1,
      kind: "epub",
      revisionId: "revision-epub-1",
      cfi: "epubcfi(/6/14!/4/2/8)",
      position: { start: 7, end: 7 },
    });
  });

  it.each([
    {
      version: 1,
      kind: "pdf",
      pageIndex: 0,
    },
    {
      version: 1,
      kind: "html",
      revisionId: "   ",
      headingPath: [],
      blockPath: [],
    },
    {
      version: 1,
      kind: "epub",
      cfi: "epubcfi(/6/2)",
    },
  ])("rejects a revision-bound anchor without a revision id", (anchor) => {
    expect(() => parseSourceAnchor(anchor)).toThrow(/revision id/i);
  });

  it("rejects PDF quads for a different page", () => {
    expect(() =>
      parseSourceAnchor({
        version: 1,
        kind: "pdf",
        revisionId: "revision-pdf-1",
        pageIndex: 2,
        quads: {
          pageIndex: 3,
          rects: [{ x1: 0, y1: 0, x2: 10, y2: 10 }],
        },
      }),
    ).toThrow(/quad selector/i);
  });

  it("rejects a PDF quad selector without rectangles", () => {
    expect(() =>
      parseSourceAnchor({
        version: 1,
        kind: "pdf",
        revisionId: "revision-pdf-1",
        pageIndex: 0,
        quads: { pageIndex: 0, rects: [] },
      }),
    ).toThrow(/between 1 and 512 rectangles/i);
  });

  it("rejects an unbounded PDF quad selector", () => {
    expect(() =>
      parseSourceAnchor({
        version: 1,
        kind: "pdf",
        revisionId: "revision-pdf-1",
        pageIndex: 0,
        quads: {
          pageIndex: 0,
          rects: Array.from({ length: 513 }, () => ({ x1: 0, y1: 0, x2: 10, y2: 10 })),
        },
      }),
    ).toThrow(/between 1 and 512 rectangles/i);
  });

  it("rejects an inverted text position", () => {
    expect(() =>
      parseSourceAnchor({
        version: 1,
        kind: "pdf",
        revisionId: "revision-pdf-1",
        pageIndex: 0,
        position: { start: 12, end: 4 },
      }),
    ).toThrow(/must not precede/i);
  });

  it("rejects an unknown source kind", () => {
    expect(() =>
      parseSourceAnchor({
        version: 1,
        kind: "spreadsheet",
        revisionId: "revision-sheet-1",
      }),
    ).toThrow("Unsupported source anchor kind: spreadsheet");
  });
});
