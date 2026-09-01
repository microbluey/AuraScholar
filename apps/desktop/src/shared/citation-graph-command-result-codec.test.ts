import type { CitationGraph, GraphNode } from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import type {
  CitationGraphCacheEntry,
  CitationGraphGetActiveLibraryDoisCommandResult,
} from "../../electron/citation-graph-command-contract";
import type { LibraryScopeToken } from "../../electron/library-read-command-contract";
import {
  decodeCitationGraph,
  decodeCitationGraphBuildResult,
  decodeCitationGraphGetActiveLibraryDoisResult,
  decodeCitationGraphGetCachedResult,
  decodeCitationGraphPutCachedResult,
} from "./citation-graph-command-result-codec";
import {
  MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS,
  MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES,
  MAX_CITATION_GRAPH_DOI_BYTES,
  MAX_CITATION_GRAPH_LIBRARY_ID_BYTES,
  MAX_CITATION_GRAPH_NODE_TEXT_BYTES,
  MAX_CITATION_GRAPH_NODES,
  citationGraphUtf8ByteLength,
} from "./citation-graph-limits";

const GRAPH: CitationGraph = {
  centerId: "W-center",
  nodes: [
    {
      id: "W-center",
      title: "Center",
      citedByCount: 10,
      doi: "10.1000/center",
      venue: "Journal",
      firstAuthor: "Researcher",
      year: 2025,
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
  truncated: false,
};

function validCacheEntry(): CitationGraphCacheEntry {
  return { cacheVersion: 1, fetchedAt: 0, graph: GRAPH };
}

function expectInvalid(decoder: () => unknown): void {
  expect(decoder).toThrow();
}

describe("Citation Graph command-result codec", () => {
  it("accepts nullable/exact envelopes and deeply clones valid graphs", () => {
    expect(decodeCitationGraphBuildResult({ graph: null })).toEqual({ graph: null });
    const nullPrototypeResult = Object.create(null) as { graph: null };
    nullPrototypeResult.graph = null;
    expect(decodeCitationGraphBuildResult(nullPrototypeResult)).toEqual({ graph: null });

    const decodedBuild = decodeCitationGraphBuildResult({ graph: GRAPH });
    expect(decodedBuild).toEqual({ graph: GRAPH });
    expect(decodedBuild.graph).not.toBe(GRAPH);
    expect(decodedBuild.graph?.nodes).not.toBe(GRAPH.nodes);
    expect(decodedBuild.graph?.nodes[0]).not.toBe(GRAPH.nodes[0]);
    expect(decodedBuild.graph?.edges).not.toBe(GRAPH.edges);
    expect(decodedBuild.graph?.edges[0]).not.toBe(GRAPH.edges[0]);

    const sourceEntry = validCacheEntry();
    const decodedCache = decodeCitationGraphGetCachedResult({ entry: sourceEntry });
    expect(decodedCache.entry).toEqual(sourceEntry);
    expect(decodedCache.entry).not.toBe(sourceEntry);
    expect(decodedCache.entry?.graph).not.toBe(GRAPH);
    expect(decodedCache.entry?.graph.nodes).not.toBe(sourceEntry.graph.nodes);
    expect(decodedCache.entry?.graph.edges).not.toBe(sourceEntry.graph.edges);

    const inheritedNode = Object.create({ doi: "10.1000/inherited" }) as Record<string, unknown>;
    Object.assign(inheritedNode, {
      id: "W-center",
      title: "Center",
      citedByCount: 10,
      relation: "center",
    });
    const graphWithInheritedOptional = decodeCitationGraph({
      ...GRAPH,
      nodes: [inheritedNode, GRAPH.nodes[1]],
    });
    expect(graphWithInheritedOptional.nodes[0]).not.toHaveProperty("doi");
  });

  it("rejects malformed result envelopes and acknowledgements", () => {
    const invalidBuild = [
      {},
      { graph: null, extra: true },
      { graph: undefined },
      { graph: "not-a-graph" },
    ];
    for (const value of invalidBuild) expectInvalid(() => decodeCitationGraphBuildResult(value));

    const invalidCache = [
      {},
      { entry: null, extra: true },
      { entry: undefined },
      { entry: { fetchedAt: 0, graph: GRAPH } },
      {
        entry: { ...validCacheEntry(), extra: true },
      },
    ];
    for (const value of invalidCache)
      expectInvalid(() => decodeCitationGraphGetCachedResult(value));

    expect(decodeCitationGraphPutCachedResult({ stored: true })).toEqual({ stored: true });
    expect(decodeCitationGraphPutCachedResult({ stored: false })).toEqual({ stored: false });
    for (const value of [{}, { stored: 1 }, { stored: "true" }, { stored: true, extra: true }]) {
      expectInvalid(() => decodeCitationGraphPutCachedResult(value));
    }
  });

  it("validates graph topology, exact fields, dense arrays, and scalar bounds", () => {
    const sparseNodes = [...GRAPH.nodes] as GraphNode[];
    delete sparseNodes[1];
    const sparseEdges = [...GRAPH.edges];
    delete sparseEdges[0];
    const invalidGraphs: unknown[] = [
      {},
      { ...GRAPH, extra: true },
      { ...GRAPH, nodes: [] },
      { ...GRAPH, nodes: sparseNodes },
      { ...GRAPH, edges: sparseEdges },
      { ...GRAPH, nodes: [{ ...GRAPH.nodes[0], extra: true }, GRAPH.nodes[1]] },
      {
        ...GRAPH,
        nodes: GRAPH.nodes.map((node) =>
          node.id === GRAPH.centerId ? { ...node, relation: "reference" } : node,
        ),
      },
      {
        ...GRAPH,
        nodes: [...GRAPH.nodes, { ...GRAPH.nodes[1], id: GRAPH.nodes[0]?.id }],
      },
      { ...GRAPH, edges: [{ source: "W-center", target: "W-center" }] },
      { ...GRAPH, edges: [{ source: "W-center", target: "missing" }] },
      {
        ...GRAPH,
        edges: [
          { source: "W-center", target: "W-reference" },
          { source: "W-center", target: "W-reference" },
        ],
      },
      { ...GRAPH, centerId: "missing" },
      { ...GRAPH, truncated: 0 },
      {
        ...GRAPH,
        nodes: GRAPH.nodes.map((node) =>
          node.id === GRAPH.centerId ? { ...node, citedByCount: -1 } : node,
        ),
      },
      {
        ...GRAPH,
        nodes: GRAPH.nodes.map((node) =>
          node.id === GRAPH.centerId
            ? { ...node, citedByCount: Number.MAX_SAFE_INTEGER + 1 }
            : node,
        ),
      },
      {
        ...GRAPH,
        nodes: GRAPH.nodes.map((node) =>
          node.id === GRAPH.centerId ? { ...node, year: 10_001 } : node,
        ),
      },
      {
        ...GRAPH,
        nodes: GRAPH.nodes.map((node) =>
          node.id === GRAPH.centerId ? { ...node, relation: "unknown" } : node,
        ),
      },
    ];
    for (const graph of invalidGraphs) expectInvalid(() => decodeCitationGraph(graph));

    const oversizedNodeText = "x".repeat(MAX_CITATION_GRAPH_NODE_TEXT_BYTES + 1);
    expectInvalid(() =>
      decodeCitationGraph({
        ...GRAPH,
        nodes: GRAPH.nodes.map((node) =>
          node.id === GRAPH.centerId ? { ...node, title: oversizedNodeText } : node,
        ),
      }),
    );
    const oversizedDoi = "x".repeat(MAX_CITATION_GRAPH_DOI_BYTES + 1);
    expectInvalid(() =>
      decodeCitationGraph({
        ...GRAPH,
        nodes: GRAPH.nodes.map((node) =>
          node.id === GRAPH.centerId ? { ...node, doi: oversizedDoi } : node,
        ),
      }),
    );
  });

  it("rejects graphs over the node and serialized payload limits", () => {
    const tooManyNodes = Array.from({ length: MAX_CITATION_GRAPH_NODES + 1 }, (_, index) => ({
      id: `node-${index}`,
      title: "Node",
      citedByCount: 0,
      relation: index === 0 ? "center" : "reference",
    }));
    expectInvalid(() =>
      decodeCitationGraph({
        centerId: "node-0",
        nodes: tooManyNodes,
        edges: [],
        truncated: false,
      }),
    );

    const oversizedText = "x".repeat(MAX_CITATION_GRAPH_NODE_TEXT_BYTES);
    const oversizedGraph: CitationGraph = {
      centerId: "node-0",
      nodes: Array.from({ length: MAX_CITATION_GRAPH_NODES }, (_, index) => ({
        id: `node-${index}`,
        title: oversizedText,
        venue: oversizedText,
        firstAuthor: oversizedText,
        citedByCount: 0,
        relation: index === 0 ? "center" : "reference",
      })),
      edges: [],
      truncated: false,
    };
    expect(citationGraphUtf8ByteLength(JSON.stringify(oversizedGraph))).toBeGreaterThan(
      MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES,
    );
    expectInvalid(() => decodeCitationGraph(oversizedGraph));
  });

  it("validates cache timestamps and preserves zero", () => {
    expect(decodeCitationGraphGetCachedResult({ entry: validCacheEntry() })).toEqual({
      entry: validCacheEntry(),
    });
    for (const fetchedAt of [-1, 1.5, "now", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expectInvalid(() =>
        decodeCitationGraphGetCachedResult({
          entry: { cacheVersion: 1, fetchedAt, graph: GRAPH },
        }),
      );
    }
    for (const cacheVersion of [0, -1, 1.5, "one", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expectInvalid(() =>
        decodeCitationGraphGetCachedResult({
          entry: { cacheVersion, fetchedAt: 0, graph: GRAPH },
        }),
      );
    }
  });

  it("binds cache responses to the requested center DOI when one is supplied", () => {
    expect(
      decodeCitationGraphGetCachedResult(
        { entry: validCacheEntry() },
        "HTTPS://DOI.ORG/10.1000/CENTER",
      ),
    ).toEqual({ entry: validCacheEntry() });

    const mismatchedGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, doi: "10.1000/other" } : node,
      ),
    };
    const unboundGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, doi: undefined } : node,
      ),
    };
    expectInvalid(() =>
      decodeCitationGraphGetCachedResult(
        { entry: { cacheVersion: 1, fetchedAt: 0, graph: mismatchedGraph } },
        "10.1000/center",
      ),
    );
    expectInvalid(() =>
      decodeCitationGraphGetCachedResult(
        { entry: { cacheVersion: 1, fetchedAt: 0, graph: unboundGraph } },
        "10.1000/center",
      ),
    );
    // The legacy one-argument decoder remains useful for generic graph reads.
    expect(
      decodeCitationGraphGetCachedResult({
        entry: { cacheVersion: 1, fetchedAt: 0, graph: unboundGraph },
      }),
    ).toEqual({
      entry: { cacheVersion: 1, fetchedAt: 0, graph: unboundGraph },
    });
  });

  it("bounds and scopes active-Library DOI membership, then clones the response", () => {
    const requested = ["10.1000/center", "10.1000/reference"];
    const scope: LibraryScopeToken = { libraryId: "library:active", scopeToken: "scope-token" };
    const response: CitationGraphGetActiveLibraryDoisCommandResult = {
      dois: [" DOI:10.1000/CENTER "],
      scope,
    };
    const decoded = decodeCitationGraphGetActiveLibraryDoisResult(response, requested, scope);
    expect(decoded).toEqual({ dois: ["DOI:10.1000/CENTER"], scope });
    expect(decoded.dois).not.toBe(response.dois);
    expect(decoded.scope).not.toBe(response.scope);

    const invalid = [
      { dois: ["10.1000/other"], scope },
      { dois: ["10.1000/center", "doi:10.1000/CENTER"], scope },
      { dois: ["10.1000/center", undefined], scope },
      { dois: ["10.1000/center"], scope: { ...scope, libraryId: "" } },
      {
        dois: ["10.1000/center"],
        scope: { ...scope, libraryId: "x".repeat(MAX_CITATION_GRAPH_LIBRARY_ID_BYTES + 1) },
      },
      { dois: ["10.1000/center"], scope, extra: true },
      { dois: ["10.1000/center"], scope: { ...scope, scopeToken: "different" } },
    ];
    for (const value of invalid) {
      expectInvalid(() => decodeCitationGraphGetActiveLibraryDoisResult(value, requested, scope));
    }

    const sparseDois = new Array<string>(1);
    expectInvalid(() =>
      decodeCitationGraphGetActiveLibraryDoisResult({ dois: sparseDois, scope }, requested, scope),
    );

    const tooMany = Array.from(
      { length: MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS + 1 },
      (_, index) => `10.1000/${index}`,
    );
    expectInvalid(() =>
      decodeCitationGraphGetActiveLibraryDoisResult({ dois: tooMany, scope }, tooMany, scope),
    );
  });
});
