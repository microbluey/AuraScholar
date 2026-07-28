import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildHomepageSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
    {
      name: "homepage-library-read-retry-recovery",
      pass: renderer.homepageLibraryReadRetryRecoveryVisible,
      detail: renderer.homepageLibraryReadRetryRecoveryDetail,
    },
    {
      name: "homepage-library-refresh-race-preserved",
      pass: renderer.homepageLibraryRefreshRacePreserved,
    },
    {
      name: "homepage-profile-save-failure-retry",
      pass:
        renderer.homepageProfileSaveFailureVisible &&
        renderer.homepageProfileSaveFailureRetryVisible &&
        renderer.homepageProfileSaveFailureBusyVisible &&
        renderer.homepageProfileSaveFailurePreserved &&
        renderer.homepageProfileSaveFailureDidNotPersist &&
        renderer.homepageProfileSaveFailureRetryPersisted,
      detail: `visible=${renderer.homepageProfileSaveFailureVisible}; retry=${renderer.homepageProfileSaveFailureRetryVisible}; busy=${renderer.homepageProfileSaveFailureBusyVisible}; preserved=${renderer.homepageProfileSaveFailurePreserved}; notPersisted=${renderer.homepageProfileSaveFailureDidNotPersist}; retryPersisted=${renderer.homepageProfileSaveFailureRetryPersisted}`,
    },
    {
      name: "homepage-publication-filter-empty-recovery",
      pass: renderer.homepagePublicationFilterActionRestored,
      detail: renderer.homepagePublicationFilterActionDetail,
    },
    {
      name: "homepage-featured-overwrite-confirm",
      pass:
        renderer.homepageFeaturedOverwriteConfirmVisible &&
        renderer.homepageFeaturedOverwriteCancelPreserved,
      detail: `visible=${renderer.homepageFeaturedOverwriteConfirmVisible}; preserved=${renderer.homepageFeaturedOverwriteCancelPreserved}`,
    },
    {
      name: "homepage-clear-selected-works-confirm",
      pass:
        renderer.homepageClearSelectedConfirmVisible &&
        renderer.homepageClearSelectedCancelPreserved,
      detail: `visible=${renderer.homepageClearSelectedConfirmVisible}; preserved=${renderer.homepageClearSelectedCancelPreserved}`,
    },
    {
      name: "homepage-clear-selected-works-undo",
      pass:
        renderer.homepageClearSelectedUndoRecovered &&
        renderer.homepageClearSelectedUndoRetryPersisted,
      detail: renderer.homepageClearSelectedUndoDetail,
    },
    {
      name: "homepage-clear-selected-works-undo-failure-recovers",
      pass:
        renderer.homepageClearSelectedUndoFailureVisible &&
        renderer.homepageClearSelectedUndoFailureBusyVisible &&
        renderer.homepageClearSelectedUndoFailurePreserved &&
        renderer.homepageClearSelectedUndoFailureDidNotPersist,
      detail: `visible=${renderer.homepageClearSelectedUndoFailureVisible}; busy=${renderer.homepageClearSelectedUndoFailureBusyVisible}; preserved=${renderer.homepageClearSelectedUndoFailurePreserved}; notPersisted=${renderer.homepageClearSelectedUndoFailureDidNotPersist}`,
    },
    {
      name: "homepage-copy-feedback",
      pass:
        renderer.homepageCopyAriaBusyVisible &&
        renderer.homepageCopyBusyVisible &&
        renderer.homepageCopySuccessVisible &&
        renderer.homepageCopyFailureVisible,
      detail: `busy=${renderer.homepageCopyBusyVisible}; aria=${renderer.homepageCopyAriaBusyVisible}; success=${renderer.homepageCopySuccessVisible}; failure=${renderer.homepageCopyFailureVisible}`,
    },
    {
      name: "homepage-export-feedback",
      pass:
        renderer.homepageExportAriaBusyVisible &&
        renderer.homepageExportBusyVisible &&
        renderer.homepageExportSuccessVisible &&
        renderer.homepageExportFailureVisible,
      detail: `busy=${renderer.homepageExportBusyVisible}; aria=${renderer.homepageExportAriaBusyVisible}; success=${renderer.homepageExportSuccessVisible}; failure=${renderer.homepageExportFailureVisible}`,
    },
    {
      name: "homepage-export-link-safety",
      pass: renderer.homepageExternalLinkSafetyOk && renderer.homepageSafeLinkRelHardened,
      detail: `safe=${renderer.homepageExternalLinkSafetyOk}; rel=${renderer.homepageSafeLinkRelHardened}`,
    },
  ];
}
