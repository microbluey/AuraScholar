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

  it("structured columns override the raw csl_json blob", () => {
    const item = toCslItem({
      ...RAW_CSL,
      volume: "99", // column wins over csl_json's volume "30"
      issn: "2222-3333",
      pmid: "41000001",
      publisher: "Edited Publisher",
    });
    expect(item.volume).toBe("99");
    expect(item.ISSN).toBe("2222-3333");
    expect(item.PMID).toBe("41000001");
    expect(item.publisher).toBe("Edited Publisher");
  });

  it("falls back from malformed raw CSL type and date fields", () => {
    const item = toCslItem({
      id: "w-bad-csl",
      title: "A Recoverable Reference",
      doi: null,
      year: null,
      publicationDate: "2026-03-14",
      venueName: "Local First Notes",
      type: "conference",
      cslJson: {
        type: { id: "article-journal" },
        title: "Raw Recoverable Reference",
        author: [{ family: "Legacy", given: "Data" }],
        issued: { "date-parts": [["2025"], [2025, null, 14], []] },
      },
    });

    expect(item.type).toBe("paper-conference");
    expect(item.title).toBe("Raw Recoverable Reference");
    expect(item.author?.[0]).toEqual({ family: "Legacy", given: "Data", literal: undefined });
    expect(item.issued).toEqual({ raw: "2026-03-14" });
  });

  it("authorsDetail splits authors and editors by role", () => {
    const item = toCslItem({
      ...BARE,
      authorsDetail: [
        { displayName: "Jane Q. Researcher", role: "author" },
        { displayName: "Ed Itor", role: "editor" },
      ],
    });
    expect(item.author?.map((a) => a.family)).toEqual(["Researcher"]);
    expect(item.editor?.map((a) => a.family)).toEqual(["Itor"]);
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

  it("returns empty text for empty BibTeX and RIS exports", () => {
    expect(toBibTeX([])).toBe("");
    expect(toRIS([])).toBe("");
    expect(toCslJson([])).toBe("[]");
  });

  it("BibTeX has a key, type, and braces", () => {
    const bib = toBibTeX([{ ...item, PMID: "41000001" }]);
    expect(bib).toMatch(/@article\{vaswani2017/);
    expect(bib).toContain("title = {Attention Is All You Need}");
    expect(bib).toContain("author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki}");
    expect(bib).toContain("pages = {5998--6008}");
    expect(bib).toContain("doi = {10.48550/arxiv.1706.03762}");
    expect(bib).toContain("pmid = {41000001}");
  });

  it("RIS has TY/AU/ER tags", () => {
    const ris = toRIS([{ ...item, PMID: "41000001" }]);
    expect(ris).toContain("TY  - JOUR");
    expect(ris).toContain("AU  - Vaswani, Ashish");
    expect(ris).toContain("PY  - 2017");
    expect(ris).toContain("DO  - 10.48550/arxiv.1706.03762");
    expect(ris).toContain("AN  - PMID:41000001");
    expect(ris.trimEnd().endsWith("ER  -")).toBe(true);
  });

  it("CSL-JSON round-trips", () => {
    const json = JSON.parse(toCslJson([{ ...item, PMID: "41000001" }]));
    expect(json[0].title).toBe("Attention Is All You Need");
    expect(json[0].DOI).toBe("10.48550/arxiv.1706.03762");
    expect(json[0].PMID).toBe("41000001");
  });

  it("normalizes DOI fields across export formats and omits invalid DOI values", () => {
    const normalizedDoiItem = { ...item, DOI: " https://DX.doi.org/10.5555/Foo.Bar " };
    const invalidDoiItem = { ...item, DOI: "https://example.com/not-a-doi" };

    expect(toBibTeX([normalizedDoiItem])).toContain("doi = {10.5555/foo.bar}");
    expect(toRIS([normalizedDoiItem])).toContain("DO  - 10.5555/foo.bar");
    expect(JSON.parse(toCslJson([normalizedDoiItem]))[0].DOI).toBe("10.5555/foo.bar");

    expect(toBibTeX([invalidDoiItem])).not.toContain("doi =");
    expect(toRIS([invalidDoiItem])).not.toContain("DO  -");
    expect(JSON.parse(toCslJson([invalidDoiItem]))[0]).not.toHaveProperty("DOI");
  });

  it("exports RIS page ranges from single, double, and en dash separators", () => {
    const doubleDash = toRIS([{ ...item, page: "5998--6008" }]);
    const enDash = toRIS([{ ...item, page: "10–20" }]);
    const singlePage = toRIS([{ ...item, page: "42" }]);

    expect(doubleDash).toContain("SP  - 5998");
    expect(doubleDash).toContain("EP  - 6008");
    expect(enDash).toContain("SP  - 10");
    expect(enDash).toContain("EP  - 20");
    expect(singlePage).toContain("SP  - 42");
    expect(singlePage).not.toContain("EP  -");
  });

  it("keeps multiline and braced metadata from corrupting BibTeX and RIS records", () => {
    const messy = {
      ...item,
      title: "A {Fragile}\nTitle } With\r\nBreaks",
      author: [{ literal: "Research\nLab" }],
      publisher: "Publisher\r\nName",
      abstract: "First line\nSecond line",
    };

    const bib = toBibTeX([messy]);
    const ris = toRIS([messy]);

    expect(bib).toContain("title = {A Fragile Title With Breaks}");
    expect(bib).toContain("author = {Research Lab}");
    expect(bib).toContain("publisher = {Publisher Name}");
    expect(bib).not.toContain("Fragile}\n");

    expect(ris).toContain("TI  - A {Fragile} Title } With Breaks");
    expect(ris).toContain("AU  - Research Lab");
    expect(ris).toContain("PB  - Publisher Name");
    expect(ris).toContain("AB  - First line Second line");
    expect(ris).not.toContain("\nSecond line");
  });

  it("generates safe unique BibTeX keys for duplicate and non-latin metadata", () => {
    const duplicate = { ...item, id: "10.1000/duplicate key" };
    const nonLatin = {
      ...item,
      id: "10.1000/中文 key",
      title: "深度学习论文",
      author: [{ family: "王", given: "小明" }],
      issued: { "date-parts": [[2026]] },
    };
    const bib = toBibTeX([duplicate, duplicate, nonLatin]);

    expect(bib).toMatch(/@article\{vaswani2017attention,/);
    expect(bib).toMatch(/@article\{vaswani2017attention-2,/);
    expect(bib).toMatch(/@article\{2026,/);
    expect(bib).not.toContain("@article{10.1000/");
    expect(bib).not.toContain("中文 key");
  });
});

describe("styles", () => {
  const item = toCslItem(RAW_CSL);

  it("APA includes year in parens and et-al-free author list", () => {
    const s = formatEntry(item, "apa");
    expect(s).toContain("(2017)");
    expect(s).toContain("Vaswani");
  });

  it("APA normalizes DOI URLs and skips invalid DOI values", () => {
    const normalized = formatEntry(
      { ...item, DOI: " https://DX.doi.org/10.5555/Foo.Bar " },
      "apa",
    );
    const invalid = formatEntry({ ...item, DOI: "https://example.com/not-a-doi" }, "apa");

    expect(normalized).toContain("https://doi.org/10.5555/foo.bar");
    expect(normalized).not.toContain("https://doi.org/https://");
    expect(invalid).not.toContain("doi.org");
    expect(invalid).not.toContain("not-a-doi");
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
