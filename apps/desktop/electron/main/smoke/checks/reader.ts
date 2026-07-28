import type { SmokeCheck, SmokeRendererResult } from "../contracts";
import { summarize } from "./summarize";

export function buildReaderSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
    {
      name: "reader-pdf-route",
      pass:
        renderer.readerHash.includes("/reader") &&
        renderer.readerTitleVisible &&
        renderer.readerPageBadgeVisible &&
        renderer.readerCanvasVisible &&
        !renderer.readerErrorVisible,
      detail: `${renderer.readerHash}; title=${renderer.readerTitleVisible}; page=${renderer.readerPageBadgeVisible}; canvas=${renderer.readerCanvasVisible}; error=${renderer.readerErrorVisible}`,
    },
    {
      name: "reader-open-promotes-unread-status",
      pass: renderer.readerAutoReadingStatusPersisted,
      detail: `persisted=${renderer.readerAutoReadingStatusPersisted}`,
    },
    {
      name: "reader-tab-deeplink-sync",
      pass: renderer.readerTabDeepLinkSyncVisible,
    },
    {
      name: "reader-annotation-create-failure-preserves-selection",
      pass:
        renderer.readerAnnotationCreateFailureVisible &&
        renderer.readerAnnotationCreateFailureBusyVisible &&
        renderer.readerAnnotationCreateFailurePreserved &&
        renderer.readerAnnotationCreateFailureDidNotPersist,
      detail: `visible=${renderer.readerAnnotationCreateFailureVisible}; busy=${renderer.readerAnnotationCreateFailureBusyVisible}; preserved=${renderer.readerAnnotationCreateFailurePreserved}; notPersisted=${renderer.readerAnnotationCreateFailureDidNotPersist}`,
    },
    {
      name: "reader-snippet-save-failure-preserves-selection",
      pass:
        renderer.readerSnippetSaveFailureVisible &&
        renderer.readerSnippetSaveFailureBusyVisible &&
        renderer.readerSnippetSaveFailurePreserved &&
        renderer.readerSnippetSaveFailureDidNotPersist,
      detail: `visible=${renderer.readerSnippetSaveFailureVisible}; busy=${renderer.readerSnippetSaveFailureBusyVisible}; preserved=${renderer.readerSnippetSaveFailurePreserved}; notPersisted=${renderer.readerSnippetSaveFailureDidNotPersist}`,
    },
    {
      name: "reader-snippet-save-feedback",
      pass: renderer.readerSnippetSaveBusyVisible && renderer.readerSnippetSavePersisted,
      detail: `busy=${renderer.readerSnippetSaveBusyVisible}; persisted=${renderer.readerSnippetSavePersisted}`,
    },
    {
      name: "reader-dirty-comment-export-guard",
      pass: renderer.readerCommentDirtyExportBlocked,
      detail: `message=${renderer.readerCommentDirtyExportMessageVisible}; download=${renderer.readerCommentDirtyExportDownloadPrevented}`,
    },
    {
      name: "reader-annotation-delete-confirm",
      pass:
        renderer.readerAnnotationDeleteConfirmVisible &&
        renderer.readerAnnotationDeleteCancelPreserved,
      detail: `visible=${renderer.readerAnnotationDeleteConfirmVisible}; preserved=${renderer.readerAnnotationDeleteCancelPreserved}`,
    },
    {
      name: "reader-comment-save-busy-feedback",
      pass: renderer.readerCommentSaveBusyVisible && renderer.readerCommentSavePersisted,
      detail: `busy=${renderer.readerCommentSaveBusyVisible}; persisted=${renderer.readerCommentSavePersisted}`,
    },
    {
      name: "reader-comment-save-failure-preserves-draft",
      pass:
        renderer.readerCommentSaveFailureVisible &&
        renderer.readerCommentSaveFailurePreserved &&
        renderer.readerCommentSaveFailureDidNotPersist,
      detail: `visible=${renderer.readerCommentSaveFailureVisible}; preserved=${renderer.readerCommentSaveFailurePreserved}; notPersisted=${renderer.readerCommentSaveFailureDidNotPersist}`,
    },
    {
      name: "reader-annotation-delete-busy-feedback",
      pass:
        renderer.readerAnnotationDeleteBusyVisible && renderer.readerAnnotationDeleteSuccessVisible,
      detail: `busy=${renderer.readerAnnotationDeleteBusyVisible}; success=${renderer.readerAnnotationDeleteSuccessVisible}`,
    },
    {
      name: "reader-annotation-delete-failure-recovers",
      pass:
        renderer.readerAnnotationDeleteFailureVisible &&
        renderer.readerAnnotationDeleteFailureBusyVisible &&
        renderer.readerAnnotationDeleteFailurePreserved &&
        renderer.readerAnnotationDeleteFailureDidNotPersist,
      detail: `visible=${renderer.readerAnnotationDeleteFailureVisible}; busy=${renderer.readerAnnotationDeleteFailureBusyVisible}; preserved=${renderer.readerAnnotationDeleteFailurePreserved}; notPersisted=${renderer.readerAnnotationDeleteFailureDidNotPersist}`,
    },
    {
      name: "reader-annotation-delete-undo-failure-recovers",
      pass:
        renderer.readerAnnotationDeleteUndoFailureVisible &&
        renderer.readerAnnotationDeleteUndoFailureBusyVisible &&
        renderer.readerAnnotationDeleteUndoFailurePreserved &&
        renderer.readerAnnotationDeleteUndoFailureDidNotPersist,
      detail: `visible=${renderer.readerAnnotationDeleteUndoFailureVisible}; busy=${renderer.readerAnnotationDeleteUndoFailureBusyVisible}; preserved=${renderer.readerAnnotationDeleteUndoFailurePreserved}; notPersisted=${renderer.readerAnnotationDeleteUndoFailureDidNotPersist}`,
    },
    {
      name: "reader-annotation-delete-undo-recovery",
      pass:
        renderer.readerAnnotationDeleteUndoBusyVisible &&
        renderer.readerAnnotationDeleteUndoRecovered,
      detail: `busy=${renderer.readerAnnotationDeleteUndoBusyVisible}; restored=${renderer.readerAnnotationDeleteUndoRecovered}`,
    },
    {
      name: "reader-comment-draft-discard-confirm",
      pass:
        renderer.readerCommentDraftConfirmVisible &&
        renderer.readerCommentDraftCancelPreserved &&
        renderer.readerCommentDraftDiscarded,
      detail: `visible=${renderer.readerCommentDraftConfirmVisible}; preserved=${renderer.readerCommentDraftCancelPreserved}; discarded=${renderer.readerCommentDraftDiscarded}`,
    },
    {
      name: "reader-comment-shortcut-ime-guard",
      pass: renderer.readerCommentShortcutCompositionIgnored,
    },
    {
      name: "reader-translation-reading-modes",
      pass:
        renderer.readerTranslationSelectionPopoverVisible &&
        renderer.readerTranslationSplitDocumentsVisible &&
        renderer.readerTranslationInlineDocumentVisible,
      detail: `selection=${renderer.readerTranslationSelectionPopoverVisible}; split=${renderer.readerTranslationSplitDocumentsVisible}; inline=${renderer.readerTranslationInlineDocumentVisible}`,
    },
    {
      name: "reader-translation-start-feedback",
      pass:
        renderer.readerTranslationStartBusyVisible && renderer.readerTranslationStartErrorVisible,
      detail: `busy=${renderer.readerTranslationStartBusyVisible}; error=${renderer.readerTranslationStartErrorVisible}`,
    },
    {
      name: "reader-translation-settings-cta",
      pass:
        renderer.readerTranslationSettingsCtaVisible &&
        renderer.readerTranslationSettingsCtaNavigates &&
        renderer.readerTranslationSettingsCtaTargetsSection,
      detail: `visible=${renderer.readerTranslationSettingsCtaVisible}; navigated=${renderer.readerTranslationSettingsCtaNavigates}; targeted=${renderer.readerTranslationSettingsCtaTargetsSection}`,
    },
    {
      name: "reader-translation-copy-feedback",
      pass:
        renderer.readerTranslationCopyBusyVisible &&
        renderer.readerTranslationCopyFeedbackVisible &&
        renderer.readerTranslationClipboardMatches,
      detail: `busy=${renderer.readerTranslationCopyBusyVisible}; ${renderer.readerTranslationCopyStatusText}; clipboard=${renderer.readerTranslationClipboardMatches}`,
    },
    {
      name: "reader-annotation-canvas-deep-link",
      pass:
        renderer.canvasReaderAnnotationDeepLinkNavigated &&
        renderer.canvasReaderAnnotationVisible &&
        renderer.canvasReaderAnnotationPersisted,
      detail: `navigated=${renderer.canvasReaderAnnotationDeepLinkNavigated}; visible=${renderer.canvasReaderAnnotationVisible}; persisted=${renderer.canvasReaderAnnotationPersisted}; hash=${renderer.canvasReaderAnnotationDeepLinkHash}`,
    },
    {
      name: "reader-no-work-clears-document",
      pass: renderer.readerNoWorkClearsDocument,
    },
    {
      name: "reader-load-retry-recovery",
      pass: renderer.readerLoadRetryRecoveryVisible && renderer.readerLoadRetryAttempts === 2,
      detail: renderer.readerLoadRetryRecoveryDetail,
    },
    {
      name: "reader-archived-work-blocked",
      pass:
        renderer.readerArchivedHash.includes("/reader") &&
        renderer.readerArchivedAttachmentRows >= 1 &&
        renderer.readerArchivedAnnotationRows >= 1 &&
        renderer.readerArchivedStateVisible &&
        renderer.readerArchivedRecoveryCtaVisible &&
        renderer.readerArchivedForbiddenActionsHidden &&
        renderer.readerArchivedCanvasBlocked,
      detail: `${renderer.readerArchivedHash}; state=${renderer.readerArchivedStateVisible}; cta=${renderer.readerArchivedRecoveryCtaVisible}; forbiddenHidden=${renderer.readerArchivedForbiddenActionsHidden}; canvasBlocked=${renderer.readerArchivedCanvasBlocked}; attachments=${renderer.readerArchivedAttachmentRows}; annotations=${renderer.readerArchivedAnnotationRows}`,
    },
    {
      name: "reader-archived-work-back-to-trash",
      pass:
        renderer.readerArchivedBackToTrashHash.includes("/library") &&
        renderer.readerArchivedBackToTrashLocated &&
        renderer.readerArchivedBackToTrashRowVisible &&
        renderer.readerArchivedBackToTrashFilterVisible &&
        renderer.readerArchivedBackToTrashSearchCleared,
      detail: `${renderer.readerArchivedBackToTrashHash}; located=${renderer.readerArchivedBackToTrashLocated}; row=${renderer.readerArchivedBackToTrashRowVisible}; filter=${renderer.readerArchivedBackToTrashFilterVisible}; searchCleared=${renderer.readerArchivedBackToTrashSearchCleared}`,
    },
    {
      name: "reader-missing-pdf-recovery",
      pass:
        renderer.readerMissingHash.includes("/reader") &&
        renderer.readerMissingPdfVisible &&
        renderer.readerMissingPdfRecoveryVisible,
      detail: `${renderer.readerMissingHash}; state=${renderer.readerMissingPdfVisible}; recovery=${renderer.readerMissingPdfRecoveryVisible}`,
    },
    {
      name: "reader-find-fulltext-handoff",
      pass:
        renderer.readerFindFulltextHandoffNavigated &&
        renderer.readerFindFulltextHandoffTargetVisible &&
        renderer.readerFindFulltextHandoffStatusVisible,
      detail: `${renderer.readerFindFulltextHandoffHash}; navigated=${renderer.readerFindFulltextHandoffNavigated}; target=${renderer.readerFindFulltextHandoffTargetVisible}; status=${renderer.readerFindFulltextHandoffStatusVisible}; view=${renderer.readerFindFulltextHandoffView}`,
    },
    {
      name: "reader-missing-pdf-back-to-library",
      pass:
        renderer.readerMissingBackToLibraryHash.includes("/library") &&
        renderer.readerMissingBackToLibraryLocated &&
        renderer.readerMissingBackToLibraryRowVisible &&
        renderer.readerMissingBackToLibrarySearchCleared,
      detail: `${renderer.readerMissingBackToLibraryHash}; located=${renderer.readerMissingBackToLibraryLocated}; row=${renderer.readerMissingBackToLibraryRowVisible}; searchCleared=${renderer.readerMissingBackToLibrarySearchCleared}; detail=${summarize(renderer.readerMissingBackToLibraryDetail, 80)}; page=${renderer.readerMissingBackToLibraryPageText}; rows=${summarize(renderer.readerMissingBackToLibraryVisibleRows, 180)}`,
    },
    {
      name: "reader-missing-pdf-attach",
      pass:
        renderer.readerMissingPdfAttachCtaVisible &&
        renderer.readerMissingPdfAttachBusyVisible &&
        renderer.readerRecoveredPdfVisible &&
        renderer.readerRecoveredAttachmentCount !== null &&
        renderer.readerRecoveredAttachmentCount >= 1,
      detail: `cta=${renderer.readerMissingPdfAttachCtaVisible}; busy=${renderer.readerMissingPdfAttachBusyVisible}; visible=${renderer.readerRecoveredPdfVisible}; attachments=${renderer.readerRecoveredAttachmentCount}`,
    },
    {
      name: "reader-broken-blob-repair",
      pass:
        renderer.readerBrokenHash.includes("/reader") &&
        renderer.readerBrokenBlobVisible &&
        renderer.readerBrokenBlobRecoveryVisible &&
        renderer.readerBrokenAttachmentCount !== null &&
        renderer.readerBrokenAttachmentCount >= 2,
      detail: `${renderer.readerBrokenHash}; state=${renderer.readerBrokenBlobVisible}; recovery=${renderer.readerBrokenBlobRecoveryVisible}; attachments=${renderer.readerBrokenAttachmentCount}`,
    },
    {
      name: "reader-corrupt-pdf-repair",
      pass:
        renderer.readerCorruptHash.includes("/reader") &&
        renderer.readerCorruptPdfVisible &&
        renderer.readerCorruptPdfRecoveryVisible &&
        renderer.readerCorruptAttachmentCount !== null &&
        renderer.readerCorruptAttachmentCount >= 2,
      detail: `${renderer.readerCorruptHash}; state=${renderer.readerCorruptPdfVisible}; recovery=${renderer.readerCorruptPdfRecoveryVisible}; attachments=${renderer.readerCorruptAttachmentCount}`,
    },
    {
      name: "route-error-boundary-recovery",
      pass:
        renderer.routeCrashBoundaryVisible &&
        renderer.routeCrashShellVisible &&
        renderer.routeCrashRecoveredLibraryVisible &&
        renderer.routeCrashRecoveryHash.includes("/library"),
      detail: `boundary=${renderer.routeCrashBoundaryVisible}; shell=${renderer.routeCrashShellVisible}; recovered=${renderer.routeCrashRecoveredLibraryVisible}; hash=${renderer.routeCrashRecoveryHash}`,
    },
  ];
}
