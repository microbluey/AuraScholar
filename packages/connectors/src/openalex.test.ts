import { StubHttpClient } from "@aurascholar/platform";
import { describe, expect, it } from "vitest";
import type { ConnectorContext } from "./client";
import {
  decodeInvertedIndex,
  MAX_OPENALEX_ABSTRACT_BYTES,
  MAX_OPENALEX_ABSTRACT_ENTRIES,
  MAX_OPENALEX_ABSTRACT_POSITIONS,
  MAX_OPENALEX_ABSTRACT_WORD_BYTES,
  MAX_OPENALEX_ABSTRACT_WORDS,
  normalizeOpenAlex,
  openalexByDoi,
  openalexById,
  openalexCitedBy,
} from "./openalex";

function ctxWith(http: StubHttpClient): ConnectorContext {
  return { http, mailto: "test@example.com" };
}

describe("OpenAlex request cancellation", () => {
  it.each([
    [
      "openalexByDoi",
      (ctx: ConnectorContext, signal: AbortSignal) =>
        openalexByDoi(ctx, "10.1000/example", { retries: 0, signal }),
    ],
    [
      "openalexById",
      (ctx: ConnectorContext, signal: AbortSignal) =>
        openalexById(ctx, "W2741809807", { retries: 0, signal }),
    ],
    [
      "openalexCitedBy",
      (ctx: ConnectorContext, signal: AbortSignal) =>
        openalexCitedBy(ctx, "W2741809807", 25, { retries: 0, signal }),
    ],
  ])("%s rejects an already-aborted request before issuing HTTP", async (_name, request) => {
    const http = new StubHttpClient();
    const controller = new AbortController();
    controller.abort();

    await expect(request(ctxWith(http), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(http.requests).toHaveLength(0);
  });
});

describe("normalizeOpenAlex", () => {
  it("uses only explicit PDF locations for oaPdfUrl", () => {
    expect(
      normalizeOpenAlex({
        id: "https://openalex.org/W1",
        title: "Best OA PDF",
        best_oa_location: { pdf_url: "https://repository.example/paper.pdf" },
        primary_location: { pdf_url: "https://publisher.example/paper.pdf" },
        open_access: { oa_url: "https://publisher.example/article" },
      }).oaPdfUrl,
    ).toBe("https://repository.example/paper.pdf");

    expect(
      normalizeOpenAlex({
        id: "https://openalex.org/W2",
        title: "Primary PDF",
        primary_location: { pdf_url: "https://publisher.example/primary.pdf" },
      }).oaPdfUrl,
    ).toBe("https://publisher.example/primary.pdf");
  });

  it("does not treat an open-access landing page as a PDF", () => {
    const work = normalizeOpenAlex({
      id: "https://openalex.org/W3",
      title: "Landing page only",
      open_access: { oa_url: "https://publisher.example/article" },
    });

    expect(work.oaPdfUrl).toBeUndefined();
  });

  it("keeps the work when a malformed abstract index is rejected", () => {
    const work = normalizeOpenAlex({
      id: "https://openalex.org/W4",
      doi: "https://doi.org/10.1000/kept",
      title: "Metadata survives",
      abstract_inverted_index: { word: [4_294_967_294] } as unknown as Record<string, number[]>,
    });

    expect(work).toMatchObject({ doi: "10.1000/kept", title: "Metadata survives" });
    expect(work.abstract).toBeUndefined();
  });
});

describe("decodeInvertedIndex", () => {
  it("preserves position order, gaps, and last-write-wins duplicates", () => {
    expect(
      decodeInvertedIndex({
        third: [2],
        first: [0],
        second: [1],
      }),
    ).toBe("first second third");
    expect(decodeInvertedIndex({ first: [0], replacement: [0], third: [2] })).toBe(
      "replacement third",
    );
    // The legacy implementation compacted gaps with filter(Boolean).
    expect(decodeInvertedIndex({ only: [7] })).toBe("only");
  });

  it.each([
    ["null index", null],
    ["array index", []],
    ["undefined index", undefined],
    ["positions object", { word: {} }],
    ["positions string", { word: "0" }],
    ["null positions", { word: null }],
    ["negative position", { word: [-1] }],
    ["fractional position", { word: [1.5] }],
    ["NaN position", { word: [Number.NaN] }],
    ["Infinity position", { word: [Number.POSITIVE_INFINITY] }],
    ["negative Infinity position", { word: [Number.NEGATIVE_INFINITY] }],
    ["position string", { word: ["0"] }],
  ])("fails closed for %s", (_label, index) => {
    expect(decodeInvertedIndex(index)).toBeUndefined();
  });

  it("rejects sparse position arrays without iterating their holes", () => {
    const sparse = new Array<number>(2);
    sparse[1] = 0;
    expect(decodeInvertedIndex({ word: sparse })).toBeUndefined();
  });

  it("accepts the safe position and word-byte boundaries", () => {
    expect(
      decodeInvertedIndex({
        ["x".repeat(MAX_OPENALEX_ABSTRACT_WORD_BYTES)]: [MAX_OPENALEX_ABSTRACT_WORDS - 1],
      }),
    ).toBe("x".repeat(MAX_OPENALEX_ABSTRACT_WORD_BYTES));
    expect(
      decodeInvertedIndex({
        word: [MAX_OPENALEX_ABSTRACT_WORDS - 1],
      }),
    ).toBe("word");
  });

  it.each([
    ["position just above the word bound", { word: [MAX_OPENALEX_ABSTRACT_WORDS] }],
    ["position near the JavaScript array limit", { word: [4_294_967_294] }],
    ["safe integer position above the word bound", { word: [Number.MAX_SAFE_INTEGER] }],
    [
      "word longer than its byte bound",
      { ["x".repeat(MAX_OPENALEX_ABSTRACT_WORD_BYTES + 1)]: [0] },
    ],
    [
      "too many positions",
      {
        word: Array.from({ length: MAX_OPENALEX_ABSTRACT_POSITIONS + 1 }, (_, index) => index % 2),
      },
    ],
  ])("rejects %s without allocating a sparse output", (_label, index) => {
    expect(decodeInvertedIndex(index)).toBeUndefined();
  });

  it("rejects an index with too many word entries", () => {
    const index: Record<string, number[]> = {};
    for (let entry = 0; entry <= MAX_OPENALEX_ABSTRACT_ENTRIES; entry += 1) {
      index[`word-${entry}`] = [];
    }
    expect(decodeInvertedIndex(index)).toBeUndefined();
  });

  it("rejects decoded text beyond the UTF-8 byte bound", () => {
    const word = "word";
    const index = { [word]: Array.from({ length: MAX_OPENALEX_ABSTRACT_WORDS }, (_, i) => i) };
    expect(decodeInvertedIndex(index)).toBeUndefined();
    expect(MAX_OPENALEX_ABSTRACT_BYTES).toBeGreaterThan(0);
  });
});
