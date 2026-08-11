import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildLibraryCoreSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
    {
      name: "library-empty-state",
      pass: renderer.emptyStateVisible,
    },
    {
      name: "library-load-retry-recovery",
      pass:
        renderer.libraryLoadRetryRecoveryVisible &&
        (renderer.initialWorkCount === 0 ? renderer.libraryLoadRetryAttempts === 2 : true),
      detail: renderer.libraryLoadRetryRecoveryDetail,
    },
    {
      name: "library-populated-state",
      pass:
        renderer.populatedStateVisible &&
        renderer.detailVisible &&
        renderer.libraryPdfAttachmentVisible &&
        renderer.seededWorkCount !== null &&
        renderer.seededWorkCount >= 1,
      detail: `count=${renderer.seededWorkCount}; pdf=${renderer.libraryPdfAttachmentVisible}`,
    },
    {
      name: "library-filter-tabs-accessible",
      pass: renderer.libraryFilterTabsExposeState,
    },
    {
      name: "library-filter-empty-recovery",
      pass: renderer.libraryFilterEmptyActionRestoresResults,
    },
    {
      name: "library-bulk-select-mixed-state",
      pass: renderer.libraryBulkSelectMixedVisible,
    },
    {
      name: "library-canvas-work-ingress",
      pass:
        renderer.canvasLibraryWorkIngressNavigated &&
        renderer.canvasLibraryWorkIngressVisible &&
        renderer.canvasLibraryWorkIngressPersisted,
      detail: `navigated=${renderer.canvasLibraryWorkIngressNavigated}; visible=${renderer.canvasLibraryWorkIngressVisible}; persisted=${renderer.canvasLibraryWorkIngressPersisted}; hash=${renderer.canvasLibraryWorkIngressHash}`,
    },
    {
      name: "library-refresh-race-preserved",
      pass: renderer.libraryRefreshRacePreserved,
    },
    {
      name: "library-sidebar-meta-isolated",
      pass:
        renderer.librarySidebarMetaVisible &&
        renderer.librarySidebarHealthHidden &&
        renderer.librarySidebarOrganizerActionsVisible,
      detail: `meta=${renderer.librarySidebarMetaVisible}; healthHidden=${renderer.librarySidebarHealthHidden}; actions=${renderer.librarySidebarOrganizerActionsVisible}`,
    },
    {
      name: "library-missing-deeplink-feedback",
      pass: renderer.libraryMissingDeepLinkFeedbackVisible,
    },
    {
      name: "library-search",
      pass:
        renderer.searchDataPathOk &&
        renderer.searchResultVisible &&
        renderer.searchEmptyActionRestoresResults &&
        renderer.searchClearButtonRestoresResults &&
        renderer.searchEscapeClearsQuery,
      detail: `data=${renderer.searchDataPathOk}; result=${renderer.searchResultVisible}; empty=${renderer.searchEmptyStateVisible}; emptyAction=${renderer.searchEmptyActionRestoresResults}; clear=${renderer.searchClearButtonRestoresResults}; escape=${renderer.searchEscapeClearsQuery}`,
    },
    {
      name: "library-pdf-upload-feedback",
      pass:
        renderer.libraryPdfUploadBusyVisible &&
        renderer.libraryPdfUploadSuccessVisible &&
        renderer.libraryPdfUploadPersisted,
      detail: `busy=${renderer.libraryPdfUploadBusyVisible}; success=${renderer.libraryPdfUploadSuccessVisible}; persisted=${renderer.libraryPdfUploadPersisted}`,
    },
    {
      name: "library-typed-pdf-ingest-main-owned",
      pass: renderer.libraryTypedPdfIngestCommitted,
      detail: renderer.libraryTypedPdfIngestDetail,
    },
    {
      name: "library-reading-status-action",
      pass:
        renderer.libraryReadingStatusBusyVisible &&
        renderer.libraryReadingStatusSuccessVisible &&
        renderer.libraryReadingStatusPersisted,
      detail: `busy=${renderer.libraryReadingStatusBusyVisible}; success=${renderer.libraryReadingStatusSuccessVisible}; persisted=${renderer.libraryReadingStatusPersisted}; status=${renderer.readingStatus ?? "null"}`,
    },
    {
      name: "library-reading-status-failure-recovers",
      pass:
        renderer.libraryReadingStatusFailureVisible &&
        renderer.libraryReadingStatusFailureBusyVisible &&
        renderer.libraryReadingStatusFailurePreserved &&
        renderer.libraryReadingStatusFailureDidNotPersist,
      detail: `visible=${renderer.libraryReadingStatusFailureVisible}; busy=${renderer.libraryReadingStatusFailureBusyVisible}; preserved=${renderer.libraryReadingStatusFailurePreserved}; notPersisted=${renderer.libraryReadingStatusFailureDidNotPersist}`,
    },
    {
      name: "library-star-action-feedback",
      pass:
        renderer.libraryStarBusyVisible &&
        renderer.libraryStarSuccessVisible &&
        renderer.libraryStarPersisted,
      detail: `busy=${renderer.libraryStarBusyVisible}; success=${renderer.libraryStarSuccessVisible}; persisted=${renderer.libraryStarPersisted}`,
    },
    {
      name: "library-star-failure-recovers",
      pass:
        renderer.libraryStarFailureVisible &&
        renderer.libraryStarFailureBusyVisible &&
        renderer.libraryStarFailurePreserved &&
        renderer.libraryStarFailureDidNotPersist,
      detail: `visible=${renderer.libraryStarFailureVisible}; busy=${renderer.libraryStarFailureBusyVisible}; preserved=${renderer.libraryStarFailurePreserved}; notPersisted=${renderer.libraryStarFailureDidNotPersist}`,
    },
    {
      name: "library-citation-context-focused",
      pass: renderer.libraryCitationContextVisible && renderer.libraryContextualWorkflowsHidden,
      detail: `citation=${renderer.libraryCitationContextVisible}; misplacedWorkflowsHidden=${renderer.libraryContextualWorkflowsHidden}`,
    },
    {
      name: "library-citation-export-feedback",
      pass:
        renderer.libraryCitationExportBusyVisible &&
        renderer.libraryCitationExportSuccessVisible &&
        renderer.libraryCitationExportFailureVisible &&
        renderer.libraryCitationExportPmidVisible,
      detail: `busy=${renderer.libraryCitationExportBusyVisible}; success=${renderer.libraryCitationExportSuccessVisible}; failure=${renderer.libraryCitationExportFailureVisible}; pmid=${renderer.libraryCitationExportPmidVisible}`,
    },
    {
      name: "library-citation-copy-feedback",
      pass:
        renderer.libraryCitationCopyBusyVisible &&
        renderer.libraryCitationCopySuccessVisible &&
        renderer.libraryCitationCopyFailureVisible,
      detail: `busy=${renderer.libraryCitationCopyBusyVisible}; success=${renderer.libraryCitationCopySuccessVisible}; failure=${renderer.libraryCitationCopyFailureVisible}`,
    },
    {
      name: "library-bulk-tag-feedback",
      pass:
        renderer.libraryBulkTagBusyVisible &&
        renderer.libraryBulkTagSuccessVisible &&
        renderer.libraryBulkTagPersisted,
      detail: `busy=${renderer.libraryBulkTagBusyVisible}; success=${renderer.libraryBulkTagSuccessVisible}; persisted=${renderer.libraryBulkTagPersisted}`,
    },
    {
      name: "library-bulk-tag-failure-rolls-back",
      pass:
        renderer.libraryBulkTagFailureVisible &&
        renderer.libraryBulkTagFailureBusyVisible &&
        renderer.libraryBulkTagFailurePreserved &&
        renderer.libraryBulkTagFailureDidNotPersist,
      detail: `visible=${renderer.libraryBulkTagFailureVisible}; busy=${renderer.libraryBulkTagFailureBusyVisible}; preserved=${renderer.libraryBulkTagFailurePreserved}; notPersisted=${renderer.libraryBulkTagFailureDidNotPersist}`,
    },
    {
      name: "library-merge-works-feedback",
      pass:
        renderer.libraryMergeBusyVisible &&
        renderer.libraryMergeSuccessVisible &&
        renderer.libraryMergePersisted,
      detail: `busy=${renderer.libraryMergeBusyVisible}; success=${renderer.libraryMergeSuccessVisible}; persisted=${renderer.libraryMergePersisted}`,
    },
    {
      name: "library-merge-failure-rolls-back",
      pass:
        renderer.libraryMergeFailureVisible &&
        renderer.libraryMergeFailureBusyVisible &&
        renderer.libraryMergeFailurePreserved &&
        renderer.libraryMergeFailureDidNotPersist,
      detail: `visible=${renderer.libraryMergeFailureVisible}; busy=${renderer.libraryMergeFailureBusyVisible}; preserved=${renderer.libraryMergeFailurePreserved}; notPersisted=${renderer.libraryMergeFailureDidNotPersist}`,
    },
    {
      name: "library-bulk-trash-failure-rolls-back",
      pass:
        renderer.libraryBulkTrashFailureVisible &&
        renderer.libraryBulkTrashFailureBusyVisible &&
        renderer.libraryBulkTrashFailurePreserved &&
        renderer.libraryBulkTrashFailureDidNotPersist,
      detail: `visible=${renderer.libraryBulkTrashFailureVisible}; busy=${renderer.libraryBulkTrashFailureBusyVisible}; preserved=${renderer.libraryBulkTrashFailurePreserved}; notPersisted=${renderer.libraryBulkTrashFailureDidNotPersist}`,
    },
    {
      name: "library-trash-restore-feedback",
      pass: renderer.libraryTrashRestoreBusyVisible && renderer.libraryTrashRestoreSuccessVisible,
      detail: `busy=${renderer.libraryTrashRestoreBusyVisible}; success=${renderer.libraryTrashRestoreSuccessVisible}`,
    },
    {
      name: "library-trash-restore-failure-rolls-back",
      pass:
        renderer.libraryTrashRestoreFailureVisible &&
        renderer.libraryTrashRestoreFailureBusyVisible &&
        renderer.libraryTrashRestoreFailurePreserved &&
        renderer.libraryTrashRestoreFailureDidNotPersist,
      detail: `visible=${renderer.libraryTrashRestoreFailureVisible}; busy=${renderer.libraryTrashRestoreFailureBusyVisible}; preserved=${renderer.libraryTrashRestoreFailurePreserved}; notPersisted=${renderer.libraryTrashRestoreFailureDidNotPersist}`,
    },
    {
      name: "library-trash-failure-recovers",
      pass:
        renderer.libraryTrashFailureVisible &&
        renderer.libraryTrashFailureBusyVisible &&
        renderer.libraryTrashFailurePreserved &&
        renderer.libraryTrashFailureDidNotPersist,
      detail: `visible=${renderer.libraryTrashFailureVisible}; busy=${renderer.libraryTrashFailureBusyVisible}; preserved=${renderer.libraryTrashFailurePreserved}; notPersisted=${renderer.libraryTrashFailureDidNotPersist}`,
    },
    {
      name: "library-trash-undo-failure-recovers",
      pass:
        renderer.libraryTrashUndoFailureVisible &&
        renderer.libraryTrashUndoFailureBusyVisible &&
        renderer.libraryTrashUndoFailurePreserved &&
        renderer.libraryTrashUndoFailureDidNotPersist,
      detail: `visible=${renderer.libraryTrashUndoFailureVisible}; busy=${renderer.libraryTrashUndoFailureBusyVisible}; preserved=${renderer.libraryTrashUndoFailurePreserved}; notPersisted=${renderer.libraryTrashUndoFailureDidNotPersist}`,
    },
    {
      name: "library-trash-undo-recovery",
      pass:
        renderer.libraryTrashUndoVisible &&
        renderer.libraryTrashUndoBusyVisible &&
        renderer.libraryTrashUndoRecovered,
      detail: `visible=${renderer.libraryTrashUndoVisible}; busy=${renderer.libraryTrashUndoBusyVisible}; recovered=${renderer.libraryTrashUndoRecovered}`,
    },
    {
      name: "library-trash-purge-typed-confirm",
      pass:
        renderer.libraryTrashPurgeTypedConfirmProtected &&
        renderer.libraryTrashPurgeBusyVisible &&
        renderer.libraryTrashPurgePersisted,
      detail: `protected=${renderer.libraryTrashPurgeTypedConfirmProtected}; busy=${renderer.libraryTrashPurgeBusyVisible}; persisted=${renderer.libraryTrashPurgePersisted}`,
    },
    {
      name: "library-trash-purge-failure-rolls-back",
      pass:
        renderer.libraryTrashPurgeFailureVisible &&
        renderer.libraryTrashPurgeFailureBusyVisible &&
        renderer.libraryTrashPurgeFailurePreserved &&
        renderer.libraryTrashPurgeFailureDidNotPersist,
      detail: `visible=${renderer.libraryTrashPurgeFailureVisible}; busy=${renderer.libraryTrashPurgeFailureBusyVisible}; preserved=${renderer.libraryTrashPurgeFailurePreserved}; notPersisted=${renderer.libraryTrashPurgeFailureDidNotPersist}`,
    },
    {
      name: "library-move-to-collection-feedback",
      pass:
        renderer.libraryMoveToCollectionBusyVisible &&
        renderer.libraryMoveToCollectionSuccessVisible &&
        renderer.libraryMoveToCollectionPersisted,
      detail: `busy=${renderer.libraryMoveToCollectionBusyVisible}; success=${renderer.libraryMoveToCollectionSuccessVisible}; persisted=${renderer.libraryMoveToCollectionPersisted}`,
    },
    {
      name: "library-move-to-collection-failure-rolls-back",
      pass:
        renderer.libraryMoveToCollectionFailureVisible &&
        renderer.libraryMoveToCollectionFailureBusyVisible &&
        renderer.libraryMoveToCollectionFailurePreserved &&
        renderer.libraryMoveToCollectionFailureDidNotPersist,
      detail: `visible=${renderer.libraryMoveToCollectionFailureVisible}; busy=${renderer.libraryMoveToCollectionFailureBusyVisible}; preserved=${renderer.libraryMoveToCollectionFailurePreserved}; notPersisted=${renderer.libraryMoveToCollectionFailureDidNotPersist}`,
    },
    {
      name: "library-collection-create-failure-preserves-draft",
      pass:
        renderer.libraryCollectionCreateFailureVisible &&
        renderer.libraryCollectionCreateFailureBusyVisible &&
        renderer.libraryCollectionCreateFailurePreserved &&
        renderer.libraryCollectionCreateFailureDidNotPersist,
      detail: `visible=${renderer.libraryCollectionCreateFailureVisible}; busy=${renderer.libraryCollectionCreateFailureBusyVisible}; preserved=${renderer.libraryCollectionCreateFailurePreserved}; notPersisted=${renderer.libraryCollectionCreateFailureDidNotPersist}`,
    },
    {
      name: "library-collection-hierarchy-move-feedback",
      pass: renderer.libraryCollectionMoveSuccessVisible && renderer.libraryCollectionMovePersisted,
      detail: `success=${renderer.libraryCollectionMoveSuccessVisible}; persisted=${renderer.libraryCollectionMovePersisted}`,
    },
    {
      name: "library-collection-rename-failure-preserves-draft",
      pass:
        renderer.libraryCollectionRenameFailureVisible &&
        renderer.libraryCollectionRenameFailureBusyVisible &&
        renderer.libraryCollectionRenameFailurePreserved &&
        renderer.libraryCollectionRenameFailureDidNotPersist,
      detail: `visible=${renderer.libraryCollectionRenameFailureVisible}; busy=${renderer.libraryCollectionRenameFailureBusyVisible}; preserved=${renderer.libraryCollectionRenameFailurePreserved}; notPersisted=${renderer.libraryCollectionRenameFailureDidNotPersist}`,
    },
    {
      name: "library-collection-manager-delete-failure-recovers",
      pass:
        renderer.libraryCollectionDeleteFailureVisible &&
        renderer.libraryCollectionDeleteFailureBusyVisible &&
        renderer.libraryCollectionDeleteFailurePreserved &&
        renderer.libraryCollectionDeleteFailureDidNotPersist,
      detail: `visible=${renderer.libraryCollectionDeleteFailureVisible}; busy=${renderer.libraryCollectionDeleteFailureBusyVisible}; preserved=${renderer.libraryCollectionDeleteFailurePreserved}; notPersisted=${renderer.libraryCollectionDeleteFailureDidNotPersist}`,
    },
    {
      name: "library-collection-manager-delete-feedback",
      pass:
        renderer.libraryCollectionDeleteBusyVisible &&
        renderer.libraryCollectionDeleteSuccessVisible &&
        renderer.libraryCollectionDeletePersisted,
      detail: `busy=${renderer.libraryCollectionDeleteBusyVisible}; success=${renderer.libraryCollectionDeleteSuccessVisible}; persisted=${renderer.libraryCollectionDeletePersisted}`,
    },
    {
      name: "library-collection-manager-delete-undo-failure-recovers",
      pass:
        renderer.libraryCollectionDeleteUndoFailureVisible &&
        renderer.libraryCollectionDeleteUndoFailureBusyVisible &&
        renderer.libraryCollectionDeleteUndoFailurePreserved &&
        renderer.libraryCollectionDeleteUndoFailureDidNotPersist,
      detail: `visible=${renderer.libraryCollectionDeleteUndoFailureVisible}; busy=${renderer.libraryCollectionDeleteUndoFailureBusyVisible}; preserved=${renderer.libraryCollectionDeleteUndoFailurePreserved}; notPersisted=${renderer.libraryCollectionDeleteUndoFailureDidNotPersist}`,
    },
    {
      name: "library-collection-manager-delete-undo-recovery",
      pass:
        renderer.libraryCollectionDeleteUndoBusyVisible &&
        renderer.libraryCollectionDeleteUndoRecovered,
      detail: `busy=${renderer.libraryCollectionDeleteUndoBusyVisible}; restored=${renderer.libraryCollectionDeleteUndoRecovered}`,
    },
    {
      name: "library-tag-rename-failure-preserves-draft",
      pass:
        renderer.libraryTagRenameFailureVisible &&
        renderer.libraryTagRenameFailureBusyVisible &&
        renderer.libraryTagRenameFailurePreserved &&
        renderer.libraryTagRenameFailureDidNotPersist,
      detail: `visible=${renderer.libraryTagRenameFailureVisible}; busy=${renderer.libraryTagRenameFailureBusyVisible}; preserved=${renderer.libraryTagRenameFailurePreserved}; notPersisted=${renderer.libraryTagRenameFailureDidNotPersist}`,
    },
    {
      name: "library-tag-manager-delete-failure-recovers",
      pass:
        renderer.libraryTagDeleteFailureVisible &&
        renderer.libraryTagDeleteFailureBusyVisible &&
        renderer.libraryTagDeleteFailurePreserved &&
        renderer.libraryTagDeleteFailureDidNotPersist,
      detail: `visible=${renderer.libraryTagDeleteFailureVisible}; busy=${renderer.libraryTagDeleteFailureBusyVisible}; preserved=${renderer.libraryTagDeleteFailurePreserved}; notPersisted=${renderer.libraryTagDeleteFailureDidNotPersist}`,
    },
    {
      name: "library-tag-manager-delete-feedback",
      pass:
        renderer.libraryTagDeleteBusyVisible &&
        renderer.libraryTagDeleteSuccessVisible &&
        renderer.libraryTagDeletePersisted,
      detail: `busy=${renderer.libraryTagDeleteBusyVisible}; success=${renderer.libraryTagDeleteSuccessVisible}; persisted=${renderer.libraryTagDeletePersisted}`,
    },
    {
      name: "library-tag-manager-delete-undo-failure-recovers",
      pass:
        renderer.libraryTagDeleteUndoFailureVisible &&
        renderer.libraryTagDeleteUndoFailureBusyVisible &&
        renderer.libraryTagDeleteUndoFailurePreserved &&
        renderer.libraryTagDeleteUndoFailureDidNotPersist,
      detail: `visible=${renderer.libraryTagDeleteUndoFailureVisible}; busy=${renderer.libraryTagDeleteUndoFailureBusyVisible}; preserved=${renderer.libraryTagDeleteUndoFailurePreserved}; notPersisted=${renderer.libraryTagDeleteUndoFailureDidNotPersist}`,
    },
    {
      name: "library-tag-manager-delete-undo-recovery",
      pass: renderer.libraryTagDeleteUndoBusyVisible && renderer.libraryTagDeleteUndoRecovered,
      detail: `busy=${renderer.libraryTagDeleteUndoBusyVisible}; restored=${renderer.libraryTagDeleteUndoRecovered}`,
    },
    { name: "quick-open-dialog", pass: renderer.commandDialogOpen },
  ];
}
