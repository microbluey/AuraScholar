import {
  mergeDiscoveryResults,
  type DiscoveryQuery,
  type DiscoveryResult,
  type DiscoverySort,
  type DiscoverySource,
  type DiscoverySearchReport,
  type SourceCursor,
} from "@aurascholar/core";
import { type NormalizedWork } from "@aurascholar/connectors";
import { isDesktopRuntime } from "./aura-platform";
import {
  discoveryLibraryStatusInput,
  loadDiscoveryLibraryStatuses,
  type DiscoveryLibraryStatusCommandClient,
} from "./discovery-library-status";
import type { IngestResult } from "./library-types";
import { searchScholarlyOpenSources } from "./scholarly-data";

export interface DiscoveryResultWithLibrary extends DiscoveryResult {
  inLibrary: boolean;
  libraryWorkId?: string;
  /** Set after import when no PDF was attached — card can offer "find full text". */
  needsFulltext?: boolean;
  /** Sources that contributed this merged result in the current UI search. */
  matchedSources: DiscoverySource[];
}

export interface DiscoverySearchReportWithLibrary extends Omit<DiscoverySearchReport, "results"> {
  results: DiscoveryResultWithLibrary[];
}

export { mergeDiscoveryResults };

export async function searchDiscovery(
  query: string,
  sources?: DiscoverySource[],
  signal?: AbortSignal,
): Promise<DiscoveryResultWithLibrary[]> {
  return (await searchDiscoveryDetailed(query, sources, signal)).results;
}

export async function searchDiscoveryDetailed(
  query: string | DiscoveryQuery,
  sources?: DiscoverySource[],
  signal?: AbortSignal,
  opts?: {
    sort?: DiscoverySort;
    page?: number;
    cursors?: Partial<Record<DiscoverySource, SourceCursor>>;
    limit?: number;
  },
): Promise<DiscoverySearchReportWithLibrary> {
  const smokeReport = await smokeDiscoveryReport(query, sources, signal);
  if (smokeReport) return smokeReport;
  const normalizedQuery: DiscoveryQuery = typeof query === "string" ? { text: query } : query;
  const { report } = await searchScholarlyOpenSources(
    {
      cursors: opts?.cursors,
      limit: opts?.limit ?? 20,
      page: opts?.page,
      query: normalizedQuery,
      sort: opts?.sort,
      sources,
    },
    signal,
  );
  const results = await markLibraryStatus(report.results, signal);
  return { ...report, results };
}

export async function importDiscoveryResult(work: NormalizedWork): Promise<IngestResult> {
  const smokeResult = await smokeDiscoveryImportResult(work);
  if (smokeResult) return smokeResult;
  const { ingestResolvedWork } = await import("./library");
  return ingestResolvedWork(work);
}

export async function markLibraryStatus(
  results: DiscoveryResult[],
  signal?: AbortSignal,
): Promise<DiscoveryResultWithLibrary[]> {
  if (!isDesktopRuntime() || results.length === 0) {
    return results.map((result) => ({
      ...result,
      inLibrary: false,
      matchedSources: [result.source],
    }));
  }

  const { statuses } = await loadDiscoveryLibraryStatuses(
    discoveryLibraryStatusCommandClient,
    discoveryLibraryStatusInput(results),
    { signal },
  );
  return results.map((result, index) => {
    const status = statuses[index]!;
    const workId = status.workId ?? undefined;
    return {
      ...result,
      inLibrary: workId !== undefined,
      libraryWorkId: workId,
      matchedSources: [result.source],
      needsFulltext: workId ? !status.hasPdf : undefined,
    };
  });
}

const discoveryLibraryStatusCommandClient: DiscoveryLibraryStatusCommandClient = {
  command(name, input) {
    return window.aura.data.command(name, input);
  },
};

interface DiscoverySmokeImportFixture {
  delayMs?: number;
  deduped?: boolean;
  doi?: string;
  needsConfirmation?: boolean;
  pdfError?: string;
  pdfFetched?: boolean;
  title?: string;
  workId?: string;
}

interface DiscoverySmokeFixture {
  acceptAnyQuery?: boolean;
  delayMs?: number;
  empty?: boolean;
  query: string;
  title: string;
  doi?: string;
  abstract?: string;
  year?: number;
  venueName?: string;
  oaPdfUrl?: string;
  citedByCount?: number;
  hasMore?: boolean;
  importResult?: DiscoverySmokeImportFixture;
  page?: number;
}

