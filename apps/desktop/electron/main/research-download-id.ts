import { assertOpaqueDownloadId } from "./research-download-store-io";
import { MAX_RESEARCH_DOWNLOAD_ID_LENGTH } from "./research-download-limits";

const DOWNLOAD_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;

export function assertResearchDownloadId(value: unknown): asserts value is string {
  assertOpaqueDownloadId(value, DOWNLOAD_ID_PATTERN, MAX_RESEARCH_DOWNLOAD_ID_LENGTH);
}

export function assertResearchDownloadConsumeInput(value: unknown): { downloadId: string } {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "downloadId")) {
    throw new Error("Invalid research.consumeDownload input");
  }
  const downloadId = value.downloadId;
  assertResearchDownloadId(downloadId);
  return { downloadId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
