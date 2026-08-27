import { MAX_REFERENCE_IMPORT_INPUT_BYTES } from "./reference-import-limits";
import type { ResearchDownloadContent } from "../shared";

const REFERENCE_EXTENSIONS = new Set([".bib", ".ris", ".nbib", ".enw", ".json", ".txt"]);
type ResearchDownloadContentKind = ResearchDownloadContent["kind"];

export interface ResearchDownloadFilePolicy {
  kind: ResearchDownloadContentKind;
  maxByteSize: number;
}

/**
 * Reference candidates are decoded and parsed in the renderer before import,
 * so they must share the stricter reference-import input bound. Other captured
 * files retain the general research-download limit for backward compatibility.
 */
export function describeResearchDownloadFile(
  fileName: string,
  maxDownloadBytes: number,
): ResearchDownloadFilePolicy {
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (extension === ".pdf") return { kind: "pdf", maxByteSize: maxDownloadBytes };
  if (REFERENCE_EXTENSIONS.has(extension)) {
    return {
      kind: "references",
      maxByteSize: Math.min(maxDownloadBytes, MAX_REFERENCE_IMPORT_INPUT_BYTES),
    };
  }
  return { kind: "ignored", maxByteSize: maxDownloadBytes };
}

export function researchDownloadByteLimit(fileName: string, maxDownloadBytes: number): number {
  return describeResearchDownloadFile(fileName, maxDownloadBytes).maxByteSize;
}

/** Accept Electron's unknown total (0), but bound all known transfer counters. */
export function isResearchDownloadTransferWithinLimit(
  receivedBytes: number,
  totalBytes: number,
  maxByteSize: number,
): boolean {
  return (
    Number.isSafeInteger(receivedBytes) &&
    receivedBytes >= 0 &&
    Number.isSafeInteger(totalBytes) &&
    totalBytes >= 0 &&
    receivedBytes <= maxByteSize &&
    (totalBytes === 0 || (totalBytes <= maxByteSize && receivedBytes <= totalBytes))
  );
}
