import {
  isAllowedResearchUrl,
  MAX_RESEARCH_URL_LENGTH,
  validateResearchUrl,
} from "./research-browser-policy";

const PDF_VIEWER_EXTENSION_ID = "mhjfbmdgcfjbbpaeojofohoefgiehjai";

/**
 * Embedded documents commonly use these non-network URLs. They are safe to
 * keep inside a web page, but must never become the top-level research tab
 * (where they could bypass the URL and capture policy).
 */
function isAllowedEmbeddedResearchUrl(rawUrl: unknown): boolean {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.trim() !== rawUrl ||
    rawUrl.length === 0 ||
    rawUrl.length > MAX_RESEARCH_URL_LENGTH ||
    hasControlCharacter(rawUrl)
  ) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol === "about:") {
    return url.pathname.toLowerCase() === "blank";
  }

  // Chromium's built-in PDF viewer is a child frame with this fixed entry
  // point. Allow only that internal origin/path; arbitrary extensions remain
  // blocked and the extension cannot become a top-level research document.
  if (url.protocol === "chrome-extension:") {
    return (
      url.hostname === PDF_VIEWER_EXTENSION_ID &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/index.html"
    );
  }

  // A blob URL inherits the origin of the page that created it. Parse the
  // inner URL rather than checking `url.hostname` (which is empty for blobs),
  // so blob:file/data and opaque-origin blobs remain blocked.
  if (url.protocol !== "blob:") return false;
  const innerUrl = rawUrl.slice("blob:".length);
  return isAllowedResearchUrl(innerUrl);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Decide whether a frame navigation may proceed. Main frames are restricted to
 * the same HTTP(S) policy used by IPC opens. Subframes retain ordinary HTTP(S)
 * pages plus the narrowly scoped about:blank/blob/PDF-viewer documents needed
 * by embedded content; file/data/javascript and unknown extensions are blocked.
 */
export function isAllowedResearchFrameUrl(rawUrl: unknown, isMainFrame: unknown): boolean {
  if (isMainFrame !== true && isMainFrame !== false) return false;
  if (isAllowedResearchUrl(rawUrl)) return true;
  if (isMainFrame) return false;
  return isAllowedEmbeddedResearchUrl(rawUrl);
}

export function shouldBlockResearchFrameNavigation(rawUrl: unknown, isMainFrame: unknown): boolean {
  return !isAllowedResearchFrameUrl(rawUrl, isMainFrame);
}

export interface ResearchNavigationEvent {
  url: string;
  isMainFrame: boolean;
  preventDefault(): void;
}

export function guardResearchNavigation(details: ResearchNavigationEvent): void {
  if (shouldBlockResearchFrameNavigation(details.url, details.isMainFrame)) {
    details.preventDefault();
  }
}

/**
 * Return a canonical URL only for a committed main-frame navigation. A null
 * result means the event was for a child frame or carried an unsafe/malformed
 * URL, so callers must leave tab state and scholar metadata unchanged.
 */
export function acceptResearchMainFrameUrl(rawUrl: unknown, isMainFrame: unknown): string | null {
  if (isMainFrame !== true) return null;
  try {
    return validateResearchUrl(rawUrl).toString();
  } catch {
    return null;
  }
}

export function commitResearchMainFrameUrl(
  target: { url: string; scholar?: unknown },
  rawUrl: unknown,
  isMainFrame: unknown,
): string | null {
  const safeUrl = acceptResearchMainFrameUrl(rawUrl, isMainFrame);
  if (!safeUrl) {
    if (isMainFrame === true) target.scholar = undefined;
    return null;
  }
  target.url = safeUrl;
  return safeUrl;
}
