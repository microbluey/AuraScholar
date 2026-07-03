// Saved-search runner: re-runs stored open-source queries on a schedule and
// surfaces newly-published matches. The discovery analogue of the sentinel
// loop (services/sentinel.ts) — startup catch-up + hourly in-app timer.
import { workFingerprint } from "@aurascholar/db/ids";
import {
  SavedSearchesRepo,
  type SavedSearchRow,
} from "@aurascholar/db/repos/saved-searches";
import type { NormalizedWork } from "@aurascholar/connectors";
import { getDb } from "./aura-db";
import { auraNotifier } from "./aura-platform";
import type { DiscoveryResultWithLibrary } from "./discovery";
import type { DiscoverySource } from "@aurascholar/core";

// How long until a saved search is polled again. Conservative — new
// publications appear over days, not minutes, and we want to stay polite to the
// open APIs.
const POLL_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h

export interface SavedSearchView {
  id: string;
  query: string;
  sources: DiscoverySource[] | null;
  newCount: number;
  lastRunAt: number | null;
  lastError: string | null;
}

export interface CreateSavedSearchResult {
  created: boolean;
  id: string;
}

const ALL_DISCOVERY_SOURCES: DiscoverySource[] = ["arxiv", "crossref", "openalex", "s2"];

function toView(row: SavedSearchRow): SavedSearchView {
  return {
    id: row.id,
    query: row.query,
    sources: row.sources_json ? (JSON.parse(row.sources_json) as DiscoverySource[]) : null,
    newCount: row.new_count,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
  };
}

function parseSources(value: string | null): DiscoverySource[] | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as DiscoverySource[];
  } catch {
    return null;
  }
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function canonicalSources(sources?: DiscoverySource[] | null): DiscoverySource[] {
  const selected = sources && sources.length > 0 ? sources : ALL_DISCOVERY_SOURCES;
  const unique = [...new Set(selected)];
  const allSelected =
    unique.length === ALL_DISCOVERY_SOURCES.length &&
    ALL_DISCOVERY_SOURCES.every((source) => unique.includes(source));
  return [...(allSelected ? ALL_DISCOVERY_SOURCES : unique)].sort();
}

function sameSources(a?: DiscoverySource[] | null, b?: DiscoverySource[] | null): boolean {
  return JSON.stringify(canonicalSources(a)) === JSON.stringify(canonicalSources(b));
}

/** Stable identity for a result, matching the discovery dedupe keys. */
function stableId(work: NormalizedWork): string {
  if (work.doi) return `doi:${work.doi.toLowerCase()}`;
  if (work.arxivId) return `arxiv:${work.arxivId.toLowerCase()}`;
  if (work.openalexId) return `openalex:${work.openalexId.toLowerCase()}`;
  if (work.s2Id) return `s2:${work.s2Id.toLowerCase()}`;
  if (work.pmid) return `pmid:${work.pmid.toLowerCase()}`;
  const firstAuthor = work.authors[0]?.family ?? work.authors[0]?.displayName?.split(/\s+/).pop();
  return `fp:${workFingerprint(work.title, work.year ?? null, firstAuthor ?? null)}`;
}

export async function listSavedSearches(): Promise<SavedSearchView[]> {
  const repo = new SavedSearchesRepo(await getDb());
  return (await repo.list()).map(toView);
}

export async function createSavedSearch(
  query: string,
  sources?: DiscoverySource[],
): Promise<CreateSavedSearchResult> {
  const repo = new SavedSearchesRepo(await getDb());
  const normalizedQuery = normalizeQuery(query);
  const existing = (await repo.list()).find(
    (row) =>
      normalizeQuery(row.query) === normalizedQuery && sameSources(parseSources(row.sources_json), sources),
  );
  if (existing) return { created: false, id: existing.id };

  const storedSources = sameSources(sources, null) ? null : canonicalSources(sources);
  const id = await repo.create({
    query: query.trim().replace(/\s+/g, " "),
    sources: storedSources,
  });
  // Seed the baseline immediately so the first scheduled run only reports
  // genuinely new papers rather than the entire current result set.
  await runSavedSearch(id, { silent: true });
  return { created: true, id };
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const repo = new SavedSearchesRepo(await getDb());
  await repo.softDelete(id);
}

export async function clearSavedSearchBadge(id: string): Promise<void> {
  const repo = new SavedSearchesRepo(await getDb());
  await repo.clearNew(id);
}

