import { describe, expect, it } from "vitest";
import {
  parseCitationGraphBuildInput,
  parseLibraryResolveClueInput,
  parseScholarEnrichByDoiInput,
  parseScholarlySearchDiscoveryInput,
} from "./scholarly-command-input";

describe("scholarly command input boundary", () => {
  it("normalizes semantic DOI input without accepting HTTP controls", () => {
    expect(
      parseCitationGraphBuildInput({
        doi: "HTTPS://DOI.ORG/10.1000/Graph",
        requestId: "graph-1",
      }),
    ).toEqual({ doi: "10.1000/graph", requestId: "graph-1" });
    expect(parseScholarEnrichByDoiInput({ doi: "doi:10.1000/Signals", requestId: "s2-1" })).toEqual(
      {
        doi: "10.1000/signals",
        requestId: "s2-1",
      },
    );
    expect(() =>
      parseCitationGraphBuildInput({
        doi: "10.1000/graph",
        headers: { authorization: "Bearer no" },
        requestId: "graph-2",
      }),
    ).toThrow("Invalid citationGraph.build input");
  });

  it("accepts only bounded structured discovery intent", () => {
    expect(
      parseScholarlySearchDiscoveryInput({
        cursors: { openalex: { hasMore: true, page: 2 } },
        limit: 20,
        query: { author: "Ada", text: "graph methods", yearFrom: 2020, yearTo: 2026 },
        requestId: "search-1",
        sources: ["openalex", "s2"],
        sort: "citations",
      }),
    ).toMatchObject({
      cursors: { openalex: { hasMore: true, page: 2 } },
      limit: 20,
      query: { author: "Ada", text: "graph methods", yearFrom: 2020, yearTo: 2026 },
      sources: ["openalex", "s2"],
      sort: "citations",
    });
    expect(() =>
      parseScholarlySearchDiscoveryInput({
        body: "must not cross IPC",
        query: { text: "graph methods" },
        requestId: "search-2",
      }),
    ).toThrow("Invalid discovery.searchOpenSources input");
    expect(() =>
      parseScholarlySearchDiscoveryInput({
        query: { text: "graph methods" },
        requestId: "search-3",
        sources: ["s2", "s2"],
      }),
    ).toThrow("unique");
  });

  it("allows only DOI, arXiv, and title clue variants", () => {
    expect(
      parseLibraryResolveClueInput({
        clue: { arxivId: "2401.12345", kind: "arxiv" },
        requestId: "clue-1",
      }),
    ).toEqual({ clue: { arxivId: "2401.12345", kind: "arxiv" }, requestId: "clue-1" });
    expect(() =>
      parseLibraryResolveClueInput({
        clue: { kind: "url", url: "https://example.test/opaque" },
        requestId: "clue-2",
      }),
    ).toThrow("unsupported");
    expect(() =>
      parseLibraryResolveClueInput({
        clue: { kind: "title", title: "Candidate", url: "https://example.test" },
        requestId: "clue-3",
      }),
    ).toThrow("invalid");
  });
});
