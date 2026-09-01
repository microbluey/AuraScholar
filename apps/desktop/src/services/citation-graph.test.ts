import type { CitationGraph } from "@aurascholar/core";
import { describe, expect, it, vi } from "vitest";
import {
  isCitationGraph,
  isFreshCitationGraphCacheEntry,
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

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
  it("treats only finite, non-future timestamps inside the TTL as fresh", () => {
    const entry = { cacheVersion: 1, fetchedAt: 1_000, graph: GRAPH };
    expect(isFreshCitationGraphCacheEntry(entry, 1_000, 100)).toBe(true);
    expect(isFreshCitationGraphCacheEntry(entry, 1_099, 100)).toBe(true);
    expect(isFreshCitationGraphCacheEntry(entry, 1_100, 100)).toBe(false);
    expect(isFreshCitationGraphCacheEntry({ ...entry, fetchedAt: 1_001 }, 1_000, 100)).toBe(false);
    expect(
      isFreshCitationGraphCacheEntry({ ...entry, fetchedAt: Number.MAX_SAFE_INTEGER }, 1_000, 100),
    ).toBe(false);
    expect(isFreshCitationGraphCacheEntry(entry, Number.NaN, 100)).toBe(false);
    expect(isFreshCitationGraphCacheEntry(entry, 1_000, 0)).toBe(false);
    expect(isFreshCitationGraphCacheEntry(entry, 1_000, Number.POSITIVE_INFINITY)).toBe(false);
  });

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
    const source = cache({ cacheVersion: 1, graph: GRAPH, fetchedAt: 9_900 });
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
    const source = cache({ cacheVersion: 1, graph: {} as CitationGraph, fetchedAt: 9_900 });
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph,
        cache: source,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(buildGraph).toHaveBeenCalledWith("10.1000/center", undefined);
    expect(source.putCached).toHaveBeenCalledWith("10.1000/center", GRAPH, 1);
  });

  it("rebuilds a cache entry at the TTL boundary", async () => {
    const source = cache({ cacheVersion: 2, graph: GRAPH, fetchedAt: 9_900 });
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
    expect(source.putCached).toHaveBeenCalledWith("10.1000/center", GRAPH, 2);
  });

  it("rebuilds a future cache entry instead of treating it as permanently fresh", async () => {
    const source = cache({ cacheVersion: 3, graph: GRAPH, fetchedAt: 10_001 });
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
    expect(source.putCached).toHaveBeenCalledWith("10.1000/center", GRAPH, 3);
  });

  it("does not reuse a custom cache graph bound to another DOI", async () => {
    const mismatchedGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, doi: "10.1000/other" } : node,
      ),
    };
    const source = cache({ cacheVersion: 4, graph: mismatchedGraph, fetchedAt: 9_900 });
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph,
        cache: source,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(buildGraph).toHaveBeenCalledOnce();
    expect(source.putCached).toHaveBeenCalledWith("10.1000/center", GRAPH, 4);
  });

  it("keeps an unbound build result visible without persisting it", async () => {
    const source = cache();
    const unboundGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, doi: undefined } : node,
      ),
    };
    const buildGraph = vi.fn(async () => unboundGraph);

    await expect(
      loadCitationGraphByDoi("10.1000/center", { buildGraph, cache: source }),
    ).resolves.toMatchObject({ centerId: GRAPH.centerId });
    expect(source.putCached).not.toHaveBeenCalled();
  });

  it("rejects a build result whose explicit center DOI names another work", async () => {
    const source = cache();
    const mismatchedGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, doi: "10.1000/other" } : node,
      ),
    };
    const buildGraph = vi.fn(async () => mismatchedGraph);

    await expect(
      loadCitationGraphByDoi("10.1000/center", { buildGraph, cache: source }),
    ).resolves.toBeNull();
    expect(source.putCached).not.toHaveBeenCalled();
  });

  it("delegates legacy raw-key migration to the main-process cache command", async () => {
    const legacyRawDoi = "HTTPS://DOI.ORG/10.1000/CENTER";
    const source = cache({ cacheVersion: 5, graph: GRAPH, fetchedAt: 9_900 });
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

  it("snapshots the cache before force refresh and stores the refreshed normalized graph", async () => {
    const source = cache({ cacheVersion: 6, graph: GRAPH, fetchedAt: 9_900 });
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(
      loadCitationGraphByDoi("HTTPS://DOI.ORG/10.1000/CENTER", {
        buildGraph,
        cache: source,
        forceRefresh: true,
      }),
    ).resolves.toEqual(GRAPH);

    expect(source.getCached).toHaveBeenCalledWith("HTTPS://DOI.ORG/10.1000/CENTER");
    expect(source.putCached).toHaveBeenCalledWith("10.1000/center", GRAPH, 6);
  });

  it("uses the cache snapshot as a CAS token for concurrent force refreshes", async () => {
    const slowGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, title: "Slow rebuild" } : node,
      ),
    };
    const fastGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, title: "Fast refresh" } : node,
      ),
    };
    let entry: Awaited<ReturnType<CitationGraphCacheDataSource["getCached"]>> = {
      cacheVersion: 7,
      fetchedAt: 100,
      graph: GRAPH,
    };
    const source = {
      getCached: vi.fn(async () => entry),
      putCached: vi.fn(
        async (_doi: string, graph: CitationGraph, expectedCacheVersion?: number | null) => {
          const token = expectedCacheVersion ?? null;
          if (!entry || entry.cacheVersion !== token) return false;
          entry = { ...entry, cacheVersion: entry.cacheVersion + 1, graph };
          return true;
        },
      ),
    } satisfies CitationGraphCacheDataSource;
    const builds: Array<Deferred<CitationGraph>> = [];
    const buildsReady = deferred<void>();
    const buildGraph = vi.fn(() => {
      const build = deferred<CitationGraph>();
      builds.push(build);
      if (builds.length === 2) buildsReady.resolve();
      return build.promise;
    });

    const slowRequest = loadCitationGraphByDoi("10.1000/center", {
      buildGraph,
      cache: source,
      forceRefresh: true,
      now: () => 10_000,
    });
    const fastRequest = loadCitationGraphByDoi("10.1000/center", {
      buildGraph,
      cache: source,
      forceRefresh: true,
      now: () => 10_000,
    });
    await buildsReady.promise;

    expect(source.getCached).toHaveBeenCalledTimes(2);
    builds[1]!.resolve(fastGraph);
    await expect(fastRequest).resolves.toBe(fastGraph);
    builds[0]!.resolve(slowGraph);
    await expect(slowRequest).resolves.toBe(slowGraph);

    expect(source.putCached).toHaveBeenNthCalledWith(1, "10.1000/center", fastGraph, 7);
    expect(source.putCached).toHaveBeenNthCalledWith(2, "10.1000/center", slowGraph, 7);
    expect(entry).toEqual({ cacheVersion: 8, fetchedAt: 100, graph: fastGraph });
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
      expectedCacheVersion: null,
      graph: GRAPH,
    });
  });

  it("fails closed when the default cache read returns a malformed acknowledgement", async () => {
    const command = vi.fn().mockResolvedValue({ entry: null, unexpected: true });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(loadCitationGraphByDoi("10.1000/center", { buildGraph })).rejects.toThrow(
      "Citation graph cache result is invalid",
    );

    expect(buildGraph).not.toHaveBeenCalled();
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("deep-clones a valid graph returned by the default cache command", async () => {
    const command = vi.fn().mockResolvedValue({
      entry: { cacheVersion: 9, fetchedAt: 9_900, graph: GRAPH },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    const buildGraph = vi.fn();

    const result = await loadCitationGraphByDoi("10.1000/center", {
      buildGraph,
      now: () => 10_000,
    });

    if (!result) throw new Error("expected a cached citation graph");
    expect(result).toEqual(GRAPH);
    expect(result).not.toBe(GRAPH);
    expect(result.nodes).not.toBe(GRAPH.nodes);
    expect(result.nodes[0]).not.toBe(GRAPH.nodes[0]);
    expect(result.edges).not.toBe(GRAPH.edges);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("preserves the graph result when the default cache write reports stored false", async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({ entry: null })
      .mockResolvedValueOnce({ stored: false });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph,
        forceRefresh: true,
      }),
    ).resolves.toBe(GRAPH);

    expect(buildGraph).toHaveBeenCalledWith("10.1000/center", undefined);
    expect(command).toHaveBeenCalledWith("citationGraph.putCached", {
      doi: "10.1000/center",
      expectedCacheVersion: null,
      graph: GRAPH,
    });
  });

  it("fails closed when the default cache write returns a malformed acknowledgement", async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({ entry: null })
      .mockResolvedValueOnce({ stored: "true" });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph: vi.fn(async () => GRAPH),
        forceRefresh: true,
      }),
    ).rejects.toThrow("Citation graph cache write result is invalid");
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
      return { cacheVersion: 10, graph: GRAPH, fetchedAt: Date.now() };
    });

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        cache: source,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
