import type { CitationGraph } from "@aurascholar/core";
import { describe, expect, it, vi } from "vitest";
import {
  loadCitationGraphPageSnapshot,
  type CitationGraphPageDataSource,
} from "./citation-graph-page-data";

const GRAPH: CitationGraph = {
  centerId: "center",
  truncated: false,
  nodes: [
    {
      id: "center",
      title: "Center",
      citedByCount: 4,
      doi: "10.1000/center",
      relation: "center",
    },
    {
      id: "reference",
      title: "Reference",
      citedByCount: 2,
      doi: "10.1000/reference",
      relation: "reference",
    },
    {
      id: "duplicate",
      title: "Duplicate DOI",
      citedByCount: 1,
      doi: "10.1000/reference",
      relation: "citer",
    },
  ],
  edges: [{ source: "center", target: "reference" }],
};

function dataSource(
  getActiveLibraryDois = vi.fn(async () => ["10.1000/reference"]),
  loadGraph = vi.fn(async () => GRAPH as CitationGraph | null),
): {
  getActiveLibraryDois: typeof getActiveLibraryDois;
  loadGraph: typeof loadGraph;
  source: CitationGraphPageDataSource;
} {
  return {
    getActiveLibraryDois,
    loadGraph,
    source: { getActiveLibraryDois, loadGraph },
  };
}

describe("citation graph page data gateway", () => {
  it("loads graph and active local Library DOI membership through the injected source", async () => {
    const fixture = dataSource();
    const buildGraph = vi.fn();

    const snapshot = await loadCitationGraphPageSnapshot(
      "10.1000/center",
      { buildGraph },
      fixture.source,
    );

    expect(fixture.loadGraph).toHaveBeenCalledWith("10.1000/center", {
      buildGraph,
      signal: undefined,
    });
    expect(fixture.getActiveLibraryDois).toHaveBeenCalledWith([
      "10.1000/center",
      "10.1000/reference",
    ]);
    expect(snapshot.graph).toBe(GRAPH);
    expect([...snapshot.inLibraryDois]).toEqual(["10.1000/reference"]);
  });

  it("uses the typed active-Library DOI command in the production source", async () => {
    const command = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    command
      .mockResolvedValueOnce({ entry: null })
      .mockResolvedValueOnce({ stored: true })
      .mockResolvedValueOnce({
        dois: ["10.1000/reference"],
        libraryId: "library:active",
      });

    await expect(
      loadCitationGraphPageSnapshot("10.1000/center", {
        buildGraph: vi.fn(async () => GRAPH),
      }),
    ).resolves.toEqual({ graph: GRAPH, inLibraryDois: new Set(["10.1000/reference"]) });
    expect(command).toHaveBeenNthCalledWith(3, "citationGraph.getActiveLibraryDois", {
      dois: ["10.1000/center", "10.1000/reference"],
    });
  });

  it("fails closed when the default active-Library DOI command returns a malformed acknowledgement", async () => {
    const command = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    command
      .mockResolvedValueOnce({ entry: null })
      .mockResolvedValueOnce({ stored: true })
      .mockResolvedValueOnce({
        dois: ["10.1000/reference"],
        libraryId: "library:active",
        unexpected: true,
      });

    await expect(
      loadCitationGraphPageSnapshot("10.1000/center", {
        buildGraph: vi.fn(async () => GRAPH),
      }),
    ).rejects.toThrow("Citation graph active Library DOI result is invalid");
  });

  it("rejects active-Library DOI membership outside the requested graph DOI set", async () => {
    const command = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    command
      .mockResolvedValueOnce({ entry: null })
      .mockResolvedValueOnce({ stored: true })
      .mockResolvedValueOnce({
        dois: ["10.1000/not-requested"],
        libraryId: "library:active",
      });

    await expect(
      loadCitationGraphPageSnapshot("10.1000/center", {
        buildGraph: vi.fn(async () => GRAPH),
      }),
    ).rejects.toThrow("outside the requested set");
  });

  it("normalizes DOI variants for membership lookup and maps active results back to graph nodes", async () => {
    const graphWithVariants: CitationGraph = {
      ...GRAPH,
      nodes: [
        ...GRAPH.nodes,
        {
          ...GRAPH.nodes[1]!,
          id: "reference-variant",
          doi: "HTTPS://DOI.ORG/10.1000/REFERENCE",
        },
      ],
    };
    const fixture = dataSource(
      vi.fn(async () => ["10.1000/reference"]),
      vi.fn(async () => graphWithVariants),
    );

    const snapshot = await loadCitationGraphPageSnapshot("10.1000/center", {}, fixture.source);

    expect(fixture.getActiveLibraryDois).toHaveBeenCalledWith([
      "10.1000/center",
      "10.1000/reference",
    ]);
    expect([...snapshot.inLibraryDois]).toEqual([
      "10.1000/reference",
      "HTTPS://DOI.ORG/10.1000/REFERENCE",
    ]);
  });

  it("does not load a graph when already aborted", async () => {
    const fixture = dataSource();
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadCitationGraphPageSnapshot(
        "10.1000/center",
        { signal: controller.signal },
        fixture.source,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.loadGraph).not.toHaveBeenCalled();
  });

  it("does not query active Library membership after a stale graph load", async () => {
    const controller = new AbortController();
    const fixture = dataSource(
      vi.fn(async () => []),
      vi.fn(async () => {
        controller.abort();
        return GRAPH;
      }),
    );

    await expect(
      loadCitationGraphPageSnapshot(
        "10.1000/center",
        { signal: controller.signal },
        fixture.source,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.getActiveLibraryDois).not.toHaveBeenCalled();
  });

  it("skips the membership query when no graph was resolved", async () => {
    const fixture = dataSource(
      vi.fn(async () => []),
      vi.fn(async () => null),
    );

    await expect(
      loadCitationGraphPageSnapshot("10.1000/missing", {}, fixture.source),
    ).resolves.toEqual({ graph: null, inLibraryDois: new Set() });
    expect(fixture.getActiveLibraryDois).not.toHaveBeenCalled();
  });

  it("skips the membership query when graph nodes have no usable DOI", async () => {
    const graphWithoutDois: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node, index) => ({
        ...node,
        doi: index === 0 ? undefined : "   ",
      })),
    };
    const fixture = dataSource(
      vi.fn(async () => []),
      vi.fn(async () => graphWithoutDois),
    );

    await expect(
      loadCitationGraphPageSnapshot("10.1000/no-node-doi", {}, fixture.source),
    ).resolves.toEqual({ graph: graphWithoutDois, inLibraryDois: new Set() });
    expect(fixture.getActiveLibraryDois).not.toHaveBeenCalled();
  });

  it("does not project active membership returned after cancellation", async () => {
    const controller = new AbortController();
    const fixture = dataSource(
      vi.fn(async () => {
        controller.abort();
        return ["10.1000/reference"];
      }),
    );

    await expect(
      loadCitationGraphPageSnapshot(
        "10.1000/center",
        { signal: controller.signal },
        fixture.source,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
