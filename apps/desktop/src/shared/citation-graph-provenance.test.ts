import type { CitationGraph } from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import {
  CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
  CITATION_GRAPH_PROVIDER,
  CITATION_GRAPH_PROVIDER_VERSION,
  citationGraphProvenanceMatches,
  createOpenAlexCitationGraphProvenance,
  type CitationGraphProvenance,
} from "./citation-graph-provenance";

const GRAPH: CitationGraph = {
  centerId: "W-center",
  edges: [],
  nodes: [
    {
      citedByCount: 0,
      doi: "HTTPS://DOI.ORG/10.1000/CENTER",
      id: "W-center",
      relation: "center",
      title: "Center",
    },
  ],
  truncated: false,
};

const PROVENANCE: CitationGraphProvenance = {
  capturedAt: 1,
  centerDoi: "10.1000/center",
  provider: CITATION_GRAPH_PROVIDER,
  providerVersion: CITATION_GRAPH_PROVIDER_VERSION,
  requestedDoi: "10.1000/center",
  schemaVersion: CITATION_GRAPH_PROVENANCE_SCHEMA_VERSION,
};

describe("Citation Graph provenance contract", () => {
  it("constructs only a timestamped envelope bound to one canonical DOI", () => {
    expect(
      createOpenAlexCitationGraphProvenance({
        capturedAt: 1,
        centerDoi: "DOI:10.1000/CENTER",
        requestedDoi: "https://doi.org/10.1000/center",
      }),
    ).toEqual(PROVENANCE);

    for (const input of [
      { capturedAt: 1, centerDoi: null, requestedDoi: "10.1000/center" },
      { capturedAt: 1, centerDoi: "10.1000/other", requestedDoi: "10.1000/center" },
      { capturedAt: -1, centerDoi: "10.1000/center", requestedDoi: "10.1000/center" },
      { capturedAt: 1.5, centerDoi: "10.1000/center", requestedDoi: "10.1000/center" },
    ]) {
      expect(() => createOpenAlexCitationGraphProvenance(input)).toThrow();
    }
  });

  it("requires the request, envelope, and graph center to identify the same work", () => {
    expect(citationGraphProvenanceMatches(GRAPH, PROVENANCE, "DOI:10.1000/CENTER")).toBe(true);

    const otherCenterGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) => ({ ...node, doi: "10.1000/other" })),
    };
    expect(
      citationGraphProvenanceMatches(
        otherCenterGraph,
        { ...PROVENANCE, centerDoi: "10.1000/other" },
        "10.1000/center",
      ),
    ).toBe(false);
    expect(
      citationGraphProvenanceMatches(GRAPH, { ...PROVENANCE, capturedAt: -1 }, "10.1000/center"),
    ).toBe(false);
    expect(
      citationGraphProvenanceMatches(
        GRAPH,
        { ...PROVENANCE, requestedDoi: "DOI:10.1000/CENTER" },
        "10.1000/center",
      ),
    ).toBe(false);
    expect(
      citationGraphProvenanceMatches(
        GRAPH,
        { ...PROVENANCE, extra: true } as CitationGraphProvenance,
        "10.1000/center",
      ),
    ).toBe(false);
  });
});
