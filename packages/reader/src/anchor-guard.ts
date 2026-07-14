import type {
  AnnotationAnchor,
  QuadRect,
  QuadSelector,
  TextPositionSelector,
  TextQuoteSelector,
} from "./anchor-types.js";

export interface NormalizedAnchor {
  anchor: AnnotationAnchor;
  recovered: boolean;
}

export function normalizeAnnotationAnchor(value: unknown, fallbackPageIndex: number): NormalizedAnchor {
  const fallback = fallbackAnchor(fallbackPageIndex);
  if (!isRecord(value)) return { anchor: fallback, recovered: true };
  if (value.version !== 1) return { anchor: fallback, recovered: true };
  const pageIndex = pickPageIndex(value.pageIndex);
  if (pageIndex === null) return { anchor: fallback, recovered: true };

  const anchor: AnnotationAnchor = { version: 1, pageIndex };
  let recovered = false;
  const quads = normalizeQuads(value.quads);
  if (quads) anchor.quads = quads;
  else if (value.quads !== undefined) recovered = true;

  const quote = normalizeQuote(value.quote);
  if (quote) anchor.quote = quote;
  else if (value.quote !== undefined) recovered = true;

  const position = normalizePosition(value.position);
  if (position) anchor.position = position;
  else if (value.position !== undefined) recovered = true;

  return { anchor, recovered };
}

export function parseAnnotationAnchorJson(
  value: string | null | undefined,
  fallbackPageIndex: number,
): NormalizedAnchor {
  if (!value) return { anchor: fallbackAnchor(fallbackPageIndex), recovered: false };
  try {
    return normalizeAnnotationAnchor(JSON.parse(value), fallbackPageIndex);
  } catch {
    return { anchor: fallbackAnchor(fallbackPageIndex), recovered: true };
  }
}

function fallbackAnchor(pageIndex: number): AnnotationAnchor {
  const safePageIndex = Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : 0;
  return { version: 1, pageIndex: safePageIndex };
}

function normalizeQuads(value: unknown): QuadSelector | null {
  if (!isRecord(value)) return null;
  const pageIndex = pickPageIndex(value.pageIndex);
  if (pageIndex === null || !Array.isArray(value.rects)) return null;
  const rects = value.rects.map(normalizeQuadRect).filter((rect): rect is QuadRect => rect !== null);
  return rects.length ? { pageIndex, rects } : null;
}

function normalizeQuadRect(value: unknown): QuadRect | null {
  if (!isRecord(value)) return null;
  const x1 = pickFiniteNumber(value.x1);
  const y1 = pickFiniteNumber(value.y1);
  const x2 = pickFiniteNumber(value.x2);
  const y2 = pickFiniteNumber(value.y2);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  return { x1, y1, x2, y2 };
}

function normalizeQuote(value: unknown): TextQuoteSelector | null {
  if (!isRecord(value) || typeof value.exact !== "string") return null;
  return {
    exact: value.exact,
    prefix: typeof value.prefix === "string" ? value.prefix : "",
    suffix: typeof value.suffix === "string" ? value.suffix : "",
  };
}

function normalizePosition(value: unknown): TextPositionSelector | null {
  if (!isRecord(value)) return null;
  const start = pickTextOffset(value.start);
  const end = pickTextOffset(value.end);
  if (start === null || end === null || end < start) return null;
  return { start, end };
}

function pickPageIndex(value: unknown): number | null {
  const pageIndex = pickTextOffset(value);
  return pageIndex === null ? null : pageIndex;
}

function pickTextOffset(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function pickFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
