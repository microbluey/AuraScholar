// Stage 2: resolve a clue into merged metadata. Crossref is bibliographic
// truth; OpenAlex supplements IDs, abstract, and OA info. Title searches
// return scored candidates — the UI must confirm low-confidence matches
// rather than silently mis-filing a paper.
import {
  arxivByid,
  crossrefByDoi,
  crossrefSearchByTitle,
  normalizeOpenAlex,
  openalexByDoi,
  unpaywallPdf,
  type ConnectorContext,
  type NormalizedWork,
} from "@aurascholar/connectors";
import type { Clue } from "./clues";

export interface ResolvedWork {
  work: NormalizedWork;
  /** 0..1 — below ~0.7 the UI should ask the user to confirm. */
  confidence: number;
  candidates?: NormalizedWork[];
}

export async function resolveClue(ctx: ConnectorContext, clue: Clue): Promise<ResolvedWork | null> {
  switch (clue.kind) {
    case "doi":
      return resolveDoi(ctx, clue.doi);
    case "arxiv": {
      const work = await arxivByid(ctx, clue.arxivId);
      if (!work) return null;
      // Preprint may have been published since — its DOI gives richer metadata.
      if (work.doi) {
        const published = await resolveDoi(ctx, work.doi);
        if (published) {
          published.work.arxivId = clue.arxivId;
          published.work.oaPdfUrl ??= work.oaPdfUrl;
          return published;
        }
      }
      return { work, confidence: 1 };
    }
    case "title":
      return resolveTitle(ctx, clue.title);
    case "url":
      // Reaching here means URL pattern matching failed upstream; treat the
      // URL itself as unresolvable (the app layer may fetch the page HTML
      // for citation meta tags on desktop where CORS allows).
      return null;
  }
}

async function resolveDoi(ctx: ConnectorContext, doi: string): Promise<ResolvedWork | null> {
  const [crossref, openalex] = await Promise.all([
    crossrefByDoi(ctx, doi),
    openalexByDoi(ctx, doi).catch(() => null),
  ]);
  if (!crossref && !openalex) return null;

  const oa = openalex ? normalizeOpenAlex(openalex) : undefined;
  const base = crossref ?? oa!;
  const work: NormalizedWork = {
    ...base,
    abstract: base.abstract ?? oa?.abstract,
    openalexId: oa?.openalexId,
    pmid: oa?.pmid,
    oaPdfUrl: oa?.oaPdfUrl,
    publicationDate: base.publicationDate ?? oa?.publicationDate,
  };
  return { work, confidence: 1 };
}

async function resolveTitle(ctx: ConnectorContext, title: string): Promise<ResolvedWork | null> {
  const hits = await crossrefSearchByTitle(ctx, title, 5);
  if (hits.length === 0) return null;
  const best = hits[0]!;
  const confidence = titleSimilarity(title, best.work.title);
  return {
    work: best.work,
    confidence,
    candidates: hits.map((h) => h.work),
  };
}

/** Normalized Levenshtein similarity (0..1) for title-match confidence. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length));
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length]!;
}

/** Finds a legal OA PDF for a resolved work: Unpaywall → arXiv → OpenAlex. */
export async function findOaPdf(
  ctx: ConnectorContext,
  work: NormalizedWork,
): Promise<{ url: string; via: string } | null> {
  if (work.doi) {
    const oa = await unpaywallPdf(ctx, work.doi).catch(() => null);
    if (oa) return { url: oa.pdfUrl, via: "unpaywall" };
  }
  if (work.arxivId) {
    return { url: `https://arxiv.org/pdf/${work.arxivId}`, via: "arxiv" };
  }
  if (work.oaPdfUrl) {
    return { url: work.oaPdfUrl, via: "openalex" };
  }
  return null;
}
