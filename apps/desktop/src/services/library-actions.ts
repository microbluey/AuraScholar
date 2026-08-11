import type { WorkInput } from "@aurascholar/db/repos/works";
import type { DataCommandMap } from "../../electron/data-command-contract";
import { auraFs } from "./aura-platform";
import type { PendingPdf } from "./library-types";

type FinalizeIngestCommand = DataCommandMap["library.finalizeIngest"];
type FindIngestDedupCommand = DataCommandMap["library.findIngestDedup"];
type ReleaseStagedPdfCommand = DataCommandMap["library.releaseStagedPdf"];
type StagePdfCommand = DataCommandMap["library.stagePdf"];

export type FinalizeIngestDecision =
  | { mode: "attach"; pdf: PendingPdf | null; workId: string }
  | { mode: "create"; pdf: PendingPdf | null; workInput: WorkInput };

export type FinalizeIngestResult = FinalizeIngestCommand["output"];
export type FindIngestDedupResult = FindIngestDedupCommand["output"];
export type StagedPdfReceipt = StagePdfCommand["output"];

export interface FinalizeDedupIngestResult {
  attachmentError: unknown | null;
  result: FinalizeIngestResult;
}

/**
 * Commit one reviewed ingest decision through the main-process transaction.
 * `PendingPdf.relPath` is intentionally kept out of the command input: it is
 * a renderer-only research-download cleanup capability.
 */
export function finalizeIngest(decision: FinalizeIngestDecision): Promise<FinalizeIngestResult> {
  const pdf = toStagedPdfInput(decision.pdf);
  if (decision.mode === "create") {
    return window.aura.data.command("library.finalizeIngest", {
      mode: "create",
      pdf,
      workInput: decision.workInput,
    });
  }
  return window.aura.data.command("library.finalizeIngest", {
    mode: "attach",
    pdf,
    workId: decision.workId,
  });
}

/**
 * Query only the active local Library for an exact PDF or DOI ingest hit.
 * The renderer never receives a database handle or a caller-selected Library
 * scope; this is intentionally smaller than a general work/attachment API.
 */
export function findIngestDedup(
  input: FindIngestDedupCommand["input"],
): Promise<FindIngestDedupResult> {
  return window.aura.data.command("library.findIngestDedup", input);
}

/**
 * Preserve the dedup surface when linking a fresh staged PDF fails, but never
 * claim success for a removed or foreign target. Main must independently
 * revalidate the same active work with a no-PDF, idempotent attach command.
 */
export async function finalizeDedupIngest(
  workId: string,
  pdf: PendingPdf | null,
): Promise<FinalizeDedupIngestResult> {
  try {
    return {
      attachmentError: null,
      result: await finalizeIngest({ mode: "attach", pdf, workId }),
    };
  } catch (attachmentError) {
    if (!pdf) throw attachmentError;
    try {
      const result = await finalizeIngest({ mode: "attach", pdf: null, workId });
      await discardStagedPdf(pdf);
      return { attachmentError, result };
    } catch {
      throw attachmentError;
    }
  }
}

function toStagedPdfInput(pdf: PendingPdf | null): FinalizeIngestCommand["input"]["pdf"] {
  if (!pdf) return null;
  return {
    fetchedVia: pdf.fetchedVia,
    fileName: pdf.fileName,
    pageCount: pdf.pageCount,
    stageId: pdf.stageId,
    ...(pdf.sourceUrl === undefined ? {} : { sourceUrl: pdf.sourceUrl }),
  };
}

/** Main owns canonical blob writes and returns an opaque one-time receipt. */
export function stagePdf(bytes: Uint8Array): Promise<StagedPdfReceipt> {
  return window.aura.data.command("library.stagePdf", { bytes });
}

/**
 * Discard a PDF staged during analysis when the user cancels before commit.
 * Main releases only its short-lived receipt, never global content-addressed
 * bytes; the renderer separately clears a research-download temp file.
 */
export async function discardStagedPdf(pdf: PendingPdf | null | undefined): Promise<void> {
  if (!pdf) return;
  const releases: Promise<unknown>[] = [releaseStagedPdf(pdf.stageId).catch(() => {})];
  if (pdf.relPath) releases.push(auraFs.deleteFile(pdf.relPath).catch(() => {}));
  await Promise.all(releases);
}

function releaseStagedPdf(stageId: string): Promise<ReleaseStagedPdfCommand["output"]> {
  return window.aura.data.command("library.releaseStagedPdf", { stageId });
}
