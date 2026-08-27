import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { createResearchDownloadFileName } from "./research-download-file-name";
import { researchDownloadPath } from "./research-download-store";
import { isNodeError } from "./research-download-store-io";

export const MAX_RESEARCH_PRINT_FILE_ATTEMPTS = 4;

export interface ResearchPrintFileIo {
  openExclusive(path: string): number;
  writeFile(handle: number, pdf: Uint8Array): void;
  closeFile(handle: number): void;
  removeFile(path: string): void;
}

export interface ResearchPrintFileDependencies {
  createFileName(originalFileName: string): string;
  pathFor(userDataRoot: string, fileName: string): string;
  io: ResearchPrintFileIo;
}

/**
 * Atomically allocate a print capture file without ever replacing an existing
 * download. A collision is safe to retry because every candidate is written
 * with exclusive create semantics.
 */
export function writeResearchPrintedFile(
  userDataRoot: string,
  originalFileName: string,
  pdf: Uint8Array,
  dependencies: Partial<ResearchPrintFileDependencies> = {},
): string {
  const createFileName = dependencies.createFileName ?? createResearchDownloadFileName;
  const pathFor = dependencies.pathFor ?? researchDownloadPath;
  const io = dependencies.io ?? researchPrintFileIo;

  for (let attempt = 0; attempt < MAX_RESEARCH_PRINT_FILE_ATTEMPTS; attempt += 1) {
    const fileName = createFileName(originalFileName);
    try {
      writeExclusiveFile(pathFor(userDataRoot, fileName), pdf, io);
      return fileName;
    } catch (error) {
      if (
        !isNodeError(error) ||
        error.code !== "EEXIST" ||
        attempt + 1 === MAX_RESEARCH_PRINT_FILE_ATTEMPTS
      ) {
        throw error;
      }
    }
  }

  throw new Error("Research print file allocation did not complete");
}

const researchPrintFileIo: ResearchPrintFileIo = {
  openExclusive(path) {
    return openSync(path, "wx", 0o600);
  },
  writeFile(handle, pdf) {
    writeFileSync(handle, pdf);
  },
  closeFile(handle) {
    closeSync(handle);
  },
  removeFile(path) {
    unlinkSync(path);
  },
};

function writeExclusiveFile(path: string, pdf: Uint8Array, io: ResearchPrintFileIo): void {
  let handle: number | null = null;
  try {
    handle = io.openExclusive(path);
    io.writeFile(handle, pdf);
    io.closeFile(handle);
    handle = null;
  } catch (error) {
    if (handle !== null) {
      try {
        io.closeFile(handle);
      } catch {
        // Preserve the original write error while still attempting cleanup.
      }
      try {
        io.removeFile(path);
      } catch {
        // Recovery handles a file that cannot be removed immediately.
      }
    }
    throw error;
  }
}
