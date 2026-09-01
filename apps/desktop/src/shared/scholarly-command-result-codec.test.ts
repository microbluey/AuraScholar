import type { NormalizedWork, S2Enrichment } from "@aurascholar/connectors";
import type { DiscoverySearchReport, DiscoverySource, ResolvedWork } from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import {
  decodeLibraryResolveClueResult,
  decodeScholarEnrichByDoiResult,
  decodeScholarlyCancelRunResult,
  decodeScholarlySearchDiscoveryResult,
} from "./scholarly-command-result-codec";
import {
  MAX_SCHOLARLY_AUTHOR_COUNT,
  MAX_SCHOLARLY_CANDIDATES,
  MAX_SCHOLARLY_DISCOVERY_RESULTS,
  MAX_SCHOLARLY_OUTPUT_BYTES,
} from "./scholarly-command-limits";

function work(overrides: Partial<NormalizedWork> = {}): NormalizedWork {
  return {
    authors: [
      {
        displayName: "Ada Lovelace",
        family: "Lovelace",
        given: "Ada",
        position: 0,
        role: "author",
      },
    ],
    doi: "10.1000/example",
    source: "crossref",
    title: "A scholarly work",
    year: 2025,
    ...overrides,
  };
}

function report(
  sources: readonly DiscoverySource[] = ["openalex"],
  results: unknown[] = [],
): DiscoverySearchReport {
  return {
    cursors: Object.fromEntries(
      sources.map((source) => [source, { hasMore: false, page: 1 }]),
    ) as DiscoverySearchReport["cursors"],
    results: results as DiscoverySearchReport["results"],
    sources: Object.fromEntries(
      sources.map((source) => [source, { count: 0, source, status: "empty" }]),
    ) as DiscoverySearchReport["sources"],
  };
}

function result(source: DiscoverySource = "openalex"): DiscoverySearchReport["results"][number] {
  return {
    id: `${source}:10.1000/example:0`,
    score: 10,
    source,
    work: work({ source }),
  };
}

