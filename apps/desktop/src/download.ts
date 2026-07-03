// eslint-disable-next-line no-control-regex -- control chars are exactly what we strip
const ILLEGAL_FILENAME_CHARS = /[\x00-\x1f<>:"/\\|?*]+/g;

export function safeDownloadName(name: string, fallback = "aurascholar-export"): string {
  const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, "-").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
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
