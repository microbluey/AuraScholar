import type { CitationGraph, DiscoverySearchReport, ResolvedWork } from "@aurascholar/core";
import type { S2Enrichment } from "@aurascholar/connectors";
import { describe, expect, it, vi } from "vitest";
import { executeScholarlyCommand, type MainScholarlyService } from "./scholarly-commands";
import { MainScholarlyRunRegistry } from "./scholarly-run-registry";
import type { CitationGraphProvenance } from "../../src/shared/citation-graph-provenance";

const GRAPH: CitationGraph = {
  centerId: "W-center",
  edges: [],
  nodes: [
    {
      citedByCount: 0,
      doi: "10.1000/graph",
      id: "W-center",
      relation: "center",
      title: "Center work",
    },
  ],
  truncated: false,
};

const GRAPH_PROVENANCE: CitationGraphProvenance = {
  capturedAt: 1_725_000_000_000,
  centerDoi: "10.1000/graph",
  provider: "openalex",
  providerVersion: "openalex-citation-graph-v1",
  requestedDoi: "10.1000/graph",
  schemaVersion: 1,
};

const RESOLVED: ResolvedWork = {
  confidence: 1,
  work: { authors: [], doi: "10.1000/resolved", source: "crossref", title: "Resolved work" },
};

function service(overrides: Partial<MainScholarlyService> = {}): MainScholarlyService {
  return {
    buildCitationGraph: vi.fn(async () => GRAPH),
    enrichByDoi: vi.fn(async (): Promise<S2Enrichment | null> => null),
    resolveClue: vi.fn(async () => RESOLVED),
    searchDiscovery: vi.fn(
      async (): Promise<DiscoverySearchReport> => ({
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
      }),
    ),
    ...overrides,
  };
}

