import { parseSourceAnchor, type SourceAnchor } from "@aurascholar/anchors";
import { createContentUnit, type ContentUnit } from "./content-unit.js";
import {
  CONTENT_UNIT_CONTEXT_CHARS,
  DEFAULT_PDF_MAX_UNIT_CHARS,
  DEFAULT_PDF_OVERLAP_CHARS,
  PDF_PAGE_CHUNK_PROFILE_V1,
  PDF_PAGE_CONTEXT_CHUNK_PROFILE_V1,
  PDF_TEXT_EXTRACTOR_PROFILE_V1,
  PDF_WINDOW_CHUNK_PROFILE_V1,
} from "./profiles.js";

export interface ExtractedPdfTextPage {
  pageIndex: number;
  /** Text in the reader's frozen PDF anchoring space. */
  text: string;
}

export type PdfTextPageResult =
  | string
  | ExtractedPdfTextPage
  | { pageIndex?: number; text: string };

/** Minimal adapter contract; it deliberately does not depend on pdf.js. */
export interface PdfTextSource {
  pageCount: number;
  getPageText(pageIndex: number, signal?: AbortSignal): Promise<PdfTextPageResult>;
}

export interface PdfContentUnitContext {
  libraryId: string;
  revisionId: string;
  workId?: string | null;
  assetId?: string | null;
}

export interface BuildPdfContentUnitsInput extends PdfContentUnitContext {
  pages: readonly ExtractedPdfTextPage[];
  maxUnitChars?: number;
  overlapChars?: number;
  extractorProfile?: string;
}

export interface ExtractPdfContentUnitsInput extends PdfContentUnitContext {
  source: PdfTextSource;
  maxUnitChars?: number;
  overlapChars?: number;
  extractorProfile?: string;
  signal?: AbortSignal;
}

/**
 * Extracts every page in order, then delegates to the deterministic pure
 * builder. A returned page index is checked rather than silently reordered.
 */
export async function extractPdfContentUnits(
  input: ExtractPdfContentUnitsInput,
): Promise<ContentUnit[]> {
  assertPageCount(input.source.pageCount);
  const pages: ExtractedPdfTextPage[] = [];
  for (let pageIndex = 0; pageIndex < input.source.pageCount; pageIndex += 1) {
    throwIfAborted(input.signal);
    const result = await input.source.getPageText(pageIndex, input.signal);
    throwIfAborted(input.signal);
    const page = normalizePageResult(result, pageIndex);
    pages.push(page);
  }
  return buildPdfContentUnits({ ...input, pages });
}

/** Builds revision-bound units from already extracted, ordered page text. */
export async function buildPdfContentUnits(
  input: BuildPdfContentUnitsInput,
): Promise<ContentUnit[]> {
  assertPageSequence(input.pages);
  assertId(input.revisionId, "Revision id");
  const maxUnitChars = input.maxUnitChars ?? DEFAULT_PDF_MAX_UNIT_CHARS;
  const overlapChars = input.overlapChars ?? DEFAULT_PDF_OVERLAP_CHARS;
  validateChunkOptions(maxUnitChars, overlapChars);
  const extractorProfile = input.extractorProfile ?? PDF_TEXT_EXTRACTOR_PROFILE_V1;

  const units: ContentUnit[] = [];
  let ordinal = 0;
  for (const page of input.pages) {
    if (!page.text.trim()) continue;
    const chunks = splitText(page.text, maxUnitChars, overlapChars);
    if (chunks.length === 1) {
      units.push(
        await createPdfUnit({
          context: input,
          extractorProfile,
          ordinal: ordinal++,
          text: page.text,
          page,
          chunkProfile: PDF_PAGE_CHUNK_PROFILE_V1,
          parentUnitId: null,
          state: "ready",
          start: 0,
          end: page.text.length,
        }),
      );
      continue;
    }

    const parent = await createPdfUnit({
      context: input,
      extractorProfile,
      ordinal: ordinal++,
      text: page.text,
      page,
      chunkProfile: PDF_PAGE_CONTEXT_CHUNK_PROFILE_V1,
      parentUnitId: null,
      state: "context-only",
      start: 0,
      end: page.text.length,
    });
    units.push(parent);
    for (const chunk of chunks) {
      units.push(
        await createPdfUnit({
          context: input,
          extractorProfile,
          ordinal: ordinal++,
          text: chunk.text,
          page,
          chunkProfile: PDF_WINDOW_CHUNK_PROFILE_V1,
          parentUnitId: parent.id,
          state: "ready",
          start: chunk.start,
          end: chunk.end,
        }),
      );
    }
  }
  return units;
}

