import { describe, expect, it } from "vitest";
import { normalizeResearchScholarMeta } from "./research-browser-scholar-meta";

describe("research browser scholar metadata", () => {
  it("normalizes citation identifiers and resolves a relative PDF URL", () => {
    expect(
      normalizeResearchScholarMeta(
        {
          citation_doi: ["doi:10.1000/Example.1."],
          citation_pdf_url: ["/paper.pdf"],
          citation_title: ["  Example paper  "],
        },
        "https://example.edu/record/1",
      ),
    ).toEqual({
      doi: "10.1000/example.1",
      pdfUrl: "https://example.edu/paper.pdf",
      sourceUrl: "https://example.edu/record/1",
      title: "Example paper",
    });
  });

  it("derives arXiv ids from supported URLs and ignores malformed optional metadata", () => {
    expect(
      normalizeResearchScholarMeta(
        { citation_pdf_url: ["http://[invalid"] },
        "https://arxiv.org/pdf/2401.01234.pdf",
      ),
    ).toEqual({
      arxivId: "2401.01234",
      sourceUrl: "https://arxiv.org/pdf/2401.01234.pdf",
    });
    expect(normalizeResearchScholarMeta({}, "https://example.edu/paper")).toBeUndefined();
  });
});
