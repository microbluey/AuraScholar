import type { NormalizedWork } from "@aurascholar/connectors";
import type { OaPdfSource } from "@aurascholar/core";

export type PdfFetchedVia = "manual" | "research-download" | OaPdfSource;

export interface IngestResult {
  workId: string;
  deduped: boolean;
  title: string;
  pdfFetched: boolean;
  /** Safe user-facing detail when metadata committed but PDF acquisition failed. */
  pdfError?: string;
  /** Set when title-search confidence was low; UI should let the user verify. */
  needsConfirmation?: boolean;
}

export interface AttachPdfResult {
  attachmentId: string;
  deduped: boolean;
  pageCount: number;
  restoredAnnotationCount: number;
}

/**
 * A PDF staged by the main process. `stageId` is a short-lived, opaque
 * capability that `finalizeIngest` can consume once; hash and byte size are
 * returned only as renderer metadata. `relPath` is the research-download temp
 * file, deleted by the caller after commit/cancel; null for in-memory uploads.
 */
export interface PendingPdf {
  sha: string;
  fileName: string;
  byteSize: number;
  pageCount: number;
  relPath: string | null;
  stageId: string;
  fetchedVia: PdfFetchedVia;
  /** Original OA endpoint, retained only when the source is automatically fetched. */
  sourceUrl?: string;
}

/** Import already in the library; surfaced directly without a confirm card. */
export interface DedupHit {
  reason: "exact-file" | "doi";
  workId: string;
  title: string;
}

/**
 * Output of the analyze step: resolved candidates + staged PDF, with NO rows
 * written to `works`/`attachments`. The user picks/edits a candidate in the
 * confirm card; only `finalizeIngest` writes to the library.
 */
export interface IngestDraft {
  source: "browser" | "pdf" | "input";
  /** All resolved candidates (best first). Empty = nothing resolved. */
  candidates: NormalizedWork[];
  /** Index of the most-confident candidate; -1 when none is trustworthy. */
  bestIndex: number;
  /** Confidence of the best candidate (0..1), for a "low confidence" hint. */
  confidence: number;
  pdf: PendingPdf | null;
  /** Non-null = already in the library; caller should skip the card. */
  dedup: DedupHit | null;
  /** Fallback title for the "leave unidentified" choice. */
  fallbackTitle: string;
  /** Fields harvested from the PDF itself; used when no online match fits. */
  pdfFields: PdfFields | null;
  /** Existing library works that look like a match (attach instead of create). */
  localMatches: LocalMatch[];
  /**
   * When set, this import is "find full text for an existing work"; the confirm
   * card defaults to attaching the PDF to this work rather than creating one.
   */
  targetWorkId?: string;
  targetTitle?: string;
  /** Immutable handoff identity used to reject stale async completions. */
  targetHandoffId?: string;
  /**
   * Existing work identified by DOI/content hash when it differs from the
   * explicit full-text target. The confirmation UI must surface this conflict;
   * it must never silently redirect the attachment.
   */
  targetConflict?: DedupHit;
}

/** Best-effort metadata read straight from the PDF (Info/XMP + first page). */
export interface PdfFields {
  title?: string;
  authors: string[];
  year?: number;
}

/** A library work that may be the same paper; selecting it attaches the PDF. */
export interface LocalMatch {
  workId: string;
  title: string;
  year: number | null;
  authors: string[];
  doi: string | null;
}