interface CreatePdfUnitInput {
  context: PdfContentUnitContext;
  extractorProfile: string;
  ordinal: number;
  text: string;
  page: ExtractedPdfTextPage;
  chunkProfile: string;
  parentUnitId: string | null;
  state: "ready" | "context-only";
  start: number;
  end: number;
}

async function createPdfUnit(input: CreatePdfUnitInput): Promise<ContentUnit> {
  return createContentUnit({
    libraryId: input.context.libraryId,
    sourceType: "pdf",
    sourceId: input.context.revisionId,
    workId: input.context.workId,
    assetId: input.context.assetId,
    revisionId: input.context.revisionId,
    parentUnitId: input.parentUnitId,
    ordinal: input.ordinal,
    headingPath: null,
    anchor: makePdfAnchor(
      input.context.revisionId,
      input.page.pageIndex,
      input.page.text,
      input.start,
      input.end,
    ),
    text: input.text,
    extractorProfile: input.extractorProfile,
    chunkProfile: input.chunkProfile,
    state: input.state,
  });
}

function makePdfAnchor(
  revisionId: string,
  pageIndex: number,
  pageText: string,
  start: number,
  end: number,
): SourceAnchor {
  const anchor = parseSourceAnchor({
    version: 1,
    kind: "pdf",
    revisionId,
    pageIndex,
    quote: {
      exact: pageText.slice(start, end),
      prefix: pageText.slice(Math.max(0, start - CONTENT_UNIT_CONTEXT_CHARS), start),
      suffix: pageText.slice(end, end + CONTENT_UNIT_CONTEXT_CHARS),
    },
    position: { start, end },
  });
  return anchor;
}

function normalizePageResult(
  result: PdfTextPageResult,
  expectedPageIndex: number,
): ExtractedPdfTextPage {
  if (typeof result === "string") return { pageIndex: expectedPageIndex, text: result };
  if (result.pageIndex !== undefined && result.pageIndex !== expectedPageIndex) {
    throw new Error(
      `PDF text source returned page ${result.pageIndex} while extracting page ${expectedPageIndex}`,
    );
  }
  if (typeof result.text !== "string")
    throw new Error("PDF text source returned invalid page text");
  return { pageIndex: expectedPageIndex, text: result.text };
}

function assertPageSequence(pages: readonly ExtractedPdfTextPage[]): void {
  pages.forEach((page, expectedPageIndex) => {
    if (!Number.isInteger(page.pageIndex) || page.pageIndex !== expectedPageIndex) {
      throw new Error("PDF pages must be provided exactly once in ascending page order");
    }
    if (typeof page.text !== "string") throw new Error("PDF page text must be a string");
  });
}

function assertPageCount(pageCount: number): void {
  if (!Number.isInteger(pageCount) || pageCount < 0) {
    throw new Error("PDF page count must be a non-negative integer");
  }
}

function validateChunkOptions(maxUnitChars: number, overlapChars: number): void {
  if (!Number.isInteger(maxUnitChars) || maxUnitChars < 1) {
    throw new Error("PDF max unit chars must be a positive integer");
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxUnitChars) {
    throw new Error("PDF overlap chars must be a non-negative integer smaller than max unit chars");
  }
}

function splitText(
  text: string,
  maxUnitChars: number,
  overlapChars: number,
): Array<{ start: number; end: number; text: string }> {
  if (text.length <= maxUnitChars) return [{ start: 0, end: text.length, text }];
  const chunks: Array<{ start: number; end: number; text: string }> = [];
  let start = 0;
  while (start < text.length) {
    let end = moveToBoundary(text, Math.min(text.length, start + maxUnitChars), "backward");
    if (end <= start)
      end = moveToBoundary(text, Math.min(text.length, start + maxUnitChars), "forward");
    if (end <= start) throw new Error("PDF chunker could not make progress");
    chunks.push({ start, end, text: text.slice(start, end) });
    if (end === text.length) break;
    const proposedNext = Math.max(start + 1, end - overlapChars);
    let next = moveToBoundary(text, proposedNext, "forward");
    if (next >= end || next <= start) next = end;
    start = next;
  }
  return chunks;
}

function moveToBoundary(text: string, index: number, direction: "backward" | "forward"): number {
  const bounded = Math.max(0, Math.min(text.length, index));
  if (bounded === 0 || bounded === text.length) return bounded;
  const before = text.charCodeAt(bounded - 1);
  const after = text.charCodeAt(bounded);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
    return direction === "backward" ? bounded - 1 : bounded + 1;
  }
  return bounded;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error("PDF extraction was aborted");
  error.name = "AbortError";
  throw error;
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
}
