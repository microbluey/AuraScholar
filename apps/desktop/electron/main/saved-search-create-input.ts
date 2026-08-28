import type { DiscoverySource } from "@aurascholar/core";
import type { SavedSearchRow } from "@aurascholar/db/repos/saved-searches";
import {
  normalizeSavedSearchCriteria,
  parseSavedSearchCriteria,
  savedSearchCriteriaKey,
} from "../../src/shared/saved-search-criteria";
import type { CreateSavedSearchCommandInput } from "../data-command-contract";
import { isRecord, requireRecordId } from "./data-command-runtime";

const ALL_DISCOVERY_SOURCES: readonly DiscoverySource[] = ["arxiv", "crossref", "openalex", "s2"];

export function parseCreateSavedSearchInput(value: unknown): CreateSavedSearchCommandInput {
  if (!isRecord(value)) throw new Error("Invalid savedSearch.create input");
  const query = normalizeSavedSearchCriteria({ text: value.query }).text;
  const criteria =
    value.criteria === undefined ? { text: query } : normalizeSavedSearchCriteria(value.criteria);
  if (savedSearchCriteriaKey({ text: query }) !== savedSearchCriteriaKey({ text: criteria.text })) {
    throw new Error("Saved search query must match its criteria");
  }
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    query: criteria.text,
    criteria,
    sources: parseSources(value.sources),
  };
}

export function matchesSavedSearchInput(
  row: SavedSearchRow,
  input: CreateSavedSearchCommandInput,
): boolean {
  return (
    savedSearchCriteriaKey(parseSavedSearchCriteria(row.criteria_json, row.query)) ===
      savedSearchCriteriaKey(input.criteria ?? { text: input.query }) &&
    sourceKey(parsePersistedSources(row.sources_json)) === sourceKey(input.sources)
  );
}

function parseSources(value: unknown): DiscoverySource[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > ALL_DISCOVERY_SOURCES.length) {
    throw new Error("Saved search sources are invalid");
  }
  const sources = value.map((source) => {
    if (!isDiscoverySource(source)) throw new Error("Saved search source is invalid");
    return source;
  });
  if (new Set(sources).size !== sources.length) {
    throw new Error("Saved search sources must be unique");
  }
  if (
    sources.length === ALL_DISCOVERY_SOURCES.length &&
    ALL_DISCOVERY_SOURCES.every((source) => sources.includes(source))
  ) {
    return null;
  }
  return [...sources].sort(
    (left, right) => ALL_DISCOVERY_SOURCES.indexOf(left) - ALL_DISCOVERY_SOURCES.indexOf(right),
  );
}

function parsePersistedSources(value: string | null): DiscoverySource[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const sources = parsed.filter(isDiscoverySource);
    if (sources.length === 0) return null;
    return [...new Set(sources)].sort(
      (left, right) => ALL_DISCOVERY_SOURCES.indexOf(left) - ALL_DISCOVERY_SOURCES.indexOf(right),
    );
  } catch {
    return null;
  }
}

function sourceKey(value: DiscoverySource[] | null): string {
  return JSON.stringify(value ?? ALL_DISCOVERY_SOURCES);
}

function isDiscoverySource(value: unknown): value is DiscoverySource {
  return (ALL_DISCOVERY_SOURCES as readonly unknown[]).includes(value);
}
