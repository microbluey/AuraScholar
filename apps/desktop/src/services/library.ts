// Library service: glues ingest pipeline (core) + repos (db) + blob store
// (fs) together for the desktop app.
import {
  AnnotationsRepo,
  AttachmentsRepo,
  WorksRepo,
  type WorkWithAuthors,
} from "@aurascholar/db";
import { clueFromInput, cluesFromPdfText, findOaPdf, resolveClue } from "@aurascholar/core";
import type { ConnectorContext, NormalizedWork } from "@aurascholar/connectors";
import { PdfDocument } from "@aurascholar/reader";
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

async function repos() {
  const db = await getDb();
  return {
    works: new WorksRepo(db),
    attachments: new AttachmentsRepo(db),
    annotations: new AnnotationsRepo(db),
  };
}

function toWorkInput(w: NormalizedWork) {
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

/** Ingest from pasted text (DOI / arXiv / URL / title). */
export async function ingestFromInput(input: string): Promise<IngestResult | null> {
  const clue = clueFromInput(input);
  if (!clue) return null;
  const resolved = await resolveClue(ctx, clue);
  if (!resolved) return null;

  const { works } = await repos();
  const { id, deduped } = await works.upsert(toWorkInput(resolved.work));
  const pdfFetched = await tryFetchPdf(id, resolved.work);
  return {
    workId: id,
    deduped,
    title: resolved.work.title,
    pdfFetched,
    needsConfirmation: resolved.confidence < 0.7,
  };
}

/** Ingest a local PDF file: hash → store blob → extract clues → resolve metadata. */
export async function ingestFromPdf(fileName: string, data: Uint8Array): Promise<IngestResult> {
  const { works, attachments } = await repos();
  const sha = await sha256Hex(data);

  // Exact-file duplicate? Just surface the existing work.
  const dup = await attachments.bySha(sha);
  if (dup) {
    const existing = await works.get(dup.work_id);
    return { workId: dup.work_id, deduped: true, title: existing?.title ?? fileName, pdfFetched: true };
  }

  await tauriFs.writeFile(blobPath(sha), data);

  // Try to identify the paper from its first pages.
  const doc = await PdfDocument.load(data);
  let pageCount = doc.pageCount;
  let text = "";
  try {
    for (let i = 0; i < Math.min(2, doc.pageCount); i++) {
      text += (await doc.getPageText(i)).text + "\n";
    }
  } finally {
    doc.destroy();
  }

  let resolved = null;
  for (const clue of cluesFromPdfText(text).slice(0, 3)) {
    resolved = await resolveClue(ctx, clue);
    if (resolved) break;
  }

  const workInput = resolved
    ? toWorkInput(resolved.work)
    : { title: fileName.replace(/\.pdf$/i, ""), type: "article" };
  const { id, deduped } = await works.upsert(workInput);
  await attachments.create({
    workId: id,
    sha256: sha,
    byteSize: data.byteLength,
    originalFilename: fileName,
    fetchedVia: "manual",
    pageCount,
  });
  return {
    workId: id,
    deduped,
    title: workInput.title,
    pdfFetched: true,
    needsConfirmation: !resolved,
  };
}

/** Downloads an OA PDF for a work if a legal source exists. */
async function tryFetchPdf(workId: string, work: NormalizedWork): Promise<boolean> {
  const { attachments } = await repos();
  const existing = await attachments.forWork(workId);
  if (existing.length > 0) return true;

  const oa = await findOaPdf(ctx, work).catch(() => null);
  if (!oa) return false;
  try {
    const res = await tauriHttp.request({ url: oa.url, timeoutMs: 60_000 });
    if (res.status !== 200 || res.body.byteLength < 1024) return false;
    // Some "PDF" URLs return HTML paywalls; check magic bytes.
    const head = new TextDecoder().decode(res.body.slice(0, 5));
    if (!head.startsWith("%PDF")) return false;
    const sha = await sha256Hex(res.body);
    await tauriFs.writeFile(blobPath(sha), res.body);
    await attachments.create({
      workId,
      sha256: sha,
      byteSize: res.body.byteLength,
      sourceUrl: oa.url,
      fetchedVia: oa.via,
    });
    return true;
  } catch {
    return false;
  }
}

export async function listWorks(
  search?: string,
  collectionId?: string,
  limit?: number,
): Promise<WorkWithAuthors[]> {
  const { works } = await repos();
  return works.list({ search, collectionId, limit });
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
