import type { CanvasWorkspaceDocument, CitationGraph } from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import {
  canvasCitationLayoutRequestMatches,
  canvasCitationRelationsFromGraph,
  canvasCitationSelectionFingerprint,
  mergeCanvasCitationRelations,
  normalizeCitationDoi,
  type CanvasCitationPaperIdentity,
} from "./canvas-citation";

function graph(overrides: Partial<CitationGraph> = {}): CitationGraph {
  return {
    centerId: "openalex-a",
    nodes: [
      {
        id: "openalex-a",
        title: "A",
        citedByCount: 10,
        doi: "https://doi.org/10.1000/A",
        relation: "center",
      },
      {
        id: "openalex-b",
        title: "B",
        citedByCount: 5,
        doi: "DOI: 10.1000/b",
        relation: "reference",
      },
      {
        id: "openalex-without-doi",
        title: "No DOI",
        citedByCount: 0,
        relation: "reference",
      },
      {
        id: "openalex-unselected",
        title: "Not selected",
        citedByCount: 1,
        doi: "10.1000/unselected",
        relation: "reference",
      },
    ],
    edges: [],
    truncated: false,
    ...overrides,
  };
}

const selectedPapers: CanvasCitationPaperIdentity[] = [
  { nodeId: "node-a", workId: "work-a", doi: "10.1000/a" },
  { nodeId: "node-b", workId: "work-b", doi: "https://DX.DOI.ORG/10.1000/B" },
  { nodeId: "node-no-doi", workId: "work-no-doi", doi: null },
];

describe("canvas citation helpers", () => {
  it("normalizes DOI URL and label prefixes without changing the DOI suffix", () => {
    expect(normalizeCitationDoi(" HTTPS://DOI.ORG/10.5555/ABC.Def ")).toBe("10.5555/abc.def");
    expect(normalizeCitationDoi("http://dx.doi.org/10.5555/ABC")).toBe("10.5555/abc");
    expect(normalizeCitationDoi("doi.org/10.5555/ABC")).toBe("10.5555/abc");
    expect(normalizeCitationDoi(" DOI: 10.5555/ABC ")).toBe("10.5555/abc");
    expect(normalizeCitationDoi("10.5555/ABC")).toBe("10.5555/abc");
    expect(normalizeCitationDoi("  ")).toBeNull();
    expect(normalizeCitationDoi(null)).toBeNull();
    expect(normalizeCitationDoi(undefined)).toBeNull();
  });

  it("maps graph edges from citing to cited local works and filters unusable edges", () => {
    const source = graph({
      edges: [
        { source: "openalex-b", target: "openalex-a" },
        { source: "openalex-a", target: "openalex-b" },
        { source: "openalex-a", target: "openalex-b" },
        { source: "openalex-a", target: "openalex-a" },
        { source: "openalex-without-doi", target: "openalex-a" },
        { source: "openalex-a", target: "openalex-unselected" },
        { source: "missing-node", target: "openalex-b" },
      ],
    });

    expect(canvasCitationRelationsFromGraph(source, selectedPapers)).toEqual([
      { citingWorkId: "work-a", citedWorkId: "work-b" },
      { citingWorkId: "work-b", citedWorkId: "work-a" },
    ]);
  });

  it("maps duplicate selected DOI identities without emitting self loops or duplicates", () => {
    const source = graph({
      edges: [
        { source: "openalex-a", target: "openalex-b" },
        { source: "openalex-a-alias", target: "openalex-b" },
      ],
      nodes: [
        ...graph().nodes,
        {
          id: "openalex-a-alias",
          title: "A alias",
          citedByCount: 10,
          doi: "doi:10.1000/a",
          relation: "citer",
        },
      ],
    });
    const selected = [
      ...selectedPapers,
      { nodeId: "node-a-copy", workId: "work-a", doi: "https://doi.org/10.1000/a" },
    ];

    expect(canvasCitationRelationsFromGraph(source, selected)).toEqual([
      { citingWorkId: "work-a", citedWorkId: "work-b" },
    ]);
  });

  it("merges multiple relation sources with deterministic ordering", () => {
    const first = [
      { citingWorkId: "work-c", citedWorkId: "work-a" },
      { citingWorkId: "work-b", citedWorkId: "work-c" },
    ];
    const second = [
      { citingWorkId: "work-a", citedWorkId: "work-b" },
      { citingWorkId: "work-b", citedWorkId: "work-c" },
      { citingWorkId: "work-a", citedWorkId: "work-a" },
    ];

    expect(mergeCanvasCitationRelations(first, second)).toEqual([
      { citingWorkId: "work-a", citedWorkId: "work-b" },
      { citingWorkId: "work-b", citedWorkId: "work-c" },
      { citingWorkId: "work-c", citedWorkId: "work-a" },
    ]);
    expect(mergeCanvasCitationRelations(second, first)).toEqual(
      mergeCanvasCitationRelations(first, second),
    );
  });

  it("fingerprints workspace and selected paper identities independently of selection order", () => {
    const first = canvasCitationSelectionFingerprint("workspace-a", selectedPapers);
    const reordered = canvasCitationSelectionFingerprint("workspace-a", [
      selectedPapers[2]!,
      selectedPapers[0]!,
      selectedPapers[1]!,
      selectedPapers[0]!,
    ]);
    const equivalentDoi = canvasCitationSelectionFingerprint("workspace-a", [
      { ...selectedPapers[0]!, doi: "DOI:10.1000/A" },
      selectedPapers[1]!,
      selectedPapers[2]!,
    ]);

    expect(reordered).toBe(first);
    expect(equivalentDoi).toBe(first);
    expect(canvasCitationSelectionFingerprint("workspace-b", selectedPapers)).not.toBe(first);
    expect(
      canvasCitationSelectionFingerprint("workspace-a", [
        { ...selectedPapers[0]!, nodeId: "node-a-replacement" },
        selectedPapers[1]!,
        selectedPapers[2]!,
      ]),
    ).not.toBe(first);
    expect(
      canvasCitationSelectionFingerprint("workspace-a", [
        { ...selectedPapers[0]!, workId: "work-a-replacement" },
        selectedPapers[1]!,
        selectedPapers[2]!,
      ]),
    ).not.toBe(first);
  });

  it("ignores viewport-only updates but rejects layout-content or selection changes", () => {
    const document: CanvasWorkspaceDocument = {
      schemaVersion: 1,
      workspaceId: "workspace-a",
      name: "Research",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const fingerprint = canvasCitationSelectionFingerprint("workspace-a", selectedPapers);
    const request = { document, fingerprint };

    expect(canvasCitationLayoutRequestMatches(request, document, fingerprint)).toBe(true);
    expect(
      canvasCitationLayoutRequestMatches(
        request,
        { ...document, viewport: { x: 20, y: 10, zoom: 1.2 }, updatedAt: 2 },
        fingerprint,
      ),
    ).toBe(true);
    expect(
      canvasCitationLayoutRequestMatches(request, { ...document, nodes: [] }, fingerprint),
    ).toBe(false);
    expect(
      canvasCitationLayoutRequestMatches(request, { ...document, edges: [] }, fingerprint),
    ).toBe(false);
    expect(
      canvasCitationLayoutRequestMatches(
        request,
        { ...document, workspaceId: "workspace-b" },
        fingerprint,
      ),
    ).toBe(false);
    expect(
      canvasCitationLayoutRequestMatches(
        request,
        document,
        canvasCitationSelectionFingerprint("workspace-a", selectedPapers.slice(0, 2)),
      ),
    ).toBe(false);
  });
});
