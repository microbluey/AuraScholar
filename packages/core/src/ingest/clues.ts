// Stage 1 of the ingest pipeline: turn raw user input (a pasted string or an
// uploaded PDF's first pages of text) into a typed "clue" we can resolve.
import { normalizeDoi } from "@aurascholar/db";
import { parseArxivId } from "@aurascholar/connectors";

export type Clue =
  | { kind: "doi"; doi: string }
  | { kind: "arxiv"; arxivId: string }
  | { kind: "url"; url: string }
  | { kind: "title"; title: string };

export interface PdfMetadataFields {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

export interface PdfClueSource {
  /** First pages of PDF text. Line breaks improve title extraction. */
  text?: string;
  metadata?: PdfMetadataFields;
  fileName?: string;
}

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

/**
 * Builds a prioritized clue list from PDF-native evidence. Strong identifiers
 * always come first; title candidates are only fallbacks for resolver search.
 */
export function cluesFromPdfSource(source: PdfClueSource): Clue[] {
  const clues: Clue[] = [];
  const seen = new Set<string>();

  const push = (clue: Clue) => {
    const key =
      clue.kind === "doi"
        ? `doi:${clue.doi}`
        : clue.kind === "arxiv"
          ? `arxiv:${clue.arxivId}`
          : clue.kind === "title"
            ? `title:${normalizeTitleForDedupe(clue.title)}`
            : `url:${clue.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    clues.push(clue);
  };

  const identifierText = [
    source.metadata?.title,
    source.metadata?.subject,
    source.metadata?.keywords,
    source.text,
  ]
    .filter(Boolean)
    .join("\n");
  for (const clue of cluesFromPdfText(identifierText)) push(clue);

  for (const title of titleCandidatesFromPdfSource(source)) {
    push({ kind: "title", title });
  }

  return clues;
}

export function titleCandidatesFromPdfSource(source: PdfClueSource): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    const title = cleanTitleCandidate(raw);
    if (!title || !isPlausiblePaperTitle(title)) return;
    const key = normalizeTitleForDedupe(title);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(title);
  };

  push(source.metadata?.title);
  push(source.metadata?.subject);

  for (const title of titleCandidatesFromText(source.text ?? "")) push(title);
  push(titleFromFileName(source.fileName));

  return candidates.slice(0, 4);
}

function titleCandidatesFromText(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanTitleCandidate(line))
    .filter((line): line is string => !!line);
  const candidates: Array<{ title: string; score: number }> = [];
  const limit = Math.min(lines.length, 28);

  for (let i = 0; i < limit; i++) {
    const line = lines[i]!;
    if (isSectionBoundary(line)) break;
    if (!isTitleLineCandidate(line)) continue;

    let block = line;
    addCandidate(candidates, block, i);
    for (let j = i + 1; j < Math.min(i + 3, limit); j++) {
      const next = lines[j]!;
      if (isSectionBoundary(next) || !isTitleLineCandidate(next)) break;
      block = `${block} ${next}`;
      addCandidate(candidates, block, i);
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .map((c) => c.title)
    .filter(
      (title, i, arr) =>
        arr.findIndex(
          (other) => normalizeTitleForDedupe(other) === normalizeTitleForDedupe(title),
        ) === i,
    )
    .slice(0, 3);
}

function addCandidate(
  candidates: Array<{ title: string; score: number }>,
  raw: string,
  lineIndex: number,
): void {
  const title = cleanTitleCandidate(raw);
  if (!title || !isPlausiblePaperTitle(title)) return;
  const words = wordCount(title);
  const lengthScore = Math.max(0, 1 - Math.abs(words - 11) / 18);
  const positionScore = Math.max(0, 1 - lineIndex / 24);
  const punctuationPenalty = /[,;]/.test(title) ? 0.08 : 0;
  candidates.push({ title, score: lengthScore * 0.65 + positionScore * 0.35 - punctuationPenalty });
}

function cleanTitleCandidate(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex -- PDF text streams can embed NULs
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, "")
    .replace(/^Microsoft Word\s*-\s*/i, "")
    .replace(/\.(docx?|pdf)$/i, "")
    .trim();
  return cleaned || null;
}

function titleFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const base = fileName
    .replace(/^.*[\\/]/, "")
    .replace(/^\d+-/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return base;
}

function isTitleLineCandidate(line: string): boolean {
  if (isSectionBoundary(line)) return false;
  if (isLikelyNonTitleLine(line)) return false;
  const chars = line.replace(/\s/g, "").length;
  return chars >= 12 && chars <= 220;
}

function isPlausiblePaperTitle(title: string): boolean {
  if (isLikelyNonTitleLine(title)) return false;
  if (/^10\.\d{4,9}\//.test(title)) return false;
  if (/^arxiv[:\s]/i.test(title)) return false;
  if (/^https?:\/\//i.test(title)) return false;
  if (/[^\s]+@[^\s]+/.test(title)) return false;
  if (normalizeTitleForDedupe(title).length < 12) return false;
  const letters = title.match(/[A-Za-z一-鿿]/g)?.length ?? 0;
  const digits = title.match(/\d/g)?.length ?? 0;
  if (digits >= 4 && digits > letters) return false;
  const words = wordCount(title);
  const hasCjk = /[一-鿿]/.test(title);
  if (!hasCjk && words < 3) return false;
  if (words > 34) return false;
  const alnum = title.match(/[A-Za-z0-9一-鿿]/g)?.length ?? 0;
  return alnum / Math.max(1, title.length) >= 0.55;
}

function isSectionBoundary(line: string): boolean {
  return /^(abstract|summary|keywords?|introduction|references|acknowledg(e)?ments?|supplementary\s+(materials?|information)|摘要|关键词|引言|参考文献)\b/i.test(
    line.trim(),
  );
}

function isLikelyNonTitleLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (
    /^(untitled|main document|full text|article|paper|manuscript|accepted manuscript|proof|preprint)$/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (
    /^(journal|proceedings|conference|transactions|vol\.?|volume|issue|pp\.?|pages?)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/\b(received|accepted|published|copyright|doi|issn|isbn)\b/i.test(trimmed)) return true;
  if (
    /\b(university|department|institute|school of|college of|laboratory|centre|center)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (looksLikeAuthorLine(trimmed)) return true;
  if (/^\d+(\.\d+)*$/.test(trimmed)) return true;
  return false;
}

function looksLikeAuthorLine(line: string): boolean {
  const commaCount = line.match(/,/g)?.length ?? 0;
  if (commaCount < 2) return false;
  const parts = line.split(/\s*,\s*/).filter(Boolean);
  if (parts.length < 3) return false;
  const nameLike = parts.filter((part) =>
    /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}(?:\s+et\s+al\.?)?$/i.test(part),
  );
  return nameLike.length / parts.length >= 0.7;
}

function wordCount(text: string): number {
  const asciiWords = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
  const cjkChars = text.match(/[一-鿿]/g)?.length ?? 0;
  return asciiWords + Math.ceil(cjkChars / 2);
}

function normalizeTitleForDedupe(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
