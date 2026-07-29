import type { CitationGraph } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
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
  query = vi.fn(async () => [{ doi: "10.1000/reference" }]),
  loadGraph = vi.fn(async () => GRAPH as CitationGraph | null),
): {
  db: Database;
  loadGraph: typeof loadGraph;
  query: typeof query;
  source: CitationGraphPageDataSource;
} {
  const db = { query } as unknown as Database;
  return {
    db,
    loadGraph,
    query,
    source: {
      loadGraph,
      open: vi.fn(async () => ({ db, libraryId: "library-1" })),
    },
  };
}

describe("citation graph page data gateway", () => {
  it("loads graph and active in-library DOI state in one Library scope", async () => {
    const fixture = dataSource();
    const buildGraph = vi.fn();

    const snapshot = await loadCitationGraphPageSnapshot(
      "10.1000/center",
      { buildGraph },
      fixture.source,
    );

    expect(fixture.source.open).toHaveBeenCalledTimes(1);
    expect(fixture.loadGraph).toHaveBeenCalledWith("10.1000/center", {
      buildGraph,
      db: fixture.db,
      signal: undefined,
    });
    expect(fixture.query).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE library_id = \\?.*deleted_at IS NULL/s),
      ["library-1", "10.1000/center", "10.1000/reference"],
    );
    expect(snapshot.graph).toBe(GRAPH);
    expect([...snapshot.inLibraryDois]).toEqual(["10.1000/reference"]);
  });

  it("does not open a Library scope when already aborted", async () => {
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
    expect(fixture.source.open).not.toHaveBeenCalled();
  });

  it("does not query Library membership after a stale graph load", async () => {
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
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it("skips the membership query when no graph was resolved", async () => {
    const fixture = dataSource(
      vi.fn(async () => []),
      vi.fn(async () => null),
    );

    await expect(
      loadCitationGraphPageSnapshot("10.1000/missing", {}, fixture.source),
    ).resolves.toEqual({ graph: null, inLibraryDois: new Set() });
    expect(fixture.query).not.toHaveBeenCalled();
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
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it("does not project membership returned after cancellation", async () => {
    const controller = new AbortController();
    const fixture = dataSource(
      vi.fn(async () => {
        controller.abort();
        return [{ doi: "10.1000/reference" }];
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
