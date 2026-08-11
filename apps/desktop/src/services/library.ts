// Library service: glues ingest pipeline (core), repositories, and blob storage together.
import { normalizeDoi } from "@aurascholar/db/ids";
import { clueFromInput, cluesFromPdfSource, titleCandidatesFromPdfSource } from "@aurascholar/core";
import type { Clue } from "@aurascholar/core";
import type { ScholarIdentity } from "../../electron/shared";
import type { NormalizedWork } from "@aurascholar/connectors";
import { configureWorker, PdfDocument } from "@aurascholar/reader";
import type { PdfDocumentMetadata } from "@aurascholar/reader";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { sha256Hex } from "./aura-platform";
import {
  discardStagedPdf,
  finalizeIngest,
  findIngestDedup,
  stagePdf as stagePdfBytes,
} from "./library-actions";
import { fetchPdfForCommittedWork } from "./library-ingest-lifecycle";
import { ensureOaPdfAttachment } from "./library-oa";
import { restoreAnnotationsForAttachment } from "./library-annotation-recovery";
import { searchWorksByMetadata } from "./library-list";
import { resolveLibraryScholarlyClue } from "./scholarly-data";
import { toWorkInput } from "./work-input";
import type {
  AttachPdfResult,
  DedupHit,
  IngestDraft,
  IngestResult,
  LocalMatch,
  PendingPdf,
  PdfFields,
} from "./library-types";

configureWorker(workerSrc);

interface LibraryIngestSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_INGEST_FROM_INPUT__?: (
    input: string,
  ) => IngestResult | null | undefined | Promise<IngestResult | null | undefined>;
}

async function smokeIngestFromInput(input: string): Promise<IngestResult | null | undefined> {
  if (typeof window === "undefined") return undefined;
  const smokeIngest = (window as LibraryIngestSmokeWindow).__AURASCHOLAR_SMOKE_INGEST_FROM_INPUT__;
  if (!smokeIngest) return undefined;
  return smokeIngest(input);
}

/**
 * Direct ingest from a strong identifier (DOI/arXiv) with no user confirmation.
 * Used by background/automatic callers — the sentinel and citation-graph node
 * import — where the input is always an authoritative DOI, so there's no
 * mis-resolution risk and no UI to confirm against. Interactive entry points
 * (quick-add, PDF import, browser download) go through analyze/commit instead.
 */
export async function ingestFromInput(input: string): Promise<IngestResult | null> {
  const smokeResult = await smokeIngestFromInput(input);
  if (smokeResult !== undefined) return smokeResult;
  const clue = clueFromInput(input);
  if (!clue) return null;
  const resolved = await resolveSingleClue(clue);
  if (!resolved) return null;
  return ingestResolvedWork(resolved.work, { needsConfirmation: resolved.confidence < 0.7 });
}

/** Upsert a resolved work and try to fetch its OA PDF. Used by search import. */
export async function ingestResolvedWork(
  work: NormalizedWork,
  options: { needsConfirmation?: boolean } = {},
): Promise<IngestResult> {
  // Direct and automatic imports deliberately share the reviewed main-process
  // finalizer with interactive imports. It derives the active local Library
  // and owns the upsert; the renderer only follows up with best-effort OA PDF
  // acquisition after metadata is durably committed.
  const finalized = await finalizeIngest({
    mode: "create",
    pdf: null,
    workInput: toWorkInput(work),
  });
  const pdf = await fetchPdfForCommittedWork(() => ensureOaPdfAttachment(finalized.workId));
  return {
    workId: finalized.workId,
    deduped: finalized.deduped,
    title: finalized.title,
    ...pdf,
    needsConfirmation: options.needsConfirmation,
  };
}

// ── Analyze: resolve candidates WITHOUT writing to works/attachments ────────
// The user confirms (and may edit/pick) before anything is written. blob bytes
// may be staged here (content-addressed, idempotent); only finalizeIngest writes
// the library rows.

/** Analyze pasted text (DOI / arXiv / URL / title). No PDF, no library write. */
export async function analyzeInput(input: string): Promise<IngestDraft | null> {
  const clue = clueFromInput(input);
  if (!clue) return null;

  const fallbackTitle = input.trim();
  const dedup = await dedupForClue(clue);
  if (dedup) {
    return {
      source: "input",
      candidates: [],
      bestIndex: -1,
      confidence: 0,
      pdf: null,
      dedup,
      fallbackTitle,
      pdfFields: null,
      localMatches: [],
    };
  }

  const { candidates, confidence } = await resolveCandidates(clue);
  // For a title query, also surface look-alikes already in the library.
  const localMatches = clue.kind === "title" ? await searchLocalLibrary(clue.title) : [];
  return {
    source: "input",
    candidates,
    bestIndex: candidates.length > 0 ? 0 : -1,
    confidence,
    pdf: null,
    dedup: null,
    fallbackTitle,
    pdfFields: null,
    localMatches,
  };
}

