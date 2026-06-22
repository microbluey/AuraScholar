import {
  searchOpenSourcesDetailed,
  type DiscoveryQuery,
  type DiscoveryResult,
  type DiscoverySort,
  type DiscoverySource,
  type DiscoverySearchReport,
  type SourceCursor,
} from "@aurascholar/core";
import { type NormalizedWork } from "@aurascholar/connectors";
import { workFingerprint } from "@aurascholar/db";
import { getDb } from "./tauri-db";
import { tauriHttp } from "./tauri-platform";
import { ingestResolvedWork, type IngestResult } from "./library";

const ctx = { http: tauriHttp, mailto: "contact@aurascholar.app" };

export interface DiscoveryResultWithLibrary extends DiscoveryResult {
  inLibrary: boolean;
  libraryWorkId?: string;
  /** Set after import when no PDF was attached — card can offer "find full text". */
  needsFulltext?: boolean;
}

export interface DiscoverySearchReportWithLibrary extends Omit<DiscoverySearchReport, "results"> {
  results: DiscoveryResultWithLibrary[];
}

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
  return ingestResolvedWork(work);
}

async function markLibraryStatus(
  results: DiscoveryResult[],
): Promise<DiscoveryResultWithLibrary[]> {
  if (!("aura" in window) || results.length === 0) {
    return results.map((result) => ({ ...result, inLibrary: false }));
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
    };
  });
}

function fingerprintForWork(work: NormalizedWork): string | null {
  const firstAuthor = work.authors[0]?.family ?? work.authors[0]?.displayName?.split(/\s+/).pop();
  if (!work.title) return null;
  return workFingerprint(work.title, work.year ?? null, firstAuthor ?? null);
}
