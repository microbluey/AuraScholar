import {
  isReaderPdfIpcBusyError,
  isReaderPdfIpcLimitError,
} from "../../electron/reader-pdf-ipc-limit";
import {
  loadReaderAttachmentPdf,
  loadReaderWorkPdfCandidates,
  type ReaderAttachment,
} from "./reader-session-data";
import { describeSafeError } from "./sensitive-text";

/** A safe semantic error for Reader UI, not a raw main-process filesystem error. */
export class ReaderPdfTooLargeError extends Error {
  constructor() {
    super("Reader PDF exceeds the one-shot IPC limit");
    this.name = "ReaderPdfTooLargeError";
  }
}

/** A short-lived admission failure that the Reader UI may safely retry. */
export class ReaderPdfBusyError extends Error {
  constructor() {
    super("Another Reader PDF is already being opened");
    this.name = "ReaderPdfBusyError";
  }
}

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
  candidates: readonly ReaderAttachment[],
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
      lastError = isReaderPdfIpcLimitError(error)
        ? new ReaderPdfTooLargeError()
        : isReaderPdfIpcBusyError(error)
          ? new ReaderPdfBusyError()
          : error;
    }
  }

  if (lastError instanceof ReaderPdfTooLargeError || lastError instanceof ReaderPdfBusyError) {
    throw lastError;
  }
  const detail = describeSafeError(lastError);
  throw new Error(`PDF 附件文件无法读取:${detail}`);
}
