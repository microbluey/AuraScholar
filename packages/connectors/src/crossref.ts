// Crossref REST API — bibliographic source of truth for DOI-registered works.
// https://api.crossref.org — polite pool via mailto query param.
import { getJson, type ConnectorContext } from "./client";
import type { NormalizedAuthor, NormalizedWork } from "./types";

const BASE = "https://api.crossref.org";

interface CrossrefWork {
  DOI: string;
  title?: string[];
  abstract?: string;
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
    ORCID?: string;
    sequence?: string;
  }>;
  "container-title"?: string[];
  type?: string;
  issued?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  volume?: string;
  issue?: string;
  page?: string;
  [key: string]: unknown;
}

export async function crossrefByDoi(
  ctx: ConnectorContext,
  doi: string,
): Promise<NormalizedWork | null> {
  try {
    const data = await getJson<{ message: CrossrefWork }>(
      ctx,
      `${BASE}/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(ctx.mailto)}`,
    );
    return normalizeCrossref(data.message);
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export interface CrossrefSearchHit {
  work: NormalizedWork;
  score: number;
}

export async function crossrefSearchByTitle(
  ctx: ConnectorContext,
  title: string,
  rows = 5,
): Promise<CrossrefSearchHit[]> {
  const data = await getJson<{ message: { items: (CrossrefWork & { score: number })[] } }>(
    ctx,
    `${BASE}/works?query.bibliographic=${encodeURIComponent(title)}&rows=${rows}&mailto=${encodeURIComponent(ctx.mailto)}`,
  );
  return (data.message.items ?? []).map((item) => ({
    work: normalizeCrossref(item),
    score: item.score,
  }));
}

/** Raw Crossref message for a DOI — used by the sentinel as evidence snapshots. */
export async function crossrefRaw(
  ctx: ConnectorContext,
  doi: string,
): Promise<Record<string, unknown> | null> {
  try {
    const data = await getJson<{ message: Record<string, unknown> }>(
      ctx,
      `${BASE}/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(ctx.mailto)}`,
    );
    return data.message;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

function normalizeCrossref(w: CrossrefWork): NormalizedWork {
  const dateParts =
    w.issued?.["date-parts"]?.[0] ??
    w["published-online"]?.["date-parts"]?.[0] ??
    w["published-print"]?.["date-parts"]?.[0];
  const authors: NormalizedAuthor[] = (w.author ?? []).map((a, i) => ({
    displayName: a.name ?? [a.given, a.family].filter(Boolean).join(" "),
    family: a.family,
    given: a.given,
    orcid: a.ORCID?.replace(/^https?:\/\/orcid\.org\//, ""),
    position: i,
    isCorresponding: undefined,
  }));
  return {
    doi: w.DOI?.toLowerCase(),
    title: w.title?.[0] ?? "(untitled)",
    abstract: w.abstract ? stripJats(w.abstract) : undefined,
    year: dateParts?.[0],
    publicationDate: dateParts
      ? [
          dateParts[0],
          String(dateParts[1] ?? 1).padStart(2, "0"),
          String(dateParts[2] ?? 1).padStart(2, "0"),
        ].join("-")
      : undefined,
    venueName: w["container-title"]?.[0],
    venueType: w.type?.includes("proceedings") ? "conference" : "journal",
    type: w.type === "journal-article" ? "article" : w.type,
    authors,
    cslJson: w as Record<string, unknown>,
    source: "crossref",
  };
}

/** Crossref abstracts arrive as JATS XML — strip tags for plain text. */
function stripJats(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