/** Analyze a local PDF: stage the blob, resolve candidates from its own evidence. */
export async function analyzePdf(fileName: string, data: Uint8Array): Promise<IngestDraft> {
  return analyzePdfWithoutPageIdentity(fileName, data, "pdf", null);
}

/**
 * Analyze a browser download whose page exposed no citation metadata. Keeping
 * the research-download source and relPath ensures confirm/cancel can always
 * acknowledge and clean the exact temporary file that produced this draft.
 */
export async function analyzeResearchDownloadPdf(
  fileName: string,
  data: Uint8Array,
  relPath: string,
): Promise<IngestDraft> {
  return analyzePdfWithoutPageIdentity(fileName, data, "browser", relPath);
}

async function analyzePdfWithoutPageIdentity(
  fileName: string,
  data: Uint8Array,
  source: "pdf" | "browser",
  relPath: string | null,
): Promise<IngestDraft> {
  const exact = await exactFileDedup(fileName, data);
  if (exact.dedup) {
    if (source === "pdf") return draftWithDedup(source, exact.dedup, fileName);
    const pdf = await stagePdf(
      fileName,
      data,
      relPath,
      "research-download",
      exact.pageCount || undefined,
    );
    return { ...draftWithDedup(source, exact.dedup, fileName), pdf };
  }
  const pdf = await stagePdf(
    fileName,
    data,
    relPath,
    source === "browser" ? "research-download" : "manual",
    exact.pageCount,
  );
  const pdfFields = pdfFieldsFrom(exact.metadata, exact.text, fileName);

  const clues = cluesFromPdfSource({ text: exact.text, metadata: exact.metadata, fileName });
  const ordered = [
    ...clues.filter((c) => c.kind === "doi" || c.kind === "arxiv").slice(0, 3),
    ...clues.filter((c) => c.kind === "title").slice(0, 3),
  ];
  const { candidates, confidence } = await resolveManyClues(ordered);
  const localMatches = await searchLocalLibrary(pdfFields.title ?? fileName);
  return {
    source,
    candidates,
    bestIndex: candidates.length > 0 ? 0 : -1,
    confidence,
    pdf,
    dedup: null,
    fallbackTitle: pdfFields.title ?? fileName.replace(/\.pdf$/i, ""),
    pdfFields,
    localMatches,
  };
}

/**
 * Analyze a downloaded PDF using the page identity sniffed from `citation_*`
 * meta. The page identifier is authoritative — far better than guessing a DOI
 * from the PDF body. Candidates are surfaced for the user; nothing is written.
 */
export async function analyzePdfWithIdentity(
  fileName: string,
  data: Uint8Array,
  identity: ScholarIdentity,
  relPath: string | null,
): Promise<IngestDraft> {
  const exact = await exactFileDedup(fileName, data);
  if (exact.dedup) {
    // Keep a staged PDF even for a cross-work exact duplicate. A find-fulltext
    // task may intentionally attach the same content-addressed blob to its
    // explicit target; the renderer must be able to confirm that choice rather
    // than silently redirecting to whichever work first owned the blob.
    const pdf = await stagePdf(
      fileName,
      data,
      relPath,
      "research-download",
      exact.pageCount || undefined,
    );
    return { ...draftWithDedup("browser", exact.dedup, fileName), pdf };
  }

  const clue = identityClue(identity);
  if (clue) {
    const dedup = await dedupForClue(clue);
    if (dedup) {
      const pdf = await stagePdf(fileName, data, relPath, "research-download", exact.pageCount);
      // Already in library by DOI — but we still have a fresh PDF to offer.
      // Surface as a dedup so the caller can attach without a confirm card.
      return {
        source: "browser",
        candidates: [],
        bestIndex: -1,
        confidence: 0,
        pdf,
        dedup,
        fallbackTitle: fileName.replace(/\.pdf$/i, ""),
        pdfFields: null,
        localMatches: [],
      };
    }
  }

  const pdf = await stagePdf(fileName, data, relPath, "research-download", exact.pageCount);
  const pdfFields = pdfFieldsFrom(exact.metadata, exact.text, fileName, identity);
  let candidates: NormalizedWork[];
  let confidence: number;
  if (clue) {
    const r = await resolveCandidates(clue);
    candidates = r.candidates;
    confidence = r.confidence;
  } else {
    // No page identity — fall back to the PDF's own evidence.
    const clues = cluesFromPdfSource({ text: exact.text, metadata: exact.metadata, fileName });
    const ordered = [
      ...clues.filter((c) => c.kind === "doi" || c.kind === "arxiv").slice(0, 3),
      ...clues.filter((c) => c.kind === "title").slice(0, 3),
    ];
    const r = await resolveManyClues(ordered);
    candidates = r.candidates;
    confidence = r.confidence;
  }
  const localMatches = await searchLocalLibrary(pdfFields.title ?? identity.title ?? fileName);
  return {
    source: "browser",
    candidates,
    bestIndex: candidates.length > 0 ? 0 : -1,
    confidence,
    pdf,
    dedup: null,
    fallbackTitle: pdfFields.title ?? identity.title?.trim() ?? fileName.replace(/\.pdf$/i, ""),
    pdfFields,
    localMatches,
  };
}

