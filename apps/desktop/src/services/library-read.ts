import type { AttachmentRow } from "@aurascholar/db/repos/attachments";
import { loadReaderAttachmentPdf, loadReaderWorkPdfCandidates } from "./reader-session-data";
import { describeSafeError } from "./sensitive-text";

/**
 * Resolves Reader-owned PDF candidates and reads each selected attachment
 * through the scoped typed command boundary.
 */
export async function loadPdfForWork(
  workId: string,
  preferredAttachmentId?: string,
): Promise<{ attachmentId: string; data: Uint8Array } | null> {
  const { pdfAttachments } = await loadReaderWorkPdfCandidates(workId);
  return loadPdfFromCandidates(workId, pdfAttachments, preferredAttachmentId);
}

/** Keeps the historical fallback behavior while revalidating each attachment in main. */
export async function loadPdfFromCandidates(
  workId: string,
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
      const { data } = await loadReaderAttachmentPdf(workId, pdf.id);
      return { attachmentId: pdf.id, data };
    } catch (error) {
      lastError = error;
    }
  }

  const detail = describeSafeError(lastError);
  throw new Error(`PDF 附件文件无法读取:${detail}`);
}
