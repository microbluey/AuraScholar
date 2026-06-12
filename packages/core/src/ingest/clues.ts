// Stage 1 of the ingest pipeline: turn raw user input (a pasted string or an
// uploaded PDF's first pages of text) into a typed "clue" we can resolve.
import { normalizeDoi } from "@aurascholar/db";
import { parseArxivId } from "@aurascholar/connectors";

export type Clue =
  | { kind: "doi"; doi: string }
  | { kind: "arxiv"; arxivId: string }
  | { kind: "url"; url: string }
  | { kind: "title"; title: string };

/** Classifies pasted text: DOI > arXiv ID > URL > free-text title. */
export function clueFromInput(input: string): Clue | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const doi = normalizeDoi(trimmed);
  if (doi) return { kind: "doi", doi };

  // Explicit arXiv forms only — a bare "2017.12345" would be too ambiguous.
  if (/arxiv/i.test(trimmed)) {
    const arxivId = parseArxivId(trimmed);
    if (arxivId) return { kind: "arxiv", arxivId };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const fromUrl = clueFromUrl(trimmed);
    if (fromUrl) return fromUrl;
    return { kind: "url", url: trimmed };
  }

  return { kind: "title", title: trimmed };
}

/** Extracts a stronger clue from a URL when the pattern is recognizable. */
export function clueFromUrl(url: string): Clue | null {
  const doi = normalizeDoi(url);
  if (doi) return { kind: "doi", doi };

  if (/arxiv\.org\/(abs|pdf)\//i.test(url)) {
    const arxivId = parseArxivId(url);
    if (arxivId) return { kind: "arxiv", arxivId };
  }

  // Many publisher URLs embed the DOI in the path (Springer, Wiley, T&F...).
  const embedded = url.match(/10\.\d{4,9}\/[^?#\s]+/);
  if (embedded) {
    const cleaned = normalizeDoi(embedded[0].replace(/\/(pdf|full|abstract|epdf)$/i, ""));
    if (cleaned) return { kind: "doi", doi: cleaned };
  }

  return null;
}

const DOI_IN_TEXT_RE = /\b10\.\d{4,9}\/[^\s"'<>;,]+/g;

/**
 * Scans extracted first-pages PDF text for a DOI or arXiv ID.
 * Returns all DOI candidates ordered by frequency (a paper's own DOI usually
 * repeats in header/footer; cited DOIs appear once).
 */
export function cluesFromPdfText(text: string): Clue[] {
  const clues: Clue[] = [];
  const counts = new Map<string, number>();
  for (const m of text.matchAll(DOI_IN_TEXT_RE)) {
    const doi = normalizeDoi(m[0].replace(/[).,;]+$/, ""));
    if (doi) counts.set(doi, (counts.get(doi) ?? 0) + 1);
  }
  for (const [doi] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    clues.push({ kind: "doi", doi });
  }
  const arxivMatch = text.match(/arXiv:(\d{4}\.\d{4,5})/i);
  if (arxivMatch) clues.push({ kind: "arxiv", arxivId: arxivMatch[1]! });
  return clues;
}
