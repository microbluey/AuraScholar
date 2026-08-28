/**
 * A Reader PDF crosses the Electron IPC boundary as one complete byte array.
 * Keep this separate from larger on-disk staging limits until Reader gains a
 * streaming, main-process-owned document protocol.
 */
export const MAX_READER_PDF_IPC_BYTES = 512 * 1024 * 1024;
export const MAX_READER_PDF_IPC_MIB = MAX_READER_PDF_IPC_BYTES / (1024 * 1024);

/** Stable, non-sensitive marker that survives Electron's Error serialization. */
export const READER_PDF_IPC_LIMIT_ERROR_MARKER = "reader-pdf-ipc-limit";
export const READER_PDF_IPC_BUSY_ERROR_MARKER = "reader-pdf-ipc-busy";

export function createReaderPdfIpcLimitError(): Error {
  return new Error(`${READER_PDF_IPC_LIMIT_ERROR_MARKER}: PDF is too large to open safely`);
}

export function createReaderPdfIpcBusyError(): Error {
  return new Error(`${READER_PDF_IPC_BUSY_ERROR_MARKER}: another PDF is already opening`);
}

export function isReaderPdfIpcLimitError(error: unknown): boolean {
  return errorMessage(error)?.includes(`${READER_PDF_IPC_LIMIT_ERROR_MARKER}:`) ?? false;
}

export function isReaderPdfIpcBusyError(error: unknown): boolean {
  return errorMessage(error)?.includes(`${READER_PDF_IPC_BUSY_ERROR_MARKER}:`) ?? false;
}

function errorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("message" in error)) return null;
  const { message } = error as { message?: unknown };
  return typeof message === "string" ? message : null;
}
