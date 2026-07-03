import { describe, expect, it } from "vitest";
import { parseReferences, parseBibTeX, parseRis, parseNbib, parseEnw, detectFormat } from "./import";
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

const NBIB = `PMID- 41000001
TI  - Consumer-grade research companion design for reference migration.
FAU - Hopper, Grace
FAU - Lovelace, Ada
JT  - Journal of Research UX
DP  - 2026 Feb
VI  - 12
IP  - 2
PG  - 33-41
LID - 10.4242/aurascholar.nbib [doi]
AB  - A PubMed export smoke fixture.
`;

const ENW = `%0 Journal Article
%T EndNote tagged import experience for scholars
%A Hopper, Grace
%A Lovelace, Ada
%J Journal of Research UX
%D 2026
%V 12
%N 2
%P 33-41
%R 10.4242/aurascholar.enw
%U https://doi.org/10.4242/aurascholar.enw
%X An EndNote tagged export smoke fixture.
`;

describe("detectFormat", () => {
  it("sniffs each format", () => {
    expect(detectFormat(BIB)).toBe("bibtex");
    expect(detectFormat(RIS)).toBe("ris");
    expect(detectFormat(NBIB)).toBe("nbib");
    expect(detectFormat(ENW)).toBe("enw");
    expect(detectFormat('[{"id":"x","type":"article-journal"}]')).toBe("csljson");
  });

  it("routes NBIB and ENW through parseReferences", () => {
    expect(parseReferences(NBIB)[0]?.DOI).toBe("10.4242/aurascholar.nbib");
    expect(parseReferences(ENW)[0]?.DOI).toBe("10.4242/aurascholar.enw");
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

  it("accepts escaped newline separators from pasted BibTeX text", () => {
    const [item] = parseBibTeX(BIB.split("\n").join("\\n"));
    expect(item?.title).toBe("Attention Is All You Need");
    expect(item?.author?.[0]).toEqual({ family: "Vaswani", given: "Ashish" });
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

describe("parseNbib", () => {
  it("parses PubMed NBIB exports", () => {
    const [item] = parseNbib(NBIB);
    expect(item?.title).toBe("Consumer-grade research companion design for reference migration");
    expect(item?.author?.map((a) => a.family)).toEqual(["Hopper", "Lovelace"]);
    expect(item?.["container-title"]).toBe("Journal of Research UX");
    expect(item?.issued?.["date-parts"]?.[0]?.[0]).toBe(2026);
    expect(item?.volume).toBe("12");
    expect(item?.issue).toBe("2");
    expect(item?.page).toBe("33-41");
    expect(item?.DOI).toBe("10.4242/aurascholar.nbib");
    expect(item?.PMID).toBe("41000001");
    expect(item?.URL).toBe("https://pubmed.ncbi.nlm.nih.gov/41000001/");
  });
});

describe("parseEnw", () => {
  it("parses EndNote tagged exports", () => {
    const [item] = parseEnw(ENW);
    expect(item?.title).toBe("EndNote tagged import experience for scholars");
    expect(item?.author?.map((a) => a.family)).toEqual(["Hopper", "Lovelace"]);
    expect(item?.["container-title"]).toBe("Journal of Research UX");
    expect(item?.issued?.["date-parts"]?.[0]?.[0]).toBe(2026);
    expect(item?.volume).toBe("12");
    expect(item?.issue).toBe("2");
    expect(item?.page).toBe("33-41");
    expect(item?.DOI).toBe("10.4242/aurascholar.enw");
    expect(item?.URL).toBe("https://doi.org/10.4242/aurascholar.enw");
  });
});

describe("round-trip", () => {
  const item = toCslItem({
    id: "w1",
    title: "Round Trip Paper",
    doi: "10.1/abc",
    pmid: "41000001",
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
    expect(back?.PMID).toBe("41000001");
  });

  it("RIS export → import preserves core fields", () => {
    const [back] = parseReferences(toRIS([item]));
    expect(back?.title).toBe("Round Trip Paper");
    expect(back?.["container-title"]).toBe("Journal X");
    expect(back?.author?.[0]?.family).toBe("Smith");
    expect(back?.PMID).toBe("41000001");
  });

  it("rich fields survive a BibTeX round-trip", () => {
    const rich = toCslItem({
      id: "w2",
      title: "Rich Paper",
      doi: "10.1/rich",
      year: 2019,
      venueName: "J. Rich",
      type: "article",
      authorNames: ["Carol King"],
      volume: "7",
      issue: "2",
      pages: "11-20",
      publisher: "Springer",
      placePublished: "Berlin",
      issn: "1111-2222",
      language: "en",
    });
    const [back] = parseReferences(toBibTeX([rich]));
    expect(back?.volume).toBe("7");
    expect(back?.issue).toBe("2");
    expect(back?.page).toBe("11-20");
    expect(back?.publisher).toBe("Springer");
    expect(back?.["publisher-place"]).toBe("Berlin");
    expect(back?.ISSN).toBe("1111-2222");
  });
});
