// Saved-search runner: re-runs stored open-source queries on a schedule and
// surfaces newly-published matches. The discovery analogue of the sentinel
// loop (services/sentinel.ts) — startup catch-up + hourly in-app timer.
import { SavedSearchesRepo, workFingerprint, type SavedSearchRow } from "@aurascholar/db";
import type { NormalizedWork } from "@aurascholar/connectors";
import { getDb } from "./tauri-db";
import { tauriNotifier } from "./tauri-platform";
import { searchDiscovery } from "./discovery";
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
}

function toView(row: SavedSearchRow): SavedSearchView {
  return {
    id: row.id,
    query: row.query,
    sources: row.sources_json ? (JSON.parse(row.sources_json) as DiscoverySource[]) : null,
    newCount: row.new_count,
    lastRunAt: row.last_run_at,
  };
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
): Promise<string> {
  const repo = new SavedSearchesRepo(await getDb());
  const id = await repo.create({ query, sources: sources ?? null });
  // Seed the baseline immediately so the first scheduled run only reports
  // genuinely new papers rather than the entire current result set.
  await runSavedSearch(id, { silent: true });
  return id;
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
  return runRow(repo, row, opts.silent ?? false);
}

async function runRow(
  repo: SavedSearchesRepo,
  row: SavedSearchRow,
  silent: boolean,
): Promise<number> {
  const sources = row.sources_json
    ? (JSON.parse(row.sources_json) as DiscoverySource[])
    : undefined;
  let results;
  try {
    results = await searchDiscovery(row.query, sources);
  } catch {
    // A transient failure shouldn't reset the baseline — reschedule and bail.
    await repo.recordRun(row.id, JSON.parse(row.seen_ids_json), 0, Date.now() + POLL_INTERVAL_MS);
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

  if (!silent && fresh.length > 0) {
    await tauriNotifier.notify({
      title: `🔎 检索订阅有 ${fresh.length} 篇新结果`,
      body: row.query,
      tag: `saved-search:${row.id}`,
    });
    window.dispatchEvent(new CustomEvent("aurascholar:saved-searches-updated"));
  }
  return fresh.length;
}

/** Poll every due saved search once. Returns total new results found. */
export async function runDueSavedSearches(): Promise<number> {
  const repo = new SavedSearchesRepo(await getDb());
  const due = await repo.due();
  let total = 0;
  for (const row of due) total += await runRow(repo, row, false);
  return total;
}

let started = false;

/** Startup catch-up + hourly re-check while the app is open. */
export function startSavedSearchLoop(): void {
  if (started) return;
  started = true;
  void runDueSavedSearches();
  setInterval(() => void runDueSavedSearches(), 60 * 60 * 1000);
}
