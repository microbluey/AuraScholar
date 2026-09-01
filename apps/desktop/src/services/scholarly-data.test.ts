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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { aura: { data: { command } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scholarly typed command client", () => {
  it("sends only semantic discovery input", async () => {
    command.mockResolvedValueOnce({ report: { cursors: {}, results: [], sources: {} } });

    await expect(
      searchScholarlyOpenSources({
        limit: 20,
        query: { text: "graph neural networks" },
        sources: ["openalex"],
        sort: "relevance",
      }),
    ).resolves.toEqual({ report: { cursors: {}, results: [], sources: {} } });

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
