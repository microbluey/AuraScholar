import { describe, expect, it } from "vitest";
import { normalizeAnnotationAnchor, parseAnnotationAnchorJson } from "./anchor-guard";

describe("parseAnnotationAnchorJson", () => {
  it("falls back to an orphanable page anchor when stored JSON is malformed", () => {
    expect(parseAnnotationAnchorJson("{bad-json", 3)).toEqual({
      anchor: { version: 1, pageIndex: 3 },
      recovered: true,
    });
  });

  it("keeps a valid anchor and reports no recovery", () => {
    const anchor = {
      version: 1,
      pageIndex: 2,
      quote: { exact: "attention", prefix: "pay ", suffix: " now" },
      position: { start: 10, end: 19 },
      quads: {
        pageIndex: 2,
        rects: [{ x1: 1, y1: 2, x2: 3, y2: 4 }],
      },
    };

    expect(parseAnnotationAnchorJson(JSON.stringify(anchor), 9)).toEqual({
      anchor,
      recovered: false,
    });
  });
});

describe("normalizeAnnotationAnchor", () => {
  it("drops malformed selectors while preserving usable anchor fields", () => {
    const result = normalizeAnnotationAnchor(
      {
        version: 1,
        pageIndex: 4,
        quote: { exact: "survives", prefix: 1, suffix: null },
        position: { start: 12, end: 5 },
        quads: {
          pageIndex: 4,
          rects: [
            { x1: 1, y1: 2, x2: 3, y2: 4 },
            { x1: 1, y1: Number.NaN, x2: 3, y2: 4 },
          ],
        },
      },
      0,
    );

    expect(result).toEqual({
      anchor: {
        version: 1,
        pageIndex: 4,
        quote: { exact: "survives", prefix: "", suffix: "" },
        quads: { pageIndex: 4, rects: [{ x1: 1, y1: 2, x2: 3, y2: 4 }] },
      },
      recovered: true,
    });
  });

  it("falls back when the root anchor shape is unusable", () => {
    expect(normalizeAnnotationAnchor({ version: 2, pageIndex: 1 }, 7)).toEqual({
      anchor: { version: 1, pageIndex: 7 },
      recovered: true,
    });
  });
});
