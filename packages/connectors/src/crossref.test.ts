import { describe, expect, it } from "vitest";
import { StubHttpClient, jsonResponse } from "@aurascholar/platform";
import { crossrefByDoi } from "./crossref";
import type { ConnectorContext } from "./client";

function ctxWith(http: StubHttpClient): ConnectorContext {
  return { http, mailto: "test@example.com" };
}

const MESSAGE = {
  DOI: "10.1145/Xyz",
  title: ["A Structured Paper"],
  abstract: "<jats:p>We study <jats:italic>graphs</jats:italic>.</jats:p>",
  author: [
    { given: "Ada", family: "Lovelace", ORCID: "https://orcid.org/0000-0002-1825-0097" },
    { given: "Alan", family: "Turing" },
  ],
  editor: [{ given: "Grace", family: "Hopper" }],
  "container-title": ["Journal of Things"],
  type: "journal-article",
  issued: { "date-parts": [[2021, 5, 3]] },
  volume: "12",
  issue: "4",
  page: "100-115",
  publisher: "ACM",
  "publisher-location": "New York, NY",
  ISSN: ["1234-5678"],
  ISBN: ["978-1-4503"],
  language: "en",
  subject: ["Graph Theory", "Algorithms"],
  URL: "https://doi.org/10.1145/xyz",
};

describe("crossrefByDoi → normalizeCrossref", () => {
  it("extracts rich bibliographic fields", async () => {
    const http = new StubHttpClient();
    http.on(/api\.crossref\.org\/works\//, () => jsonResponse(200, { message: MESSAGE }));
    const w = (await crossrefByDoi(ctxWith(http), "10.1145/xyz"))!;

    expect(w.doi).toBe("10.1145/xyz"); // lowercased
    expect(w.volume).toBe("12");
    expect(w.issue).toBe("4");
    expect(w.pages).toBe("100-115");
    expect(w.publisher).toBe("ACM");
    expect(w.placePublished).toBe("New York, NY");
    expect(w.issn).toBe("1234-5678");
    expect(w.isbn).toBe("978-1-4503");
    expect(w.language).toBe("en");
    expect(w.keywords).toEqual(["Graph Theory", "Algorithms"]);
    expect(w.abstract).toBe("We study graphs ."); // JATS stripped
  });

  it("tags editors with the editor role after authors", async () => {
    const http = new StubHttpClient();
    http.on(/crossref/, () => jsonResponse(200, { message: MESSAGE }));
    const w = (await crossrefByDoi(ctxWith(http), "10.1145/xyz"))!;
    const authors = w.authors.filter((a) => a.role === "author");
    const editors = w.authors.filter((a) => a.role === "editor");
    expect(authors).toHaveLength(2);
    expect(editors).toHaveLength(1);
    expect(editors[0]?.displayName).toBe("Grace Hopper");
    // editor position comes after the two authors
    expect(editors[0]?.position).toBe(2);
    expect(authors[0]?.orcid).toBe("0000-0002-1825-0097");
  });
});
