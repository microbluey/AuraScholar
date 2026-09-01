// OpenAlex — ID crosswalk, abstracts (inverted index), OA locations, and the
// citation graph (referenced_works + cites filter). https://docs.openalex.org
import { getJson, type ConnectorContext, type ConnectorRequestOptions } from "./client.js";
import type { ConnectorSearchFilters, NormalizedWork } from "./types.js";

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

/**
 * Bounds for the untrusted OpenAlex abstract inverted index.
 *
 * OpenAlex normally returns a few thousand positions at most.  These limits
 * leave room for unusually long abstracts while ensuring a malformed response
 * cannot allocate an attacker-selected sparse JavaScript array.
 */
export const MAX_OPENALEX_ABSTRACT_WORDS = 32_768;
export const MAX_OPENALEX_ABSTRACT_ENTRIES = 16_384;
export const MAX_OPENALEX_ABSTRACT_POSITIONS = 65_536;
export const MAX_OPENALEX_ABSTRACT_WORD_BYTES = 4 * 1024;
export const MAX_OPENALEX_ABSTRACT_BYTES = 128 * 1024;

const utf8Encoder = new TextEncoder();

export async function openalexByDoi(
  ctx: ConnectorContext,
  doi: string,
  opts?: ConnectorRequestOptions,
): Promise<OpenAlexWork | null> {
  try {
    return await getJson<OpenAlexWork>(
      ctx,
      `${BASE}/works/https://doi.org/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(ctx.mailto)}`,
      opts,
    );
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export async function openalexById(
  ctx: ConnectorContext,
  id: string,
  opts?: ConnectorRequestOptions,
): Promise<OpenAlexWork | null> {
  const short = id.replace(/^https:\/\/openalex\.org\//, "");
  try {
    return await getJson<OpenAlexWork>(
      ctx,
      `${BASE}/works/${short}?mailto=${encodeURIComponent(ctx.mailto)}`,
      opts,
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
  opts?: ConnectorRequestOptions,
  filters?: ConnectorSearchFilters,
  page = 1,
): Promise<OpenAlexWork[]> {
  // OpenAlex filter is a single comma-joined list; ":" and "," are literal so
  // only the values are encoded.
  const filterParts = [`title.search:${encodeURIComponent(title)}`];
  if (filters?.author)
    filterParts.push(`raw_author_name.search:${encodeURIComponent(filters.author)}`);
  if (filters?.yearFrom) filterParts.push(`from_publication_date:${filters.yearFrom}-01-01`);
  if (filters?.yearTo) filterParts.push(`to_publication_date:${filters.yearTo}-12-31`);
  if (filters?.venue)
    filterParts.push(
      `primary_location.source.display_name.search:${encodeURIComponent(filters.venue)}`,
    );

  let url =
    `${BASE}/works?filter=${filterParts.join(",")}` +
    `&per-page=${perPage}&mailto=${encodeURIComponent(ctx.mailto)}`;
  if (page > 1) url += `&page=${page}`;
  // A sort= replaces relevance ranking, so only add it for explicit non-relevance sorts.
  if (filters?.sort === "citations") url += `&sort=cited_by_count:desc`;
  else if (filters?.sort === "year") url += `&sort=publication_date:desc`;

  const data = await getJson<{ results: OpenAlexWork[] }>(ctx, url, opts);
  return data.results ?? [];
}

/** Works citing the given OpenAlex work id (one page; caller paginates by cursor if needed). */
export async function openalexCitedBy(
  ctx: ConnectorContext,
  openalexId: string,
  perPage = 50,
  opts?: ConnectorRequestOptions,
): Promise<OpenAlexWork[]> {
  const short = openalexId.replace(/^https:\/\/openalex\.org\//, "");
  const data = await getJson<{ results: OpenAlexWork[] }>(
    ctx,
    `${BASE}/works?filter=cites:${short}&per-page=${perPage}&sort=cited_by_count:desc&mailto=${encodeURIComponent(ctx.mailto)}`,
    opts,
  );
  return data.results ?? [];
}

export function normalizeOpenAlex(w: OpenAlexWork): NormalizedWork {
  const abstract = decodeInvertedIndex(w.abstract_inverted_index);
  return {
    doi: w.doi?.replace(/^https:\/\/doi\.org\//, "").toLowerCase(),
    title: w.display_name ?? w.title ?? "(untitled)",
    abstract,
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
    oaPdfUrl: w.best_oa_location?.pdf_url ?? w.primary_location?.pdf_url ?? undefined,
    citedByCount: w.cited_by_count,
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
export function decodeInvertedIndex(index: unknown): string | undefined {
  try {
    if (!isRecord(index)) return undefined;

    const entries = Object.entries(index);
    if (entries.length > MAX_OPENALEX_ABSTRACT_ENTRIES) return undefined;

    // A Map keeps positions bounded and never lets an external value become
    // an array index.  The old implementation used `words[pos]`, which lets a
    // single position near 2^32 allocate a giant sparse array and makes the
    // subsequent filter scan that entire range.
    const words = new Map<number, string>();
    let positionCount = 0;
    for (const [word, positions] of entries) {
      if (
        utf8ByteLength(word) > MAX_OPENALEX_ABSTRACT_WORD_BYTES ||
        !Array.isArray(positions) ||
        positions.length > MAX_OPENALEX_ABSTRACT_POSITIONS ||
        !isDenseArray(positions)
      ) {
        return undefined;
      }

      positionCount += positions.length;
      if (positionCount > MAX_OPENALEX_ABSTRACT_POSITIONS) return undefined;

      for (const position of positions) {
        if (
          !Number.isSafeInteger(position) ||
          (position as number) < 0 ||
          (position as number) >= MAX_OPENALEX_ABSTRACT_WORDS
        ) {
          return undefined;
        }
        // Preserve the previous decoder's last-write-wins behavior for
        // duplicate positions while keeping the collection sparse-safe.
        words.set(position as number, word);
      }
    }

    const ordered: string[] = [];
    let outputBytes = 0;
    for (const [, word] of [...words.entries()].sort(([left], [right]) => left - right)) {
      // The old `filter(Boolean)` omitted empty words. Keep that behavior for
      // compatibility with otherwise valid indexes containing an empty key.
      if (!word) continue;
      const nextBytes = outputBytes + (ordered.length > 0 ? 1 : 0) + utf8ByteLength(word);
      if (nextBytes > MAX_OPENALEX_ABSTRACT_BYTES) return undefined;
      ordered.push(word);
      outputBytes = nextBytes;
    }
    return ordered.join(" ");
  } catch {
    // Network payloads are untrusted. A getter/proxy or any other malformed
    // value must not escape as an exception from normalization; callers retain
    // the work while dropping only the unusable abstract.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}
