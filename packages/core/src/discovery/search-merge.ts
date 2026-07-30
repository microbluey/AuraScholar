import type { NormalizedWork } from "@aurascholar/connectors";
import type {
  DiscoveryResult,
  DiscoveryResultMerger,
  DiscoverySort,
  DiscoverySource,
} from "./search.js";

export function mergeDiscoveryResults<T extends DiscoveryResult>(
  results: T[],
  mergePreferred?: DiscoveryResultMerger<T>,
  sortKey: DiscoverySort = "relevance",
): T[] {
  interface MergeGroup {
    result: T;
    keys: Set<string>;
  }

  const groups: MergeGroup[] = [];
  const keyToGroups = new Map<string, Set<MergeGroup>>();
  for (const result of results) {
    const keys = dedupeKeys(result.work);
    const linked = [...new Set(keys.flatMap((key) => [...(keyToGroups.get(key) ?? [])]))].filter(
      (group) => !hasConflictingStableKeys(group.keys, keys),
    );
    const exactMatches = linked.filter((group) => hasMatchingStableKey(group.keys, keys));
    const candidates =
      linked.length <= 1
        ? linked
        : exactMatches.every((candidate, index) =>
              exactMatches
                .slice(index + 1)
                .every((other) => !hasConflictingStableKeys(candidate.keys, other.keys)),
            )
          ? exactMatches
          : [];
    let group = candidates[0];

    if (!group) {
      group = { result: mergePreferred?.(undefined, result) ?? result, keys: new Set(keys) };
      groups.push(group);
    } else {
      for (const other of candidates.slice(1)) {
        if (hasConflictingStableKeys(group.keys, other.keys)) continue;
        group.result = mergePair(group.result, other.result, mergePreferred);
        for (const key of other.keys) group.keys.add(key);
        groups.splice(groups.indexOf(other), 1);
        for (const key of other.keys) keyToGroups.get(key)?.delete(other);
      }
      group.result = mergePair(group.result, result, mergePreferred);
      for (const key of keys) group.keys.add(key);
    }

    for (const key of group.keys) {
      const linkedGroups = keyToGroups.get(key) ?? new Set<MergeGroup>();
      linkedGroups.add(group);
      keyToGroups.set(key, linkedGroups);
    }
  }

  return groups.map((group) => group.result).sort(comparatorFor(sortKey));
}

export function sameDiscoveryWorkIdentity(left: NormalizedWork, right: NormalizedWork): boolean {
  if (hasConflictingDiscoveryIdentifiers(left, right)) return false;
  if (hasMatchingStableIdentifier(left, right)) return true;
  return (
    Boolean(left.title) &&
    normalizeDiscoveryTitle(left.title) === normalizeDiscoveryTitle(right.title) &&
    (left.year ?? null) === (right.year ?? null)
  );
}

export function hasConflictingDiscoveryIdentifiers(
  left: DiscoveryStableIdentifiers,
  right: DiscoveryStableIdentifiers,
): boolean {
  return STABLE_DISCOVERY_IDENTIFIERS.some((field) => {
    const leftValue = normalizeIdentifier(left[field]);
    const rightValue = normalizeIdentifier(right[field]);
    return Boolean(leftValue && rightValue && leftValue !== rightValue);
  });
}

export function normalizeDiscoveryTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Unified ordering for the merged set; falls back to relevance as tiebreak. */
function comparatorFor(sortKey: DiscoverySort) {
  return (a: DiscoveryResult, b: DiscoveryResult): number => {
    if (sortKey === "year") {
      return sortYear(b.work) - sortYear(a.work) || b.score - a.score;
    }
    if (sortKey === "citations") {
      return (b.work.citedByCount ?? -1) - (a.work.citedByCount ?? -1) || b.score - a.score;
    }
    return b.score - a.score || sortYear(b.work) - sortYear(a.work);
  };
}