describe("scholarly data commands", () => {
  it("routes typed intent through a main-owned service and bounds the result", async () => {
    const scholarlyService = service();
    const runs = new MainScholarlyRunRegistry();

    await expect(
      executeScholarlyCommand(
        {
          input: { doi: "HTTPS://DOI.ORG/10.1000/GRAPH", requestId: "graph-1" },
          name: "citationGraph.build",
        },
        { runs, service: scholarlyService },
      ),
    ).resolves.toMatchObject({
      graph: GRAPH,
      provenance: {
        centerDoi: "10.1000/graph",
        provider: "openalex",
        providerVersion: "openalex-citation-graph-v1",
        requestedDoi: "10.1000/graph",
        schemaVersion: 1,
      },
    });

    expect(scholarlyService.buildCitationGraph).toHaveBeenCalledWith(
      "10.1000/graph",
      expect.any(AbortSignal),
    );
  });

  it("rejects HTTP-shaped and unsupported URL-clue input before any service call", async () => {
    const scholarlyService = service();
    const dependencies = { runs: new MainScholarlyRunRegistry(), service: scholarlyService };

    await expect(
      executeScholarlyCommand(
        {
          input: {
            query: { text: "unsafe" },
            requestId: "unsafe-1",
            url: "https://attacker.example/metadata",
          },
          name: "discovery.searchOpenSources",
        } as never,
        dependencies,
      ),
    ).rejects.toThrow("Invalid discovery.searchOpenSources input");
    await expect(
      executeScholarlyCommand(
        {
          input: {
            clue: { kind: "url", url: "https://attacker.example/work" },
            requestId: "unsafe-2",
          },
          name: "library.resolveClue",
        } as never,
        dependencies,
      ),
    ).rejects.toThrow("unsupported");
    expect(scholarlyService.searchDiscovery).not.toHaveBeenCalled();
    expect(scholarlyService.resolveClue).not.toHaveBeenCalled();
  });

  it("rejects an injected graph snapshot whose provenance is missing or misbound", async () => {
    const missing = service({
      buildCitationGraph: vi.fn(async () => ({ graph: GRAPH, provenance: null })),
    });
    await expect(
      executeScholarlyCommand(
        {
          input: { doi: "10.1000/graph", requestId: "missing-provenance" },
          name: "citationGraph.build",
        },
        { runs: new MainScholarlyRunRegistry(), service: missing },
      ),
    ).rejects.toThrow("Citation graph provenance is invalid");

    const misbound = service({
      buildCitationGraph: vi.fn(async () => ({
        graph: GRAPH,
        provenance: { ...GRAPH_PROVENANCE, requestedDoi: "10.1000/other" },
      })),
    });
    await expect(
      executeScholarlyCommand(
        {
          input: { doi: "10.1000/graph", requestId: "misbound-provenance" },
          name: "citationGraph.build",
        },
        { runs: new MainScholarlyRunRegistry(), service: misbound },
      ),
    ).rejects.toThrow("Citation graph provenance is invalid");
  });

  it("passes a cancellation signal to the active operation and rejects after cancellation", async () => {
    let observedSignal: AbortSignal | undefined;
    const scholarlyService = service({
      enrichByDoi: vi.fn(
        (_doi: string, signal: AbortSignal) =>
          new Promise<S2Enrichment | null>((_, reject) => {
            observedSignal = signal;
            signal.addEventListener(
              "abort",
              () => {
                const error = new Error("cancelled");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      ),
    });
    const runs = new MainScholarlyRunRegistry();
    const pending = executeScholarlyCommand(
      {
        input: { doi: "10.1000/cancel", requestId: "cancel-1" },
        name: "scholar.enrichByDoi",
      },
      { runs, service: scholarlyService },
    );

    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    await expect(
      executeScholarlyCommand(
        { input: { requestId: "cancel-1" }, name: "scholarly.cancelRun" },
        { runs, service: scholarlyService },
      ),
    ).resolves.toEqual({ cancelled: true });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal?.aborted).toBe(true);
  });

  it("sanitizes excessive public metadata before it can cross IPC", async () => {
    const scholarlyService = service({
      enrichByDoi: vi.fn(async () => ({
        citationCount: 42,
        tldr: "x".repeat(200_000),
        url: "file:///private/secret",
      })),
    });

    await expect(
      executeScholarlyCommand(
        { input: { doi: "10.1000/safe", requestId: "safe-1" }, name: "scholar.enrichByDoi" },
        { runs: new MainScholarlyRunRegistry(), service: scholarlyService },
      ),
    ).resolves.toEqual({
      enrichment: {
        citationCount: 42,
        tldr: "x".repeat(128 * 1024),
      },
    });
  });

  it("drops URLs whose canonical form exceeds the public output bound", async () => {
    const scholarlyService = service({
      enrichByDoi: vi.fn(async () => ({
        openAccessPdfUrl: `https://example.test/${"界".repeat(2700)}`,
      })),
    });

    await expect(
      executeScholarlyCommand(
        {
          input: { doi: "10.1000/unicode-url", requestId: "unicode-url-1" },
          name: "scholar.enrichByDoi",
        },
        { runs: new MainScholarlyRunRegistry(), service: scholarlyService },
      ),
    ).resolves.toEqual({ enrichment: {} });
  });

  it("fails closed for malformed discovery reports and enrichment containers", async () => {
    const malformedReport = service({
      searchDiscovery: vi.fn(async () => null as never),
    });
    await expect(
      executeScholarlyCommand(
        {
          input: {
            query: { text: "malformed report" },
            requestId: "malformed-report",
          },
          name: "discovery.searchOpenSources",
        },
        { runs: new MainScholarlyRunRegistry(), service: malformedReport },
      ),
    ).rejects.toThrow("Discovery search report is invalid");

    const malformedEnrichment = service({
      enrichByDoi: vi.fn(async () => [] as never),
    });
    await expect(
      executeScholarlyCommand(
        {
          input: { doi: "10.1000/array", requestId: "array-enrichment" },
          name: "scholar.enrichByDoi",
        },
        { runs: new MainScholarlyRunRegistry(), service: malformedEnrichment },
      ),
    ).resolves.toEqual({ enrichment: null });
  });

  it("drops discovery results that lose source provenance or repeat an id", async () => {
    const report: DiscoverySearchReport = {
      cursors: {
        arxiv: { hasMore: false, page: 1 },
        crossref: { hasMore: false, page: 1 },
        openalex: { hasMore: false, page: 1 },
        s2: { hasMore: false, page: 1 },
      },
      results: [
        {
          id: "same-id",
          score: 1,
          source: "openalex",
          work: { authors: [], source: "crossref", title: "Mismatched" },
        },
        {
          id: "same-id",
          score: 1,
          source: "crossref",
          work: { authors: [], source: "crossref", title: "First" },
        },
        {
          id: "same-id",
          score: 0.5,
          source: "crossref",
          work: { authors: [], source: "crossref", title: "Duplicate" },
        },
      ],
      sources: {
        arxiv: { count: 0, source: "arxiv", status: "empty" },
        crossref: { count: 2, source: "crossref", status: "done" },
        openalex: { count: 1, source: "openalex", status: "done" },
        s2: { count: 0, source: "s2", status: "empty" },
      },
    };
    const scholarlyService = service({ searchDiscovery: vi.fn(async () => report) });

    await expect(
      executeScholarlyCommand(
        {
          input: { query: { text: "provenance" }, requestId: "provenance-1" },
          name: "discovery.searchOpenSources",
        },
        { runs: new MainScholarlyRunRegistry(), service: scholarlyService },
      ),
    ).resolves.toMatchObject({
      report: { results: [{ id: "same-id", work: { title: "First" } }] },
    });
  });
});
