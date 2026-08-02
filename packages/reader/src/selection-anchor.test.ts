import { describe, expect, it } from "vitest";
import type { PageTextIndex } from "./document.js";
import { buildPdfSelectionAnchor, buildReaderEvidenceSelection } from "./selection-anchor.js";

const index: PageTextIndex = {
  items: [
    {
      textStart: 0,
      item: {
        dir: "ltr",
        fontName: "font-1",
        hasEOL: false,
        height: 12,
        str: "Evidence anchors stay.",
        transform: [1, 0, 0, 1, 10, 20],
        width: 132,
      },
    },
  ],
  text: "Evidence anchors stay.",
};

const selection = {
  clientRect: { height: 18, width: 48, x: 100, y: 120 },
  end: 16,
  exact: "anchors",
  pageIndex: 2,
  start: 9,
};

describe("PDF selection anchors", () => {
  it("uses the same selectors for annotations and Evidence", () => {
    const annotationAnchor = buildPdfSelectionAnchor(index, selection);
    const evidence = buildReaderEvidenceSelection(index, selection);

    expect(evidence.anchor).toEqual({ ...annotationAnchor, kind: "pdf" });
    expect(evidence.exact).toBe(annotationAnchor.quote?.exact);
    expect(evidence.clientRect).toEqual(selection.clientRect);
    expect(evidence.anchor).toMatchObject({
      pageIndex: 2,
      position: { end: 16, start: 9 },
      quads: { pageIndex: 2 },
      quote: { exact: "anchors" },
      version: 1,
    });
  });
});
