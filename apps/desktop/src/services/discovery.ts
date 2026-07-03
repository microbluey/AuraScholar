import {
  mergeDiscoveryResults,
  searchOpenSourcesDetailed,
  type DiscoveryQuery,
  type DiscoveryResult,
  type DiscoverySort,
  type DiscoverySource,
  type DiscoverySearchReport,
  type SourceCursor,
} from "@aurascholar/core";
import { type NormalizedWork } from "@aurascholar/connectors";
import { workFingerprint } from "@aurascholar/db/ids";
import { getDb } from "./aura-db";
import { auraHttp } from "./aura-platform";
import type { IngestResult } from "./library-types";

const ctx = { http: auraHttp, mailto: "contact@aurascholar.app" };

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
  const smokeReport = smokeDiscoveryReport(query, sources);
  if (smokeReport) return smokeReport;
  const report = await searchOpenSourcesDetailed(ctx, query, {
    sources,
    limit: opts?.limit ?? 20,
    timeoutMs: 5_000,
    signal,
    sort: opts?.sort,
    page: opts?.page,
    cursors: opts?.cursors,
  });
  const results = await markLibraryStatus(report.results);
  return { ...report, results };
}

export async function importDiscoveryResult(work: NormalizedWork): Promise<IngestResult> {
  const smokeResult = await smokeDiscoveryImportResult(work);
  if (smokeResult) return smokeResult;
  const { ingestResolvedWork } = await import("./library");
  return ingestResolvedWork(work);
}

async function markLibraryStatus(
  results: DiscoveryResult[],
): Promise<DiscoveryResultWithLibrary[]> {
  if (!("aura" in window) || results.length === 0) {
    return results.map((result) => ({
      ...result,
      inLibrary: false,
      matchedSources: [result.source],
    }));
  }

  const db = await getDb();
  const dois = [...new Set(results.map((r) => r.work.doi).filter((doi): doi is string => !!doi))];
  const arxivIds = [
    ...new Set(results.map((r) => r.work.arxivId).filter((id): id is string => !!id)),
  ];
  const openalexIds = [
    ...new Set(results.map((r) => r.work.openalexId).filter((id): id is string => !!id)),
  ];
  const s2Ids = [...new Set(results.map((r) => r.work.s2Id).filter((id): id is string => !!id))];
  const pmids = [...new Set(results.map((r) => r.work.pmid).filter((id): id is string => !!id))];
  const fingerprints = [
    ...new Set(
      results
        .map((r) => fingerprintForWork(r.work))
        .filter((fingerprint): fingerprint is string => !!fingerprint),
    ),
  ];

  const byDoi = new Map<string, string>();
  const byArxiv = new Map<string, string>();
  const byOpenAlex = new Map<string, string>();
  const byS2 = new Map<string, string>();
  const byPmid = new Map<string, string>();
  const byFingerprint = new Map<string, string>();

  if (dois.length > 0) {
    const rows = await db.query<{ id: string; doi: string }>(
      `SELECT id, doi FROM works WHERE doi IN (${dois.map(() => "?").join(",")}) AND deleted_at IS NULL`,
      dois,
    );
    for (const row of rows) byDoi.set(row.doi.toLowerCase(), row.id);
  }

  if (arxivIds.length > 0) {
    const rows = await db.query<{ id: string; arxiv_id: string }>(
      `SELECT id, arxiv_id FROM works WHERE arxiv_id IN (${arxivIds.map(() => "?").join(",")}) AND deleted_at IS NULL`,
      arxivIds,
    );
    for (const row of rows) byArxiv.set(row.arxiv_id.toLowerCase(), row.id);
  }

  if (openalexIds.length > 0) {
    const rows = await db.query<{ id: string; openalex_id: string }>(
      `SELECT id, openalex_id FROM works WHERE openalex_id IN (${openalexIds.map(() => "?").join(",")}) AND deleted_at IS NULL`,
      openalexIds,
    );
    for (const row of rows) byOpenAlex.set(row.openalex_id.toLowerCase(), row.id);
  }

  if (s2Ids.length > 0) {
    const rows = await db.query<{ id: string; s2_id: string }>(
      `SELECT id, s2_id FROM works WHERE s2_id IN (${s2Ids.map(() => "?").join(",")}) AND deleted_at IS NULL`,
      s2Ids,
    );
    for (const row of rows) byS2.set(row.s2_id.toLowerCase(), row.id);
  }

  if (pmids.length > 0) {
    const rows = await db.query<{ id: string; pmid: string }>(
      `SELECT id, pmid FROM works WHERE pmid IN (${pmids.map(() => "?").join(",")}) AND deleted_at IS NULL`,
      pmids,
    );
    for (const row of rows) byPmid.set(row.pmid.toLowerCase(), row.id);
  }

  if (fingerprints.length > 0) {
    const rows = await db.query<{ id: string; fingerprint: string }>(
      `SELECT id, fingerprint FROM works WHERE fingerprint IN (${fingerprints.map(() => "?").join(",")}) AND deleted_at IS NULL`,
      fingerprints,
    );
    for (const row of rows) byFingerprint.set(row.fingerprint, row.id);
  }

  return results.map((result) => {
    const work = result.work;
    const fingerprint = fingerprintForWork(work);
    const id =
      (work.doi ? byDoi.get(work.doi.toLowerCase()) : undefined) ??
      (work.arxivId ? byArxiv.get(work.arxivId.toLowerCase()) : undefined) ??
      (work.openalexId ? byOpenAlex.get(work.openalexId.toLowerCase()) : undefined) ??
      (work.s2Id ? byS2.get(work.s2Id.toLowerCase()) : undefined) ??
      (work.pmid ? byPmid.get(work.pmid.toLowerCase()) : undefined) ??
      (fingerprint ? byFingerprint.get(fingerprint) : undefined);
    return {
      ...result,
      inLibrary: !!id,
      libraryWorkId: id,
      matchedSources: [result.source],
    };
  });
}

