import { describe, expect, it } from "vitest";
import {
  buildPdfContentUnits,
  extractPdfContentUnits,
  type ExtractedPdfTextPage,
} from "./index.js";

const context = {
  libraryId: "library-1",
  workId: "work-1",
  assetId: "asset-1",
  revisionId: "revision-1",
};

describe("PDF ContentUnit extraction", () => {
  it("creates revision-bound page units in stable page order", async () => {
    const units = await buildPdfContentUnits({
      ...context,
      pages: [
        { pageIndex: 0, text: "First page text." },
        { pageIndex: 1, text: "Second page text." },
      ],
    });

    expect(units).toHaveLength(2);
    expect(units.map((unit) => unit.ordinal)).toEqual([0, 1]);
    expect(units[0]).toMatchObject({
      sourceType: "pdf",
      sourceId: "revision-1",
      revisionId: "revision-1",
      text: "First page text.",
      state: "ready",
      anchor: {
        kind: "pdf",
        pageIndex: 0,
        revisionId: "revision-1",
        position: { start: 0, end: 16 },
        quote: { exact: "First page text." },
      },
    });
  });

  it("uses a context parent and bounded overlapping windows for oversized pages", async () => {
    const text = "0123456789ABCDEFGHIJ";
    const units = await buildPdfContentUnits({
      ...context,
      pages: [{ pageIndex: 0, text }],
      maxUnitChars: 10,
      overlapChars: 2,
    });

    expect(units).toHaveLength(4);
    const parent = units[0]!;
    const children = units.slice(1);
    expect(parent).toMatchObject({ text, state: "context-only", parentUnitId: null });
    expect(children.every((unit) => unit.parentUnitId === parent.id)).toBe(true);
    expect(children.every((unit) => unit.state === "ready")).toBe(true);
    expect(children.map((unit) => unit.text)).toEqual(["0123456789", "89ABCDEFGH", "GHIJ"]);
    expect(children.map((unit) => unit.anchor)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ position: { start: 0, end: 10 } }),
        expect.objectContaining({ position: { start: 8, end: 18 } }),
        expect.objectContaining({ position: { start: 16, end: 20 } }),
      ]),
    );
  });

  it("never cuts a Unicode surrogate pair when windowing", async () => {
    const text = "12345678😀abcdef";
    const units = await buildPdfContentUnits({
      ...context,
      pages: [{ pageIndex: 0, text }],
      maxUnitChars: 10,
      overlapChars: 1,
    });
    for (const unit of units) {
      expect(unit.text).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
      );
      expect(unit.anchor).toMatchObject({ kind: "pdf", revisionId: context.revisionId });
    }
  });

  it.each([
    [
      [
        { pageIndex: 1, text: "wrong first page" },
        { pageIndex: 0, text: "wrong second page" },
      ],
    ],
    [
      [
        { pageIndex: 0, text: "duplicate" },
        { pageIndex: 0, text: "duplicate again" },
      ],
    ],
  ])("fails closed for an invalid page sequence", async (pages: ExtractedPdfTextPage[]) => {
    await expect(buildPdfContentUnits({ ...context, pages })).rejects.toThrow(
      "ascending page order",
    );
  });

  it("checks the async source page identity and supports cancellation", async () => {
    await expect(
      extractPdfContentUnits({
        ...context,
        source: {
          pageCount: 1,
          async getPageText() {
            return { pageIndex: 2, text: "not page one" };
          },
        },
      }),
    ).rejects.toThrow("while extracting page 0");

    const controller = new AbortController();
    controller.abort();
    await expect(
      extractPdfContentUnits({
        ...context,
        source: {
          pageCount: 1,
          async getPageText() {
            return "never read";
          },
        },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
