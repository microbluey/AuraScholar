// eslint-disable-next-line no-control-regex -- control chars are exactly what we strip
const ILLEGAL_FILENAME_CHARS = /[\x00-\x1f<>:"/\\|?*]+/g;
const RESERVED_WINDOWS_BASENAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_DOWNLOAD_NAME_LENGTH = 180;

export function safeDownloadName(name: string, fallback = "aurascholar-export"): string {
  const sanitizedFallback = sanitizeFilenameText(fallback);
  const cleanFallback =
    sanitizedFallback && !isReservedBasename(sanitizedFallback)
      ? sanitizedFallback
      : "aurascholar-export";
  let cleaned = sanitizeFilenameText(name);
  const extension = filenameExtension(cleaned);
  if (!cleaned || isReservedBasename(cleaned)) {
    cleaned = `${stripExtension(cleanFallback) || "aurascholar-export"}${extension}`;
  }
  return truncateFilename(cleaned, MAX_DOWNLOAD_NAME_LENGTH) || cleanFallback;
}

function sanitizeFilenameText(value: string): string {
  return value
    .replace(ILLEGAL_FILENAME_CHARS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
}

function isReservedBasename(value: string): boolean {
  return RESERVED_WINDOWS_BASENAMES.test(stripExtension(value));
}

function filenameExtension(value: string): string {
  const dot = value.lastIndexOf(".");
  if (dot <= 0 || dot === value.length - 1) return "";
  const extension = value.slice(dot);
  return extension.length <= 16 ? extension : "";
}

function stripExtension(value: string): string {
  const extension = filenameExtension(value);
  return extension ? value.slice(0, -extension.length) : value;
}

function truncateFilename(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const extension = filenameExtension(value);
  if (!extension || extension.length >= maxLength - 1) {
    return value.slice(0, maxLength).replace(/[. ]+$/g, "");
  }
  const baseLength = maxLength - extension.length;
  const base = value.slice(0, baseLength).replace(/[. ]+$/g, "");
  return `${base}${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): string {
  const safeName = safeDownloadName(filename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 30_000);
  return safeName;
}
