// Library service: glues ingest pipeline (core) + repos (db) + blob store
// (fs) together for the desktop app.
import {
  AnnotationsRepo,
  AttachmentsRepo,
  WorksRepo,
  normalizeDoi,
  type WorkInput,
  type WorkWithAuthors,
} from "@aurascholar/db";
import {
  clueFromInput,
  cluesFromPdfSource,
  findOaPdf,
  resolveClue,
  titleCandidatesFromPdfSource,
} from "@aurascholar/core";
import type { Clue } from "@aurascholar/core";
import type { ScholarIdentity } from "../../electron/shared";
import type { ConnectorContext, NormalizedWork } from "@aurascholar/connectors";
import { PdfDocument } from "@aurascholar/reader";
import type { PdfDocumentMetadata } from "@aurascholar/reader";
import { getDb } from "./tauri-db";
import { blobPath, sha256Hex, tauriFs, tauriHttp } from "./tauri-platform";

// Until a settings UI exists, use a project contact for polite pools.
const ctx: ConnectorContext = { http: tauriHttp, mailto: "contact@aurascholar.app" };

export interface IngestResult {
  workId: string;
  deduped: boolean;
  title: string;
  pdfFetched: boolean;
  /** Set when title-search confidence was low — UI should let the user verify. */
  needsConfirmation?: boolean;
}

export interface AttachPdfResult {
  attachmentId: string;
  deduped: boolean;
  pageCount: number;
}

/**
 * A PDF staged during analysis. Its blob is already written (content-addressed
 * by sha, so writing is idempotent and harmless); commit only creates the
 * `attachments` row. `relPath` is the research-download temp file, deleted by
 * the caller after commit/cancel; null for in-memory local uploads.
 */
export interface PendingPdf {
  sha: string;
  fileName: string;
  byteSize: number;
  pageCount: number;
  relPath: string | null;
  fetchedVia: "manual" | "research-download";
}

/** Import already in the library — surfaced directly without a confirm card. */
export interface DedupHit {
  reason: "exact-file" | "doi";
  workId: string;
  title: string;
}

/**
 * Output of the analyze step: resolved candidates + staged PDF, with NO rows
 * written to `works`/`attachments`. The user picks/edits a candidate in the
 * confirm card; only `commitIngest` writes to the library.
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
  /** Fields harvested from the PDF itself — used when no online match fits. */
  pdfFields: PdfFields | null;
  /** Existing library works that look like a match (attach instead of create). */
  localMatches: LocalMatch[];
  /**
   * When set, this import is "find full text for an existing work" — the confirm
   * card defaults to attaching the PDF to this work rather than creating one.
   */
  targetWorkId?: string;
  targetTitle?: string;
}

/** Minimal work shape for OA lookup (subset of NormalizedWork fields). */
export interface OaLookupWork {
  doi?: string;
  arxivId?: string;
  oaPdfUrl?: string;
  title: string;
}

/** Best-effort metadata read straight from the PDF (Info/XMP + first page). */
export interface PdfFields {
  title?: string;
  authors: string[];
  year?: number;
}

/** A library work that may be the same paper — selecting it attaches the PDF. */
export interface LocalMatch {
  workId: string;
  title: string;
  year: number | null;
  authors: string[];
  doi: string | null;
}

async function repos() {
  const db = await getDb();
  return {
    works: new WorksRepo(db),
    attachments: new AttachmentsRepo(db),
    annotations: new AnnotationsRepo(db),
  };
}

export function toWorkInput(w: NormalizedWork): WorkInput {
  return {
    doi: w.doi,
    title: w.title,
    abstract: w.abstract,
    year: w.year,
    publicationDate: w.publicationDate,
    venueName: w.venueName,
    venueType: w.venueType,
    type: w.type,
    arxivId: w.arxivId,
    openalexId: w.openalexId,
    s2Id: w.s2Id,
    pmid: w.pmid,
    volume: w.volume,
    issue: w.issue,
    pages: w.pages,
    publisher: w.publisher,
    placePublished: w.placePublished,
    issn: w.issn,
    isbn: w.isbn,
    language: w.language,
    url: w.url,
    keywords: w.keywords,
    cslJson: w.cslJson,
    authors: w.authors.map((a) => ({
      displayName: a.displayName,
      orcid: a.orcid,
      position: a.position,
      role: a.role,
    })),
  };
}

/**
 * Direct ingest from a strong identifier (DOI/arXiv) with no user confirmation.
 * Used by background/automatic callers — the sentinel and citation-graph node
 * import — where the input is always an authoritative DOI, so there's no
 * mis-resolution risk and no UI to confirm against. Interactive entry points
 * (quick-add, PDF import, browser download) go through analyze/commit instead.
 */
