// Title-based DOI discovery for sentinel tasks created before the DOI is
// known. Searches TWO sources: Crossref (publisher-registered DOIs) and
// OpenAlex (additionally covers DataCite-registered DOIs — arXiv, Zenodo,
// institutional repositories — which Crossref cannot see). Auxiliary hints
// (venue, first author) guard against matching a different paper with a
// similar title.
import {
  crossrefSearchByTitle,
  normalizeOpenAlex,
  openalexSearchByTitle,
  type ConnectorContext,
  type NormalizedWork,
} from "@aurascholar/connectors";
import { titleSimilarity } from "../ingest/resolve";

export interface TitleMatchHints {
  /** Expected journal/conference name (substring match, case-insensitive). */
  venue?: string;
  /** Expected author family name or full name (matched against author list). */
  author?: string;
}

export interface TitleMatchResult {
  doi: string;
  matchedTitle: string;
  /** 0..1 combined confidence. */
  confidence: number;
  source: "crossref" | "openalex";
  evidence: Record<string, unknown>;
}

/** Accept threshold: below this the match is reported but not auto-adopted. */
export const TITLE_MATCH_THRESHOLD = 0.85;

export async function findDoiByTitle(
  ctx: ConnectorContext,
  title: string,
  hints: TitleMatchHints = {},
): Promise<TitleMatchResult | null> {
  const [crossrefHits, openalexHits] = await Promise.all([
    crossrefSearchByTitle(ctx, title, 5).catch(() => []),
    openalexSearchByTitle(ctx, title, 5).catch(() => []),
  ]);

  const candidates: Array<{ work: NormalizedWork; source: "crossref" | "openalex" }> = [
    ...crossrefHits.map((h) => ({ work: h.work, source: "crossref" as const })),
    ...openalexHits.map((w) => ({ work: normalizeOpenAlex(w), source: "openalex" as const })),
  ];

  let best: TitleMatchResult | null = null;
  for (const { work, source } of candidates) {
    if (!work.doi) continue;
    const confidence = scoreCandidate(title, work, hints);
    if (!best || confidence > best.confidence) {
      best = {
        doi: work.doi,
        matchedTitle: work.title,
        confidence,
        source,
        evidence: {
          matched_title: work.title,
          matched_doi: work.doi,
          matched_venue: work.venueName,
          matched_authors: work.authors.slice(0, 5).map((a) => a.displayName),
          query_title: title,
          source,
          hints,
          confidence,
        },
      };
    }
  }
  return best;
}

function scoreCandidate(
  queryTitle: string,
  work: NormalizedWork,
  hints: TitleMatchHints,
): number {
  let confidence = titleSimilarity(queryTitle, work.title);

  if (hints.venue) {
    const venue = (work.venueName ?? "").toLowerCase();
    const expected = hints.venue.toLowerCase().trim();
    // Venue agreement is a strong corroborator; mismatch is a strong veto —
    // but an absent venue (common for repository records) is neutral.
    if (venue) {
      confidence += venue.includes(expected) || expected.includes(venue) ? 0.08 : -0.25;
    }
  }
  if (hints.author) {
    const expected = normalizeName(hints.author);
    const found = work.authors.some(
      (a) =>
        normalizeName(a.displayName).includes(expected) ||
        (a.family && normalizeName(a.family) === expected),
    );
    confidence += found ? 0.08 : -0.25;
  }
  return Math.max(0, Math.min(1, confidence));
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z一-鿿]/g, "");
}
