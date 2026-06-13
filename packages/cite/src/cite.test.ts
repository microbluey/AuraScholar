import { describe, expect, it } from "vitest";
import { toCslItem, splitName, type WorkLike } from "./csl";
import { toBibTeX, toRIS, toCslJson } from "./export";
import { formatEntry, formatBibliography, formatCitation } from "./styles";

const RAW_CSL: WorkLike = {
  id: "w1",
  title: "Attention Is All You Need",
  doi: "10.48550/arXiv.1706.03762",
  year: 2017,
  venueName: "NeurIPS",
  type: "article",
  cslJson: {
    type: "article-journal",
    title: "Attention Is All You Need",
    author: [
      { family: "Vaswani", given: "Ashish" },
      { family: "Shazeer", given: "Noam" },
      { family: "Parmar", given: "Niki" },
    ],
    "container-title": "Advances in Neural Information Processing Systems",
    issued: { "date-parts": [[2017]] },
    volume: "30",
    page: "5998-6008",
    DOI: "10.48550/arXiv.1706.03762",
  },
};

const BARE: WorkLike = {
  id: "w2",
  title: "A Local-First Study",
  doi: null,
  year: 2023,
  venueName: "Journal of Stuff",
  type: "article",
  authorNames: ["Jane Q. Researcher"],
};

describe("toCslItem", () => {
  it("prefers stored CSL-JSON", () => {
    const item = toCslItem(RAW_CSL);
    expect(item.type).toBe("article-journal");
    expect(item.author?.[0]).toEqual({ family: "Vaswani", given: "Ashish", literal: undefined });
    expect(item["container-title"]).toContain("Neural Information");
  });

  it("synthesizes from columns when CSL is absent", () => {
    const item = toCslItem(BARE);
    expect(item.title).toBe("A Local-First Study");
    expect(item.author?.[0]?.family).toBe("Researcher");
    expect(item.issued?.["date-parts"]?.[0]?.[0]).toBe(2023);
  });
});

describe("splitName", () => {
  it("splits given/family", () => {
    expect(splitName("Ashish Vaswani")).toEqual({ given: "Ashish", family: "Vaswani" });
    expect(splitName("Plato")).toEqual({ family: "Plato" });
  });
});

describe("exporters", () => {
  const item = toCslItem(RAW_CSL);

  it("BibTeX has a key, type, and braces", () => {
    const bib = toBibTeX([item]);
    expect(bib).toMatch(/@article\{vaswani2017/);
    expect(bib).toContain("title = {Attention Is All You Need}");
    expect(bib).toContain("author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki}");
    expect(bib).toContain("pages = {5998--6008}");
  });

  it("RIS has TY/AU/ER tags", () => {
    const ris = toRIS([item]);
    expect(ris).toContain("TY  - JOUR");
    expect(ris).toContain("AU  - Vaswani, Ashish");
    expect(ris).toContain("PY  - 2017");
    expect(ris.trimEnd().endsWith("ER  -")).toBe(true);
  });

  it("CSL-JSON round-trips", () => {
    const json = JSON.parse(toCslJson([item]));
    expect(json[0].title).toBe("Attention Is All You Need");
  });
});

describe("styles", () => {
  const item = toCslItem(RAW_CSL);

  it("APA includes year in parens and et-al-free author list", () => {
    const s = formatEntry(item, "apa");
    expect(s).toContain("(2017)");
    expect(s).toContain("Vaswani");
  });

  it("GB/T 7714 uses 等 after 3 authors and [J] marker", () => {
    const many = { ...item, author: [...(item.author ?? []), { family: "Uszkoreit", given: "Jakob" }] };
    const s = formatEntry(many, "gb7714");
    expect(s).toContain("[J]");
    expect(s).toContain("等");
  });

  it("IEEE numbered bibliography", () => {
    const list = formatBibliography([item], "ieee");
    expect(list[0]).toMatch(/^\[1\]/);
  });

  it("author-date citation vs numeric citation", () => {
    expect(formatCitation(item, "apa")).toContain("2017");
    expect(formatCitation(item, "apa")).toContain("et al.");
    expect(formatCitation(item, "ieee", 3)).toBe("[3]");
  });
});
