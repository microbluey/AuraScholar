// Title-based DOI discovery for sentinel tasks created before the DOI is
// known (or when the user only has the acceptance email). Auxiliary hints
// (venue, first author) guard against matching a different paper with a
// similar title.
import { crossrefSearchByTitle, type ConnectorContext } from "@aurascholar/connectors";
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
  evidence: Record<string, unknown>;
}

/** Accept threshold: below this the match is reported but not auto-adopted. */
export const TITLE_MATCH_THRESHOLD = 0.85;

export async function findDoiByTitle(
  ctx: ConnectorContext,
  title: string,
  hints: TitleMatchHints = {},
): Promise<TitleMatchResult | null> {
  const hits = await crossrefSearchByTitle(ctx, title, 5);
  let best: TitleMatchResult | null = null;

  for (const hit of hits) {
    if (!hit.work.doi) continue;
    let confidence = titleSimilarity(title, hit.work.title);

    if (hints.venue) {
      const venue = (hit.work.venueName ?? "").toLowerCase();
      const expected = hints.venue.toLowerCase().trim();
      // Venue agreement is a strong corroborator; mismatch is a strong veto.
      confidence += venue.includes(expected) || expected.includes(venue) ? 0.08 : -0.25;
    }
    if (hints.author) {
      const expected = normalizeName(hints.author);
      const found = hit.work.authors.some((a) =>
        normalizeName(a.displayName).includes(expected) ||
        (a.family && normalizeName(a.family) === expected),
      );
      confidence += found ? 0.08 : -0.25;
    }
    confidence = Math.max(0, Math.min(1, confidence));

    if (!best || confidence > best.confidence) {
      best = {
        doi: hit.work.doi,
        matchedTitle: hit.work.title,
        confidence,
        evidence: {
          matched_title: hit.work.title,
          matched_doi: hit.work.doi,
          matched_venue: hit.work.venueName,
          matched_authors: hit.work.authors.slice(0, 5).map((a) => a.displayName),
          query_title: title,
          hints,
          confidence,
        },
      };
    }
  }

  return best;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z一-鿿]/g, "");
}
