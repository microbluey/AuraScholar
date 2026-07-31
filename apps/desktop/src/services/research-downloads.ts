// Bridges the Electron research-browser download interceptor to the library
// ingest pipeline. When the user downloads a file from inside a research tab,
// main saves it under AppData/research-downloads and sends
// "research://download-finished" with the relative path. We read the bytes and
// route them: a PDF is *analyzed* into an IngestDraft (candidates + staged PDF,
// nothing written) and surfaced to a confirmation card — the user picks/edits
// before anything reaches the library; citation files (.bib etc.) are
// authoritative and imported directly. No per-site scraping required.
import { auraFs } from "./aura-platform";
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

const REFERENCE_EXTS = [".bib", ".ris", ".nbib", ".enw", ".json", ".txt"];

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

async function ingestDownloadedFile(
  tabId: string,
  ownerTabId: string,
  relPath: string,
  fileName: string,
  scholar?: ScholarIdentity,
): Promise<CapturedDownload> {
  // Strip the timestamp prefix main adds ("<ms>-<original>") for display/extension.
  const display = fileName.replace(/^\d+-/, "");
  const ext = extOf(display);
  try {
    const bytes = await auraFs.readFile(relPath);
    if (ext === ".pdf") {
      // Analyze only — never auto-write. The page identity (citation_* meta) is
      // preferred over guessing a DOI from the PDF body. The temp file is kept
      // until the user confirms or cancels (handled by the caller).
      const { analyzePdfWithIdentity, analyzeResearchDownloadPdf } = await import("./library");
      const draft = hasIdentity(scholar)
        ? await analyzePdfWithIdentity(display, bytes, scholar, relPath)
        : await analyzeResearchDownloadPdf(display, bytes, relPath);
      return { tabId, ownerTabId, kind: "pdf", title: display, fileName: display, draft };
    }
    if (REFERENCE_EXTS.includes(ext)) {
      const text = new TextDecoder().decode(bytes);
      const { importReferences, previewReferences } = await import("./import-refs");
      // .txt / .json may not actually be references — bail quietly if nothing parses.
      if (previewReferences(text).length === 0) {
        void auraFs.deleteFile(relPath).catch(() => {});
        return { tabId, ownerTabId, kind: "ignored", fileName: display };
      }
      const summary = await importReferences(text);
      void auraFs.deleteFile(relPath).catch(() => {});
      return {
        tabId,
        ownerTabId,
        kind: "references",
        fileName: display,
        imported: summary.imported,
        deduped: summary.deduped > 0,
      };
    }
    void auraFs.deleteFile(relPath).catch(() => {});
    return { tabId, ownerTabId, kind: "ignored", fileName: display };
  } catch (e) {
    void auraFs.deleteFile(relPath).catch(() => {});
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

async function inspectFinishedDownload(
  payload: DownloadFinishedPayload,
): Promise<CapturedDownload> {
  if (!payload.success) {
    void auraFs.deleteFile(payload.relPath).catch(() => {});
    return {
      tabId: payload.tabId,
      ownerTabId: payload.ownerTabId,
      kind: "error",
      fileName: payload.fileName.replace(/^\d+-/, ""),
      error: "下载未完成",
    };
  }
  return ingestDownloadedFile(
    payload.tabId,
    payload.ownerTabId,
    payload.relPath,
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
    void inspectFinishedDownload(payload).then((result) => {
      if (generation !== brokerGeneration) {
        if (result.draft?.pdf) {
          void import("./library-actions").then(({ discardStagedPdf }) =>
            discardStagedPdf(result.draft?.pdf),
          ).catch(() => {});
        }
        return;
      }
      if (result.kind === "references") {
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      }
      publishResult(result);
    });
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
      void import("./library-actions").then(({ discardStagedPdf }) =>
        discardStagedPdf(result.draft?.pdf),
      ).catch(() => {});
    }
  }
}
