import { describe, expect, it } from "vitest";
import { StubHttpClient, jsonResponse } from "@aurascholar/platform";
import { s2ByDoi, s2SearchByTitle, normalizeS2, type S2Paper } from "./semanticscholar";
import type { ConnectorContext } from "./client";

function ctxWith(http: StubHttpClient): ConnectorContext {
  return { http, mailto: "test@example.com" };
}

const PAPER: S2Paper = {
  paperId: "abc123",
  externalIds: { DOI: "10.1/XYZ", ArXiv: "1706.03762", PubMed: "999" },
  title: "Attention Is All You Need",
  abstract: "The dominant sequence transduction models...",
  year: 2017,
  publicationDate: "2017-06-12",
  venue: "NeurIPS",
  publicationTypes: ["Conference"],
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
};

describe("s2ByDoi", () => {
  it("requests the DOI: id form (url-encoded) and returns the paper", async () => {
    const http = new StubHttpClient();
    http.on(/graph\/v1\/paper\/DOI%3A/, () => jsonResponse(200, PAPER));
    const p = await s2ByDoi(ctxWith(http), "10.1/XYZ");
    expect(p?.paperId).toBe("abc123");
  });

  it("returns null on 404", async () => {
    const http = new StubHttpClient();
    http.on(/graph\/v1\/paper\/DOI%3A/, () => jsonResponse(404, { error: "not found" }));
    const p = await s2ByDoi(ctxWith(http), "10.1/missing");
    expect(p).toBeNull();
  });
});

describe("s2SearchByTitle", () => {
  it("unwraps the data array", async () => {
    const http = new StubHttpClient();
    http.on(/paper\/search/, () => jsonResponse(200, { data: [PAPER] }));
    const results = await s2SearchByTitle(ctxWith(http), "attention");
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toContain("Attention");
  });
});

describe("normalizeS2", () => {
  it("maps external ids, venue type, and authors", () => {
    const w = normalizeS2(PAPER);
    expect(w.doi).toBe("10.1/xyz"); // lowercased
    expect(w.arxivId).toBe("1706.03762");
    expect(w.pmid).toBe("999");
    expect(w.s2Id).toBe("abc123");
    expect(w.venueType).toBe("conference");
    expect(w.source).toBe("s2");
    expect(w.authors.map((a) => a.displayName)).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
  });

  it("defaults venue type to journal", () => {
    const w = normalizeS2({ ...PAPER, publicationTypes: ["JournalArticle"] });
    expect(w.venueType).toBe("journal");
  });
});