export async function ingestFromInput(input: string): Promise<IngestResult | null> {
  const clue = clueFromInput(input);
  if (!clue) return null;
  const resolved = await resolveClue(ctx, clue);
  if (!resolved) return null;
  return ingestResolvedWork(resolved.work, { needsConfirmation: resolved.confidence < 0.7 });
}

/** Upsert a resolved work and try to fetch its OA PDF. Used by search import. */
export async function ingestResolvedWork(
  work: NormalizedWork,
  options: { needsConfirmation?: boolean } = {},
): Promise<IngestResult> {
  const { works } = await repos();
  const { id, deduped } = await works.upsert(toWorkInput(work));
  const pdfFetched = await tryFetchPdf(id, work);
  return {
    workId: id,
    deduped,
    title: work.title,
    pdfFetched,
    needsConfirmation: options.needsConfirmation,
  };
}

// ── Analyze: resolve candidates WITHOUT writing to works/attachments ────────
// The user confirms (and may edit/pick) before anything is written. blob bytes
// may be staged here (content-addressed, idempotent); only commitIngest writes
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
  const exact = await exactFileDedup(fileName, data);
  if (exact.dedup) {
    return draftWithDedup("pdf", exact.dedup, fileName);
  }
  const pdf = await stagePdf(fileName, data, null, "manual", exact.pageCount);
  const pdfFields = pdfFieldsFrom(exact.metadata, exact.text, fileName);

  const clues = cluesFromPdfSource({ text: exact.text, metadata: exact.metadata, fileName });
  const ordered = [
    ...clues.filter((c) => c.kind === "doi" || c.kind === "arxiv").slice(0, 3),
    ...clues.filter((c) => c.kind === "title").slice(0, 3),
  ];
  const { candidates, confidence } = await resolveManyClues(ordered);
  const localMatches = await searchLocalLibrary(pdfFields.title ?? fileName);
  return {
    source: "pdf",
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
    return draftWithDedup("browser", exact.dedup, fileName);
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
  let candidates: NormalizedWork[] = [];
  let confidence = 0;
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

/**
 * Commit a user-confirmed import: the ONLY place that writes works/attachments.
 * `workInput` is the user's final pick/edit; `pdf` is the staged blob (already
 * on disk) to attach.
 */
export async function commitIngest(args: {
  workInput: WorkInput;
  pdf: PendingPdf | null;
  source: IngestDraft["source"];
}): Promise<IngestResult> {
  const { works, attachments } = await repos();
  const { id, deduped } = await works.upsert(args.workInput);
  let pdfFetched = false;
  if (args.pdf) {
    await attachments.create({
      workId: id,
      sha256: args.pdf.sha,
      byteSize: args.pdf.byteSize,
      originalFilename: args.pdf.fileName,
      fetchedVia: args.pdf.fetchedVia,
      pageCount: args.pdf.pageCount,
    });
    pdfFetched = true;
  }
  return { workId: id, deduped, title: args.workInput.title, pdfFetched };
}

/** Restore a soft-deleted dedup hit and surface it (no new rows written). */
export async function restoreDedup(workId: string): Promise<void> {
  const { works } = await repos();
  await works.restore(workId);
}

/** Attach an already-staged PDF (blob on disk) to a work — for dedup hits. */
export async function attachStagedPdf(workId: string, pdf: PendingPdf): Promise<void> {
  const { attachments } = await repos();
  await attachments.create({
    workId,
    sha256: pdf.sha,
    byteSize: pdf.byteSize,
    originalFilename: pdf.fileName,
    fetchedVia: pdf.fetchedVia,
    pageCount: pdf.pageCount,
  });
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
async function loadPdfCopy(data: Uint8Array): Promise<{ pageCount: number; text: string; metadata: PdfDocumentMetadata }> {
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
  const { works, attachments } = await repos();
  const sha = await sha256Hex(data);
  const dup = await attachments.bySha(sha);
  if (dup) {
    const existing = await works.get(dup.work_id);
    return {
      sha,
      pageCount: 0,
      text: "",
      metadata: {},
      dedup: { reason: "exact-file", workId: dup.work_id, title: existing?.title ?? fileName },
    };
  }

  const { pageCount, text, metadata } = await loadPdfCopy(data);
  return { sha, pageCount, text, metadata, dedup: null };
}

/**
 * Persist the PDF blob (idempotent, content-addressed) and build PendingPdf.
 * Writes from the original bytes; probing for the page count uses a copy so the
 * write isn't handed a detached buffer.
 */
async function stagePdf(
  fileName: string,
  data: Uint8Array,
  relPath: string | null,
  fetchedVia: PendingPdf["fetchedVia"],
  pageCount?: number,
): Promise<PendingPdf> {
  const sha = await sha256Hex(data);
  await tauriFs.writeFile(blobPath(sha), data);
  const pages = pageCount ?? (await loadPdfCopy(data)).pageCount;
  return { sha, fileName, byteSize: data.byteLength, pageCount: pages, relPath, fetchedVia };
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

/** Find existing library works whose title resembles the query (FTS prefix). */
async function searchLocalLibrary(query: string): Promise<LocalMatch[]> {
  const q = query.trim();
  if (q.length < 4) return [];
  const { works } = await repos();
  try {
    const rows = await works.list({ search: q, limit: 5 });
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
  const { works } = await repos();
  const existing = await works.findByDoi(clue.doi);
  return existing ? { reason: "doi", workId: existing.id, title: existing.title } : null;
}

/** Resolve a single clue into candidates (title clues keep all candidates). */
async function resolveCandidates(
  clue: Clue,
): Promise<{ candidates: NormalizedWork[]; confidence: number }> {
  const resolved = await resolveClue(ctx, clue).catch(() => null);
  if (!resolved) return { candidates: [], confidence: 0 };
  const candidates = dedupeWorks([resolved.work, ...(resolved.candidates ?? [])]);
  return { candidates, confidence: resolved.confidence };
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
  const { attachments } = await repos();
  const sha = await sha256Hex(data);

  // Write the blob from the original bytes first; probe page count with a copy
  // (pdf.js detaches the buffer it's given).
  await tauriFs.writeFile(blobPath(sha), data);
  const { pageCount } = await loadPdfCopy(data);

  const { id, deduped } = await attachments.create({
    workId,
    sha256: sha,
    byteSize: data.byteLength,
    originalFilename: fileName,
    fetchedVia: "manual",
    pageCount,
  });
  return { attachmentId: id, deduped, pageCount };
}

/**
 * Fetch a legal open-access PDF for a work, validating it's a real PDF (some
 * "PDF" URLs return HTML paywalls). Returns the bytes + source, or null.
 */
async function fetchOaBytes(
  work: OaLookupWork,
): Promise<{ bytes: Uint8Array; url: string; via: string } | null> {
  const oa = await findOaPdf(ctx, work as NormalizedWork).catch(() => null);
  if (!oa) return null;
  try {
    const res = await tauriHttp.request({ url: oa.url, timeoutMs: 60_000 });
    if (res.status !== 200 || res.body.byteLength < 1024) return null;
    const head = new TextDecoder().decode(res.body.slice(0, 5));
    if (!head.startsWith("%PDF")) return null;
    return { bytes: res.body, url: oa.url, via: oa.via };
  } catch {
    return null;
  }
}

/** Downloads an OA PDF for a work if a legal source exists. */
async function tryFetchPdf(workId: string, work: NormalizedWork): Promise<boolean> {
  const { attachments } = await repos();
  const existing = await attachments.forWork(workId);
  if (existing.length > 0) return true;

  const oa = await fetchOaBytes(work);
  if (!oa) return false;
  const sha = await sha256Hex(oa.bytes);
  await tauriFs.writeFile(blobPath(sha), oa.bytes);
  await attachments.create({
    workId,
    sha256: sha,
    byteSize: oa.bytes.byteLength,
    sourceUrl: oa.url,
    fetchedVia: oa.via,
  });
  return true;
}

/**
 * "Find full text" fast path: try to fetch an OA PDF for an existing work and
 * stage it as a draft (targeted to attach to that work, pending confirmation).
 * Returns null when no OA PDF is available — caller then opens the browser.
 */
export async function analyzeOaPdf(work: OaLookupWork): Promise<IngestDraft | null> {
  const oa = await fetchOaBytes(work);
  if (!oa) return null;
  const fileName = `${work.title.slice(0, 60).replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`;
  const pdf = await stagePdf(fileName, oa.bytes, null, "manual");
  return {
    source: "pdf",
    candidates: [],
    bestIndex: -1,
    confidence: 0,
    pdf,
    dedup: null,
    fallbackTitle: work.title,
    pdfFields: null,
    localMatches: [],
  };
}

export async function listWorks(
  search?: string,
  collectionId?: string,
  limit?: number,
): Promise<WorkWithAuthors[]> {
  const { works } = await repos();
  return works.list({ search, collectionId, limit });
}

export async function listDeletedWorks(
  search?: string,
  limit?: number,
): Promise<WorkWithAuthors[]> {
  const { works } = await repos();
  return works.listDeleted({ search, limit });
}

export async function loadPdfForWork(
  workId: string,
): Promise<{ attachmentId: string; data: Uint8Array } | null> {
  const { attachments } = await repos();
  const list = await attachments.forWork(workId);
  const pdf = list.find((a) => a.kind === "pdf");
  if (!pdf) return null;
  const data = await tauriFs.readFile(blobPath(pdf.sha256));
  return { attachmentId: pdf.id, data };
}

export { repos };
