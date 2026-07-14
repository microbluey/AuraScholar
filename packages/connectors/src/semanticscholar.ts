// Semantic Scholar (S2) — Graph API. Adds tldr/abstracts, S2 paper IDs, and an
// independent title-search corroboration source. https://api.semanticscholar.org
// The public (keyless) endpoint is heavily rate-limited; the shared interval
// limiter in client.ts uses the conservative 250ms default for this host.
import { getJson, ApiError, type ConnectorContext, type ConnectorRequestOptions } from "./client.js";
import type { ConnectorSearchFilters, NormalizedWork } from "./types.js";

const BASE = "https://api.semanticscholar.org/graph/v1";

const FIELDS = [
  "paperId",
  "externalIds",
  "title",
  "abstract",
  "year",
  "publicationDate",
  "venue",
  "publicationTypes",
  "authors",
  "citationCount",
].join(",");

export interface S2Author {
  authorId?: string;
  name?: string;
}

export interface S2Paper {
  paperId?: string;
  externalIds?: { DOI?: string; ArXiv?: string; PubMed?: string; [k: string]: string | undefined };
  title?: string;
  abstract?: string;
  year?: number;
  publicationDate?: string;
  venue?: string;
  publicationTypes?: string[];
  authors?: S2Author[];
  citationCount?: number;
}

/** Extra S2-only signals not carried by NormalizedWork — fetched on demand. */
export interface S2Enrichment {
  s2Id?: string;
  /** S2's auto-generated one-sentence summary ("AI 摘要"). */
  tldr?: string;
  citationCount?: number;
  /** Citations S2 judges "influential" — a quality signal, not just volume. */
  influentialCitationCount?: number;
  referenceCount?: number;
  /** Open-access PDF S2 knows about, if any. */
  openAccessPdfUrl?: string;
  /** S2 landing page for the paper. */
  url?: string;
}

interface S2PaperFull extends S2Paper {
  tldr?: { text?: string } | null;
  citationCount?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
  openAccessPdf?: { url?: string } | null;
  url?: string;
}

const ENRICH_FIELDS = [
  "paperId",
  "tldr",
  "citationCount",
  "influentialCitationCount",
  "referenceCount",
  "openAccessPdf",
  "url",
].join(",");

/** Look up by DOI (S2 accepts the `DOI:` id prefix). */
export async function s2ByDoi(
  ctx: ConnectorContext,
  doi: string,
  opts?: ConnectorRequestOptions,
): Promise<S2Paper | null> {
  return s2ById(ctx, `DOI:${doi}`, opts);
}

/** Look up by any S2-accepted id: a bare paperId, `DOI:…`, `ARXIV:…`, `PMID:…`. */
export async function s2ById(
  ctx: ConnectorContext,
  id: string,
  opts?: ConnectorRequestOptions,
): Promise<S2Paper | null> {
  try {
    return await getJson<S2Paper>(
      ctx,
      `${BASE}/paper/${encodeURIComponent(id)}?fields=${FIELDS}`,
      opts,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function s2SearchByTitle(
  ctx: ConnectorContext,
  title: string,
  limit = 5,
  opts?: ConnectorRequestOptions,
  filters?: ConnectorSearchFilters,
  page = 1,
): Promise<S2Paper[]> {
  let url = `${BASE}/paper/search?query=${encodeURIComponent(title)}&limit=${limit}&fields=${FIELDS}`;
  if (page > 1) url += `&offset=${(page - 1) * limit}`;
  // S2 year filter accepts ranges: "2015-2020", "2015-", "-2020".
  if (filters?.yearFrom || filters?.yearTo) {
    url += `&year=${filters.yearFrom ?? ""}-${filters.yearTo ?? ""}`;
  }
  if (filters?.venue) url += `&venue=${encodeURIComponent(filters.venue)}`;
  // /paper/search has no author filter and no sort — author/sort are soft-applied
  // by the caller after merge.
  const data = await getJson<{ data?: S2Paper[] }>(ctx, url, opts);
  return data.data ?? [];
}

/**
 * Fetches S2's value-add signals (tldr, citation counts) by DOI. Returns null
 * when the paper isn't in S2. Kept separate from resolution so it can be called
 * lazily from the detail panel without bloating ingest.
 */
export async function s2EnrichByDoi(
  ctx: ConnectorContext,
  doi: string,
): Promise<S2Enrichment | null> {
  let p: S2PaperFull;
  try {
    p = await getJson<S2PaperFull>(
      ctx,
      `${BASE}/paper/DOI:${encodeURIComponent(doi)}?fields=${ENRICH_FIELDS}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
  return {
    s2Id: p.paperId,
    tldr: p.tldr?.text ?? undefined,
    citationCount: p.citationCount,
    influentialCitationCount: p.influentialCitationCount,
    referenceCount: p.referenceCount,
    openAccessPdfUrl: p.openAccessPdf?.url ?? undefined,
    url: p.url,
  };
}

export function normalizeS2(p: S2Paper): NormalizedWork {
  const types = p.publicationTypes ?? [];
  const venueType = types.includes("Conference")
    ? "conference"
    : types.includes("Book") || types.includes("BookSection")
      ? "book"
      : "journal";
  return {
    doi: p.externalIds?.DOI?.toLowerCase(),
    title: p.title ?? "(untitled)",
    abstract: p.abstract ?? undefined,
    year: p.year,
    publicationDate: p.publicationDate,
    venueName: p.venue || undefined,
    venueType,
    arxivId: p.externalIds?.ArXiv,
    s2Id: p.paperId,
    pmid: p.externalIds?.PubMed,
    authors: (p.authors ?? []).map((a, i) => ({
      displayName: a.name ?? "(unknown)",
      position: i,
    })),
    citedByCount: p.citationCount,
    source: "s2",
  };
}
