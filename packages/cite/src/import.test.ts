import { describe, expect, it } from "vitest";
import { parseReferences, parseBibTeX, parseRis, detectFormat } from "./import";
import { toBibTeX, toRIS } from "./export";
import { toCslItem } from "./csl";

const BIB = `@article{vaswani2017attention,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  journal = {Advances in Neural Information Processing Systems},
  year = {2017},
  volume = {30},
  pages = {5998--6008},
  doi = {10.48550/arXiv.1706.03762}
}`;

const RIS = `TY  - JOUR
AU  - Vaswani, Ashish
AU  - Shazeer, Noam
TI  - Attention Is All You Need
T2  - NeurIPS
PY  - 2017
VL  - 30
SP  - 5998
EP  - 6008
DO  - 10.48550/arXiv.1706.03762
ER  - `;

describe("detectFormat", () => {
  it("sniffs each format", () => {
    expect(detectFormat(BIB)).toBe("bibtex");
    expect(detectFormat(RIS)).toBe("ris");
    expect(detectFormat('[{"id":"x","type":"article-journal"}]')).toBe("csljson");
  });
});

describe("parseBibTeX", () => {
  it("parses fields and authors", () => {
    const [item] = parseBibTeX(BIB);
    expect(item?.title).toBe("Attention Is All You Need");
    expect(item?.author).toHaveLength(3);
    expect(item?.author?.[0]).toEqual({ family: "Vaswani", given: "Ashish" });
    expect(item?.["container-title"]).toContain("Neural Information");
    expect(item?.DOI).toBe("10.48550/arXiv.1706.03762");
    expect(item?.issued?.["date-parts"]?.[0]?.[0]).toBe(2017);
  });

  it("parses multiple entries", () => {
    const items = parseBibTeX(BIB + "\n\n" + BIB.replace("vaswani2017attention", "x2020"));
    expect(items).toHaveLength(2);
  });
});

describe("parseRis", () => {
  it("parses tags, authors, and page range", () => {
    const [item] = parseRis(RIS);
    expect(item?.title).toBe("Attention Is All You Need");
    expect(item?.author).toHaveLength(2);
    expect(item?.page).toBe("5998-6008");
    expect(item?.DOI).toBe("10.48550/arXiv.1706.03762");
  });
});

describe("round-trip", () => {
  const item = toCslItem({
    id: "w1",
    title: "Round Trip Paper",
    doi: "10.1/abc",
    year: 2020,
    venueName: "Journal X",
    type: "article",
    authorNames: ["Alice Smith", "Bob Jones"],
  });

  it("BibTeX export → import preserves core fields", () => {
    const [back] = parseReferences(toBibTeX([item]));
    expect(back?.title).toBe("Round Trip Paper");
    expect(back?.author?.map((a) => a.family)).toEqual(["Smith", "Jones"]);
    expect(back?.DOI).toBe("10.1/abc");
  });

  it("RIS export → import preserves core fields", () => {
    const [back] = parseReferences(toRIS([item]));
    expect(back?.title).toBe("Round Trip Paper");
    expect(back?.["container-title"]).toBe("Journal X");
    expect(back?.author?.[0]?.family).toBe("Smith");
  });
});