describe("scholarly command-result codec", () => {
  it("accepts exact nullable envelopes and cancellation acknowledgements", () => {
    expect(decodeScholarEnrichByDoiResult({ enrichment: null })).toEqual({ enrichment: null });
    expect(decodeLibraryResolveClueResult({ resolved: null })).toEqual({ resolved: null });
    expect(decodeScholarlySearchDiscoveryResult({ report: report() }, ["openalex"])).toEqual({
      report: report(),
    });
    expect(decodeScholarlyCancelRunResult({ cancelled: true })).toEqual({ cancelled: true });
  });

  it("deep-clones discovery, resolution, and enrichment values", () => {
    const discovery = report(["openalex"], [result("openalex")]);
    discovery.results[0]!.work.cslJson = { issued: { "date-parts": [[2025]] } };
    const decodedDiscovery = decodeScholarlySearchDiscoveryResult({ report: discovery }, [
      "openalex",
    ]).report;
    expect(decodedDiscovery).toEqual(discovery);
    expect(decodedDiscovery).not.toBe(discovery);
    expect(decodedDiscovery.results).not.toBe(discovery.results);
    expect(decodedDiscovery.results[0]).not.toBe(discovery.results[0]);
    expect(decodedDiscovery.results[0]!.work).not.toBe(discovery.results[0]!.work);
    expect(decodedDiscovery.results[0]!.work.authors).not.toBe(discovery.results[0]!.work.authors);
    expect(decodedDiscovery.results[0]!.work.cslJson).not.toBe(discovery.results[0]!.work.cslJson);

    const resolved: ResolvedWork = {
      confidence: 0.8,
      candidates: [work({ title: "Candidate" })],
      work: work({ title: "Resolved" }),
    };
    const decodedResolved = decodeLibraryResolveClueResult({ resolved }).resolved;
    expect(decodedResolved).toEqual(resolved);
    expect(decodedResolved).not.toBe(resolved);
    expect(decodedResolved?.work).not.toBe(resolved.work);
    expect(decodedResolved?.candidates).not.toBe(resolved.candidates);

    const enrichment: S2Enrichment = {
      citationCount: 12,
      openAccessPdfUrl: "https://example.test/paper.pdf",
      s2Id: "s2-paper",
      tldr: "A short summary",
      url: "https://example.test/paper",
    };
    const decodedEnrichment = decodeScholarEnrichByDoiResult({ enrichment }).enrichment;
    expect(decodedEnrichment).toEqual(enrichment);
    expect(decodedEnrichment).not.toBe(enrichment);
  });

  it("rejects malformed or unexpected command envelopes", () => {
    const invalid = [
      () => decodeScholarlySearchDiscoveryResult({}, ["openalex"]),
      () => decodeScholarlySearchDiscoveryResult({ report: report(), extra: true }, ["openalex"]),
      () => decodeScholarEnrichByDoiResult({ enrichment: null, extra: true }),
      () => decodeScholarEnrichByDoiResult({ enrichment: [] }),
      () => decodeLibraryResolveClueResult({ resolved: null, extra: true }),
      () => decodeLibraryResolveClueResult({ resolved: {} }),
      () => decodeScholarlyCancelRunResult({ cancelled: "true" }),
      () => decodeScholarlyCancelRunResult({}),
    ];
    for (const decode of invalid) expect(decode).toThrow("is invalid");
  });

  it("binds discovery maps and result sources to the requested source set", () => {
    expect(() =>
      decodeScholarlySearchDiscoveryResult({ report: report(["openalex"]) }, ["s2"]),
    ).toThrow("source reports");
    expect(() =>
      decodeScholarlySearchDiscoveryResult({ report: report(["openalex"]) }, ["openalex", "s2"]),
    ).toThrow("source reports");
    expect(() =>
      decodeScholarlySearchDiscoveryResult({ report: report(["openalex"], [result("s2")]) }, [
        "openalex",
      ]),
    ).toThrow("outside the requested set");
    expect(() =>
      decodeScholarlySearchDiscoveryResult(
        {
          report: report(
            ["openalex"],
            [{ ...result("openalex"), work: work({ source: "crossref" }) }],
          ),
        },
        ["openalex"],
      ),
    ).toThrow("work source");
    expect(() =>
      decodeScholarlySearchDiscoveryResult(
        {
          report: report(["openalex"], [result("openalex"), result("openalex")]),
        },
        ["openalex"],
      ),
    ).toThrow("ids must be unique");
    expect(() =>
      decodeScholarlySearchDiscoveryResult(
        {
          report: {
            ...report(),
            sources: {
              openalex: {
                count: MAX_SCHOLARLY_DISCOVERY_RESULTS + 1,
                source: "openalex",
                status: "empty",
              },
            },
          },
        },
        ["openalex"],
      ),
    ).toThrow("count");
    expect(() =>
      decodeScholarlySearchDiscoveryResult({ report: report(["openalex"]) }, [
        "openalex",
        "openalex",
      ]),
    ).toThrow("must be unique");
    expect(() => decodeScholarlySearchDiscoveryResult({ report: report() }, [])).toThrow(
      "requested sources",
    );
  });

  it("rejects sparse, oversized, and malformed discovery payloads", () => {
    const sparse = new Array(1);
    const tooMany = Array.from({ length: MAX_SCHOLARLY_DISCOVERY_RESULTS + 1 }, () => result());
    const badWork = (overrides: Partial<NormalizedWork>) =>
      report(["openalex"], [result("openalex")]).results.map((entry) => ({
        ...entry,
        work: work({ source: "openalex", ...overrides }),
      }));
    const invalid = [
      () =>
        decodeScholarlySearchDiscoveryResult({ report: report(["openalex"], sparse) }, [
          "openalex",
        ]),
      () =>
        decodeScholarlySearchDiscoveryResult({ report: report(["openalex"], tooMany) }, [
          "openalex",
        ]),
      () =>
        decodeScholarlySearchDiscoveryResult(
          { report: report(["openalex"], [{ ...result(), extra: true }]) },
          ["openalex"],
        ),
      () =>
        decodeScholarlySearchDiscoveryResult(
          { report: report(["openalex"], badWork({ title: "" })) },
          ["openalex"],
        ),
      () =>
        decodeScholarlySearchDiscoveryResult(
          { report: report(["openalex"], badWork({ year: -1 })) },
          ["openalex"],
        ),
      () =>
        decodeScholarlySearchDiscoveryResult(
          { report: report(["openalex"], badWork({ url: "javascript:alert(1)" })) },
          ["openalex"],
        ),
      () =>
        decodeScholarlySearchDiscoveryResult(
          {
            report: report(
              ["openalex"],
              badWork({ authors: [work().authors[0]!, undefined as never] }),
            ),
          },
          ["openalex"],
        ),
      () =>
        decodeScholarlySearchDiscoveryResult(
          {
            report: {
              ...report(),
              sources: { openalex: { count: 0, source: "s2", status: "empty" } },
            },
          },
          ["openalex"],
        ),
      () =>
        decodeScholarlySearchDiscoveryResult(
          { report: { ...report(), cursors: { openalex: { hasMore: false, page: 0 } } } },
          ["openalex"],
        ),
    ];
    for (const decode of invalid) expect(decode).toThrow();
  });

  it("rejects malformed enrichment and resolution fields", () => {
    const invalid = [
      () => decodeScholarEnrichByDoiResult({ enrichment: { citationCount: -1 } }),
      () => decodeScholarEnrichByDoiResult({ enrichment: { citationCount: 1.5 } }),
      () => decodeScholarEnrichByDoiResult({ enrichment: { url: "file:///secret" } }),
      () =>
        decodeScholarEnrichByDoiResult({
          enrichment: { url: `https://example.test/${"界".repeat(2700)}` },
        }),
      () => decodeScholarEnrichByDoiResult({ enrichment: { unknown: true } }),
      () => decodeLibraryResolveClueResult({ resolved: { confidence: 2, work: work() } }),
      () =>
        decodeLibraryResolveClueResult({
          resolved: { confidence: 1, work: work(), candidates: new Array(1) },
        }),
      () =>
        decodeLibraryResolveClueResult({
          resolved: {
            confidence: 1,
            work: work(),
            candidates: Array.from({ length: MAX_SCHOLARLY_CANDIDATES + 1 }, () => work()),
          },
        }),
    ];
    for (const decode of invalid) expect(decode).toThrow();
  });

  it("enforces nested field and aggregate size bounds", () => {
    expect(() =>
      decodeScholarlySearchDiscoveryResult(
        {
          report: report(["openalex"], [result("openalex")]),
        },
        ["openalex"],
      ),
    ).not.toThrow();
    const oversizedText = "x".repeat(MAX_SCHOLARLY_OUTPUT_BYTES);
    expect(() =>
      decodeLibraryResolveClueResult({
        resolved: { confidence: 1, work: work({ abstract: oversizedText }) },
      }),
    ).toThrow();
    expect(() =>
      decodeScholarlySearchDiscoveryResult(
        {
          report: report(["openalex"], [result("openalex")]),
        },
        ["openalex"],
      ),
    ).not.toThrow();
  });

  it("ignores inherited optional fields while rejecting inherited required fields", () => {
    const inherited = Object.create({ doi: "10.1000/inherited" }) as Record<string, unknown>;
    inherited.title = "Inherited-safe work";
    inherited.authors = [];
    inherited.source = "openalex";
    const decoded = decodeScholarlySearchDiscoveryResult(
      {
        report: report(["openalex"], [{ ...result("openalex"), work: inherited }]),
      },
      ["openalex"],
    );
    expect(decoded.report.results[0]!.work).not.toHaveProperty("doi");
  });

  it("rejects unsafe CSL JSON keys and cycles", () => {
    const unsafeJson: Record<string, unknown> = {};
    Object.defineProperty(unsafeJson, "__proto__", {
      configurable: true,
      enumerable: true,
      value: { polluted: true },
    });
    const unsafe = work({ cslJson: unsafeJson });
    expect(() =>
      decodeLibraryResolveClueResult({ resolved: { confidence: 1, work: unsafe } }),
    ).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      decodeLibraryResolveClueResult({
        resolved: { confidence: 1, work: work({ cslJson: cyclic }) },
      }),
    ).toThrow();
  });

  it("keeps the author and candidate limits explicit", () => {
    const authors = Array.from({ length: MAX_SCHOLARLY_AUTHOR_COUNT + 1 }, (_, position) => ({
      displayName: `Author ${position}`,
      position,
    }));
    expect(() =>
      decodeLibraryResolveClueResult({ resolved: { confidence: 1, work: work({ authors }) } }),
    ).toThrow();
  });
});
