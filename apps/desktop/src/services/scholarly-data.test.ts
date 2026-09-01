import type { CitationGraph } from "@aurascholar/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildScholarlyCitationGraph,
  enrichScholarByDoi,
  resolveLibraryScholarlyClue,
  searchScholarlyOpenSources,
} from "./scholarly-data";

const command = vi.fn();

const GRAPH: CitationGraph = {
  centerId: "W-center",
  truncated: false,
  nodes: [
    {
      id: "W-center",
      title: "Center",
      citedByCount: 10,
      doi: "10.1000/center",
      relation: "center",
    },
    {
      id: "W-reference",
      title: "Reference",
      citedByCount: 5,
      doi: "10.1000/reference",
      relation: "reference",
    },
  ],
  edges: [{ source: "W-center", target: "W-reference" }],
};

const EMPTY_OPENALEX_REPORT = {
  cursors: { openalex: { hasMore: false, page: 1 } },
  results: [],
  sources: { openalex: { count: 0, source: "openalex", status: "empty" } },
};

const EMPTY_ALL_SOURCES_REPORT = {
  cursors: {
    arxiv: { hasMore: false, page: 1 },
    crossref: { hasMore: false, page: 1 },
    openalex: { hasMore: false, page: 1 },
    s2: { hasMore: false, page: 1 },
  },
  results: [],
  sources: {
    arxiv: { count: 0, source: "arxiv", status: "empty" },
    crossref: { count: 0, source: "crossref", status: "empty" },
    openalex: { count: 0, source: "openalex", status: "empty" },
    s2: { count: 0, source: "s2", status: "empty" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { aura: { data: { command } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scholarly typed command client", () => {
  it("sends only semantic discovery input", async () => {
    command.mockResolvedValueOnce({ report: { ...EMPTY_OPENALEX_REPORT } });

    await expect(
      searchScholarlyOpenSources({
        limit: 20,
        query: { text: "graph neural networks" },
        sources: ["openalex"],
        sort: "relevance",
      }),
    ).resolves.toEqual({ report: EMPTY_OPENALEX_REPORT });

    expect(command).toHaveBeenCalledWith(
      "discovery.searchOpenSources",
      expect.objectContaining({
        limit: 20,
        query: { text: "graph neural networks" },
        requestId: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
        sources: ["openalex"],
        sort: "relevance",
      }),
    );
    const [, input] = command.mock.calls[0]!;
    expect(input).not.toHaveProperty("url");
    expect(input).not.toHaveProperty("headers");
    expect(input).not.toHaveProperty("body");
  });

  it("routes graph, enrichment, and clue intents through their named main commands", async () => {
    command
      .mockResolvedValueOnce({ graph: null })
      .mockResolvedValueOnce({ enrichment: null })
      .mockResolvedValueOnce({ resolved: null });

    await expect(buildScholarlyCitationGraph({ doi: "10.1000/graph" })).resolves.toEqual({
      graph: null,
    });
    await expect(enrichScholarByDoi({ doi: "10.1000/s2" })).resolves.toEqual({ enrichment: null });
    await expect(
      resolveLibraryScholarlyClue({ clue: { kind: "title", title: "A paper title" } }),
    ).resolves.toEqual({ resolved: null });

    expect(command.mock.calls.map(([name]) => name)).toEqual([
      "citationGraph.build",
      "scholar.enrichByDoi",
      "library.resolveClue",
    ]);
  });

  it("decodes every non-graph scholarly response at the renderer gateway", async () => {
    command
      .mockResolvedValueOnce({ report: EMPTY_ALL_SOURCES_REPORT })
      .mockResolvedValueOnce({ enrichment: { citationCount: 3, tldr: "summary" } })
      .mockResolvedValueOnce({
        resolved: {
          confidence: 1,
          work: { authors: [], source: "crossref", title: "Resolved" },
        },
      });

    const report = await searchScholarlyOpenSources({ query: { text: "all sources" } });
    const enrichment = await enrichScholarByDoi({ doi: "10.1000/enrichment" });
    const resolved = await resolveLibraryScholarlyClue({
      clue: { kind: "title", title: "A title" },
    });

    expect(report.report).toEqual(EMPTY_ALL_SOURCES_REPORT);
    expect(enrichment.enrichment).toEqual({ citationCount: 3, tldr: "summary" });
    expect(resolved.resolved?.work.title).toBe("Resolved");
  });

  it("fails closed on malformed non-graph scholarly responses", async () => {
    command
      .mockResolvedValueOnce({ report: EMPTY_OPENALEX_REPORT, unexpected: true })
      .mockResolvedValueOnce({ enrichment: [] })
      .mockResolvedValueOnce({ resolved: { confidence: 2, work: null } });

    await expect(
      searchScholarlyOpenSources({ query: { text: "malformed" }, sources: ["openalex"] }),
    ).rejects.toThrow("Discovery search result is invalid");
    await expect(enrichScholarByDoi({ doi: "10.1000/malformed" })).rejects.toThrow(
      "Semantic Scholar enrichment",
    );
    await expect(
      resolveLibraryScholarlyClue({ clue: { kind: "title", title: "malformed" } }),
    ).rejects.toThrow("Resolved scholarly work confidence is invalid");
  });

  it("deep-clones a valid graph returned by the default build command", async () => {
    command.mockResolvedValueOnce({ graph: GRAPH });

    const result = await buildScholarlyCitationGraph({ doi: "10.1000/graph" });

    expect(result).toEqual({ graph: GRAPH });
    expect(result.graph).not.toBe(GRAPH);
    expect(result.graph?.nodes).not.toBe(GRAPH.nodes);
    expect(result.graph?.nodes[0]).not.toBe(GRAPH.nodes[0]);
    expect(result.graph?.edges).not.toBe(GRAPH.edges);
  });

  it("fails closed when the default build command returns a malformed acknowledgement", async () => {
    command.mockResolvedValueOnce({ graph: null, unexpected: true });

    await expect(buildScholarlyCitationGraph({ doi: "10.1000/malformed" })).rejects.toThrow(
      "Citation graph build result is invalid",
    );
  });

  it("cancels the matching main run and never projects a late response", async () => {
    const controller = new AbortController();
    let complete: ((value: { enrichment: null }) => void) | undefined;
    command.mockImplementationOnce(
      () =>
        new Promise<{ enrichment: null }>((resolve) => {
          complete = resolve;
        }),
    );
    command.mockResolvedValueOnce({ cancelled: true });

    const pending = enrichScholarByDoi({ doi: "10.1000/cancel" }, controller.signal);
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    controller.abort();
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    expect(command.mock.calls[1]![0]).toBe("scholarly.cancelRun");
    const requestId = (command.mock.calls[0]![1] as { requestId: string }).requestId;
    expect(command.mock.calls[1]![1]).toEqual({ requestId });

    complete?.({ enrichment: null });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
