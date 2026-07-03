import { AttachmentsRepo } from "@aurascholar/db/repos/attachments";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { getDb } from "./tauri-db";
import { blobPath, tauriFs } from "./tauri-platform";
import type { CommitIngestArgs, IngestResult, PendingPdf } from "./library-types";

async function repos() {
  const db = await getDb();
  return {
    works: new WorksRepo(db),
    attachments: new AttachmentsRepo(db),
  };
}

/**
 * Commit a user-confirmed import: the ONLY place that writes works/attachments.
 * `workInput` is the user's final pick/edit; `pdf` is the staged blob (already
 * on disk) to attach.
 */
export async function commitIngest(args: CommitIngestArgs): Promise<IngestResult> {
  const { works, attachments } = await repos();
  const { id, deduped } = await works.upsert(args.workInput);
  let pdfFetched = false;
  if (args.pdf) {
    await attachments.create({
      workId: id,
      sha256: args.pdf.sha,
      byteSize: args.pdf.byteSize,
      originalFilename: args.pdf.fileName,
      fetchedVia: args.pdf.fetchedVia,
      pageCount: args.pdf.pageCount,
    });
    pdfFetched = true;
  }
  return { workId: id, deduped, title: args.workInput.title, pdfFetched };
}

/** Restore a soft-deleted dedup hit and surface it (no new rows written). */
export async function restoreDedup(workId: string): Promise<void> {
  const { works } = await repos();
  await works.restore(workId);
}

/** Attach an already-staged PDF (blob on disk) to a work; used for dedup hits. */
export async function attachStagedPdf(
  workId: string,
  pdf: PendingPdf,
): Promise<{ id: string; deduped: boolean }> {
  const { attachments } = await repos();
  return attachments.create({
    workId,
    sha256: pdf.sha,
    byteSize: pdf.byteSize,
    originalFilename: pdf.fileName,
    fetchedVia: pdf.fetchedVia,
    pageCount: pdf.pageCount,
  });
}

/**
 * Discard a PDF staged during analysis when the user cancels before commit.
 * The content-addressed blob is only removed if no active attachment references
 * its sha, so cancelling a duplicate/stale dialog cannot break an existing PDF.
 */
export async function discardStagedPdf(pdf: PendingPdf | null | undefined): Promise<void> {
  if (!pdf) return;
  if (pdf.relPath) {
    await tauriFs.deleteFile(pdf.relPath).catch(() => {});
  }
  const { attachments } = await repos();
  const existing = await attachments.bySha(pdf.sha);
  if (!existing) {
    await tauriFs.deleteFile(blobPath(pdf.sha)).catch(() => {});
  }
}
