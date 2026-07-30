import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildDiscoverySmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
    {
      name: "discovery-reference-import-confirm",
      pass:
        renderer.discoveryReferenceImportConfirmVisible &&
        renderer.discoveryReferenceImportCancelPreserved &&
        renderer.discoveryReferenceImportCommitBusyVisible &&
        renderer.discoveryReferenceImportCommitSuccessVisible &&
        renderer.discoveryReferenceImportCommitPersisted &&
        renderer.discoveryReferenceImportRejectsEmptyVisible &&
        renderer.discoveryReferenceImportRejectsEmptyPersisted &&
        renderer.discoveryReferenceImportRichFormatsPersisted,
      detail: `visible=${renderer.discoveryReferenceImportConfirmVisible}; cancelled=${renderer.discoveryReferenceImportCancelPreserved}; busy=${renderer.discoveryReferenceImportCommitBusyVisible}; success=${renderer.discoveryReferenceImportCommitSuccessVisible}; persisted=${renderer.discoveryReferenceImportCommitPersisted}; rejectsEmpty=${renderer.discoveryReferenceImportRejectsEmptyVisible}; emptyPersisted=${renderer.discoveryReferenceImportRejectsEmptyPersisted}; richFormats=${renderer.discoveryReferenceImportRichFormatsPersisted}`,
    },
    {
      name: "discovery-browser-hide-failure-visible",
      pass: renderer.discoveryBrowserHideFailureVisible,
    },
    {
      name: "discovery-site-action-confirm",
      pass:
        renderer.discoverySiteActionConfirmVisible && renderer.discoverySiteActionConfirmCancelled,
      detail: `visible=${renderer.discoverySiteActionConfirmVisible}; cancelled=${renderer.discoverySiteActionConfirmCancelled}`,
    },
    {
      name: "discovery-proxy-config-save-state",
      pass: renderer.discoveryProxyConfigSaved && renderer.discoveryProxyConfigSaveAriaBusyVisible,
      detail: `busy=${renderer.discoveryProxyConfigSaveBusyVisible}; aria=${renderer.discoveryProxyConfigSaveAriaBusyVisible}; value=${renderer.discoveryProxyConfigValue}`,
    },
    {
      name: "discovery-proxy-credential-url-guard",
      pass:
        renderer.discoveryProxyCredentialsRejected &&
        renderer.discoveryProxyCredentialDidNotPersist,
      detail: `rejected=${renderer.discoveryProxyCredentialsRejected}; notPersisted=${renderer.discoveryProxyCredentialDidNotPersist}`,
    },
    {
      name: "discovery-ezproxy-config-save-state",
      pass:
        renderer.discoveryEzproxyConfigSaved && renderer.discoveryEzproxyConfigSaveAriaBusyVisible,
      detail: `busy=${renderer.discoveryEzproxyConfigSaveBusyVisible}; aria=${renderer.discoveryEzproxyConfigSaveAriaBusyVisible}; value=${renderer.discoveryEzproxyConfigValue}`,
    },
    {
      name: "discovery-ezproxy-credential-url-guard",
      pass:
        renderer.discoveryEzproxyCredentialsRejected &&
        renderer.discoveryEzproxyCredentialDidNotPersist,
      detail: `rejected=${renderer.discoveryEzproxyCredentialsRejected}; notPersisted=${renderer.discoveryEzproxyCredentialDidNotPersist}`,
    },
    {
      name: "discovery-site-proxy-toggle-state",
      pass: renderer.discoverySiteProxyToggled,
      detail: `busy=${renderer.discoverySiteProxyToggleBusyVisible}; value=${renderer.discoverySiteProxyValue}`,
    },
    {
      name: "discovery-site-hide-action-state",
      pass: renderer.discoverySiteHideActionConfirmed,
      detail: `busy=${renderer.discoverySiteHideActionBusyVisible}; hidden=${renderer.discoverySiteHideActionHiddenValue}`,
    },
    {
      name: "discovery-site-remove-failure-recovers",
      pass:
        renderer.discoverySiteRemoveFailureVisible &&
        renderer.discoverySiteRemoveFailureBusyVisible &&
        renderer.discoverySiteRemoveFailurePreserved &&
        renderer.discoverySiteRemoveFailureDidNotPersist,
      detail: `visible=${renderer.discoverySiteRemoveFailureVisible}; busy=${renderer.discoverySiteRemoveFailureBusyVisible}; preserved=${renderer.discoverySiteRemoveFailurePreserved}; notPersisted=${renderer.discoverySiteRemoveFailureDidNotPersist}`,
    },
    {
      name: "discovery-site-remove-action-state",
      pass: renderer.discoverySiteRemoveActionDeleted,
      detail: `busy=${renderer.discoverySiteRemoveActionBusyVisible}; count=${renderer.discoverySiteRemoveActionCount}`,
    },
    {
      name: "discovery-site-remove-undo-failure-recovers",
      pass:
        renderer.discoverySiteRemoveUndoFailureVisible &&
        renderer.discoverySiteRemoveUndoFailureBusyVisible &&
        renderer.discoverySiteRemoveUndoFailurePreserved &&
        renderer.discoverySiteRemoveUndoFailureDidNotPersist,
      detail: `visible=${renderer.discoverySiteRemoveUndoFailureVisible}; busy=${renderer.discoverySiteRemoveUndoFailureBusyVisible}; preserved=${renderer.discoverySiteRemoveUndoFailurePreserved}; notPersisted=${renderer.discoverySiteRemoveUndoFailureDidNotPersist}`,
    },
    {
      name: "discovery-site-remove-undo-recovery",
      pass:
        renderer.discoverySiteRemoveUndoBusyVisible && renderer.discoverySiteRemoveUndoRecovered,
      detail: `busy=${renderer.discoverySiteRemoveUndoBusyVisible}; restored=${renderer.discoverySiteRemoveUndoRecovered}`,
    },
    {
      name: "discovery-duplicate-site-guard",
      pass: renderer.discoveryDuplicateSiteBlocked,
      detail: `busy=${renderer.discoveryDuplicateSiteAddBusyVisible}; message=${renderer.discoveryDuplicateSiteMessageVisible}; count=${renderer.discoveryDuplicateSiteCount}`,
    },
    {
      name: "discovery-site-credential-url-guard",
      pass:
        renderer.discoverySiteCredentialsRejected && renderer.discoverySiteCredentialDidNotPersist,
      detail: `rejected=${renderer.discoverySiteCredentialsRejected}; notPersisted=${renderer.discoverySiteCredentialDidNotPersist}`,
    },
    {
      name: "discovery-manual-hidden-site-restore",
      pass: renderer.discoveryManualHiddenSiteRestored,
      detail: `busy=${renderer.discoveryManualHiddenSiteRestoreBusyVisible}; count=${renderer.discoveryManualHiddenSiteRestoredCount}`,
    },
    {
      name: "discovery-hidden-site-restore",
      pass: renderer.discoveryHiddenSiteRestored,
      detail: `busy=${renderer.discoveryHiddenSiteAddBusyVisible}; message=${renderer.discoveryHiddenDuplicateSiteMessageVisible}; count=${renderer.discoveryHiddenDuplicateSiteCount}`,
    },
    {
      name: "discovery-saved-search-save-failure-preserves-query",
      pass:
        renderer.discoverySavedSearchSaveFailureVisible &&
        renderer.discoverySavedSearchSaveFailureBusyVisible &&
        renderer.discoverySavedSearchSaveFailurePreserved &&
        renderer.discoverySavedSearchSaveFailureDidNotPersist,
      detail: `visible=${renderer.discoverySavedSearchSaveFailureVisible}; busy=${renderer.discoverySavedSearchSaveFailureBusyVisible}; preserved=${renderer.discoverySavedSearchSaveFailurePreserved}; notPersisted=${renderer.discoverySavedSearchSaveFailureDidNotPersist}`,
    },
    {
      name: "discovery-duplicate-saved-search-guard",
      pass: renderer.discoveryDuplicateSavedSearchBlocked,
      detail: `message=${renderer.discoveryDuplicateSavedSearchMessageVisible}; count=${renderer.discoveryDuplicateSavedSearchCount}`,
    },
    {
      name: "discovery-saved-search-delete-failure-recovers",
      pass:
        renderer.discoverySavedSearchDeleteFailureVisible &&
        renderer.discoverySavedSearchDeleteFailureBusyVisible &&
        renderer.discoverySavedSearchDeleteFailurePreserved &&
        renderer.discoverySavedSearchDeleteFailureDidNotPersist,
      detail: `visible=${renderer.discoverySavedSearchDeleteFailureVisible}; busy=${renderer.discoverySavedSearchDeleteFailureBusyVisible}; preserved=${renderer.discoverySavedSearchDeleteFailurePreserved}; notPersisted=${renderer.discoverySavedSearchDeleteFailureDidNotPersist}`,
    },
    {
      name: "discovery-saved-search-delete-feedback",
      pass: renderer.discoverySavedSearchDeleted,
      detail: `confirm=${renderer.discoverySavedSearchDeleteConfirmVisible}; busy=${renderer.discoverySavedSearchDeleteBusyVisible}; persisted=${renderer.discoverySavedSearchDeletePersisted}`,
    },
    {
      name: "discovery-saved-search-delete-undo-failure-recovers",
      pass:
        renderer.discoverySavedSearchDeleteUndoFailureVisible &&
        renderer.discoverySavedSearchDeleteUndoFailureBusyVisible &&
        renderer.discoverySavedSearchDeleteUndoFailurePreserved &&
        renderer.discoverySavedSearchDeleteUndoFailureDidNotPersist,
      detail: `visible=${renderer.discoverySavedSearchDeleteUndoFailureVisible}; busy=${renderer.discoverySavedSearchDeleteUndoFailureBusyVisible}; preserved=${renderer.discoverySavedSearchDeleteUndoFailurePreserved}; notPersisted=${renderer.discoverySavedSearchDeleteUndoFailureDidNotPersist}`,
    },
    {
      name: "discovery-saved-search-delete-undo-recovery",
      pass:
        renderer.discoverySavedSearchDeleteUndoVisible &&
        renderer.discoverySavedSearchDeleteUndoBusyVisible &&
        renderer.discoverySavedSearchDeleteUndoRestored,
      detail: `visible=${renderer.discoverySavedSearchDeleteUndoVisible}; busy=${renderer.discoverySavedSearchDeleteUndoBusyVisible}; restored=${renderer.discoverySavedSearchDeleteUndoRestored}`,
    },
    {
      name: "discovery-saved-search-last-error-visible",
      pass: renderer.discoverySavedSearchLastErrorVisible,
    },
    {
      name: "discovery-saved-search-home-open-state",
      pass:
        renderer.discoverySavedSearchHomeOpenBusyVisible &&
        renderer.discoverySavedSearchHomeOpenNavigated &&
        renderer.discoverySavedSearchHomeOpenClearedNewCount &&
        renderer.discoverySavedSearchHomeOpenReplacedActiveSearch,
      detail: `busy=${renderer.discoverySavedSearchHomeOpenBusyVisible}; navigated=${renderer.discoverySavedSearchHomeOpenNavigated}; cleared=${renderer.discoverySavedSearchHomeOpenClearedNewCount}; replaced=${renderer.discoverySavedSearchHomeOpenReplacedActiveSearch}`,
    },
    {
      name: "discovery-open-search-empty-recovery",
      pass: renderer.discoveryOpenSearchEmptyClearRestored,
    },
    {
      name: "discovery-saved-search-manual-check-state",
      pass:
        renderer.discoverySavedSearchManualCheckBusyVisible &&
        renderer.discoverySavedSearchManualCheckCompleted,
      detail: `busy=${renderer.discoverySavedSearchManualCheckBusyVisible}; completed=${renderer.discoverySavedSearchManualCheckCompleted}`,
    },
    {
      name: "discovery-search-feedback",
      pass:
        renderer.discoverySearchBusyVisible &&
        renderer.discoverySearchAriaBusyVisible &&
        renderer.discoverySearchProgressLiveVisible,
      detail: `busy=${renderer.discoverySearchBusyVisible}; aria=${renderer.discoverySearchAriaBusyVisible}; progress=${renderer.discoverySearchProgressLiveVisible}`,
    },
    {
      name: "discovery-search-retry-recovery",
      pass: renderer.discoverySearchRetryRecoveryVisible,
      detail: renderer.discoverySearchRetryRecoveryDetail,
    },
    {
      name: "discovery-load-more-retry-recovery",
      pass: renderer.discoveryLoadMoreRetryRecoveryVisible,
      detail: renderer.discoveryLoadMoreRetryRecoveryDetail,
    },
    {
      name: "discovery-result-trust-signals",
      pass: renderer.discoveryTrustSignalsVisible,
      detail: renderer.discoveryTrustSignalsDetail,
    },
    {
      name: "discovery-result-fulltext-cue",
      pass: renderer.discoveryFulltextCueVisible,
      detail: renderer.discoveryTrustSignalsDetail,
    },
    {
      name: "discovery-import-fulltext-fallback",
      pass: renderer.discoveryImportBusyVisible && renderer.discoveryImportFulltextFallbackVisible,
      detail: renderer.discoveryTrustSignalsDetail,
    },
    {
      name: "discovery-import-single-flight",
      pass: renderer.discoveryImportSingleFlightVisible,
      detail: renderer.discoveryTrustSignalsDetail,
    },
  ];
}
