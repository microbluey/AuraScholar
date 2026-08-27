// Bridges the Electron research-browser download interceptor to the library
// ingest pipeline. When the user downloads a file from inside a research tab,
// main stores it behind an opaque one-time lease and sends
// "research://download-finished" with that lease id. We consume the bytes and
// route them: a PDF is *analyzed* into an IngestDraft (candidates + staged PDF,
// nothing written) and surfaced to a confirmation card — the user picks/edits
// before anything reaches the library; citation files (.bib etc.) are
// authoritative and imported directly. No per-site scraping required.
import { describeSafeError } from "./sensitive-text";
import type { IngestDraft } from "./library-types";
import type {
  DownloadFinishedPayload,
  DownloadStartedPayload,
  ScholarIdentity,
} from "../../electron/shared";

function hasIdentity(s?: ScholarIdentity): s is ScholarIdentity {
  return !!s && (!!s.doi || !!s.arxivId || !!s.title);
}

export interface CapturedDownload {
  /** Research tab whose session initiated the captured file. */
  tabId: string;
  /** Root tab that owns the source tab chain. */
  ownerTabId: string;
  kind: "pdf" | "references" | "ignored" | "error";
  title?: string;
  fileName: string;
  /** PDF: analysis result awaiting user confirmation (or a dedup hit). */
  draft?: IngestDraft;
  /** For references: count newly imported. */
  imported?: number;
  deduped?: boolean;
  error?: string;
}

async function ingestDownloadedFile(
  tabId: string,
  ownerTabId: string,
  downloadId: string,
  fileName: string,
  scholar?: ScholarIdentity,
): Promise<CapturedDownload> {
  // Strip the timestamp prefix main adds ("<ms>-<original>") for display/extension.
  const display = fileName.replace(/^\d+-/, "");
  try {
    // Main owns the download file and exposes only a short-lived, one-time
    // opaque lease. Consuming it atomically reads the bytes and retires the
    // temporary file; no renderer path or delete capability is retained.
    const content = await window.aura.research.consumeDownload({ downloadId });
    if (content.kind === "ignored") {
      return { tabId, ownerTabId, kind: "ignored", fileName: display };
    }
    if (content.kind === "pdf") {
      // Analyze only — never auto-write. The page identity (citation_* meta) is
      // preferred over guessing a DOI from the PDF body. The download lease has
      // already been consumed; the canonical staged receipt is kept until the
      // user confirms or cancels (handled by the caller).
      const { analyzePdfWithIdentity, analyzeResearchDownloadPdf } = await import("./library");
      const draft = hasIdentity(scholar)
        ? await analyzePdfWithIdentity(display, content.bytes, scholar)
        : await analyzeResearchDownloadPdf(display, content.bytes);
      return { tabId, ownerTabId, kind: "pdf", title: display, fileName: display, draft };
    }
    const text = new TextDecoder().decode(content.bytes);
    const { importReferences, previewReferences } = await import("./import-refs");
    // .txt / .json may not actually be references — bail quietly if nothing parses.
    if (previewReferences(text).length === 0) {
      return { tabId, ownerTabId, kind: "ignored", fileName: display };
    }
    const summary = await importReferences(text);
    return {
      tabId,
      ownerTabId,
      kind: "references",
      fileName: display,
      imported: summary.imported,
      deduped: summary.deduped > 0,
    };
  } catch (e) {
    return {
      tabId,
      ownerTabId,
      kind: "error",
      fileName: display,
      error: describeSafeError(e),
    };
  }
}

interface DownloadSubscriber {
  onResult(result: CapturedDownload): void;
  onStarted?(payload: DownloadStartedPayload): void;
}

const subscribers = new Set<DownloadSubscriber>();
const bufferedResults: CapturedDownload[] = [];
let brokerResearch: Window["aura"]["research"] | null = null;
let brokerOffStarted: (() => void) | null = null;
let brokerOffFinished: (() => void) | null = null;
let brokerGeneration = 0;
let inspectionTail: Promise<void> = Promise.resolve();

