// arXiv API — metadata + guaranteed-legal PDF for preprints.
// Atom XML response, parsed with regex to avoid an XML dependency.
import { getRaw, type ConnectorContext, type ConnectorRequestOptions } from "./client";
import type { ConnectorSearchFilters, NormalizedWork } from "./types";

const ARXIV_ID_RE = /(?:arxiv[:/])?(\d{4}\.\d{4,5})(v\d+)?/i;

export function parseArxivId(input: string): string | null {
  const m = input.match(ARXIV_ID_RE);
  return m ? m[1]! : null;
}

export function arxivPdfUrl(arxivId: string): string {
  return `https://arxiv.org/pdf/${arxivId}`;
}

export async function arxivByid(
  ctx: ConnectorContext,
  arxivId: string,
  opts?: ConnectorRequestOptions,
): Promise<NormalizedWork | null> {
  const res = await getRaw(ctx, `https://export.arxiv.org/api/query?id_list=${arxivId}`, opts);
  const xml = new TextDecoder().decode(res.body);
  const entry = firstEntry(xml);
  return entry ? normalizeEntry(entry) : null;
}

/**
 * Free-text search over arXiv (title + abstract). Lets the discovery aggregator
 * surface preprints by topic, not just by a known arXiv id.
 */
const ARXIV_BOOLEAN_RE = /\b(AND|OR|ANDNOT|NOT)\b/;

export async function arxivSearchByTitle(
  ctx: ConnectorContext,
  query: string,
  max = 5,
  opts?: ConnectorRequestOptions,
  filters?: ConnectorSearchFilters,
  page = 1,
): Promise<NormalizedWork[]> {
  // arXiv natively supports field prefixes (ti/abs/au) and boolean operators.
  // If the user already wrote a boolean expression, pass it through verbatim;
  // otherwise wrap the text as a title/abstract phrase match.
  let search = ARXIV_BOOLEAN_RE.test(query) ? query : `ti:"${query}" OR abs:"${query}"`;
  if (filters?.author) search = `(${search}) AND au:"${filters.author}"`;
  // venue/year have no native arXiv query filter — left to caller soft-filter.
  const sort = filters?.sort === "year" ? "submittedDate" : "relevance";
  const order = filters?.sort === "year" ? "&sortOrder=descending" : "";
  const url =
    `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(search)}` +
    `&start=${(page - 1) * max}&max_results=${max}&sortBy=${sort}${order}`;
  const res = await getRaw(ctx, url, opts);
  const xml = new TextDecoder().decode(res.body);
  return allEntries(xml)
    .map(normalizeEntry)
    .filter((work): work is NormalizedWork => work !== null);
}

function firstEntry(xml: string): string | null {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry || /<title>Error<\/title>/.test(entry)) return null;
  return entry;
}

function allEntries(xml: string): string[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((m) => m[1]!)
    .filter((entry) => !/<title>Error<\/title>/.test(entry));
}

function normalizeEntry(entry: string): NormalizedWork | null {
  const text = (tag: string) =>
    entry
      .match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]
      ?.replace(/\s+/g, " ")
      .trim();
  // The canonical id URL carries the arXiv id (with version), e.g.
  // http://arxiv.org/abs/2106.01234v2 — strip the host and version suffix.
  const idUrl = text("id");
  const arxivId = idUrl ? parseArxivId(idUrl) : null;
  if (!arxivId) return null;

  const authors = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m, i) => ({
    displayName: m[1]!.trim(),
    position: i,
  }));
  const published = text("published"); // e.g. 2017-06-12T17:57:34Z
  const doi = entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/)?.[1]?.toLowerCase();

  return {
    doi,
    title: text("title") ?? "(untitled)",
    abstract: text("summary"),
    year: published ? Number(published.slice(0, 4)) : undefined,
    publicationDate: published?.slice(0, 10),
    venueName: "arXiv",
    venueType: "repository",
    type: "preprint",
    arxivId,
    authors,
    oaPdfUrl: arxivPdfUrl(arxivId),
    source: "arxiv",
  };
}
