import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildSnippetSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
    {
      name: "snippets-note-shortcut-ime-guard",
      pass:
        renderer.snippetSaveCompositionIgnored &&
        renderer.snippetEscapeCompositionIgnored &&
        renderer.snippetShortcutSaveVisible,
      detail: `saveIme=${renderer.snippetSaveCompositionIgnored}; escapeIme=${renderer.snippetEscapeCompositionIgnored}; prevented=${renderer.snippetShortcutEventPrevented}; closed=${renderer.snippetEditorClosedAfterShortcut}; saved=${renderer.snippetSavedNote === "Smoke snippet note saved by keyboard shortcut"}; save=${renderer.snippetShortcutSaveVisible}`,
    },
    {
      name: "snippets-dirty-copy-guard",
      pass: renderer.snippetDirtyCopyBlocked,
      detail: `message=${renderer.snippetDirtyCopyMessageVisible}; clipboard=${renderer.snippetDirtyCopyClipboardPreserved}`,
    },
    {
      name: "snippets-save-failure-preserves-draft",
      pass:
        renderer.snippetSaveFailureVisible &&
        renderer.snippetSaveFailurePreserved &&
        renderer.snippetSaveFailureDidNotPersist,
      detail: `visible=${renderer.snippetSaveFailureVisible}; preserved=${renderer.snippetSaveFailurePreserved}; notPersisted=${renderer.snippetSaveFailureDidNotPersist}`,
    },
    {
      name: "snippets-refresh-race-preserved",
      pass: renderer.snippetRefreshRacePreserved,
    },
    {
      name: "snippets-load-retry-recovery",
      pass: renderer.snippetLoadRetryRecoveryVisible && renderer.snippetLoadRetryAttempts === 2,
      detail: renderer.snippetLoadRetryRecoveryDetail,
    },
    {
      name: "snippets-filter-empty-recovery",
      pass: renderer.snippetFilterEmptyActionRestoresResults,
    },
    {
      name: "snippets-visible-copy-feedback",
      pass:
        renderer.snippetVisibleCopyBusyVisible &&
        renderer.snippetVisibleCopyAriaBusyVisible &&
        renderer.snippetVisibleCopySuccessVisible,
      detail: `busy=${renderer.snippetVisibleCopyBusyVisible}; aria=${renderer.snippetVisibleCopyAriaBusyVisible}; success=${renderer.snippetVisibleCopySuccessVisible}`,
    },
    {
      name: "snippets-card-action-feedback",
      pass:
        renderer.snippetCardCopyBusyVisible &&
        renderer.snippetCardCopyAriaBusyVisible &&
        renderer.snippetCardCopyCitationBusyVisible &&
        renderer.snippetCardCopyCitationAriaBusyVisible &&
        renderer.snippetDeleteBusyVisible &&
        renderer.snippetDeleteAriaBusyVisible &&
        renderer.snippetDeleteSuccessVisible,
      detail: `copy=${renderer.snippetCardCopyBusyVisible}; copyAria=${renderer.snippetCardCopyAriaBusyVisible}; citation=${renderer.snippetCardCopyCitationBusyVisible}; citationAria=${renderer.snippetCardCopyCitationAriaBusyVisible}; deleteBusy=${renderer.snippetDeleteBusyVisible}; deleteAria=${renderer.snippetDeleteAriaBusyVisible}; deleteSuccess=${renderer.snippetDeleteSuccessVisible}`,
    },
    {
      name: "snippets-delete-failure-recovers",
      pass:
        renderer.snippetDeleteFailureVisible &&
        renderer.snippetDeleteFailureBusyVisible &&
        renderer.snippetDeleteFailurePreserved &&
        renderer.snippetDeleteFailureDidNotPersist,
      detail: `visible=${renderer.snippetDeleteFailureVisible}; busy=${renderer.snippetDeleteFailureBusyVisible}; preserved=${renderer.snippetDeleteFailurePreserved}; notPersisted=${renderer.snippetDeleteFailureDidNotPersist}`,
    },
    {
      name: "snippets-delete-undo-failure-recovers",
      pass:
        renderer.snippetDeleteUndoFailureVisible &&
        renderer.snippetDeleteUndoFailureBusyVisible &&
        renderer.snippetDeleteUndoFailurePreserved &&
        renderer.snippetDeleteUndoFailureDidNotPersist,
      detail: `visible=${renderer.snippetDeleteUndoFailureVisible}; busy=${renderer.snippetDeleteUndoFailureBusyVisible}; preserved=${renderer.snippetDeleteUndoFailurePreserved}; notPersisted=${renderer.snippetDeleteUndoFailureDidNotPersist}`,
    },
    {
      name: "snippets-delete-undo-recovery",
      pass:
        renderer.snippetDeleteUndoVisible &&
        renderer.snippetDeleteUndoBusyVisible &&
        renderer.snippetDeleteUndoRecovered,
      detail: `visible=${renderer.snippetDeleteUndoVisible}; busy=${renderer.snippetDeleteUndoBusyVisible}; recovered=${renderer.snippetDeleteUndoRecovered}`,
    },
    {
      name: "snippets-empty-latest-reader-cta",
      pass: renderer.snippetEmptyLatestReaderVisible && renderer.snippetEmptyLatestReaderOpened,
      detail: `visible=${renderer.snippetEmptyLatestReaderVisible}; opened=${renderer.snippetEmptyLatestReaderOpened}; hash=${renderer.snippetEmptyLatestReaderHash}`,
    },
  ];
}
