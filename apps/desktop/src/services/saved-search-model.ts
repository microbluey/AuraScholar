import type { NormalizedWork } from "@aurascholar/connectors";
import type { DiscoverySource } from "@aurascholar/core";
import { workFingerprint } from "@aurascholar/db/ids";
import type { SavedSearchRow } from "@aurascholar/db/repos/saved-searches";
import { describeSafeError } from "./sensitive-text";

export interface SavedSearchView {
  id: string;
  query: string;
  sources: DiscoverySource[] | null;
  newCount: number;
  lastRunAt: number | null;
  lastError: string | null;
}

const ALL_DISCOVERY_SOURCES: DiscoverySource[] = ["arxiv", "crossref", "openalex", "s2"];
const SOURCE_FAILURE_STATUSES = new Set(["timeout", "error", "rate_limited", "aborted"]);

type DiscoverySearchSourceReport = {
  source: DiscoverySource;
  status: string;
  error?: string;
};

type DiscoverySearchReportSources = Partial<Record<DiscoverySource, DiscoverySearchSourceReport>>;

export function toSavedSearchView(row: SavedSearchRow): SavedSearchView {
  return {
    id: row.id,
    query: row.query,
    sources: parseSavedSearchSources(row.sources_json),
    newCount: row.new_count,
    lastRunAt: row.last_run_at,
    lastError: row.last_error ? describeSafeError(row.last_error) : null,
  };
}

export function parseSavedSearchSources(value: string | null): DiscoverySource[] | null {
  if (!value) return null;
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return null;
  const sources = parsed.filter(isDiscoverySource);
  return sources.length ? [...new Set(sources)] : null;
}

export function canonicalSavedSearchSources(
  sources?: DiscoverySource[] | null,
): DiscoverySource[] | null {
  const selected = sources && sources.length > 0 ? sources : ALL_DISCOVERY_SOURCES;
  const unique = [...new Set(selected)];
  const allSelected =
    unique.length === ALL_DISCOVERY_SOURCES.length &&
    ALL_DISCOVERY_SOURCES.every((source) => unique.includes(source));
  return allSelected ? null : [...unique].sort();
}

/** Stable identity matching the Discovery result deduplication keys. */
export function savedSearchResultId(work: NormalizedWork): string {
  if (work.doi) return `doi:${work.doi.toLowerCase()}`;
  if (work.arxivId) return `arxiv:${work.arxivId.toLowerCase()}`;
  if (work.openalexId) return `openalex:${work.openalexId.toLowerCase()}`;
  if (work.s2Id) return `s2:${work.s2Id.toLowerCase()}`;
  if (work.pmid) return `pmid:${work.pmid.toLowerCase()}`;
  const firstAuthor = work.authors[0]?.family ?? work.authors[0]?.displayName?.split(/\s+/).pop();
  return `fp:${workFingerprint(work.title, work.year ?? null, firstAuthor ?? null)}`;
}

export function isSavedSearchReportUnavailable(report: {
  sources: DiscoverySearchReportSources;
}): boolean {
  const sources = sourceReports(report.sources);
  return (
    sources.length > 0 && sources.every((source) => SOURCE_FAILURE_STATUSES.has(source.status))
  );
}

export function savedSearchReportErrorMessage(report: {
  sources: DiscoverySearchReportSources;
}): string {
  const details = sourceReports(report.sources)
    .filter((source) => SOURCE_FAILURE_STATUSES.has(source.status))
    .map((source) => `${sourceLabel(source.source)} ${sourceStatusLabel(source.status)}`)
    .join("; ");
  return details ? `检索源暂时不可用:${details}` : "检索源暂时不可用";
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isDiscoverySource(value: unknown): value is DiscoverySource {
  return value === "arxiv" || value === "crossref" || value === "openalex" || value === "s2";
}

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
