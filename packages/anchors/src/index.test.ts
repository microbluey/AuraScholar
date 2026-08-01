import { describe, expect, it } from "vitest";
import { parseSourceAnchor } from "./index.js";

describe("SourceAnchor strict optional fields", () => {
  it.each([
    {
      label: "TextQuote prefix",
      anchor: {
        version: 1,
        kind: "pdf",
        revisionId: "revision-pdf-1",
        pageIndex: 0,
        quote: { exact: "Evidence", prefix: 42 },
      },
      message: /TextQuote prefix must be a string/,
    },
    {
      label: "TextQuote suffix",
      anchor: {
        version: 1,
        kind: "pdf",
        revisionId: "revision-pdf-1",
        pageIndex: 0,
        quote: { exact: "Evidence", suffix: false },
      },
      message: /TextQuote suffix must be a string/,
    },
    {
      label: "structural hint",
      anchor: {
        version: 1,
        kind: "html",
        revisionId: "revision-html-1",
        headingPath: ["Methods"],
        blockPath: ["paragraph-4"],
        structuralHint: 42,
      },
      message: /Structural hint must be a string/,
    },
  ])("rejects an invalid optional $label", ({ anchor, message }) => {
    expect(() => parseSourceAnchor(anchor)).toThrow(message);
  });
});