interface DiscoverySmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__?: DiscoverySmokeFixture | null;
  __AURASCHOLAR_SMOKE_DISCOVERY_IMPORT_CALL_COUNT__?: number;
}

async function smokeDiscoveryImportResult(work: NormalizedWork): Promise<IngestResult | null> {
  const smokeWindow = window as DiscoverySmokeWindow;
  const fixture = smokeWindow.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
  const importResult = fixture?.importResult;
  if (!importResult) return null;
  if (importResult.doi && importResult.doi.toLowerCase() !== work.doi?.toLowerCase()) return null;
  smokeWindow.__AURASCHOLAR_SMOKE_DISCOVERY_IMPORT_CALL_COUNT__ =
    (smokeWindow.__AURASCHOLAR_SMOKE_DISCOVERY_IMPORT_CALL_COUNT__ ?? 0) + 1;
  if (importResult.delayMs && importResult.delayMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, importResult.delayMs));
  }
  return {
    workId: importResult.workId ?? `smoke-work:${work.doi ?? work.title}`,
    deduped: importResult.deduped ?? false,
    title: importResult.title ?? work.title,
    pdfFetched: importResult.pdfFetched ?? false,
    pdfError: importResult.pdfError,
    needsConfirmation: importResult.needsConfirmation,
  };
}

async function smokeDiscoveryReport(
  query: string | DiscoveryQuery,
  sources?: DiscoverySource[],
  signal?: AbortSignal,
): Promise<DiscoverySearchReportWithLibrary | null> {
  const fixture = (window as DiscoverySmokeWindow).__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
  const text = (typeof query === "string" ? query : query.text).trim();
  if (!fixture || (!fixture.acceptAnyQuery && text !== fixture.query)) return null;
  if (fixture.delayMs && fixture.delayMs > 0) {
    await waitForSmokeDelay(fixture.delayMs, signal);
  }

  const requestedSources: DiscoverySource[] =
    sources && sources.length > 0 ? sources : ["crossref", "openalex", "s2", "arxiv"];
  const page = fixture.page ?? 1;
  const cursor = {
    page: Number.isFinite(page) && page > 0 ? Math.trunc(page) : 1,
    hasMore: Boolean(fixture.hasMore),
  };
  if (fixture.empty) {
    return {
      results: [],
      sources: Object.fromEntries(
        requestedSources.map((source) => [
          source,
          {
            source,
            status: "empty",
            count: 0,
          },
        ]),
      ) as DiscoverySearchReportWithLibrary["sources"],
      cursors: Object.fromEntries(
        requestedSources.map((source) => [source, cursor]),
      ) as DiscoverySearchReportWithLibrary["cursors"],
    };
  }
  const activeSources = new Set<DiscoverySource>(
    requestedSources.filter((source) => source !== "arxiv"),
  );
  const results: DiscoveryResultWithLibrary[] = [...activeSources].map((source, index) => ({
    id: `smoke-discovery:${source}:${fixture.doi ?? fixture.title}:${index}`,
    source,
    score: Math.max(82, 100 - index * 4),
    inLibrary: false,
    matchedSources: [source],
    work: {
      title: fixture.title,
      doi: fixture.doi,
      abstract: fixture.abstract,
      year: fixture.year,
      venueName: fixture.venueName,
      authors: [{ displayName: "Smoke Researcher", family: "Researcher", position: 0 }],
      citedByCount: source === "crossref" ? undefined : fixture.citedByCount,
      oaPdfUrl: source === "crossref" ? undefined : fixture.oaPdfUrl,
      openalexId: source === "openalex" ? "W4242424242" : undefined,
      s2Id: source === "s2" ? "smoke-s2-trust-signal" : undefined,
      source,
    },
  }));

  return {
    results,
    sources: Object.fromEntries(
      requestedSources.map((source) => [
        source,
        {
          source,
          status: activeSources.has(source) ? "done" : "empty",
          count: activeSources.has(source) ? 1 : 0,
        },
      ]),
    ) as DiscoverySearchReportWithLibrary["sources"],
    cursors: Object.fromEntries(
      requestedSources.map((source) => [source, cursor]),
    ) as DiscoverySearchReportWithLibrary["cursors"],
  };
}

function waitForSmokeDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error("smoke discovery search aborted"));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error("smoke discovery search aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
