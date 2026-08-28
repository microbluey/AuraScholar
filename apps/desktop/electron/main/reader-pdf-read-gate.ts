/**
 * Each Reader PDF open materializes a bounded byte array in the main process.
 * Admit one canonical-file read at a time so a renderer cannot multiply that
 * per-file allocation while reads are in progress. End-to-end IPC transfer
 * serialization remains a future streaming-protocol concern.
 */
export const MAX_CONCURRENT_READER_PDF_READS = 1;

export interface ReaderPdfReadAdmission {
  /** Release this admission exactly once; repeated calls are safe. */
  release(): void;
}

export interface ReaderPdfReadGate {
  admit(): ReaderPdfReadAdmission | null;
}

export function createReaderPdfReadGate(
  maxConcurrentReads = MAX_CONCURRENT_READER_PDF_READS,
): ReaderPdfReadGate {
  if (!Number.isSafeInteger(maxConcurrentReads) || maxConcurrentReads <= 0) {
    throw new Error("Reader PDF concurrent read limit is invalid");
  }

  let activeReads = 0;
  return {
    admit() {
      if (activeReads >= maxConcurrentReads) return null;
      activeReads += 1;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          activeReads -= 1;
        },
      };
    },
  };
}

export const defaultReaderPdfReadGate = createReaderPdfReadGate();
