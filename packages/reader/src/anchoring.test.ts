import { describe, it, expect } from "vitest";
import { makeQuoteSelector, resolveAnchor, similarity } from "./anchoring";
import type { AnnotationAnchor } from "./anchor-types";

const PAGE = `Abstract. The dominant sequence transduction models are based on complex
recurrent or convolutional neural networks that include an encoder and a decoder.
The best performing models also connect the encoder and decoder through an
attention mechanism. We propose a new simple network architecture, the Transformer,
based solely on attention mechanisms, dispensing with recurrence and convolutions
entirely. Experiments on two machine translation tasks show these models to be
superior in quality while being more parallelizable and requiring significantly
less time to train.`;

function anchorFor(text: string, start: number, end: number): AnnotationAnchor {
  return {
    version: 1,
    pageIndex: 0,
    quote: makeQuoteSelector(text, start, end),
    position: { start, end },
  };
}

describe("resolveAnchor", () => {
  it("resolves exactly when text is unchanged", () => {
    const start = PAGE.indexOf("attention mechanism");
    const anchor = anchorFor(PAGE, start, start + "attention mechanism".length);
    const res = resolveAnchor(anchor, PAGE);
    expect(res.status).toBe("exact");
    if (res.status === "exact") {
      expect(PAGE.slice(res.start, res.end)).toBe("attention mechanism");
    }
  });

  it("disambiguates repeated phrases using context", () => {
    // "the encoder and decoder" vs "an encoder and a decoder" — pick the
    // right occurrence of a string that appears in similar forms twice.
    const phrase = "the encoder and decoder";
    const start = PAGE.indexOf(phrase);
    const anchor = anchorFor(PAGE, start, start + phrase.length);
    const res = resolveAnchor(anchor, PAGE);
    expect(res.status).toBe("exact");
    if (res.status === "exact") expect(res.start).toBe(start);
  });

  it("survives whitespace/extraction drift via fuzzy matching", () => {
    const phrase = "based solely on attention mechanisms";
    const start = PAGE.indexOf(phrase);
    const anchor = anchorFor(PAGE, start, start + phrase.length);
    // Simulate a different extraction: line breaks collapsed, hyphenation change
    const drifted = PAGE.replace(/\n/g, " ").replace(
      "based solely on attention mechanisms",
      "based  solely on atention mechanisms", // typo + double space
    );
    const res = resolveAnchor(anchor, drifted);
    expect(res.status).toBe("fuzzy");
    if (res.status === "fuzzy") {
      expect(drifted.slice(res.start, res.end)).toContain("atention");
      expect(res.score).toBeGreaterThan(0.75);
    }
  });

  it("orphans rather than mis-anchoring when text is gone", () => {
    const phrase = "dispensing with recurrence";
    const start = PAGE.indexOf(phrase);
    const anchor = anchorFor(PAGE, start, start + phrase.length);
    const unrelated = "Completely different document about marine biology and coral reefs.";
    expect(resolveAnchor(anchor, unrelated).status).toBe("orphaned");
  });

  it("orphans anchors with no quote", () => {
    const res = resolveAnchor({ version: 1, pageIndex: 0 }, PAGE);
    expect(res.status).toBe("orphaned");
  });
});

describe("similarity", () => {
  it("is 1 for identical strings", () => {
    expect(similarity("abc", "abc")).toBe(1);
  });
  it("is high for near-identical strings", () => {
    expect(similarity("attention", "atention")).toBeGreaterThan(0.85);
  });
  it("is low for unrelated strings", () => {
    expect(similarity("attention mechanism", "marine biology")).toBeLessThan(0.4);
  });
});