/** Run one saved search now. Returns the number of newly-seen results. */
export async function runSavedSearch(
  id: string,
  opts: { silent?: boolean } = {},
): Promise<number> {
  const repo = new SavedSearchesRepo(await getDb());
  const rows = await repo.list();
  const row = rows.find((r) => r.id === id);
  if (!row) return 0;
  return runRow(repo, row, {
    silent: opts.silent ?? false,
    throwOnError: !(opts.silent ?? false),
  });
}

async function runRow(
  repo: SavedSearchesRepo,
  row: SavedSearchRow,
  options: { silent: boolean; throwOnError: boolean },
): Promise<number> {
  const sources = row.sources_json
    ? (JSON.parse(row.sources_json) as DiscoverySource[])
    : undefined;
  let results: DiscoveryResultWithLibrary[];
  try {
    const { searchDiscoveryDetailed } = await import("./discovery");
    const report = await searchDiscoveryDetailed(row.query, sources);
    if (isDiscoveryReportUnavailable(report)) {
      throw new Error(discoveryReportErrorMessage(report));
    }
    results = report.results;
  } catch (error) {
    // A transient failure shouldn't reset the baseline — reschedule and bail.
    const message = error instanceof Error ? error.message : String(error);
    await repo.recordError(row.id, message, Date.now() + POLL_INTERVAL_MS);
    notifySavedSearchesUpdated();
    if (options.throwOnError) throw new Error(message, { cause: error });
    return 0;
  }

  const seen = new Set<string>(JSON.parse(row.seen_ids_json) as string[]);
  const currentIds = results.map((r) => stableId(r.work));
  const isFirstRun = seen.size === 0 && row.last_run_at == null;
  const fresh = isFirstRun ? [] : currentIds.filter((key) => !seen.has(key));

  // The new baseline is the union of what we've ever seen and what's here now,
  // so a paper dropping out of the top results doesn't re-alert when it returns.
  const nextSeen = [...new Set([...seen, ...currentIds])];
  await repo.recordRun(row.id, nextSeen, fresh.length, Date.now() + POLL_INTERVAL_MS);

  notifySavedSearchesUpdated();

  if (!options.silent && fresh.length > 0) {
    await auraNotifier.notify({
      title: `🔎 检索订阅有 ${fresh.length} 篇新结果`,
      body: row.query,
      tag: `saved-search:${row.id}`,
    });
  }
  return fresh.length;
}

function isDiscoveryReportUnavailable(report: { sources: DiscoverySearchReportSources }): boolean {
  const sources = sourceReports(report.sources);
  return sources.length > 0 && sources.every((source) => SOURCE_FAILURE_STATUSES.has(source.status));
}

function discoveryReportErrorMessage(report: { sources: DiscoverySearchReportSources }): string {
  const details = sourceReports(report.sources)
    .filter((source) => SOURCE_FAILURE_STATUSES.has(source.status))
    .map((source) => `${sourceLabel(source.source)} ${sourceStatusLabel(source.status)}`)
    .join("; ");
  return details ? `检索源暂时不可用:${details}` : "检索源暂时不可用";
}

type DiscoverySearchSourceReport = { source: DiscoverySource; status: string; error?: string };
type DiscoverySearchReportSources = Partial<Record<DiscoverySource, DiscoverySearchSourceReport>>;

const SOURCE_FAILURE_STATUSES = new Set(["timeout", "error", "rate_limited", "aborted"]);

function sourceReports(sources: DiscoverySearchReportSources): DiscoverySearchSourceReport[] {
  return Object.values(sources).filter((source): source is DiscoverySearchSourceReport =>
    Boolean(source),
  );
}

function sourceLabel(source: DiscoverySource): string {
  switch (source) {
    case "crossref":
      return "Crossref";
    case "openalex":
      return "OpenAlex";
    case "s2":
      return "Semantic Scholar";
    case "arxiv":
      return "arXiv";
  }
}

function sourceStatusLabel(status: string): string {
  if (status === "timeout") return "超时";
  if (status === "rate_limited") return "限流";
  if (status === "aborted") return "已停止";
  return "失败";
}

/** Poll every due saved search once. Returns total new results found. */
export async function runDueSavedSearches(): Promise<number> {
  const repo = new SavedSearchesRepo(await getDb());
  const due = await repo.due();
  let total = 0;
  for (const row of due) {
    total += await runRow(repo, row, { silent: false, throwOnError: false });
  }
  return total;
}

function notifySavedSearchesUpdated(): void {
  window.dispatchEvent(new CustomEvent("aurascholar:saved-searches-updated"));
}

let started = false;

/** Startup catch-up + hourly re-check while the app is open. */
export function startSavedSearchLoop(): void {
  if (started) return;
  started = true;
  void runDueSavedSearches();
  setInterval(() => void runDueSavedSearches(), 60 * 60 * 1000);
}