function mergePair<T extends DiscoveryResult>(
  existing: T,
  result: T,
  mergePreferred?: DiscoveryResultMerger<T>,
): T {
  const [preferred, fallback] = prefersResult(result, existing)
    ? [result, existing]
    : [existing, result];
  // Keep cross-source signals even when the less-complete record carries them:
  // Crossref is the bibliographic winner but reports no citation count or OA
  // link, which OpenAlex/S2 do.
  const work: NormalizedWork = {
    ...preferred.work,
    doi: mergedStableIdentifier(preferred.work.doi, fallback.work.doi),
    arxivId: mergedStableIdentifier(preferred.work.arxivId, fallback.work.arxivId),
    openalexId: mergedStableIdentifier(preferred.work.openalexId, fallback.work.openalexId),
    s2Id: mergedStableIdentifier(preferred.work.s2Id, fallback.work.s2Id),
    pmid: mergedStableIdentifier(preferred.work.pmid, fallback.work.pmid),
    citedByCount: preferred.work.citedByCount ?? fallback.work.citedByCount,
    oaPdfUrl: preferred.work.oaPdfUrl ?? fallback.work.oaPdfUrl,
  };
  const withBestScore = {
    ...preferred,
    work,
    score: Math.max(existing.score, result.score),
  } as T;
  return mergePreferred?.(fallback, withBestScore) ?? withBestScore;
}

function prefersResult(candidate: DiscoveryResult, current: DiscoveryResult): boolean {
  const sourceRank: Record<DiscoverySource, number> = {
    crossref: 4,
    openalex: 3,
    s2: 2,
    arxiv: 1,
  };
  const currentCompleteness = completeness(current.work) + sourceRank[current.source];
  const candidateCompleteness = completeness(candidate.work) + sourceRank[candidate.source];
  return candidateCompleteness > currentCompleteness;
}

function completeness(work: NormalizedWork): number {
  return [
    work.doi,
    work.abstract,
    work.venueName,
    work.year,
    work.authors.length > 0 ? "authors" : undefined,
    work.oaPdfUrl,
  ].filter(Boolean).length;
}

function dedupeKeys(work: NormalizedWork): string[] {
  const keys = [
    stableKey("doi:", work.doi),
    stableKey("arxiv:", work.arxivId),
    stableKey("openalex:", work.openalexId),
    stableKey("s2:", work.s2Id),
    stableKey("pmid:", work.pmid),
    work.title ? `title:${normalizeDiscoveryTitle(work.title)}:${work.year ?? ""}` : undefined,
  ].filter((key): key is string => !!key);
  return keys.length > 0 ? keys : ["unknown"];
}

function stableKey(prefix: (typeof STABLE_DISCOVERY_KEY_PREFIXES)[number], value: unknown) {
  const normalized = normalizeIdentifier(value);
  return normalized ? `${prefix}${normalized}` : undefined;
}

function mergedStableIdentifier(
  preferred: string | undefined,
  fallback: string | undefined,
): string | undefined {
  const preferredNormalized = normalizeIdentifier(preferred);
  if (preferredNormalized) return preferred?.trim();
  return normalizeIdentifier(fallback) ? fallback?.trim() : undefined;
}

function hasMatchingStableIdentifier(left: NormalizedWork, right: NormalizedWork): boolean {
  return STABLE_DISCOVERY_IDENTIFIERS.some((field) => {
    const leftValue = normalizeIdentifier(left[field]);
    const rightValue = normalizeIdentifier(right[field]);
    return Boolean(leftValue && rightValue && leftValue === rightValue);
  });
}

function hasConflictingStableKeys(
  left: ReadonlySet<string>,
  right: ReadonlySet<string> | readonly string[],
): boolean {
  return STABLE_DISCOVERY_KEY_PREFIXES.some((prefix) => {
    const leftValues = [...left].filter((key) => key.startsWith(prefix));
    const rightValues = [...right].filter((key) => key.startsWith(prefix));
    if (leftValues.length === 0 || rightValues.length === 0) return false;
    return leftValues.length !== 1 || rightValues.length !== 1 || leftValues[0] !== rightValues[0];
  });
}

function hasMatchingStableKey(left: ReadonlySet<string>, right: readonly string[]): boolean {
  const rightKeys = new Set(right);
  return [...left].some(
    (key) =>
      STABLE_DISCOVERY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) && rightKeys.has(key),
  );
}

const STABLE_DISCOVERY_IDENTIFIERS = [
  "doi",
  "arxivId",
  "openalexId",
  "s2Id",
  "pmid",
] as const satisfies readonly (keyof NormalizedWork)[];

const STABLE_DISCOVERY_KEY_PREFIXES = ["doi:", "arxiv:", "openalex:", "s2:", "pmid:"] as const;

type DiscoveryStableIdentifiers = Pick<
  NormalizedWork,
  (typeof STABLE_DISCOVERY_IDENTIFIERS)[number]
>;

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function sortYear(work: NormalizedWork): number {
  return work.year ?? 0;
}
