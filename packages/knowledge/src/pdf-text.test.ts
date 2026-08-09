import { describe, expect, it } from "vitest";
import { appendPdfAnchoringText, isPdfTextItem } from "./pdf-text";

describe("PDF anchoring text", () => {
  it("keeps the reader's frozen item-join semantics", () => {
    const items: unknown[] = [
      { str: "First", hasEOL: true },
      { str: "second", hasEOL: false },
      { type: "marked-content" },
      { str: "third", hasEOL: 1 },
    ];
    const text = items.reduce(
      (result, item) => (isPdfTextItem(item) ? appendPdfAnchoringText(result, item) : result),
      "",
    );

    expect(text).toBe("First secondthird ");
  });
});
