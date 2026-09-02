import type { PdfTextEvidenceAnchorInput } from "./evidence.js";

const MAX_EXACT_TEXT_LENGTH = 256 * 1024;
const MAX_CONTEXT_LENGTH = 4_096;
const MAX_QUADS = 512;

export interface EvidenceShelfPdfAnchorOptions {
  /** Legacy reader annotations omitted the kind and revision binding. */
  allowLegacyBinding?: boolean;
}

export interface CanonicalEvidenceShelfPdfAnchor extends PdfTextEvidenceAnchorInput {
  revisionId: string;
}

/**
 * Parses and canonicalizes a Shelf PDF anchor before it is used as Evidence
 * authority. Unknown fields are discarded, while malformed selector fields
 * fail closed instead of being silently coerced.
 */
export function parseEvidenceShelfPdfAnchor(
  value: unknown,
  revisionId: string,
  options: EvidenceShelfPdfAnchorOptions = {},
): CanonicalEvidenceShelfPdfAnchor {
  const normalized = normalizeEvidenceShelfPdfAnchor(value, revisionId, options);
  if (!normalized) throw new Error("Evidence shelf anchor is not a valid PDF source anchor");
  return normalized;
}

export function normalizeEvidenceShelfPdfAnchor(
  value: unknown,
  revisionId: string,
  options: EvidenceShelfPdfAnchorOptions = {},
): CanonicalEvidenceShelfPdfAnchor | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;

  const kind = value.kind;
  if (kind !== "pdf" && !(options.allowLegacyBinding && kind === undefined)) return null;

  const revision = readRevisionAlias(value);
  if (revision === null) return null;
  if (revision === undefined) {
    if (!options.allowLegacyBinding) return null;
  } else if (revision !== revisionId) {
    return null;
  }

  const pageIndex = readNonNegativeInteger(value.pageIndex);
  if (pageIndex === null) return null;
  const quote = readQuote(value.quote);
  if (!quote) return null;
  const position = readPosition(value.position);
  if (value.position !== undefined && !position) return null;
  const quads = readQuads(value.quads, pageIndex);
  if (value.quads !== undefined && !quads) return null;

  return {
    version: 1,
    kind: "pdf",
    revisionId,
    pageIndex,
    quote,
    ...(position ? { position } : {}),
    ...(quads ? { quads } : {}),
  };
}

export function sameEvidenceShelfPdfAnchor(
  left: unknown,
  right: unknown,
  revisionId: string,
): boolean {
  const normalizedLeft = normalizeEvidenceShelfPdfAnchor(left, revisionId, {
    allowLegacyBinding: true,
  });
  const normalizedRight = normalizeEvidenceShelfPdfAnchor(right, revisionId);
  if (!normalizedLeft || !normalizedRight) return false;
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function readRevisionAlias(value: Record<string, unknown>): string | null | undefined {
  const camel = value.revisionId;
  const snake = value.revision_id;
  if (camel !== undefined && typeof camel !== "string") return null;
  if (snake !== undefined && typeof snake !== "string") return null;
  if (camel !== undefined && snake !== undefined && camel !== snake) return null;
  const selected = camel ?? snake;
  if (selected === undefined) return undefined;
  return selected.trim() ? selected.trim() : null;
}

function readQuote(value: unknown): PdfTextEvidenceAnchorInput["quote"] | null {
  if (!isRecord(value) || typeof value.exact !== "string") return null;
  if (!value.exact.trim() || value.exact.length > MAX_EXACT_TEXT_LENGTH) return null;
  const prefix = readContext(value.prefix);
  const suffix = readContext(value.suffix);
  if (prefix === null || suffix === null) return null;
  return { exact: value.exact, prefix, suffix };
}

function readContext(value: unknown): string | null {
  if (value === undefined) return "";
  return typeof value === "string" && value.length <= MAX_CONTEXT_LENGTH ? value : null;
}

function readPosition(value: unknown): NonNullable<PdfTextEvidenceAnchorInput["position"]> | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return null;
  const start = readNonNegativeInteger(value.start);
  const end = readNonNegativeInteger(value.end);
  if (start === null || end === null || end < start) return null;
  return { start, end };
}

function readQuads(
  value: unknown,
  pageIndex: number,
): NonNullable<PdfTextEvidenceAnchorInput["quads"]> | null {
  if (value === undefined) return null;
  if (!isRecord(value) || value.pageIndex !== pageIndex || !Array.isArray(value.rects)) {
    return null;
  }
  if (value.rects.length === 0 || value.rects.length > MAX_QUADS) return null;
  // Array.from visits sparse slots too; Array#map would silently skip holes.
  const rects = Array.from(value.rects, readRect);
  if (rects.some((rect) => rect === null)) return null;
  return { pageIndex, rects: rects as NonNullable<PdfTextEvidenceAnchorInput["quads"]>["rects"] };
}

function readRect(value: unknown): { x1: number; y1: number; x2: number; y2: number } | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.x1 !== "number" ||
    typeof value.y1 !== "number" ||
    typeof value.x2 !== "number" ||
    typeof value.y2 !== "number" ||
    !Number.isFinite(value.x1) ||
    !Number.isFinite(value.y1) ||
    !Number.isFinite(value.x2) ||
    !Number.isFinite(value.y2)
  ) {
    return null;
  }
  const { x1, y1, x2, y2 } = value;
  if (x2 < x1 || y2 < y1) return null;
  return { x1, y1, x2, y2 };
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
