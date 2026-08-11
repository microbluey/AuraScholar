import type { CitationGraph } from "@aurascholar/core";
import { describe, expect, it, vi } from "vitest";
import {
  isCitationGraph,
  loadCitationGraphByDoi,
  parseCachedCitationGraph,
  type CitationGraphCacheDataSource,
} from "./citation-graph";

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

function cache(
  entry: Awaited<ReturnType<CitationGraphCacheDataSource["getCached"]>> = null,
): CitationGraphCacheDataSource & {
  getCached: ReturnType<typeof vi.fn>;
  putCached: ReturnType<typeof vi.fn>;
} {
  return {
    getCached: vi.fn(async () => entry),
    putCached: vi.fn(async () => true),
  };
}

describe("citation graph loading", () => {
  it("validates cached graph payloads defensively", () => {
    expect(isCitationGraph(GRAPH)).toBe(true);
    expect(parseCachedCitationGraph(JSON.stringify(GRAPH))).toEqual(GRAPH);
    expect(parseCachedCitationGraph("{")).toBeNull();
    expect(parseCachedCitationGraph(JSON.stringify({ ...GRAPH, centerId: "missing" }))).toBeNull();
  });

  it("rejects graph shapes that the typed cache command would reject", () => {
    expect(
      isCitationGraph({
        ...GRAPH,
        nodes: [...GRAPH.nodes, { ...GRAPH.nodes[1]!, id: GRAPH.nodes[0]!.id }],
      }),
    ).toBe(false);
    expect(
      isCitationGraph({
        ...GRAPH,
        edges: [...GRAPH.edges, { source: "W-center", target: "missing-node" }],
      }),
    ).toBe(false);
    expect(
      isCitationGraph({
        ...GRAPH,
        nodes: GRAPH.nodes.map((node) =>
          node.id === GRAPH.centerId ? { ...node, relation: "reference" as const } : node,
        ),
      }),
    ).toBe(false);
    expect(isCitationGraph({ ...GRAPH, unexpected: true })).toBe(false);
  });

  it("reuses a fresh cache entry without rebuilding and keeps the original raw DOI", async () => {
    const source = cache({ graph: GRAPH, fetchedAt: 9_900 });
    const buildGraph = vi.fn();
    const rawDoi = " HTTPS://DOI.ORG/10.1000/CENTER ";

    await expect(
      loadCitationGraphByDoi(rawDoi, {
        buildGraph,
        cache: source,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(buildGraph).not.toHaveBeenCalled();
    expect(source.getCached).toHaveBeenCalledWith(rawDoi);
    expect(source.putCached).not.toHaveBeenCalled();
  });

  it("rebuilds an invalid cache entry and stores it under the normalized DOI", async () => {
    const source = cache({ graph: {} as CitationGraph, fetchedAt: 9_900 });
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph,
        cache: source,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(buildGraph).toHaveBeenCalledWith("10.1000/center", undefined);
    expect(source.putCached).toHaveBeenCalledWith("10.1000/center", GRAPH);
  });

  it("rebuilds a cache entry at the TTL boundary", async () => {
    const source = cache({ graph: GRAPH, fetchedAt: 9_900 });
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph,
        cache: source,
        cacheTtlMs: 100,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(buildGraph).toHaveBeenCalledOnce();
    expect(source.putCached).toHaveBeenCalledWith("10.1000/center", GRAPH);
  });

  it("delegates legacy raw-key migration to the main-process cache command", async () => {
    const legacyRawDoi = "HTTPS://DOI.ORG/10.1000/CENTER";
    const source = cache({ graph: GRAPH, fetchedAt: 9_900 });
    const buildGraph = vi.fn();

    await expect(
      loadCitationGraphByDoi(legacyRawDoi, {
        buildGraph,
        cache: source,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(source.getCached).toHaveBeenCalledWith(legacyRawDoi);
    expect(buildGraph).not.toHaveBeenCalled();
    expect(source.putCached).not.toHaveBeenCalled();
  });

  it("skips cache reads for force refreshes but stores the refreshed normalized graph", async () => {
    const source = cache({ graph: GRAPH, fetchedAt: 9_900 });
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(
      loadCitationGraphByDoi("HTTPS://DOI.ORG/10.1000/CENTER", {
        buildGraph,
        cache: source,
        forceRefresh: true,
      }),
    ).resolves.toEqual(GRAPH);

    expect(source.getCached).not.toHaveBeenCalled();
    expect(source.putCached).toHaveBeenCalledWith("10.1000/center", GRAPH);
  });

  it("uses typed cache commands by default", async () => {
    const command = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    command.mockResolvedValueOnce({ entry: null }).mockResolvedValueOnce({ stored: true });

    await expect(
      loadCitationGraphByDoi("HTTPS://DOI.ORG/10.1000/CENTER", {
        buildGraph: vi.fn(async () => GRAPH),
      }),
    ).resolves.toEqual(GRAPH);

    expect(command).toHaveBeenNthCalledWith(1, "citationGraph.getCached", {
      doi: "HTTPS://DOI.ORG/10.1000/CENTER",
    });
    expect(command).toHaveBeenNthCalledWith(2, "citationGraph.putCached", {
      doi: "10.1000/center",
      graph: GRAPH,
    });
  });

  it("builds uncached graphs through the semantic main command", async () => {
    const command = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    command
      .mockResolvedValueOnce({ entry: null })
      .mockResolvedValueOnce({ graph: GRAPH })
      .mockResolvedValueOnce({ stored: true });

    await expect(loadCitationGraphByDoi("10.1000/center")).resolves.toEqual(GRAPH);

    expect(command).toHaveBeenNthCalledWith(2, "citationGraph.build", {
      doi: "10.1000/center",
      requestId: expect.any(String),
    });
  });

  it("does not write a graph after its request is aborted", async () => {
    const source = cache();
    const controller = new AbortController();
    const buildGraph = vi.fn(async () => {
      controller.abort();
      return GRAPH;
    });

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph,
        cache: source,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(source.putCached).not.toHaveBeenCalled();
  });

  it("does not project a cache response returned after cancellation", async () => {
    const controller = new AbortController();
    const source = cache();
    source.getCached.mockImplementationOnce(async () => {
      controller.abort();
      return { graph: GRAPH, fetchedAt: Date.now() };
    });

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        cache: source,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
