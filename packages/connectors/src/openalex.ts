// OpenAlex — ID crosswalk, abstracts (inverted index), OA locations, and the
// citation graph (referenced_works + cites filter). https://docs.openalex.org
import { getJson, type ConnectorContext } from "./client";
import type { NormalizedWork } from "./types";

const BASE = "https://api.openalex.org";

export interface OpenAlexWork {
  id: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  ids?: { pmid?: string; mag?: string };
  primary_location?: {
    source?: {
      display_name?: string;
      type?: string;
      issn_l?: string;
      issn?: string[];
      host_organization_name?: string;
    };
    pdf_url?: string;
    landing_page_url?: string;
  };
  best_oa_location?: { pdf_url?: string };
  open_access?: { oa_url?: string };
  abstract_inverted_index?: Record<string, number[]>;
  referenced_works?: string[];
  cited_by_count?: number;
  cited_by_api_url?: string;
  language?: string;
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
  keywords?: Array<{ display_name?: string; keyword?: string }>;
  authorships?: Array<{
    author?: { display_name?: string; orcid?: string };
    is_corresponding?: boolean;
  }>;
  [key: string]: unknown;
}

export async function openalexByDoi(
  ctx: ConnectorContext,
  doi: string,
): Promise<OpenAlexWork | null> {
  try {
    return await getJson<OpenAlexWork>(
      ctx,
      `${BASE}/works/https://doi.org/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(ctx.mailto)}`,
    );
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export async function openalexById(ctx: ConnectorContext, id: string): Promise<OpenAlexWork | null> {
  const short = id.replace(/^https:\/\/openalex\.org\//, "");
  try {
    return await getJson<OpenAlexWork>(
      ctx,
      `${BASE}/works/${short}?mailto=${encodeURIComponent(ctx.mailto)}`,
    );
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/** Title search — covers Crossref AND DataCite/arXiv registered works. */
export async function openalexSearchByTitle(
  ctx: ConnectorContext,
  title: string,
  perPage = 5,
): Promise<OpenAlexWork[]> {
  const data = await getJson<{ results: OpenAlexWork[] }>(
    ctx,
    `${BASE}/works?filter=title.search:${encodeURIComponent(title)}&per-page=${perPage}&mailto=${encodeURIComponent(ctx.mailto)}`,
  );
  return data.results ?? [];
}

/** Works citing the given OpenAlex work id (one page; caller paginates by cursor if needed). */
export async function openalexCitedBy(
  ctx: ConnectorContext,
  openalexId: string,
  perPage = 50,
): Promise<OpenAlexWork[]> {
  const short = openalexId.replace(/^https:\/\/openalex\.org\//, "");
  const data = await getJson<{ results: OpenAlexWork[] }>(
    ctx,
    `${BASE}/works?filter=cites:${short}&per-page=${perPage}&sort=cited_by_count:desc&mailto=${encodeURIComponent(ctx.mailto)}`,
  );
  return data.results ?? [];
}

export function normalizeOpenAlex(w: OpenAlexWork): NormalizedWork {
  return {
    doi: w.doi?.replace(/^https:\/\/doi\.org\//, "").toLowerCase(),
    title: w.display_name ?? w.title ?? "(untitled)",
    abstract: w.abstract_inverted_index
      ? decodeInvertedIndex(w.abstract_inverted_index)
      : undefined,
    year: w.publication_year,
    publicationDate: w.publication_date,
    venueName: w.primary_location?.source?.display_name,
    openalexId: w.id?.replace(/^https:\/\/openalex\.org\//, ""),
    pmid: w.ids?.pmid?.replace(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, ""),
    authors: (w.authorships ?? []).map((a, i) => ({
      displayName: a.author?.display_name ?? "(unknown)",
      orcid: a.author?.orcid?.replace(/^https?:\/\/orcid\.org\//, ""),
      position: i,
      isCorresponding: a.is_corresponding,
    })),
    volume: w.biblio?.volume || undefined,
    issue: w.biblio?.issue || undefined,
    pages: pageRange(w.biblio?.first_page, w.biblio?.last_page),
    publisher: w.primary_location?.source?.host_organization_name,
    issn: w.primary_location?.source?.issn_l ?? w.primary_location?.source?.issn?.[0],
    language: w.language,
    url: w.primary_location?.landing_page_url,
    keywords: w.keywords?.length
      ? w.keywords.map((k) => k.display_name ?? k.keyword).filter((s): s is string => !!s)
      : undefined,
    oaPdfUrl: w.best_oa_location?.pdf_url ?? w.open_access?.oa_url ?? undefined,
    source: "openalex",
  };
}

/** Joins OpenAlex first/last page into a CSL-style range. */
function pageRange(first?: string, last?: string): string | undefined {
  if (!first && !last) return undefined;
  if (first && last) return `${first}-${last}`;
  return first || last;
}

/** OpenAlex stores abstracts as {word: [positions]} — rebuild the text. */
export function decodeInvertedIndex(index: Record<string, number[]>): string {
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.filter(Boolean).join(" ");
}
