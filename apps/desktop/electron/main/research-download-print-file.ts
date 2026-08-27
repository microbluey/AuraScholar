import { writeFileSync } from "node:fs";
import { createResearchDownloadFileName } from "./research-download-file-name";
import { researchDownloadPath } from "./research-download-store";
import { isNodeError } from "./research-download-store-io";

export const MAX_RESEARCH_PRINT_FILE_ATTEMPTS = 4;

export interface ResearchPrintFileDependencies {
  createFileName(originalFileName: string): string;
  pathFor(userDataRoot: string, fileName: string): string;
  writeFile(path: string, pdf: Uint8Array): void;
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
  const writeFile = dependencies.writeFile ?? writeExclusiveFile;

  for (let attempt = 0; attempt < MAX_RESEARCH_PRINT_FILE_ATTEMPTS; attempt += 1) {
    const fileName = createFileName(originalFileName);
    try {
      writeFile(pathFor(userDataRoot, fileName), pdf);
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

function writeExclusiveFile(path: string, pdf: Uint8Array): void {
  writeFileSync(path, pdf, { mode: 0o600, flag: "wx" });
}
