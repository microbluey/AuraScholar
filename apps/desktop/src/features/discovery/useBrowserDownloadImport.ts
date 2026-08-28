import { useCallback, type MutableRefObject } from "react";
import type { IngestDraft } from "../../services/library-types";
import { describeSafeError } from "../../services/sensitive-text";

interface BrowserDownloadImportOptions {
  enqueueDraft(draft: IngestDraft): boolean;
  finish(draft: IngestDraft, completedWorkId?: string): void;
  suspendBrowserViews(): Promise<boolean>;
  modeRef: MutableRefObject<"home" | "opensource" | "browser">;
  onMessage(message: string): void;
  resumeIfQueueEmpty(): void;
}

function discardDraft(draft: IngestDraft): void {
  void import("../../services/library-actions")
    .then(({ discardStagedPdf }) => discardStagedPdf(draft.pdf))
    .catch(() => {});
}

/** Owns the async boundary between native browser downloads and import confirmation. */
export function useBrowserDownloadImport({
  enqueueDraft,
  finish,
  suspendBrowserViews,
  modeRef,
  onMessage,
  resumeIfQueueEmpty,
}: BrowserDownloadImportOptions) {
  const queueConfirmation = useCallback(
    (draft: IngestDraft) => {
      if (modeRef.current !== "browser") {
        discardDraft(draft);
        return;
      }
      void suspendBrowserViews().then((suspended) => {
        if (suspended && enqueueDraft(draft)) return;
        discardDraft(draft);
        resumeIfQueueEmpty();
      });
    },
    [enqueueDraft, modeRef, resumeIfQueueEmpty, suspendBrowserViews],
  );

  const handleDedup = useCallback(
    async (draft: IngestDraft) => {
      if (!draft.dedup) return;
      const { finalizeIngest } = await import("../../services/library-actions");
      try {
        const result = await finalizeIngest({
          mode: "attach",
          pdf: draft.pdf,
          workId: draft.dedup.workId,
        });
        let pdfMessage = "已定位已有文献";
        if (result.attachment) {
          pdfMessage = result.attachment.deduped ? "PDF 已经挂过" : "PDF 已挂到该文献";
        }
        onMessage(`已在库中:${draft.dedup.title}，${pdfMessage}`);
        window.dispatchEvent(new Event("aurascholar:library-updated"));
        finish(draft, draft.dedup.workId);
      } catch (error) {
        onMessage(`PDF 挂载失败:${describeSafeError(error)}，可在确认卡中重试`);
        queueConfirmation(draft);
      }
    },
    [finish, onMessage, queueConfirmation],
  );

  return { handleDedup, queueConfirmation };
}