async function inspectFinishedDownload(
  payload: DownloadFinishedPayload,
): Promise<CapturedDownload> {
  if (!payload.success) {
    return {
      tabId: payload.tabId,
      ownerTabId: payload.ownerTabId,
      kind: "error",
      fileName: payload.fileName.replace(/^\d+-/, ""),
      error: "下载未完成",
    };
  }
  if (!payload.downloadId) {
    return {
      tabId: payload.tabId,
      ownerTabId: payload.ownerTabId,
      kind: "error",
      fileName: payload.fileName.replace(/^\d+-/, ""),
      error: "下载凭证无效",
    };
  }
  return ingestDownloadedFile(
    payload.tabId,
    payload.ownerTabId,
    payload.downloadId,
    payload.fileName,
    payload.scholar,
  );
}

function publishResult(result: CapturedDownload): void {
  const subscriber = subscribers.values().next().value as DownloadSubscriber | undefined;
  if (!subscriber) {
    bufferedResults.push(result);
    return;
  }
  try {
    subscriber.onResult(result);
  } catch {
    bufferedResults.push(result);
  }
}

function publishInspectedDownload(result: CapturedDownload, generation: number): void {
  if (generation !== brokerGeneration) {
    if (result.draft?.pdf) {
      void import("./library-actions")
        .then(({ discardStagedPdf }) => discardStagedPdf(result.draft?.pdf))
        .catch(() => {});
    }
    return;
  }
  if (result.kind === "references") {
    window.dispatchEvent(new Event("aurascholar:library-updated"));
  }
  publishResult(result);
}

function queueFinishedDownload(payload: DownloadFinishedPayload, generation: number): void {
  // Keep the complete pipeline exclusive, not just the IPC call: PDF analysis
  // and reference parsing retain the consumed bytes after main has returned.
  // A task that has not started must not survive a broker replacement: it may
  // otherwise import old reference bytes into a different active Library.
  const inspection = inspectionTail.then(() =>
    generation === brokerGeneration ? inspectFinishedDownload(payload) : null,
  );
  inspectionTail = inspection.then(
    () => undefined,
    () => undefined,
  );
  void inspection.then(
    (result) => {
      if (result) publishInspectedDownload(result, generation);
    },
    () => {},
  );
}

function ensureDownloadBroker(): boolean {
  if (!("aura" in window)) return false;
  const research = window.aura.research;
  if (brokerResearch === research) return true;
  disposeResearchDownloadBroker();
  brokerResearch = research;
  const generation = ++brokerGeneration;
  brokerOffStarted = research.onDownloadStarted((payload) => {
    for (const subscriber of subscribers) subscriber.onStarted?.(payload);
  });
  brokerOffFinished = research.onDownloadFinished((payload) => {
    queueFinishedDownload(payload, generation);
  });
  return true;
}

/**
 * Subscribe to the app-lifetime download broker. Results that finish while
 * Discovery is unmounted are buffered and replayed to the next subscriber.
 */
export function subscribeResearchDownloads(
  onResult: (result: CapturedDownload) => void,
  onStarted?: (payload: DownloadStartedPayload) => void,
): () => void {
  if (!ensureDownloadBroker()) return () => {};
  const subscriber: DownloadSubscriber = { onResult, onStarted };
  subscribers.add(subscriber);
  const buffered = bufferedResults.splice(0);
  for (const result of buffered) publishResult(result);
  return () => {
    subscribers.delete(subscriber);
  };
}

/** Primarily useful for renderer teardown and deterministic tests. */
export function disposeResearchDownloadBroker(): void {
  brokerGeneration += 1;
  brokerOffStarted?.();
  brokerOffFinished?.();
  brokerOffStarted = null;
  brokerOffFinished = null;
  brokerResearch = null;
  subscribers.clear();
  const abandoned = bufferedResults.splice(0);
  for (const result of abandoned) {
    if (result.draft?.pdf) {
      void import("./library-actions")
        .then(({ discardStagedPdf }) => discardStagedPdf(result.draft?.pdf))
        .catch(() => {});
    }
  }
}
