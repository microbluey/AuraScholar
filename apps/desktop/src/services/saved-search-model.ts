import type { NormalizedWork } from "@aurascholar/connectors";
import type { DiscoveryQuery, DiscoverySource } from "@aurascholar/core";
import { workFingerprint } from "@aurascholar/db/ids";
import type { SavedSearchRow } from "../../electron/data-command-contract";
import { parseSavedSearchCriteria } from "../shared/saved-search-criteria";
import { describeSafeError } from "./sensitive-text";

export interface SavedSearchView {
  id: string;
  query: string;
  criteria: DiscoveryQuery;
  sources: DiscoverySource[] | null;
  newCount: number;
  lastRunAt: number | null;
  lastError: string | null;
}

const ALL_DISCOVERY_SOURCES: DiscoverySource[] = ["arxiv", "crossref", "openalex", "s2"];

export function toSavedSearchView(row: SavedSearchRow): SavedSearchView {
  return {
    id: row.id,
    query: row.query,
    criteria: parseSavedSearchCriteria(row.criteria_json, row.query),
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
