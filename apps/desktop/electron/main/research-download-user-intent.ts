import type { BrowserWindow } from "electron";
import { EV, type ScholarIdentity } from "../shared";

export const RESEARCH_DOWNLOAD_CAPTURE_INTENT_TTL_MS = 30_000;

export interface ResearchDownloadCaptureSource {
  downloadURL(url: string): void;
}

export interface ResearchDownloadUserIntentGate {
  /** Allow one main-owned `downloadURL()` request from this exact WebContents. */
  issueAppCapture(sourceWebContents: unknown, url: string, onExpired?: () => void): () => void;
  /** Atomically claim an app-capture exception for a matching URL chain. */
  consumeAppCapture(sourceWebContents: unknown, urlChain: readonly string[]): boolean;
}

export interface ResearchDownloadUserIntentGateOptions {
  now?(): number;
  ttlMs?: number;
}

export interface ResearchDownloadCaptureOptions {
  gate?: ResearchDownloadUserIntentGate;
  onExpired?: () => void;
}

export interface ResearchDownloadCaptureNotice {
  ownerTabId: string;
  scholar?: ScholarIdentity;
  tabId: string;
}

interface PendingIntent {
  readonly expiresAt: number;
  readonly expectedUrl: string;
  readonly onExpired: (() => void) | undefined;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Electron does not attach a request ID to `will-download`. Its only
 * non-gesture path is therefore constrained to the same WebContents, exact
 * initial URL, a short lifetime, and one atomic claim.
 */
export function createResearchDownloadUserIntentGate(
  options: ResearchDownloadUserIntentGateOptions = {},
): ResearchDownloadUserIntentGate {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? RESEARCH_DOWNLOAD_CAPTURE_INTENT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Research download capture intent TTL is invalid");
  }
  const intents = new Map<object, PendingIntent>();

  function remove(source: object, intent: PendingIntent, notify = false): void {
    if (intents.get(source) !== intent) return;
    intents.delete(source);
    if (intent.timer) clearTimeout(intent.timer);
    intent.timer = null;
    if (notify) {
      try {
        intent.onExpired?.();
      } catch {
        // A closed window must not keep an expired permit alive.
      }
    }
  }

  return {
    issueAppCapture(sourceWebContents, rawUrl, onExpired) {
      const source = sourceKey(sourceWebContents);
      const expectedUrl = normalizedHttpUrl(rawUrl);
      if (!source || !expectedUrl) throw new Error("Research download capture intent is invalid");

      const previous = intents.get(source);
      if (previous) remove(source, previous);
      const intent: PendingIntent = {
        expectedUrl,
        expiresAt: now() + ttlMs,
        onExpired,
        timer: null,
      };
      intent.timer = setTimeout(() => remove(source, intent, true), ttlMs);
      intent.timer.unref?.();
      intents.set(source, intent);
      return () => remove(source, intent);
    },
    consumeAppCapture(sourceWebContents, urlChain) {
      const source = sourceKey(sourceWebContents);
      if (!source) return false;
      const intent = intents.get(source);
      if (!intent) return false;
      if (now() >= intent.expiresAt) {
        remove(source, intent, true);
        return false;
      }
      if (normalizedHttpUrl(urlChain[0]) !== intent.expectedUrl) return false;
      remove(source, intent);
      return true;
    },
  };
}

const defaultResearchDownloadUserIntentGate = createResearchDownloadUserIntentGate();

/** Start the only trusted non-gesture download path and revoke on sync failure. */
export function startResearchDownloadCapture(
  sourceWebContents: ResearchDownloadCaptureSource,
  url: string,
  options: ResearchDownloadCaptureOptions = {},
): void {
  const gate = options.gate ?? defaultResearchDownloadUserIntentGate;
  const revoke = gate.issueAppCapture(sourceWebContents, url, options.onExpired);
  try {
    sourceWebContents.downloadURL(url);
  } catch (error) {
    revoke();
    throw error;
  }
}

export function consumeResearchDownloadCaptureIntent(
  sourceWebContents: unknown,
  urlChain: readonly string[],
): boolean {
  return defaultResearchDownloadUserIntentGate.consumeAppCapture(sourceWebContents, urlChain);
}

export function notifyResearchDownloadCaptureExpired(
  window: BrowserWindow | null,
  capture: ResearchDownloadCaptureNotice,
): void {
  try {
    window?.webContents.send(EV.researchDownloadFinished, {
      tabId: capture.tabId,
      ownerTabId: capture.ownerTabId,
      fileName: "download",
      downloadId: null,
      success: false,
      scholar: capture.scholar,
    });
  } catch {
    // The capture's original window may have closed before the timeout.
  }
}

function sourceKey(value: unknown): object | undefined {
  return value !== null && (typeof value === "object" || typeof value === "function")
    ? (value as object)
    : undefined;
}

function normalizedHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}
