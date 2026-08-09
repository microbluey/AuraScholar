import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import { localSemanticIndexService } from "./local-semantic-index-runtime";
import {
  DesktopKnowledgeJobExecutor,
  type KnowledgeExecutorDependencies,
  type PdfDocumentLike,
} from "./knowledge-executor";

const CANONICAL_SHA256 = /^[0-9a-f]{64}$/;

const dependencies: KnowledgeExecutorDependencies = {
  inspect: withMainDatabase,
  materializeSemanticIndex: (job, signal) => localSemanticIndexService.materialize(job, signal),
  transaction: withMainDatabaseTransaction,
  readBlob: readContentAddressedPdfBlob,
  openPdf: openPdfDocument,
};

/** Electron-bound adapter; the core executor remains injectable for tests. */
export const knowledgeJobExecutor = new DesktopKnowledgeJobExecutor(dependencies);

async function readContentAddressedPdfBlob(
  sha256: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!CANONICAL_SHA256.test(sha256)) {
    throw new Error("PDF blob hash is not a canonical SHA-256 value");
  }
  throwIfAborted(signal);
  const path = join(app.getPath("userData"), "blobs", sha256.slice(0, 2), `${sha256}.pdf`);
  const bytes = await fs.readFile(path);
  throwIfAborted(signal);
  return new Uint8Array(bytes);
}

async function openPdfDocument(bytes: Uint8Array, signal: AbortSignal): Promise<PdfDocumentLike> {
  throwIfAborted(signal);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  throwIfAborted(signal);
  const task = pdfjs.getDocument({
    data: bytes,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  return task.promise as unknown as PdfDocumentLike;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Knowledge job execution was aborted");
  error.name = "AbortError";
  throw error;
}
