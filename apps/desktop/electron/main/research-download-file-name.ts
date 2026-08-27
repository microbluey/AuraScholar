import { randomBytes } from "node:crypto";

export const MAX_RESEARCH_DOWNLOAD_FILE_NAME_LENGTH = 255;
const RESEARCH_DOWNLOAD_NONCE_DIGITS = 20;

const WINDOWS_DEVICE_NAME =
  /^(?:aux|clock\$|com[1-9¹²³]|con|conin\$|conout\$|lpt[1-9¹²³]|nul|prn)$/iu;

/**
 * Produce a main-owned temporary filename that is portable across supported
 * filesystems. The full 64-bit numeric nonce is concatenated with the timestamp
 * so legacy UI display cleanup can still remove the entire generated prefix at once.
 */
export function createResearchDownloadFileName(
  originalFileName: string,
  now = Date.now(),
  nonce = randomNumericNonce(),
): string {
  const timestamp = Number.isSafeInteger(now) && now >= 0 ? String(now) : String(Date.now());
  const numericNonce = String(nonce)
    .replace(/\D/g, "")
    .slice(-RESEARCH_DOWNLOAD_NONCE_DIGITS)
    .padStart(RESEARCH_DOWNLOAD_NONCE_DIGITS, "0");
  const prefix = `${timestamp}${numericNonce}-`;
  const safe = normalizeOriginalName(originalFileName);
  const extensionMatch = safe.match(/\.[A-Za-z0-9]{1,16}$/u);
  const extension = extensionMatch?.[0] ?? "";
  const rawStem = extension ? safe.slice(0, -extension.length) : safe;
  const stem = WINDOWS_DEVICE_NAME.test(rawStem) ? "download" : rawStem || "download";
  const maxStemLength = MAX_RESEARCH_DOWNLOAD_FILE_NAME_LENGTH - prefix.length - extension.length;
  const boundedStem = stem.slice(0, Math.max(1, maxStemLength)) || "d";
  return `${prefix}${boundedStem}${extension}`;
}

function normalizeOriginalName(value: string): string {
  const safe = typeof value === "string" ? value.replace(/[^a-zA-Z0-9._-]/g, "-") : "";
  const trimmed = safe.replace(/^[-.]+|[-. ]+$/g, "");
  return trimmed || "download";
}

function randomNumericNonce(): string {
  return BigInt(`0x${randomBytes(8).toString("hex")}`).toString(10);
}
