// Crossref REST API — bibliographic source of truth for DOI-registered works.
// https://api.crossref.org — polite pool via mailto query param.
import { getJson, type ConnectorContext, type ConnectorRequestOptions } from "./client";
import type { ConnectorSearchFilters, NormalizedAuthor, NormalizedWork } from "./types";

const BASE = "https://api.crossref.org";

interface CrossrefContributor {
  given?: string;
  family?: string;
  name?: string;
  ORCID?: string;
  sequence?: string;
}

interface CrossrefWork {
  DOI: string;
  title?: string[];
  abstract?: string;
  author?: CrossrefContributor[];
  editor?: CrossrefContributor[];
  translator?: CrossrefContributor[];
  "container-title"?: string[];
  type?: string;
  issued?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  "publisher-location"?: string;
  ISSN?: string[];
  ISBN?: string[];
  language?: string;
  subject?: string[];
  URL?: string;
  [key: string]: unknown;
}

export async function crossrefByDoi(
  ctx: ConnectorContext,
  doi: string,
  opts?: ConnectorRequestOptions,
): Promise<NormalizedWork | null> {
  try {
    const data = await getJson<{ message: CrossrefWork }>(
      ctx,
      `${BASE}/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(ctx.mailto)}`,
      opts,
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
  opts?: ConnectorRequestOptions,
  filters?: ConnectorSearchFilters,
  page = 1,
): Promise<CrossrefSearchHit[]> {
  let url =
    `${BASE}/works?query.bibliographic=${encodeURIComponent(title)}` +
    `&rows=${rows}&mailto=${encodeURIComponent(ctx.mailto)}`;
  if (page > 1) url += `&offset=${(page - 1) * rows}`;
  if (filters?.author) url += `&query.author=${encodeURIComponent(filters.author)}`;
  // Crossref filter syntax: name:value pairs comma-joined; ":" and "," are
  // literal separators, so only the values are percent-encoded.
  const filterParts: string[] = [];
  if (filters?.yearFrom) filterParts.push(`from-pub-date:${filters.yearFrom}-01-01`);
  if (filters?.yearTo) filterParts.push(`until-pub-date:${filters.yearTo}-12-31`);
  if (filters?.venue) filterParts.push(`container-title:${encodeURIComponent(filters.venue)}`);
  if (filterParts.length > 0) url += `&filter=${filterParts.join(",")}`;
  if (filters?.sort === "citations") url += `&sort=is-referenced-by-count&order=desc`;
  else if (filters?.sort === "year") url += `&sort=published&order=desc`;

  const data = await getJson<{ message: { items: (CrossrefWork & { score: number })[] } }>(
    ctx,
    url,
    opts,
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
  const toAuthor =
    (role: NormalizedAuthor["role"], base: number) =>
    (a: CrossrefContributor, i: number): NormalizedAuthor => ({
      displayName: a.name ?? [a.given, a.family].filter(Boolean).join(" "),
      family: a.family,
      given: a.given,
      orcid: a.ORCID?.replace(/^https?:\/\/orcid\.org\//, ""),
      position: base + i,
      role,
    });
  const authorList = (w.author ?? []).map(toAuthor("author", 0));
  const editorList = (w.editor ?? []).map(toAuthor("editor", authorList.length));
  const translatorList = (w.translator ?? []).map(
    toAuthor("translator", authorList.length + editorList.length),
  );
  const authors: NormalizedAuthor[] = [...authorList, ...editorList, ...translatorList];
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
    volume: w.volume,
    issue: w.issue,
    pages: w.page,
    publisher: w.publisher,
    placePublished: w["publisher-location"],
    issn: w.ISSN?.[0],
    isbn: w.ISBN?.[0],
    language: w.language,
    url: w.URL,
    keywords: w.subject?.length ? w.subject : undefined,
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
