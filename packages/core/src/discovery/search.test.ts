import { describe, expect, it, vi } from "vitest";
import { StubHttpClient, jsonResponse } from "@aurascholar/platform";
import {
  mergeDiscoveryResults,
  searchOpenSources,
  searchOpenSourcesDetailed,
  type DiscoveryResult,
} from "./search";
import type { ConnectorContext } from "@aurascholar/connectors";

function result(partial: Partial<DiscoveryResult>): DiscoveryResult {
  return {
    id: partial.id ?? "r",
    source: partial.source ?? "openalex",
    score: partial.score ?? 1,
    work: {
      title: partial.work?.title ?? "Example Paper",
      doi: partial.work?.doi,
      year: partial.work?.year,
      abstract: partial.work?.abstract,
      venueName: partial.work?.venueName,
      arxivId: partial.work?.arxivId,
      openalexId: partial.work?.openalexId,
      s2Id: partial.work?.s2Id,
      authors: partial.work?.authors ?? [],
      source: partial.work?.source ?? "openalex",
    },
  };
}

describe("mergeDiscoveryResults", () => {
  it("dedupes DOI results and prefers richer bibliographic metadata", () => {
    const merged = mergeDiscoveryResults([
      result({
        id: "s2",
        source: "s2",
        score: 90,
        work: {
          title: "Attention Is All You Need",
          doi: "10.5555/example",
          year: 2017,
          authors: [],
          source: "s2",
        },
      }),
      result({
        id: "crossref",
        source: "crossref",
        score: 12,
        work: {
          title: "Attention Is All You Need",
          doi: "10.5555/example",
          year: 2017,
          venueName: "NeurIPS",
          authors: [{ displayName: "Ashish Vaswani", position: 0 }],
          source: "crossref",
        },
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("crossref");
    expect(merged[0]?.score).toBe(90);
    expect(merged[0]?.work.venueName).toBe("NeurIPS");
  });

  it("falls back to normalized title and year when no stable id exists", () => {
    const merged = mergeDiscoveryResults([
      result({
        id: "a",
        source: "openalex",
        work: { title: "A Study: of   Things", year: 2026, authors: [], source: "openalex" },
      }),
      result({
        id: "b",
        source: "s2",
        work: { title: "A Study of Things", year: 2026, authors: [], source: "s2" },
      }),
    ]);

    expect(merged).toHaveLength(1);
  });

  it("merges DOI and source-id aliases through shared title metadata", () => {
    const merged = mergeDiscoveryResults([
      result({
        id: "crossref",
        source: "crossref",
        score: 75,
        work: {
          title: "A Paper With a DOI",
          doi: "10.1234/example",
          year: 2024,
          authors: [],
          source: "crossref",
        },
      }),
      result({
        id: "openalex",
        source: "openalex",
        score: 92,
        work: {
          title: "A Paper With a DOI",
          openalexId: "W123",
          year: 2024,
          abstract: "Richer abstract",
          venueName: "Journal",
          oaPdfUrl: "https://example.test/paper.pdf",
          authors: [{ displayName: "A. Author", position: 0 }],
          source: "openalex",
        },
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.score).toBe(92);
    expect(merged[0]?.work.abstract).toBe("Richer abstract");
  });
});

describe("searchOpenSources", () => {
  it("uses exact DOI lookup instead of bibliographic search for DOI queries", async () => {
    const http = new StubHttpClient();
    http.on(/api\.crossref\.org\/works\/10\.1234%2Fabc/, () =>
      jsonResponse(200, {
        message: {
          DOI: "10.1234/ABC",
          title: ["Exact DOI Paper"],
          issued: { "date-parts": [[2024]] },
        },
      }),
    );

    const results = await searchOpenSources(
      { http, mailto: "test@example.com" },
      "https://doi.org/10.1234/ABC",
      { sources: ["crossref"] },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.work.doi).toBe("10.1234/abc");
    expect(results[0]?.work.title).toBe("Exact DOI Paper");
    expect(http.requests[0]?.url).toContain("/works/10.1234%2Fabc?");
    expect(http.requests[0]?.url).not.toContain("query.bibliographic");
  });

  it("returns within the soft timeout when a source stalls", async () => {
    vi.useFakeTimers();
    const ctx: ConnectorContext = {
      mailto: "test@example.com",
      http: {
        request: () => new Promise(() => {}),
      },
    };

    const pending = searchOpenSources(ctx, "slow query", {
      sources: ["crossref"],
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toEqual([]);
    vi.useRealTimers();
  });

  it("reports source errors instead of treating them as empty results", async () => {
    const http = new StubHttpClient();
    http.on(/api\.crossref\.org\/works/, () => jsonResponse(400, { message: "bad query" }));

    const report = await searchOpenSourcesDetailed(
      { http, mailto: "test@example.com" },
      "bad query",
      { sources: ["crossref"] },
    );

    expect(report.results).toEqual([]);
    expect(report.sources.crossref.status).toBe("error");
    expect(report.sources.crossref.error).toContain("API request failed");
  });

  it("reports aborted sources when the caller cancels", async () => {
    const controller = new AbortController();
    const ctx: ConnectorContext = {
      mailto: "test@example.com",
      http: {
        request: () => new Promise(() => {}),
      },
    };

    const pending = searchOpenSourcesDetailed(ctx, "slow query", {
      sources: ["crossref"],
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort();

    const report = await pending;
    expect(report.results).toEqual([]);
    expect(report.sources.crossref.status).toBe("aborted");
  });
});
