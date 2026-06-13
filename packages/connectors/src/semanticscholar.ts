// Semantic Scholar (S2) — Graph API. Adds tldr/abstracts, S2 paper IDs, and an
// independent title-search corroboration source. https://api.semanticscholar.org
// The public (keyless) endpoint is heavily rate-limited; the shared interval
// limiter in client.ts uses the conservative 250ms default for this host.
import { getJson, ApiError, type ConnectorContext } from "./client";
import type { NormalizedWork } from "./types";

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
}

/** Look up by DOI (S2 accepts the `DOI:` id prefix). */
export async function s2ByDoi(ctx: ConnectorContext, doi: string): Promise<S2Paper | null> {
  return s2ById(ctx, `DOI:${doi}`);
}

/** Look up by any S2-accepted id: a bare paperId, `DOI:…`, `ARXIV:…`, `PMID:…`. */
export async function s2ById(ctx: ConnectorContext, id: string): Promise<S2Paper | null> {
  try {
    return await getJson<S2Paper>(
      ctx,
      `${BASE}/paper/${encodeURIComponent(id)}?fields=${FIELDS}`,
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
): Promise<S2Paper[]> {
  const data = await getJson<{ data?: S2Paper[] }>(
    ctx,
    `${BASE}/paper/search?query=${encodeURIComponent(title)}&limit=${limit}&fields=${FIELDS}`,
  );
  return data.data ?? [];
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
    source: "s2",
  };
}
