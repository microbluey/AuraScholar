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
import type { ScholarIdentity } from "../../electron/shared";

function hasIdentity(s?: ScholarIdentity): s is ScholarIdentity {
  return !!s && (!!s.doi || !!s.arxivId || !!s.title);
}

export interface CapturedDownload {
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
      const { analyzePdf, analyzePdfWithIdentity } = await import("./library");
      const draft = hasIdentity(scholar)
        ? await analyzePdfWithIdentity(display, bytes, scholar, relPath)
        : await analyzePdf(display, bytes);
      return { kind: "pdf", title: display, fileName: display, draft };
    }
    if (REFERENCE_EXTS.includes(ext)) {
      const text = new TextDecoder().decode(bytes);
      const { importReferences, previewReferences } = await import("./import-refs");
      // .txt / .json may not actually be references — bail quietly if nothing parses.
      if (previewReferences(text).length === 0) {
        void auraFs.deleteFile(relPath).catch(() => {});
        return { kind: "ignored", fileName: display };
      }
      const summary = await importReferences(text);
      void auraFs.deleteFile(relPath).catch(() => {});
      return {
        kind: "references",
        fileName: display,
        imported: summary.imported,
        deduped: summary.deduped > 0,
      };
    }
    void auraFs.deleteFile(relPath).catch(() => {});
    return { kind: "ignored", fileName: display };
  } catch (e) {
    void auraFs.deleteFile(relPath).catch(() => {});
    return { kind: "error", fileName: display, error: describeSafeError(e) };
  }
}

/**
 * Subscribe to research-browser downloads. Returns an unsubscribe function.
 * `onResult` fires once per captured file that produced (or attempted) an import.
 */
export function subscribeResearchDownloads(
  onResult: (result: CapturedDownload) => void,
  onStarted?: (fileName: string) => void,
): () => void {
  if (!("aura" in window)) return () => {};

  const offStarted = onStarted
    ? window.aura.research.onDownloadStarted((p) => onStarted(p.fileName))
    : () => {};
  const offFinished = window.aura.research.onDownloadFinished(async (payload) => {
    if (!payload.success) {
      onResult({
        kind: "error",
        fileName: payload.fileName.replace(/^\d+-/, ""),
        error: "下载未完成",
      });
      return;
    }
    const result = await ingestDownloadedFile(payload.relPath, payload.fileName, payload.scholar);
    // Reference files are imported directly here. PDFs are only staged (draft) —
    // the page commits them after confirmation and dispatches the update itself.
    if (result.kind === "references") {
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    }
    onResult(result);
  });

  return () => {
    offStarted();
    offFinished();
  };
}