// ── analyze helpers ─────────────────────────────────────────────────────────

interface ExactFileResult {
  sha: string;
  pageCount: number;
  text: string;
  metadata: PdfDocumentMetadata;
  dedup: DedupHit | null;
}

/**
 * Load a PDF with pdf.js without consuming the caller's buffer. pdf.js transfers
 * (detaches) the underlying ArrayBuffer it's given, which would then fail to
 * clone over IPC when we later write the blob — so always hand it a copy.
 */
async function loadPdfCopy(
  data: Uint8Array,
): Promise<{ pageCount: number; text: string; metadata: PdfDocumentMetadata }> {
  const doc = await PdfDocument.load(data.slice());
  try {
    const metadata = await doc.getMetadata();
    const pageTexts: string[] = [];
    for (let i = 0; i < Math.min(2, doc.pageCount); i++) {
      const lines = await doc.getPageTextLines(i);
      pageTexts.push(lines.join("\n"));
    }
    return { pageCount: doc.pageCount, text: pageTexts.join("\n\n"), metadata };
  } finally {
    doc.destroy();
  }
}

/** Hash the PDF, check exact-file dedup, and (if new) read its first pages. */
async function exactFileDedup(fileName: string, data: Uint8Array): Promise<ExactFileResult> {
  const sha = await sha256Hex(data);
  const hit = (await findIngestDedup({ kind: "attachmentSha", sha256: sha })).hit;
  if (hit?.reason === "exact-file") {
    const pageCount = hit.pageCount ?? (await loadPdfCopy(data)).pageCount;
    return {
      sha,
      pageCount,
      text: "",
      metadata: {},
      dedup: { reason: "exact-file", workId: hit.workId, title: hit.title || fileName },
    };
  }

  const { pageCount, text, metadata } = await loadPdfCopy(data);
  return { sha, pageCount, text, metadata, dedup: null };
}

/**
 * Ask main to persist the canonical content-addressed blob and build a
 * short-lived receipt. Probing for the page count uses a copy so pdf.js never
 * detaches the bytes handed to main.
 */
async function stagePdf(
  fileName: string,
  data: Uint8Array,
  relPath: string | null,
  fetchedVia: PendingPdf["fetchedVia"],
  pageCount?: number,
  sourceUrl?: string,
): Promise<PendingPdf> {
  const pages = pageCount ?? (await loadPdfCopy(data)).pageCount;
  const receipt = await stagePdfBytes(data);
  return {
    ...receipt,
    fileName,
    pageCount: pages,
    relPath,
    fetchedVia,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  };
}

function draftWithDedup(
  source: IngestDraft["source"],
  dedup: DedupHit,
  fileName: string,
): IngestDraft {
  return {
    source,
    candidates: [],
    bestIndex: -1,
    confidence: 0,
    pdf: null,
    dedup,
    fallbackTitle: fileName.replace(/\.pdf$/i, ""),
    pdfFields: null,
    localMatches: [],
  };
}

/**
 * Harvest fields straight from the PDF (Info/XMP + first-page heuristics), so a
 * "leave unidentified" import isn't reduced to just a filename. A sniffed page
 * identity (citation_*) wins over PDF-internal guesses when present.
 */
function pdfFieldsFrom(
  metadata: PdfDocumentMetadata,
  text: string,
  fileName: string,
  identity?: ScholarIdentity,
): PdfFields {
  const titles = titleCandidatesFromPdfSource({ text, metadata, fileName });
  const title = identity?.title?.trim() || titles[0] || metadata.title?.trim() || undefined;

  // PDF Info "Author" is often "A; B; C" or "A, B, C"; split conservatively.
  const authors = (metadata.author ?? "")
    .split(/\s*[;]\s*|\s+and\s+/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 1 && a.length < 80)
    .slice(0, 20);

  const yearMatch = text.slice(0, 4000).match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : undefined;

  return { title, authors, year };
}

