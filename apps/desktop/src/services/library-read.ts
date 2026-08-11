import type { AttachmentRow } from "@aurascholar/db/repos/attachments";
import { auraFiles } from "./aura-platform";
import { loadReaderWorkPdfCandidates } from "./reader-session-data";
import { describeSafeError } from "./sensitive-text";

/**
 * Resolves Reader-owned PDF candidates through the typed command boundary,
 * then reads blob bytes through the filesystem capability.
 */
export async function loadPdfForWork(
  workId: string,
  preferredAttachmentId?: string,
): Promise<{ attachmentId: string; data: Uint8Array } | null> {
  const { pdfAttachments } = await loadReaderWorkPdfCandidates(workId);
  return loadPdfFromCandidates(pdfAttachments, preferredAttachmentId);
}

/**
 * File-only portion of Reader PDF loading. It keeps the historical fallback
 * behavior: try every candidate in order unless the caller chose one PDF.
 */
export async function loadPdfFromCandidates(
  candidates: readonly AttachmentRow[],
  preferredAttachmentId?: string,
): Promise<{ attachmentId: string; data: Uint8Array } | null> {
  let pdfs = candidates.filter((attachment) => attachment.kind === "pdf");
  if (pdfs.length === 0) return null;
  if (preferredAttachmentId) {
    const preferred = pdfs.find((pdf) => pdf.id === preferredAttachmentId);
    if (!preferred) throw new Error("指定的 PDF 附件不存在或已被移除");
    pdfs = [preferred];
  }

  let lastError: unknown = null;
  for (const pdf of pdfs) {
    try {
      const data = await auraFiles.readBlobPdf(pdf.sha256);
      return { attachmentId: pdf.id, data };
    } catch (error) {
      lastError = error;
    }
  }

  const detail = describeSafeError(lastError);
  throw new Error(`PDF 附件文件无法读取:${detail}`);
}