interface DiscoverySmokeImportFixture {
  delayMs?: number;
  deduped?: boolean;
  doi?: string;
  needsConfirmation?: boolean;
  pdfFetched?: boolean;
  title?: string;
  workId?: string;
}

interface DiscoverySmokeFixture {
  acceptAnyQuery?: boolean;
  query: string;
  title: string;
  doi?: string;
  abstract?: string;
  year?: number;
  venueName?: string;
  oaPdfUrl?: string;
  citedByCount?: number;
  importResult?: DiscoverySmokeImportFixture;
}

interface DiscoverySmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__?: DiscoverySmokeFixture | null;
}

async function smokeDiscoveryImportResult(work: NormalizedWork): Promise<IngestResult | null> {
  const fixture = (window as DiscoverySmokeWindow).__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
  const importResult = fixture?.importResult;
  if (!importResult) return null;
  if (importResult.doi && importResult.doi.toLowerCase() !== work.doi?.toLowerCase()) return null;
  if (importResult.delayMs && importResult.delayMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, importResult.delayMs));
  }
  return {
    workId: importResult.workId ?? `smoke-work:${work.doi ?? work.title}`,
    deduped: importResult.deduped ?? false,
    title: importResult.title ?? work.title,
    pdfFetched: importResult.pdfFetched ?? false,
    needsConfirmation: importResult.needsConfirmation,
  };
}

function smokeDiscoveryReport(
  query: string | DiscoveryQuery,
  sources?: DiscoverySource[],
): DiscoverySearchReportWithLibrary | null {
  const fixture = (window as DiscoverySmokeWindow).__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
  const text = (typeof query === "string" ? query : query.text).trim();
  if (!fixture || (!fixture.acceptAnyQuery && text !== fixture.query)) return null;

  const requestedSources: DiscoverySource[] =
    sources && sources.length > 0 ? sources : ["crossref", "openalex", "s2", "arxiv"];
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
      requestedSources.map((source) => [source, { page: 1, hasMore: false }]),
    ) as DiscoverySearchReportWithLibrary["cursors"],
  };
}

function fingerprintForWork(work: NormalizedWork): string | null {
  const firstAuthor = work.authors[0]?.family ?? work.authors[0]?.displayName?.split(/\s+/).pop();
  if (!work.title) return null;
  return workFingerprint(work.title, work.year ?? null, firstAuthor ?? null);
}
