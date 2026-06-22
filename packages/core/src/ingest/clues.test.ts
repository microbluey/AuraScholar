import { describe, it, expect } from "vitest";
import {
  clueFromInput,
  clueFromUrl,
  cluesFromPdfSource,
  cluesFromPdfText,
  titleCandidatesFromPdfSource,
} from "./clues";

describe("clueFromInput", () => {
  it("recognizes bare DOIs", () => {
    expect(clueFromInput("10.1038/s41586-021-03819-2")).toEqual({
      kind: "doi",
      doi: "10.1038/s41586-021-03819-2",
    });
  });
  it("recognizes doi.org URLs", () => {
    expect(clueFromInput("https://doi.org/10.1145/3442188.3445922")).toEqual({
      kind: "doi",
      doi: "10.1145/3442188.3445922",
    });
  });
  it("recognizes arXiv ids", () => {
    expect(clueFromInput("arXiv:1706.03762")).toEqual({ kind: "arxiv", arxivId: "1706.03762" });
    expect(clueFromInput("https://arxiv.org/abs/1706.03762")).toEqual({
      kind: "arxiv",
      arxivId: "1706.03762",
    });
  });
  it("falls back to title for free text", () => {
    expect(clueFromInput("Attention is all you need")).toEqual({
      kind: "title",
      title: "Attention is all you need",
    });
  });
  it("returns null for empty input", () => {
    expect(clueFromInput("   ")).toBeNull();
  });
});

describe("clueFromUrl", () => {
  it("extracts DOIs embedded in publisher URLs", () => {
    expect(clueFromUrl("https://link.springer.com/article/10.1007/s11263-015-0816-y")).toEqual({
      kind: "doi",
      doi: "10.1007/s11263-015-0816-y",
    });
  });
  it("strips trailing /pdf segments from embedded DOIs", () => {
    expect(clueFromUrl("https://onlinelibrary.wiley.com/doi/10.1002/abc.123/pdf")).toEqual({
      kind: "doi",
      doi: "10.1002/abc.123",
    });
  });
});

describe("cluesFromPdfText", () => {
  it("ranks the most frequent DOI first (own DOI repeats in headers)", () => {
    const text = `
      Journal of Things 10.1234/own.paper page 1
      footer 10.1234/own.paper
      References: [1] Some cited work doi:10.9999/cited.one
      footer 10.1234/own.paper
    `;
    const clues = cluesFromPdfText(text);
    expect(clues[0]).toEqual({ kind: "doi", doi: "10.1234/own.paper" });
  });
  it("picks up arXiv ids", () => {
    const clues = cluesFromPdfText("preprint arXiv:2301.00001v2 under review");
    expect(clues).toContainEqual({ kind: "arxiv", arxivId: "2301.00001" });
  });
});

describe("cluesFromPdfSource", () => {
  it("prioritizes identifiers from PDF metadata before title fallbacks", () => {
    const clues = cluesFromPdfSource({
      metadata: { title: "Publisher proof 10.1145/3442188.3445922" },
      text: "Attention Is All You Need\nAshish Vaswani et al.\nAbstract\n...",
      fileName: "attention.pdf",
    });
    expect(clues[0]).toEqual({ kind: "doi", doi: "10.1145/3442188.3445922" });
    expect(clues).toContainEqual({ kind: "title", title: "Attention Is All You Need" });
  });

  it("extracts plausible title candidates from first-page text", () => {
    expect(
      titleCandidatesFromPdfSource({
        text: `
          Attention Is All You Need
          Ashish Vaswani, Noam Shazeer, Niki Parmar
          Google Brain
          Abstract
          The dominant sequence transduction models are based on complex recurrent networks.
        `,
      })[0],
    ).toBe("Attention Is All You Need");
  });

  it("filters generic PDF metadata and non-title filenames", () => {
    const candidates = titleCandidatesFromPdfSource({
      metadata: { title: "Microsoft Word - Main Document.docx" },
      fileName: "s41586-021-03819-2.pdf",
    });
    expect(candidates).toEqual([]);
  });
});