/** Find up to five existing active works through the scoped metadata search. */
async function searchLocalLibrary(query: string): Promise<LocalMatch[]> {
  const q = query.trim();
  if (q.length < 4) return [];
  try {
    const rows = await searchWorksByMetadata(q, 5);
    return rows.map((w) => ({
      workId: w.id,
      title: w.title,
      year: w.year ?? null,
      authors: w.authorNames ?? [],
      doi: w.doi ?? null,
    }));
  } catch {
    return [];
  }
}

/** A clue whose stable identifier (DOI/arXiv) already exists in the library. */
async function dedupForClue(clue: Clue): Promise<DedupHit | null> {
  if (clue.kind !== "doi") return null;
  const hit = (await findIngestDedup({ doi: clue.doi, kind: "doi" })).hit;
  return hit?.reason === "doi" ? { reason: "doi", workId: hit.workId, title: hit.title } : null;
}

/** Resolve a single clue into candidates (title clues keep all candidates). */
async function resolveCandidates(
  clue: Clue,
): Promise<{ candidates: NormalizedWork[]; confidence: number }> {
  const resolved = await resolveSingleClue(clue).catch(() => null);
  if (!resolved) return { candidates: [], confidence: 0 };
  const candidates = dedupeWorks([resolved.work, ...(resolved.candidates ?? [])]);
  return { candidates, confidence: resolved.confidence };
}

/** URL clues need page-metadata capture, not a generic renderer HTTP fetch. */
async function resolveSingleClue(clue: Clue) {
  if (clue.kind === "url") return null;
  return (await resolveLibraryScholarlyClue({ clue })).resolved;
}

/** Try clues in order, accumulating candidates; identifier hits win confidence. */
async function resolveManyClues(
  clues: Clue[],
): Promise<{ candidates: NormalizedWork[]; confidence: number }> {
  const collected: NormalizedWork[] = [];
  let confidence = 0;
  for (const clue of clues) {
    const r = await resolveCandidates(clue);
    if (r.candidates.length === 0) continue;
    collected.push(...r.candidates);
    // The first identifier (doi/arxiv) match is authoritative — stop there.
    if (clue.kind === "doi" || clue.kind === "arxiv") {
      return { candidates: dedupeWorks(collected), confidence: Math.max(confidence, r.confidence) };
    }
    confidence = Math.max(confidence, r.confidence);
  }
  return { candidates: dedupeWorks(collected), confidence };
}

/** De-duplicate candidate works by DOI/arXiv/title so the card isn't repetitive. */
function dedupeWorks(works: NormalizedWork[]): NormalizedWork[] {
  const seen = new Set<string>();
  const out: NormalizedWork[] = [];
  for (const w of works) {
    const key =
      (w.doi && `doi:${w.doi.toLowerCase()}`) ||
      (w.arxivId && `arxiv:${w.arxivId.toLowerCase()}`) ||
      `title:${w.title.toLowerCase().replace(/\s+/g, " ").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** Highest-confidence clue derivable from a sniffed page identity. */
function identityClue(identity: ScholarIdentity): Clue | null {
  const doi = identity.doi ? normalizeDoi(identity.doi) : null;
  if (doi) return { kind: "doi", doi };
  if (identity.arxivId) return { kind: "arxiv", arxivId: identity.arxivId };
  const title = identity.title?.trim();
  if (title) return { kind: "title", title };
  return null;
}

/** Attach a local PDF to an existing library work without changing metadata. */
export async function attachPdfToWork(
  workId: string,
  fileName: string,
  data: Uint8Array,
): Promise<AttachPdfResult> {
  const pdf = await stagePdf(fileName, data, null, "manual");
  const result = await finalizeIngest({ mode: "attach", pdf, workId }).catch(async (error) => {
    await discardStagedPdf(pdf);
    throw error;
  });
  if (!result.attachment) {
    await discardStagedPdf(pdf);
    throw new Error("Main did not create the staged PDF attachment");
  }
  const restoredAnnotationCount = await restoreAnnotationsForAttachment(
    workId,
    result.attachment.id,
  );
  return {
    attachmentId: result.attachment.id,
    deduped: result.attachment.deduped,
    pageCount: pdf.pageCount,
    restoredAnnotationCount,
  };
}

export { toWorkInput };
export type {
  AttachPdfResult,
  DedupHit,
  IngestDraft,
  IngestResult,
  LocalMatch,
  PendingPdf,
  PdfFields,
} from "./library-types";
