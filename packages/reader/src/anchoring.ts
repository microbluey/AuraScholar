// Anchor resolution: re-locate an annotation's text in a page's current text
// stream. The page text may differ from when the annotation was created
// (pdf.js version changes, slightly different PDF revision), so resolution
// degrades gracefully:
//   1. exact match of quote at the stored position
//   2. exact match of quote anywhere on the page (nearest to stored position)
//   3. fuzzy (edit-distance windowed) search seeded by position, then global
//   4. orphaned — surfaced to the user, never silently dropped
import type { AnchorResolution, AnnotationAnchor, TextQuoteSelector } from "./anchor-types.js";

/** Minimum normalized similarity for a fuzzy match to be accepted. */
const FUZZY_THRESHOLD = 0.75;
export const CONTEXT_CHARS = 32;

/** Creates the quote selector for a new annotation from the page text. */
export function makeQuoteSelector(
  pageText: string,
  start: number,
  end: number,
): TextQuoteSelector {
  return {
    exact: pageText.slice(start, end),
    prefix: pageText.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: pageText.slice(end, end + CONTEXT_CHARS),
  };
}

export function resolveAnchor(anchor: AnnotationAnchor, pageText: string): AnchorResolution {
  const quote = anchor.quote;
  if (!quote || !quote.exact) return { status: "orphaned" };
  const hint = anchor.position?.start ?? 0;

  // 1+2. Exact occurrences of the quote, preferring the one nearest the hint
  // and with the best context agreement.
  const exactHits = findAll(pageText, quote.exact);
  if (exactHits.length > 0) {
    const best = exactHits
      .map((start) => ({ start, score: contextScore(pageText, start, quote) - distancePenalty(start, hint, pageText.length) }))
      .sort((a, b) => b.score - a.score)[0]!;
    return { status: "exact", start: best.start, end: best.start + quote.exact.length };
  }

  // 3. Fuzzy windowed search, seeded near the hint first then globally.
  const fuzzy = fuzzyFind(pageText, quote.exact, hint);
  if (fuzzy && fuzzy.score >= FUZZY_THRESHOLD) {
    return { status: "fuzzy", start: fuzzy.start, end: fuzzy.end, score: fuzzy.score };
  }

  return { status: "orphaned" };
}

function findAll(haystack: string, needle: string): number[] {
  const hits: number[] = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    hits.push(idx);
    idx = haystack.indexOf(needle, idx + 1);
  }
  return hits;
}

/** 0..2 — how well stored prefix/suffix agree with the text around a hit. */
function contextScore(text: string, start: number, quote: TextQuoteSelector): number {
  const end = start + quote.exact.length;
  const prefix = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const suffix = text.slice(end, end + CONTEXT_CHARS);
  return similarity(prefix, quote.prefix) + similarity(suffix, quote.suffix);
}

/** Small penalty (0..0.5) for hits far from the stored position hint. */
function distancePenalty(start: number, hint: number, textLength: number): number {
  if (textLength === 0) return 0;
  return (Math.abs(start - hint) / textLength) * 0.5;
}

interface FuzzyHit {
  start: number;
  end: number;
  score: number;
}

/**
 * Sliding-window fuzzy search. Windows of needle-length (±20%) are compared
 * by normalized edit distance; the hint position is searched first with an
 * early-exit threshold to keep the common case fast.
 */
function fuzzyFind(text: string, needle: string, hint: number): FuzzyHit | null {
  if (needle.length === 0 || text.length === 0) return null;
  const step = Math.max(1, Math.floor(needle.length / 4));
  let best: FuzzyHit | null = null;

  const tryWindow = (start: number): void => {
    for (const len of windowLengths(needle.length)) {
      const end = Math.min(text.length, start + len);
      if (end <= start) continue;
      const score = similarity(text.slice(start, end), needle);
      if (score > (best?.score ?? 0)) best = { start, end, score };
    }
  };

  // Pass 1: around the hint (±2 needle lengths)
  const near = 2 * needle.length;
  for (
    let s = Math.max(0, hint - near);
    s <= Math.min(text.length - 1, hint + near);
    s += step
  ) {
    tryWindow(s);
  }
  if (best !== null && (best as FuzzyHit).score >= 0.95) return best;

  // Pass 2: whole page
  for (let s = 0; s < text.length; s += step) tryWindow(s);
  return best;
}

function windowLengths(needleLen: number): number[] {
  const delta = Math.max(2, Math.floor(needleLen * 0.2));
  return [needleLen, needleLen - delta, needleLen + delta];
}

/** Normalized similarity 0..1 via banded Levenshtein (capped for speed). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  // Cap comparison length to bound cost on pathological selections.
  const ca = a.slice(0, 400);
  const cb = b.slice(0, 400);
  return Math.max(0, 1 - levenshtein(ca, cb) / Math.max(ca.length, cb.length));
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
