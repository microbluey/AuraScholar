import type { CitationGraph } from "@aurascholar/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CitationGraphProvenance } from "../../src/shared/citation-graph-provenance";
import {
  MAX_CITATION_GRAPH_DOI_BYTES,
  MAX_CITATION_GRAPH_NODE_ID_BYTES,
} from "../../src/shared/citation-graph-limits";
import { sanitizeCitationGraphBuild } from "./scholarly-citation-graph-output";

const GRAPH: CitationGraph = {
  centerId: "W-center",
  edges: [],
  nodes: [
    {
      citedByCount: 0,
      doi: "10.1000/center",
      id: "W-center",
      relation: "center",
      title: "Center",
    },
  ],
  truncated: false,
};

const PROVENANCE: CitationGraphProvenance = {
  capturedAt: 10,
  centerDoi: "10.1000/center",
  provider: "openalex",
  providerVersion: "openalex-citation-graph-v1",
  requestedDoi: "10.1000/center",
  schemaVersion: 1,
};

function graphWithCenterDoi(doi: string | undefined): CitationGraph {
  return {
    ...GRAPH,
    nodes: GRAPH.nodes.map((node) => {
      if (node.relation !== "center") return node;
      const { doi: _doi, ...withoutDoi } = node;
      return doi === undefined ? withoutDoi : { ...withoutDoi, doi };
    }),
  };
}

describe("scholarly Citation Graph output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a public graph only when its generated provenance is fully bound", () => {
    vi.spyOn(Date, "now").mockReturnValue(10);
    expect(sanitizeCitationGraphBuild(GRAPH, "DOI:10.1000/CENTER")).toEqual({
      graph: GRAPH,
      provenance: PROVENANCE,
    });

    expect(sanitizeCitationGraphBuild(graphWithCenterDoi(undefined), "10.1000/center")).toEqual({
      graph: null,
      provenance: null,
    });
    expect(
      sanitizeCitationGraphBuild(graphWithCenterDoi("10.1000/other"), "10.1000/center"),
    ).toEqual({ graph: null, provenance: null });
    const maxLengthDoi = `10.1000/${"a".repeat(MAX_CITATION_GRAPH_DOI_BYTES - 8)}`;
    expect(
      sanitizeCitationGraphBuild(graphWithCenterDoi(`${maxLengthDoi}x`), maxLengthDoi),
    ).toEqual({ graph: null, provenance: null });
    expect(
      sanitizeCitationGraphBuild(graphWithCenterDoi("10.1000/center\u0000"), "10.1000/center"),
    ).toEqual({ graph: null, provenance: null });
    const oversizedCenterId = "W".repeat(MAX_CITATION_GRAPH_NODE_ID_BYTES + 1);
    expect(
      sanitizeCitationGraphBuild(
        {
          ...GRAPH,
          centerId: oversizedCenterId,
          nodes: GRAPH.nodes.map((node) =>
            node.id === GRAPH.centerId ? { ...node, id: oversizedCenterId } : node,
          ),
        },
        "10.1000/center",
      ),
    ).toEqual({ graph: null, provenance: null });
    const inheritedCenter = Object.create({ doi: "10.1000/center" }) as Record<string, unknown>;
    Object.assign(inheritedCenter, {
      citedByCount: 0,
      id: "W-center",
      relation: "center",
      title: "Center",
    });
    expect(
      sanitizeCitationGraphBuild(
        { ...GRAPH, nodes: [inheritedCenter] } as unknown as CitationGraph,
        "10.1000/center",
      ),
    ).toEqual({ graph: null, provenance: null });
  });

  it("rejects explicit snapshots whose request and graph-center bindings diverge", () => {
    const otherCenterGraph = graphWithCenterDoi("10.1000/other");
    expect(() =>
      sanitizeCitationGraphBuild(
        {
          graph: otherCenterGraph,
          provenance: { ...PROVENANCE, centerDoi: "10.1000/other" },
        },
        "10.1000/center",
      ),
    ).toThrow("Citation graph provenance is invalid");
    expect(() =>
      sanitizeCitationGraphBuild(
        { graph: GRAPH, provenance: { ...PROVENANCE, capturedAt: Number.POSITIVE_INFINITY } },
        "10.1000/center",
      ),
    ).toThrow("Citation graph provenance is invalid");
    expect(() =>
      sanitizeCitationGraphBuild(
        {
          graph: GRAPH,
          provenance: { ...PROVENANCE, requestedDoi: `10.1000/center${"x".repeat(2_048)}` },
        },
        "10.1000/center",
      ),
    ).toThrow("Citation graph provenance is invalid");
  });
});
