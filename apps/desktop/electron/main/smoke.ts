// Smoke-test harness (E2E in-app checks), main-process side. Loaded ONLY when
// AURASCHOLAR_SMOKE=1 via a dynamic import in main.ts, so it stays out of the
// normal startup path and ships as a separate lazy chunk.
// Driven by scripts/smoke-electron.mjs, which parses the JSON result line.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";

const SMOKE_MODE = process.env.AURASCHOLAR_SMOKE === "1";
const SMOKE_RESULT_PREFIX = "AURASCHOLAR_SMOKE_RESULT ";
const DEFAULT_SMOKE_TIMEOUT_MS = 120_000;
const parsedSmokeTimeoutMs = Number(
  process.env.AURASCHOLAR_SMOKE_TIMEOUT_MS ?? DEFAULT_SMOKE_TIMEOUT_MS,
);
const SMOKE_TIMEOUT_MS =
  Number.isFinite(parsedSmokeTimeoutMs) && parsedSmokeTimeoutMs > 0
    ? parsedSmokeTimeoutMs
    : DEFAULT_SMOKE_TIMEOUT_MS;

interface SmokeRendererResult {
  appShellAiSettingsCtaNavigates: boolean;
  appShellAiSettingsCtaTargetsSection: boolean;
  appShellAiSettingsCtaVisible: boolean;
  appShellAiSettingsPreservesModelOnlyDraft: boolean;
  appShellAiModelWithoutSecretRequiresConfig: boolean;
  aiSettingsFallbackVisible: boolean;
  bodyText: string;
  browserPreviewWarning: boolean;
  citationBridgeMethodGuard: boolean;
  citationBridgePingOk: boolean;
  citationBridgeUnauthRejected: boolean;
  commandCompositionEscapeIgnored: boolean;
  commandCompositionIgnored: boolean;
  commandCloseRestoresFocus: boolean;
  commandDialogOpen: boolean;
  commandEmptyActionRestoresResults: boolean;
  commandKeyboardNavigationKeepsActiveVisible: boolean;
  commandNonPlatformShortcutIgnored: boolean;
  commandShortcutLabel: string;
  commandShortcutToggleCloses: boolean;
  commandShortcutToggleOpens: boolean;
  commandTargetedSettingsActionTargetsSection: boolean;
  commandTargetedSettingsActionVisible: boolean;
  detailVisible: boolean;
  discoveryBrowserHideFailureVisible: boolean;
  discoveryDuplicateSiteAddBusyVisible: boolean;
  discoveryDuplicateSiteBlocked: boolean;
  discoveryDuplicateSiteCount: number | null;
  discoveryDuplicateSiteMessageVisible: boolean;
  discoveryHiddenSiteAddBusyVisible: boolean;
  discoveryHiddenDuplicateSiteCount: number | null;
  discoveryHiddenDuplicateSiteMessageVisible: boolean;
  discoveryHiddenSiteRestored: boolean;
  discoveryManualHiddenSiteRestoreBusyVisible: boolean;
  discoveryManualHiddenSiteRestored: boolean;
  discoveryManualHiddenSiteRestoredCount: number | null;
  discoverySavedSearchSaveFailureBusyVisible: boolean;
  discoverySavedSearchSaveFailureDidNotPersist: boolean;
  discoverySavedSearchSaveFailurePreserved: boolean;
  discoverySavedSearchSaveFailureVisible: boolean;
  discoveryDuplicateSavedSearchBlocked: boolean;
  discoveryDuplicateSavedSearchCount: number | null;
  discoveryDuplicateSavedSearchMessageVisible: boolean;
  discoverySavedSearchDeleteFailureBusyVisible: boolean;
  discoverySavedSearchDeleteFailureDidNotPersist: boolean;
  discoverySavedSearchDeleteFailurePreserved: boolean;
  discoverySavedSearchDeleteFailureVisible: boolean;
  discoverySavedSearchDeleteBusyVisible: boolean;
  discoverySavedSearchDeleteConfirmVisible: boolean;
  discoverySavedSearchDeleted: boolean;
  discoverySavedSearchDeletePersisted: boolean;
  discoverySavedSearchDeleteUndoBusyVisible: boolean;
  discoverySavedSearchDeleteUndoFailureBusyVisible: boolean;
  discoverySavedSearchDeleteUndoFailureDidNotPersist: boolean;
  discoverySavedSearchDeleteUndoFailurePreserved: boolean;
  discoverySavedSearchDeleteUndoFailureVisible: boolean;
  discoverySavedSearchDeleteUndoRestored: boolean;
  discoverySavedSearchDeleteUndoVisible: boolean;
  discoveryEzproxyConfigSaveAriaBusyVisible: boolean;
  discoveryEzproxyConfigSaveBusyVisible: boolean;
  discoveryEzproxyCredentialDidNotPersist: boolean;
  discoveryEzproxyCredentialsRejected: boolean;
  discoveryEzproxyConfigSaved: boolean;
  discoveryEzproxyConfigValue: string | null;
  discoveryFulltextCueVisible: boolean;
  discoveryImportBusyVisible: boolean;
  discoveryImportFulltextFallbackVisible: boolean;
  discoveryLoadMoreRetryRecoveryDetail: string;
  discoveryLoadMoreRetryRecoveryVisible: boolean;
  discoverySearchAriaBusyVisible: boolean;
  discoverySearchBusyVisible: boolean;
  discoverySearchRetryRecoveryDetail: string;
  discoverySearchRetryRecoveryVisible: boolean;
  discoveryTrustSignalsDetail: string;
  discoverySearchProgressLiveVisible: boolean;
  discoverySavedSearchManualCheckBusyVisible: boolean;
  discoverySavedSearchManualCheckCompleted: boolean;
  discoverySavedSearchHomeOpenBusyVisible: boolean;
  discoverySavedSearchHomeOpenClearedNewCount: boolean;
  discoveryOpenSearchEmptyClearRestored: boolean;
  discoverySavedSearchHomeOpenNavigated: boolean;
  discoverySavedSearchHomeOpenReplacedActiveSearch: boolean;
  discoverySavedSearchLastErrorVisible: boolean;
  discoveryTrustSignalsVisible: boolean;
  discoveryProxyConfigSaveAriaBusyVisible: boolean;
  discoveryProxyConfigSaveBusyVisible: boolean;
  discoveryProxyCredentialDidNotPersist: boolean;
  discoveryProxyCredentialsRejected: boolean;
  discoveryProxyConfigSaved: boolean;
  discoveryProxyConfigValue: string | null;
  discoverySearchCompositionIgnored: boolean;
  discoverySiteCredentialDidNotPersist: boolean;
  discoverySiteCredentialsRejected: boolean;
  discoverySiteProxyToggleBusyVisible: boolean;
  discoverySiteProxyToggled: boolean;
  discoverySiteProxyValue: number | null;
  discoverySiteHideActionBusyVisible: boolean;
  discoverySiteHideActionConfirmed: boolean;
  discoverySiteHideActionHiddenValue: number | null;
  discoverySiteRemoveFailureBusyVisible: boolean;
  discoverySiteRemoveFailureDidNotPersist: boolean;
  discoverySiteRemoveFailurePreserved: boolean;
  discoverySiteRemoveFailureVisible: boolean;
  discoverySiteRemoveActionBusyVisible: boolean;
  discoverySiteRemoveActionCount: number | null;
  discoverySiteRemoveActionDeleted: boolean;
  discoverySiteRemoveUndoBusyVisible: boolean;
  discoverySiteRemoveUndoFailureBusyVisible: boolean;
  discoverySiteRemoveUndoFailureDidNotPersist: boolean;
  discoverySiteRemoveUndoFailurePreserved: boolean;
  discoverySiteRemoveUndoFailureVisible: boolean;
  discoverySiteRemoveUndoRecovered: boolean;
  discoverySiteActionConfirmCancelled: boolean;
  discoverySiteActionConfirmVisible: boolean;
  discoveryReferenceImportCommitBusyVisible: boolean;
  discoveryReferenceImportCommitPersisted: boolean;
  discoveryReferenceImportCommitSuccessVisible: boolean;
  discoveryReferenceImportCancelPreserved: boolean;
  discoveryReferenceImportConfirmVisible: boolean;
  discoveryReferenceImportRejectsEmptyPersisted: boolean;
  discoveryReferenceImportRejectsEmptyVisible: boolean;
  discoveryReferenceImportRichFormatsPersisted: boolean;
  appShellCanvasStatsRacePreserved: boolean;
  canvasLegacyFlashcardsRedirected: boolean;
  canvasLegacyRedirectHash: string;
  canvasLibraryWorkIngressHash: string;
  canvasLibraryWorkIngressNavigated: boolean;
  canvasLibraryWorkIngressPersisted: boolean;
  canvasLibraryWorkIngressVisible: boolean;
  canvasNodeContextMenuVisible: boolean;
  canvasPersistedNodeCount: number | null;
  canvasPersistedNodeReloaded: boolean;
  canvasSemanticQuickLinkCandidateVisible: boolean;
  canvasSemanticQuickLinkCleanupSucceeded: boolean;
  canvasSemanticQuickLinkDeferred: boolean;
  canvasSemanticQuickLinkPersisted: boolean;
  canvasSemanticQuickLinkShortcutHandled: boolean;
  canvasSplitReaderClosed: boolean;
  canvasSplitReaderCleanupSucceeded: boolean;
  canvasSplitReaderExcerptLinked: boolean;
  canvasSplitReaderKeptContext: boolean;
  canvasSplitReaderOpened: boolean;
  canvasToolboxDetailsEditPersisted: boolean;
  canvasReaderAnnotationDeepLinkHash: string;
  canvasReaderAnnotationDeepLinkNavigated: boolean;
  canvasReaderAnnotationPersisted: boolean;
  canvasReaderAnnotationVisible: boolean;
  dbError: string | null;
  emptyStateVisible: boolean;
  externalCredentialsRejected: boolean;
  externalNavigationBlocked: boolean;
  externalUnsafeRejected: boolean;
  graphCachedVisible: boolean;
  graphEmptyLatestCtaHash: string;
  graphEmptyLatestCtaOpened: boolean;
  graphEmptyLatestCtaVisible: boolean;
  graphInputCompositionIgnored: boolean;
  graphDeepLinkParamSyncVisible: boolean;
  graphImportBusyVisible: boolean;
  graphImportFailureFeedbackVisible: boolean;
  graphImportSuccessStatsUpdated: boolean;
  graphImportSuccessVisible: boolean;
  graphUnexpectedBuildMisses: string[];
  graphLoadRacePreserved: boolean;
  graphNodeKeyboardSelectable: boolean;
  graphRetryRecoveryVisible: boolean;
  hash: string;
  hasAuraBridge: boolean;
  heading: string;
  homepageClearSelectedCancelPreserved: boolean;
  homepageClearSelectedConfirmVisible: boolean;
  homepageClearSelectedUndoDetail: string;
  homepageClearSelectedUndoFailureBusyVisible: boolean;
  homepageClearSelectedUndoFailureDidNotPersist: boolean;
  homepageClearSelectedUndoFailurePreserved: boolean;
  homepageClearSelectedUndoFailureVisible: boolean;
  homepageClearSelectedUndoRecovered: boolean;
  homepageClearSelectedUndoRetryPersisted: boolean;
  homepageCopyAriaBusyVisible: boolean;
  homepageCopyBusyVisible: boolean;
  homepageCopyFailureVisible: boolean;
  homepageCopySuccessVisible: boolean;
  homepageExportAriaBusyVisible: boolean;
  homepageExportBusyVisible: boolean;
  homepageExportFailureVisible: boolean;
  homepageExportSuccessVisible: boolean;
  homepageExternalLinkSafetyOk: boolean;
  homepageFeaturedOverwriteCancelPreserved: boolean;
  homepageFeaturedOverwriteConfirmVisible: boolean;
  homepageLibraryReadRetryRecoveryDetail: string;
  homepageLibraryReadRetryRecoveryVisible: boolean;
  homepageLibraryRefreshRacePreserved: boolean;
  homepageProfileSaveFailureBusyVisible: boolean;
  homepageProfileSaveFailureDidNotPersist: boolean;
  homepageProfileSaveFailurePreserved: boolean;
  homepageProfileSaveFailureRetryPersisted: boolean;
  homepageProfileSaveFailureRetryVisible: boolean;
  homepageProfileSaveFailureVisible: boolean;
  homepagePublicationFilterActionRestored: boolean;
  homepagePublicationFilterActionDetail: string;
  homepageSafeLinkRelHardened: boolean;
  initialWorkCount: number | null;
  platformHttpUnsafeRejected: boolean;
  researchUnsafeUrlRejected: boolean;
  platformSecretsConcurrentWritesPreserved: boolean;
  libraryBulkTagFailureBusyVisible: boolean;
  libraryBulkTagFailureDidNotPersist: boolean;
  libraryBulkTagFailurePreserved: boolean;
  libraryBulkTagFailureVisible: boolean;
  libraryBulkSelectMixedVisible: boolean;
  libraryFilterEmptyActionRestoresResults: boolean;
  libraryFilterTabsExposeState: boolean;
  libraryMissingDeepLinkFeedbackVisible: boolean;
  libraryBulkTrashFailureBusyVisible: boolean;
  libraryBulkTrashFailureDidNotPersist: boolean;
  libraryBulkTrashFailurePreserved: boolean;
  libraryBulkTrashFailureVisible: boolean;
  libraryTrashFailureBusyVisible: boolean;
  libraryTrashFailureDidNotPersist: boolean;
  libraryTrashFailurePreserved: boolean;
  libraryTrashFailureVisible: boolean;
  libraryTrashUndoFailureBusyVisible: boolean;
  libraryTrashUndoFailureDidNotPersist: boolean;
  libraryTrashUndoFailurePreserved: boolean;
  libraryTrashUndoFailureVisible: boolean;
  libraryTrashUndoBusyVisible: boolean;
  libraryTrashUndoRecovered: boolean;
  libraryTrashUndoVisible: boolean;
  libraryTrashPurgeFailureBusyVisible: boolean;
  libraryTrashPurgeFailureDidNotPersist: boolean;
  libraryTrashPurgeFailurePreserved: boolean;
  libraryTrashPurgeFailureVisible: boolean;
  libraryTrashRestoreFailureBusyVisible: boolean;
  libraryTrashRestoreFailureDidNotPersist: boolean;
  libraryTrashRestoreFailurePreserved: boolean;
  libraryTrashRestoreFailureVisible: boolean;
  libraryTrashPurgeBusyVisible: boolean;
  libraryTrashPurgePersisted: boolean;
  libraryTrashPurgeTypedConfirmProtected: boolean;
  libraryLoadRetryAttempts: number;
  libraryLoadRetryRecoveryDetail: string;
  libraryLoadRetryRecoveryVisible: boolean;
  libraryRefreshRacePreserved: boolean;
  librarySidebarHealthHidden: boolean;
  librarySidebarMetaVisible: boolean;
  librarySidebarOrganizerActionsVisible: boolean;
  libraryCitationContextVisible: boolean;
  libraryContextualWorkflowsHidden: boolean;
  libraryCitationCopyBusyVisible: boolean;
  libraryCitationCopyFailureVisible: boolean;
  libraryCitationCopySuccessVisible: boolean;
  libraryBulkTagBusyVisible: boolean;
  libraryBulkTagPersisted: boolean;
  libraryBulkTagSuccessVisible: boolean;
  libraryCitationExportBusyVisible: boolean;
  libraryCitationExportFailureVisible: boolean;
  libraryCitationExportPmidVisible: boolean;
  libraryCitationExportSuccessVisible: boolean;
  libraryCollectionCreateFailureBusyVisible: boolean;
  libraryCollectionCreateFailureDidNotPersist: boolean;
  libraryCollectionCreateFailurePreserved: boolean;
  libraryCollectionCreateFailureVisible: boolean;
  libraryCollectionRenameFailureBusyVisible: boolean;
  libraryCollectionRenameFailureDidNotPersist: boolean;
  libraryCollectionRenameFailurePreserved: boolean;
  libraryCollectionRenameFailureVisible: boolean;
  libraryCollectionDeleteBusyVisible: boolean;
  libraryCollectionDeleteFailureBusyVisible: boolean;
  libraryCollectionDeleteFailureDidNotPersist: boolean;
  libraryCollectionDeleteFailurePreserved: boolean;
  libraryCollectionDeleteFailureVisible: boolean;
  libraryCollectionDeletePersisted: boolean;
  libraryCollectionDeleteSuccessVisible: boolean;
  libraryCollectionDeleteUndoBusyVisible: boolean;
  libraryCollectionDeleteUndoFailureBusyVisible: boolean;
  libraryCollectionDeleteUndoFailureDidNotPersist: boolean;
  libraryCollectionDeleteUndoFailurePreserved: boolean;
  libraryCollectionDeleteUndoFailureVisible: boolean;
  libraryCollectionDeleteUndoRecovered: boolean;
  libraryKeyboardNavigationVisible: boolean;
  libraryKeyboardOpenHash: string;
  libraryKeyboardOpenedId: string;
  libraryKeyboardNavigationDetail: string;
  libraryPdfUploadBusyVisible: boolean;
  libraryPdfUploadPersisted: boolean;
  libraryPdfUploadSuccessVisible: boolean;
  libraryMergeBusyVisible: boolean;
  libraryMergeFailureBusyVisible: boolean;
  libraryMergeFailureDidNotPersist: boolean;
  libraryMergeFailurePreserved: boolean;
  libraryMergeFailureVisible: boolean;
  libraryMergePersisted: boolean;
  libraryMergeSuccessVisible: boolean;
  libraryMoveToCollectionFailureBusyVisible: boolean;
  libraryMoveToCollectionFailureDidNotPersist: boolean;
  libraryMoveToCollectionFailurePreserved: boolean;
  libraryMoveToCollectionFailureVisible: boolean;
  libraryMoveToCollectionBusyVisible: boolean;
  libraryMoveToCollectionPersisted: boolean;
  libraryMoveToCollectionSuccessVisible: boolean;
  libraryTagDeleteBusyVisible: boolean;
  libraryTagDeleteFailureBusyVisible: boolean;
  libraryTagDeleteFailureDidNotPersist: boolean;
  libraryTagDeleteFailurePreserved: boolean;
  libraryTagDeleteFailureVisible: boolean;
  libraryTagDeletePersisted: boolean;
  libraryTagDeleteSuccessVisible: boolean;
  libraryTagDeleteUndoBusyVisible: boolean;
  libraryTagDeleteUndoFailureBusyVisible: boolean;
  libraryTagDeleteUndoFailureDidNotPersist: boolean;
  libraryTagDeleteUndoFailurePreserved: boolean;
  libraryTagDeleteUndoFailureVisible: boolean;
  libraryTagDeleteUndoRecovered: boolean;
  libraryTagRenameFailureBusyVisible: boolean;
  libraryTagRenameFailureDidNotPersist: boolean;
  libraryTagRenameFailurePreserved: boolean;
  libraryTagRenameFailureVisible: boolean;
  libraryTrashRestoreBusyVisible: boolean;
  libraryTrashRestoreSuccessVisible: boolean;
  metadataInvalidYearBlocked: boolean;
  metadataInvalidYearErrorVisible: boolean;
  metadataInvalidYearPreserved: boolean;
  metadataDiscardCancelPreserved: boolean;
  metadataSaveFailureVisible: boolean;
  metadataSaveFailurePreserved: boolean;
  metadataSaveFailureDidNotPersist: boolean;
  metadataSaveBusyVisible: boolean;
  metadataSavePersisted: boolean;
  libraryPdfAttachmentVisible: boolean;
  libraryReadingStatusBusyVisible: boolean;
  libraryReadingStatusFailureBusyVisible: boolean;
  libraryReadingStatusFailureDidNotPersist: boolean;
  libraryReadingStatusFailurePreserved: boolean;
  libraryReadingStatusFailureVisible: boolean;
  libraryReadingStatusPersisted: boolean;
  libraryReadingStatusSuccessVisible: boolean;
  libraryStarBusyVisible: boolean;
  libraryStarFailureBusyVisible: boolean;
  libraryStarFailureDidNotPersist: boolean;
  libraryStarFailurePreserved: boolean;
  libraryStarFailureVisible: boolean;
  libraryStarPersisted: boolean;
  libraryStarSuccessVisible: boolean;
  quickAddCompositionIgnored: boolean;
  quickImportConfirmCommitBusyVisible: boolean;
  quickImportConfirmDialogVisible: boolean;
  quickImportConfirmCommitPersisted: boolean;
  librarySearchShortcutLabel: string;
  librarySearchShortcutFocused: boolean;
  librarySearchNonPlatformShortcutIgnored: boolean;
  populatedStateVisible: boolean;
  quickDropImportConfirmBusyVisible: boolean;
  quickDropImportFailureBusyVisible: boolean;
  quickDropImportFailureDidNotPersist: boolean;
  quickDropImportFailurePreserved: boolean;
  quickDropImportFailureVisible: boolean;
  quickDropImportConfirmPersisted: boolean;
  quickDropImportConfirmPmidPersisted: boolean;
  quickDropImportConfirmSuccessVisible: boolean;
  quickDropImportCount: number | null;
  quickDropImportPreviewVisible: boolean;
  readingStatus: string | null;
  readerAutoReadingStatusPersisted: boolean;
  readerBrokenAttachmentCount: number | null;
  readerBrokenBlobRecoveryVisible: boolean;
  readerBrokenBlobVisible: boolean;
  readerBrokenHash: string;
  readerAnnotationCreateFailureBusyVisible: boolean;
  readerAnnotationCreateFailureDidNotPersist: boolean;
  readerAnnotationCreateFailurePreserved: boolean;
  readerAnnotationCreateFailureVisible: boolean;
  readerAnnotationDeleteBusyVisible: boolean;
  readerAnnotationDeleteCancelPreserved: boolean;
  readerAnnotationDeleteConfirmVisible: boolean;
  readerAnnotationDeleteFailureBusyVisible: boolean;
  readerAnnotationDeleteFailureDidNotPersist: boolean;
  readerAnnotationDeleteFailurePreserved: boolean;
  readerAnnotationDeleteFailureVisible: boolean;
  readerAnnotationDeleteSuccessVisible: boolean;
  readerAnnotationDeleteUndoFailureBusyVisible: boolean;
  readerAnnotationDeleteUndoFailureDidNotPersist: boolean;
  readerAnnotationDeleteUndoFailurePreserved: boolean;
  readerAnnotationDeleteUndoFailureVisible: boolean;
  readerAnnotationDeleteUndoBusyVisible: boolean;
  readerAnnotationDeleteUndoRecovered: boolean;
  readerCommentDirtyExportBlocked: boolean;
  readerCommentDirtyExportDownloadPrevented: boolean;
  readerCommentDirtyExportMessageVisible: boolean;
  readerCommentDraftCancelPreserved: boolean;
  readerCommentDraftConfirmVisible: boolean;
  readerCommentDraftDiscarded: boolean;
  readerCommentSaveFailureDidNotPersist: boolean;
  readerCommentSaveFailurePreserved: boolean;
  readerCommentSaveFailureVisible: boolean;
  readerCommentSaveBusyVisible: boolean;
  readerCommentSavePersisted: boolean;
  readerCommentShortcutCompositionIgnored: boolean;
  readerArchivedAnnotationRows: number;
  readerArchivedAttachmentRows: number;
  readerArchivedBackToTrashFilterVisible: boolean;
  readerArchivedBackToTrashHash: string;
  readerArchivedBackToTrashLocated: boolean;
  readerArchivedBackToTrashRowVisible: boolean;
  readerArchivedBackToTrashSearchCleared: boolean;
  readerArchivedCanvasBlocked: boolean;
  readerArchivedForbiddenActionsHidden: boolean;
  readerArchivedHash: string;
  readerArchivedRecoveryCtaVisible: boolean;
  readerArchivedStateVisible: boolean;
  readerCanvasVisible: boolean;
  readerCorruptAttachmentCount: number | null;
  readerCorruptPdfRecoveryVisible: boolean;
  readerCorruptPdfVisible: boolean;
  readerCorruptHash: string;
  readerErrorVisible: boolean;
  readerFindFulltextHandoffNavigated: boolean;
  readerFindFulltextHandoffHash: string;
  readerFindFulltextHandoffStatusVisible: boolean;
  readerFindFulltextHandoffTargetVisible: boolean;
  readerFindFulltextHandoffView: string;
  readerHash: string;
  readerLoadRetryAttempts: number;
  readerLoadRetryRecoveryDetail: string;
  readerLoadRetryRecoveryVisible: boolean;
  readerMissingBackToLibraryHash: string;
  readerMissingBackToLibraryDetail: string;
  readerMissingBackToLibraryLocated: boolean;
  readerMissingBackToLibraryPageText: string;
  readerMissingBackToLibraryRowVisible: boolean;
  readerMissingBackToLibrarySearchCleared: boolean;
  readerMissingBackToLibraryVisibleRows: string;
  readerMissingHash: string;
  readerMissingPdfAttachBusyVisible: boolean;
  readerMissingPdfAttachCtaVisible: boolean;
  readerMissingPdfRecoveryVisible: boolean;
  readerMissingPdfVisible: boolean;
  readerNoWorkClearsDocument: boolean;
  readerPageBadgeVisible: boolean;
  readerRecoveredAttachmentCount: number | null;
  readerRecoveredPdfVisible: boolean;
  readerSnippetSaveFailureBusyVisible: boolean;
  readerSnippetSaveFailureDidNotPersist: boolean;
  readerSnippetSaveFailurePreserved: boolean;
  readerSnippetSaveFailureVisible: boolean;
  readerSnippetSaveBusyVisible: boolean;
  readerSnippetSavePersisted: boolean;
  readerTabDeepLinkSyncVisible: boolean;
  readerTitleVisible: boolean;
  readerTranslationClipboardMatches: boolean;
  readerTranslationCopyBusyVisible: boolean;
  readerTranslationCopyFeedbackVisible: boolean;
  readerTranslationCopyStatusText: string;
  readerTranslationInlineDocumentVisible: boolean;
  readerTranslationSelectionPopoverVisible: boolean;
  readerTranslationSplitDocumentsVisible: boolean;
  readerTranslationStartBusyVisible: boolean;
  readerTranslationStartErrorVisible: boolean;
  readerTranslationSettingsCtaNavigates: boolean;
  readerTranslationSettingsCtaTargetsSection: boolean;
  readerTranslationSettingsCtaVisible: boolean;
  routeCrashBoundaryVisible: boolean;
  routeCrashRecoveredLibraryVisible: boolean;
  routeCrashRecoveryHash: string;
  routeCrashShellVisible: boolean;
  searchClearButtonRestoresResults: boolean;
  searchDataPathOk: boolean;
  searchEmptyActionRestoresResults: boolean;
  searchEmptyStateVisible: boolean;
  searchEscapeClearsQuery: boolean;
  searchResultVisible: boolean;
  settingsBackupExportBusyVisible: boolean;
  settingsBackupExportAriaBusyVisible: boolean;
  settingsBackupExportEphemeralDataExcluded: boolean;
  settingsBackupExportFailureVisible: boolean;
  settingsBackupExportRecencyVisible: boolean;
  settingsBackupExportSecretsSanitized: boolean;
  settingsBackupExportSuccessVisible: boolean;
  settingsBackupImportAiJobsPortable: boolean;
  settingsBackupImportEphemeralDataExcluded: boolean;
  settingsBackupImportIgnoredOnlyExplained: boolean;
  settingsBackupImportBusyVisible: boolean;
  settingsBackupImportAttachmentIdCollisionRemapped: boolean;
  settingsBackupImportAttachmentDeactivated: boolean;
  settingsBackupImportCancelPreserved: boolean;
  settingsBackupImportConfirmVisible: boolean;
  settingsBackupImportFailureBusyVisible: boolean;
  settingsBackupImportFailureDidNotPersist: boolean;
  settingsBackupImportFailureRetryVisible: boolean;
  settingsBackupImportFailureVisible: boolean;
  settingsBackupImportLibraryScoped: boolean;
  settingsBackupImportPersisted: boolean;
  settingsBackupImportRejectsFutureVersionVisible: boolean;
  settingsBackupImportRejectsInvalidVisible: boolean;
  settingsBackupImportReattachAnnotationRestored: boolean;
  settingsBackupImportRuntimeSkipExplained: boolean;
  settingsBackupImportSearchIndexed: boolean;
  settingsBackupImportSettingsSanitized: boolean;
  settingsBackupImportStableIdMerged: boolean;
  settingsBackupImportSuccessVisible: boolean;
  settingsAiTestFailureBusyVisible: boolean;
  settingsAiTestFailureConfigSaved: boolean;
  settingsAiTestFailureRetryVisible: boolean;
  settingsAiTestFailureVisible: boolean;
  settingsAiSaveFailureDidNotPersist: boolean;
  settingsAiSaveFailurePreserved: boolean;
  settingsAiSaveFailureVisible: boolean;
  settingsInlineSecretMigrationFailurePreserved: boolean;
  settingsInlineSecretMigrationRetrySanitized: boolean;
  settingsInlineSecretMigrationVisible: boolean;
  settingsAiUrlCredentialsRejected: boolean;
  settingsAiUrlInvalidDidNotPersist: boolean;
  settingsAiUrlInvalidVisible: boolean;
  settingsAiUrlNormalized: boolean;
  settingsTranslateSaveFailureDidNotPersist: boolean;
  settingsTranslateSaveFailurePreserved: boolean;
  settingsTranslateSaveFailureVisible: boolean;
  settingsTranslateProviderValidationDidNotPersist: boolean;
  settingsTranslateProviderValidationVisible: boolean;
  settingsSyncRunFailureBusyVisible: boolean;
  settingsSyncRunFailureConfigPreserved: boolean;
  settingsSyncRunActionableFailureVisible: boolean;
  settingsSyncRunFailureRetryVisible: boolean;
  settingsSyncRunFailureVisible: boolean;
  settingsSyncRunQuotaGuidanceVisible: boolean;
  settingsSyncUrlCredentialsRejected: boolean;
  settingsSyncUrlInvalidDidNotPersist: boolean;
  settingsSyncUrlInvalidVisible: boolean;
  settingsSyncUrlNormalized: boolean;
  settingsSyncSaveFailureDidNotPersist: boolean;
  settingsSyncSaveFailurePreserved: boolean;
  settingsSyncSaveFailureVisible: boolean;
  settingsBusySaveAriaVisible: boolean;
  settingsBusyNavigationCancelPreserved: boolean;
  settingsBusyNavigationConfirmVisible: boolean;
  settingsBusySaveControlsDisabled: boolean;
  settingsAiLoadRetryAttempts: number;
  settingsAiLoadRetryRecoveryDetail: string;
  settingsAiLoadRetryRecoveryVisible: boolean;
  settingsInitialLoadCompleted: boolean;
  settingsSyncLoadRetryAttempts: number;
  settingsSyncLoadRetryRecoveryDetail: string;
  settingsSyncLoadRetryRecoveryVisible: boolean;
  settingsTargetTranslateSectionVisible: boolean;
  settingsTranslateLoadRetryAttempts: number;
  settingsTranslateLoadRetryRecoveryDetail: string;
  settingsTranslateLoadRetryRecoveryVisible: boolean;
  settingsTranslationCacheClearBusyVisible: boolean;
  settingsTranslationCacheClearCancelled: boolean;
  settingsTranslationCacheClearConfirmVisible: boolean;
  settingsTranslationCacheClearPersisted: boolean;
  settingsTranslationCacheClearSuccessVisible: boolean;
  sentinelAddCompositionIgnored: boolean;
  sentinelAddBusyVisible: boolean;
  sentinelDeleteFailureBusyVisible: boolean;
  sentinelDeleteFailureDidNotPersist: boolean;
  sentinelDeleteFailurePreserved: boolean;
  sentinelDeleteFailureVisible: boolean;
  sentinelDeleteUndoFailureBusyVisible: boolean;
  sentinelDeleteUndoFailureDidNotPersist: boolean;
  sentinelDeleteUndoFailurePreserved: boolean;
  sentinelDeleteUndoFailureVisible: boolean;
  sentinelDeleteUndoBusyVisible: boolean;
  sentinelDeleteUndoRestored: boolean;
  sentinelDeleteUndoVisible: boolean;
  sentinelDeletedDoiRestored: boolean;
  sentinelDeletedDoiRestoredCount: number | null;
  sentinelDuplicateDoiBlocked: boolean;
  sentinelDuplicateDoiCount: number | null;
  sentinelDuplicateDoiMessageVisible: boolean;
  sentinelLastErrorVisible: boolean;
  sentinelTaskCheckBusyVisible: boolean;
  sentinelManualFailureRecorded: boolean;
  sentinelManualFailureVisible: boolean;
  sentinelFilterEmptyActionRestoresResults: boolean;
  sentinelLoadRetryAttempts: number;
  sentinelLoadRetryRecoveryDetail: string;
  sentinelLoadRetryRecoveryVisible: boolean;
  sentinelRefreshRacePreserved: boolean;
  seededWorkCount: number | null;
  snippetCardCopyAriaBusyVisible: boolean;
  snippetCardCopyBusyVisible: boolean;
  snippetCardCopyCitationAriaBusyVisible: boolean;
  snippetCardCopyCitationBusyVisible: boolean;
  snippetDeleteAriaBusyVisible: boolean;
  snippetDeleteBusyVisible: boolean;
  snippetDeleteFailureBusyVisible: boolean;
  snippetDeleteFailureDidNotPersist: boolean;
  snippetDeleteFailurePreserved: boolean;
  snippetDeleteFailureVisible: boolean;
  snippetDeleteSuccessVisible: boolean;
  snippetDeleteUndoFailureBusyVisible: boolean;
  snippetDeleteUndoFailureDidNotPersist: boolean;
  snippetDeleteUndoFailurePreserved: boolean;
  snippetDeleteUndoFailureVisible: boolean;
  snippetDeleteUndoBusyVisible: boolean;
  snippetDeleteUndoRecovered: boolean;
  snippetDeleteUndoVisible: boolean;
  snippetEmptyLatestReaderHash: string;
  snippetEmptyLatestReaderOpened: boolean;
  snippetEmptyLatestReaderVisible: boolean;
  snippetFilterEmptyActionRestoresResults: boolean;
  snippetLoadRetryAttempts: number;
  snippetLoadRetryRecoveryDetail: string;
  snippetLoadRetryRecoveryVisible: boolean;
  snippetDirtyCopyBlocked: boolean;
  snippetDirtyCopyClipboardPreserved: boolean;
  snippetDirtyCopyMessageVisible: boolean;
  snippetEditorClosedAfterShortcut: boolean;
  snippetEscapeCompositionIgnored: boolean;
  snippetRefreshRacePreserved: boolean;
  snippetSavedNote: string | null;
  snippetSaveCompositionIgnored: boolean;
  snippetSaveFailureDidNotPersist: boolean;
  snippetSaveFailurePreserved: boolean;
  snippetSaveFailureVisible: boolean;
  snippetShortcutEventPrevented: boolean;
  snippetShortcutSaveVisible: boolean;
  snippetVisibleCopyAriaBusyVisible: boolean;
  snippetVisibleCopyBusyVisible: boolean;
  snippetVisibleCopySuccessVisible: boolean;
  themeFallbackApplied: boolean;
  themeStoredInvalid: boolean;
  title: string;
}

interface SmokeCheck {
  detail?: string;
  name: string;
  pass: boolean;
}

interface SecretsFileSmoke {
  encryptedEncoding: boolean;
  error?: string;
  exists: boolean;
  mode: string;
  plaintextAbsent: boolean;
  privateMode: boolean;
}

function summarize(value: string, limit = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function emitSmokeResult(result: unknown, code: 0 | 1): void {
  console.log(`${SMOKE_RESULT_PREFIX}${JSON.stringify(result)}`);
  setTimeout(() => app.exit(code), 50);
}

async function inspectSecretsFile(): Promise<SecretsFileSmoke> {
  const file = join(app.getPath("userData"), "secrets.json");
  try {
    const [info, raw] = await Promise.all([stat(file), readFile(file, "utf8")]);
    const modeBits = info.mode & 0o777;
    return {
      encryptedEncoding: raw.includes('"v1:') && !raw.includes('"raw:'),
      exists: true,
      mode: modeBits.toString(8).padStart(3, "0"),
      plaintextAbsent: !raw.includes("smoke-ai-busy-key"),
      privateMode: process.platform === "win32" || (modeBits & 0o077) === 0,
    };
  } catch (error) {
    return {
      encryptedEncoding: false,
      error: error instanceof Error ? error.message : String(error),
      exists: false,
      mode: "missing",
      plaintextAbsent: false,
      privateMode: false,
    };
  }
}

export function setupSmokeHarness(win: BrowserWindow): void {
  if (!SMOKE_MODE) return;

  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const timeout = setTimeout(() => {
    emitSmokeResult(
      {
        ok: false,
        reason: "timeout",
        consoleErrors,
        consoleWarnings,
      },
      1,
    );
  }, SMOKE_TIMEOUT_MS);

  const finish = (result: unknown, code: 0 | 1) => {
    clearTimeout(timeout);
    emitSmokeResult(result, code);
  };

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (message.includes("AURASCHOLAR_SMOKE_ROUTE_CRASH")) return;
    const entry = `${message} (${sourceId}:${line})`;
    if (level >= 3) consoleErrors.push(entry);
    else if (level === 2) consoleWarnings.push(entry);
  });

  win.webContents.once("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    finish(
      {
        ok: false,
        reason: "did-fail-load",
        errorCode,
        errorDescription,
        validatedURL,
        consoleErrors,
        consoleWarnings,
      },
      1,
    );
  });

  let smokeStorageSeeded = false;

  win.webContents.on("did-finish-load", () => {
    if (!smokeStorageSeeded) {
      smokeStorageSeeded = true;
      void win.webContents
        .executeJavaScript(
          String.raw`
            try {
              localStorage.setItem("theme", "__aurascholar-invalid-theme__");
              localStorage.setItem("ai-settings", "{not-valid-json");
            } catch {}
            setTimeout(() => location.reload(), 0);
            true;
          `,
          true,
        )
        .catch((error: unknown) => {
          finish(
            {
              ok: false,
              reason: "smoke-storage-seed-failed",
              error: error instanceof Error ? error.message : String(error),
              consoleErrors,
              consoleWarnings,
            },
            1,
          );
        });
      return;
    }

    const script = String.raw`
      (async () => {
        const SAMPLE = {
          author: "Ada Lovelace",
          attachmentId: "smoke-attachment-pdf",
          doi: "10.4242/aurascholar.smoke",
          pmid: "42000042",
          tag: "Smoke QA",
          title: "Extreme Consumer Research Experience",
          venue: "Journal of Product-Grade Research",
          workId: "smoke-work-extreme-c-ux",
          authorId: "smoke-author-ada",
          annotationId: "smoke-annotation-reader-delete-confirm",
          tagId: "smoke-tag-qa"
        };
        const READER_ANNOTATION_DELETE_FAILURE_SMOKE = {
          error: "Smoke reader annotation delete failure"
        };
        const READER_ANNOTATION_RESTORE_FAILURE_SMOKE = {
          error: "Smoke reader annotation restore failure"
        };
        const LIBRARY_SENTINEL_LINK_SMOKE = {
          id: "smoke-sentinel-library-link",
          doi: SAMPLE.doi,
          title: SAMPLE.title
        };
        const TAG_MANAGER_SMOKE = {
          id: "smoke-tag-manager-action",
          name: "Smoke Tag Manager Action",
          color: "#0f766e"
        };
        const TAG_RENAME_FAILURE_SMOKE = {
          name: "Smoke Tag Rename Failure",
          error: "Smoke tag rename failure"
        };
        const TAG_DELETE_FAILURE_SMOKE = {
          error: "Smoke tag delete failure"
        };
        const TAG_RESTORE_FAILURE_SMOKE = {
          error: "Smoke tag restore failure"
        };
        const COLLECTION_MANAGER_SMOKE = {
          id: "smoke-collection-manager-action",
          name: "Smoke Collection Manager Action"
        };
        const COLLECTION_CREATE_FAILURE_SMOKE = {
          name: "Smoke Collection Create Failure",
          error: "Smoke collection create failure"
        };
        const COLLECTION_RENAME_FAILURE_SMOKE = {
          name: "Smoke Collection Rename Failure",
          error: "Smoke collection rename failure"
        };
        const COLLECTION_DELETE_FAILURE_SMOKE = {
          error: "Smoke collection delete failure"
        };
        const COLLECTION_RESTORE_FAILURE_SMOKE = {
          error: "Smoke collection restore failure"
        };
        const MOVE_COLLECTION_SMOKE = {
          id: "smoke-collection-move-target",
          name: "Smoke Move Target"
        };
        const MOVE_COLLECTION_FAILURE_SMOKE = {
          error: "Smoke move collection rollback failure",
          query: "Atomic Move Failure",
          works: [
            {
              author: "Emmy Noether",
              doi: "10.4242/aurascholar.move-failure-a",
              title: "Atomic Move Failure Alpha",
              venue: "Journal of Reliable Collections",
              workId: "smoke-work-move-failure-a",
              authorId: "smoke-author-emmy"
            },
            {
              author: "Ada Lovelace",
              doi: "10.4242/aurascholar.move-failure-b",
              title: "Atomic Move Failure Beta",
              venue: "Journal of Reliable Collections",
              workId: "smoke-work-move-failure-b",
              authorId: "smoke-author-ada-move"
            }
          ]
        };
        const BULK_TAG_SMOKE = {
          name: "Smoke Bulk Tag"
        };
        const BULK_TAG_FAILURE_SMOKE = {
          error: "Smoke bulk tag rollback failure",
          name: "Smoke Bulk Tag Failure",
          query: "Atomic Bulk Tag Failure",
          works: [
            {
              author: "Katherine Johnson",
              doi: "10.4242/aurascholar.bulk-tag-failure-a",
              title: "Atomic Bulk Tag Failure Alpha",
              venue: "Journal of Reliable Tagging",
              workId: "smoke-work-bulk-tag-failure-a",
              authorId: "smoke-author-katherine-tag"
            },
            {
              author: "Dorothy Vaughan",
              doi: "10.4242/aurascholar.bulk-tag-failure-b",
              title: "Atomic Bulk Tag Failure Beta",
              venue: "Journal of Reliable Tagging",
              workId: "smoke-work-bulk-tag-failure-b",
              authorId: "smoke-author-dorothy"
            }
          ]
        };
        const MERGE_SMOKE = {
          primaryId: "smoke-work-merge-primary",
          primaryTitle: "Smoke Merge Primary Paper",
          primaryDoi: "10.4242/aurascholar.merge-primary",
          duplicateId: "smoke-work-merge-duplicate",
          duplicateTitle: "Smoke Merge Duplicate Paper",
          duplicateDoi: "10.4242/aurascholar.merge-duplicate"
        };
        const MERGE_FAILURE_SMOKE = {
          error: "Smoke merge rollback failure",
          primaryId: "smoke-work-merge-failure-primary",
          primaryTitle: "Atomic Merge Failure Primary",
          primaryDoi: "10.4242/aurascholar.merge-failure-primary",
          duplicateId: "smoke-work-merge-failure-duplicate",
          duplicateTitle: "Atomic Merge Failure Duplicate",
          duplicateDoi: "10.4242/aurascholar.merge-failure-duplicate",
          attachmentId: "smoke-attachment-merge-failure",
          attachmentSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          query: "Atomic Merge Failure"
        };
        const MISSING_PDF = {
          author: "Grace Hopper",
          doi: "10.4242/aurascholar.missing-pdf",
          title: "Reader Recovery Without Full Text",
          venue: "Journal of Missing Full Text",
          workId: "smoke-work-missing-pdf",
          authorId: "smoke-author-grace"
        };
        const LIBRARY_UPLOAD_PDF = {
          author: "Mary Jackson",
          doi: "10.4242/aurascholar.library-upload-pdf",
          title: "Library Detail PDF Upload Feedback",
          venue: "Journal of Attachment UX",
          workId: "smoke-work-library-upload-pdf",
          authorId: "smoke-author-mary"
        };
        const BROKEN_BLOB = {
          attachmentId: "smoke-attachment-broken-blob",
          author: "Katherine Johnson",
          doi: "10.4242/aurascholar.broken-blob",
          sha: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          title: "Reader Recovery From Broken Local Blob",
          venue: "Journal of Local Resilience",
          workId: "smoke-work-broken-blob",
          authorId: "smoke-author-katherine"
        };
        const CORRUPT_PDF = {
          attachmentId: "smoke-attachment-corrupt-pdf",
          author: "Margaret Hamilton",
          doi: "10.4242/aurascholar.corrupt-pdf",
          title: "Reader Recovery From Corrupt PDF",
          venue: "Journal of Parse Resilience",
          workId: "smoke-work-corrupt-pdf",
          authorId: "smoke-author-margaret"
        };
        const READER_ARCHIVED_SMOKE = {
          annotationId: "smoke-annotation-reader-archived",
          attachmentId: "smoke-attachment-reader-archived",
          author: "Annie Easley",
          doi: "10.4242/aurascholar.reader-archived",
          title: "Archived Reader Link Should Restore First",
          venue: "Journal of Trustworthy Reader States",
          workId: "smoke-work-reader-archived",
          authorId: "smoke-author-annie"
        };
        const TRASH_ACTION_SMOKE = {
          author: "Barbara Liskov",
          doi: "10.4242/aurascholar.trash-action",
          title: "Recoverable Library Asset Actions",
          venue: "Journal of Safe Library Operations",
          workId: "smoke-work-trash-action",
          authorId: "smoke-author-barbara"
        };
        const TRASH_FAILURE_SMOKE = {
          author: "Evelyn Boyd Granville",
          doi: "10.4242/aurascholar.trash-failure",
          title: "Recoverable Trash Failure Feedback",
          venue: "Journal of Durable Library UX",
          workId: "smoke-work-trash-failure",
          authorId: "smoke-author-evelyn"
        };
        const TRASH_FAILURE_ERROR_SMOKE = {
          error: "Smoke library trash failure"
        };
        const BULK_TRASH_FAILURE_SMOKE = {
          error: "Smoke library bulk trash rollback failure",
          query: "Atomic Bulk Trash Failure",
          works: [
            {
              author: "Maryam Mirzakhani",
              doi: "10.4242/aurascholar.bulk-trash-failure-a",
              title: "Atomic Bulk Trash Failure Alpha",
              venue: "Journal of Atomic Library UX",
              workId: "smoke-work-bulk-trash-failure-a",
              authorId: "smoke-author-maryam"
            },
            {
              author: "Sofya Kovalevskaya",
              doi: "10.4242/aurascholar.bulk-trash-failure-b",
              title: "Atomic Bulk Trash Failure Beta",
              venue: "Journal of Atomic Library UX",
              workId: "smoke-work-bulk-trash-failure-b",
              authorId: "smoke-author-sofya"
            }
          ]
        };
        const TRASH_UNDO_SMOKE = {
          author: "Frances Allen",
          doi: "10.4242/aurascholar.trash-undo",
          title: "Instant Undo For Accidental Library Trash",
          venue: "Journal of Reversible UX",
          workId: "smoke-work-trash-undo",
          authorId: "smoke-author-frances"
        };
        const TRASH_UNDO_RESTORE_FAILURE_SMOKE = {
          error: "Smoke library trash undo restore failure"
        };
        const TRASH_RESTORE_FAILURE_SMOKE = {
          error: "Smoke library trash restore rollback failure",
          query: "Atomic Trash Restore Failure",
          works: [
            {
              author: "Joan Clarke",
              doi: "10.4242/aurascholar.trash-restore-failure-a",
              title: "Atomic Trash Restore Failure Alpha",
              venue: "Journal of Recoverable Library UX",
              workId: "smoke-work-trash-restore-failure-a",
              authorId: "smoke-author-joan"
            },
            {
              author: "Hedy Lamarr",
              doi: "10.4242/aurascholar.trash-restore-failure-b",
              title: "Atomic Trash Restore Failure Beta",
              venue: "Journal of Recoverable Library UX",
              workId: "smoke-work-trash-restore-failure-b",
              authorId: "smoke-author-hedy"
            }
          ]
        };
        const TRASH_PURGE_SMOKE = {
          author: "Grace Hopper",
          doi: "10.4242/aurascholar.trash-purge",
          title: "Typed Confirmation For Permanent Delete",
          venue: "Journal of Irreversible UX",
          workId: "smoke-work-trash-purge",
          authorId: "smoke-author-grace"
        };
        const TRASH_PURGE_FAILURE_SMOKE = {
          error: "Smoke library trash purge rollback failure",
          query: "Atomic Trash Purge Failure",
          works: [
            {
              author: "Radia Perlman",
              doi: "10.4242/aurascholar.trash-purge-failure-a",
              title: "Atomic Trash Purge Failure Alpha",
              venue: "Journal of Reversible Permanence",
              workId: "smoke-work-trash-purge-failure-a",
              authorId: "smoke-author-radia"
            },
            {
              author: "Karen Sparck Jones",
              doi: "10.4242/aurascholar.trash-purge-failure-b",
              title: "Atomic Trash Purge Failure Beta",
              venue: "Journal of Reversible Permanence",
              workId: "smoke-work-trash-purge-failure-b",
              authorId: "smoke-author-karen"
            }
          ]
        };
        const GRAPH_SMOKE = {
          centerDoi: "10.4242/aurascholar.graph-smoke",
          centerTitle: "Smoke Graph Center Paper",
          referenceDoi: " ",
          referenceTitle: "Smoke Graph Reference Node",
          successDoi: "10.4242/aurascholar.graph-import-success",
          successTitle: "Smoke Graph Import Success Node",
          raceOldDoi: "10.4242/aurascholar.graph-race-old",
          raceOldTitle: "Smoke Graph Race Stale Center",
          raceNewDoi: "10.4242/aurascholar.graph-race-new",
          raceNewTitle: "Smoke Graph Race Current Center",
          deepLinkDoi: "10.4242/aurascholar.graph-deeplink",
          deepLinkTitle: "Smoke Graph Deep Link Current Center",
          retryDoi: "10.4242/aurascholar.graph-retry",
          retryTitle: "Smoke Graph Retry Recovered Center",
        };
        const SNIPPET_SMOKE = {
          id: "smoke-snippet-keyboard",
          quote: "Smoke snippet quote for keyboard editing",
          noteDraft: "Smoke snippet note saved by keyboard shortcut"
        };
        const SNIPPET_DELETE_FAILURE_SMOKE = {
          error: "Smoke snippets delete failure"
        };
        const SNIPPET_RESTORE_FAILURE_SMOKE = {
          error: "Smoke snippets restore failure"
        };
        const SAVED_SEARCH_SMOKE = {
          id: "smoke-saved-search-duplicate",
          query: "Composition Discovery Search"
        };
        const SAVED_SEARCH_MANUAL_SMOKE = {
          id: "smoke-saved-search-manual-check",
          query: "Smoke Manual Saved Search Check"
        };
        const SAVED_SEARCH_SAVE_FAILURE_SMOKE = {
          query: "Smoke Saved Search Save Failure",
          error: "Smoke saved search save failure"
        };
        const SAVED_SEARCH_DELETE_FAILURE_SMOKE = {
          error: "Smoke saved search delete failure"
        };
        const SAVED_SEARCH_RESTORE_FAILURE_SMOKE = {
          error: "Smoke saved search restore failure"
        };
        const SAVED_SEARCH_HOME_OPEN_SMOKE = {
          id: "smoke-saved-search-home-open",
          query: "Smoke Home Saved Search Open"
        };
        const SAVED_SEARCH_ERROR_SMOKE = {
          id: "smoke-saved-search-last-error",
          query: "Smoke Saved Search Last Error",
          error: "Smoke saved search network failure"
        };
        const DISCOVERY_TRUST_SMOKE = {
          query: "Smoke Discovery Trust Signals",
          title: "Trustworthy Discovery Result With Open Full Text",
          doi: "10.4242/aurascholar.discovery-trust",
          abstract:
            "A smoke paper for checking provenance, confidence, identifiers, and open full text cues.",
          year: 2026,
          venueName: "Journal of Discovery UX",
          oaPdfUrl: "https://example.test/discovery-trust.pdf",
          citedByCount: 42,
          importResult: {
            delayMs: 80,
            doi: "10.4242/aurascholar.discovery-trust",
            pdfFetched: false,
            workId: "smoke-work-discovery-import"
          }
        };
        const DISCOVERY_LOAD_MORE_SMOKE = {
          query: "Smoke Discovery Load More Retry",
          firstDoi: "10.4242/aurascholar.discovery-load-more-first",
          firstTitle: "Smoke Discovery Load More First Page",
          recoveredDoi: "10.4242/aurascholar.discovery-load-more-recovered",
          recoveredTitle: "Smoke Discovery Load More Retry Recovered",
          error: "Smoke discovery load more transient failure"
        };
        const DISCOVERY_SEARCH_RETRY_SMOKE = {
          query: "Smoke Discovery Search Retry",
          doi: "10.4242/aurascholar.discovery-search-retry",
          title: "Smoke Discovery Search Retry Recovered",
          error: "Smoke discovery search transient failure"
        };
        const SENTINEL_DUPLICATE_SMOKE = {
          id: "smoke-sentinel-duplicate-doi",
          doi: "10.4242/aurascholar.sentinel-duplicate",
          title: "Smoke Duplicate Sentinel DOI"
        };
        const SENTINEL_RESTORE_SMOKE = {
          id: "smoke-sentinel-restore-doi",
          doi: "10.4242/aurascholar.sentinel-restore",
          title: "Smoke Restorable Sentinel DOI"
        };
        const SENTINEL_ERROR_SMOKE = {
          id: "smoke-sentinel-last-error",
          doi: "10.4242/aurascholar.sentinel-error",
          title: "Smoke Sentinel Last Error",
          error: "Smoke sentinel network failure"
        };
        const SENTINEL_MANUAL_FAILURE_SMOKE = {
          id: "smoke-sentinel-manual-failure",
          doi: "10.4242/aurascholar.sentinel-manual-failure",
          title: "Smoke Sentinel Manual Failure",
          errorFragment: "JSON"
        };
        const SENTINEL_DELETE_UNDO_SMOKE = {
          id: "smoke-sentinel-delete-undo",
          doi: "10.4242/aurascholar.sentinel-delete-undo",
          title: "Smoke Sentinel Delete Undo"
        };
        const SENTINEL_DELETE_FAILURE_SMOKE = {
          error: "Smoke sentinel delete failure"
        };
        const SENTINEL_RESTORE_FAILURE_SMOKE = {
          error: "Smoke sentinel restore failure"
        };
        const DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-duplicate-site",
          name: "Smoke Duplicate Site",
          homeUrl: "https://smoke-site.example/",
          searchUrl: "https://smoke-site.example/search?q="
        };
        const DISCOVERY_CREDENTIAL_SITE_SMOKE = {
          name: "Smoke Credential Site",
          homeUrl: "https://smoke-user:smoke-pass@credential-smoke-site.example/",
          searchUrl: "https://credential-smoke-site.example/search?q="
        };
        const REMOVABLE_DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-removable-site",
          name: "Smoke Removable Site",
          homeUrl: "https://removable-smoke-site.example/",
          searchUrl: "https://removable-smoke-site.example/search?q="
        };
        const DISCOVERY_SITE_REMOVE_FAILURE_SMOKE = {
          error: "Smoke discovery site remove failure"
        };
        const DISCOVERY_SITE_RESTORE_FAILURE_SMOKE = {
          error: "Smoke discovery site restore failure"
        };
        const HIDDEN_DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-hidden-duplicate-site",
          name: "Smoke Hidden Duplicate Site",
          homeUrl: "https://hidden-smoke-site.example/",
          searchUrl: "https://hidden-smoke-site.example/search?q="
        };
        const MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-manual-hidden-site",
          name: "Smoke Manual Hidden Site",
          homeUrl: "https://manual-hidden-smoke-site.example/",
          searchUrl: "https://manual-hidden-smoke-site.example/search?q="
        };
        const DISCOVERY_PROXY_SITE_SMOKE = {
          id: "builtin:google-scholar",
          name: "Google Scholar"
        };
        const DISCOVERY_PROXY_CONFIG_SMOKE = "http://127.0.0.1:7890/";
        const DISCOVERY_PROXY_CREDENTIAL_SMOKE = "http://smoke-user:smoke-pass@127.0.0.1:7890/";
        const DISCOVERY_EZPROXY_CONFIG_SMOKE =
          "https://login.ezproxy.example.edu/login?url=";
        const DISCOVERY_EZPROXY_CREDENTIAL_SMOKE =
          "https://smoke-user:smoke-pass@login.ezproxy.example.edu/login?url=";
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitFor = async (predicate, timeoutMs = 8_000) => {
          const startedAt = Date.now();
          while (Date.now() - startedAt < timeoutMs) {
            const value = await predicate();
            if (value) return value;
            await wait(100);
          }
          return null;
        };
        const text = (selector) =>
          document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const bodyIncludes = (value) => document.body.innerText.includes(value);
        const statusbarMetric = (label) => {
          const metrics = document.querySelector(".app-statusbar__metrics");
          const item = Array.from(metrics?.querySelectorAll("span") ?? []).find((span) =>
            span.textContent?.includes(label)
          );
          const raw = item?.querySelector("strong")?.textContent ?? "";
          if (!raw.trim()) return null;
          const value = Number(raw.replace(/[^\d]/g, ""));
          return Number.isFinite(value) ? value : null;
        };
          const selectedLibrarySection = (heading) =>
            Array.from(document.querySelectorAll(".library-inspector__section")).find((section) =>
              section.querySelector("h3")?.textContent?.includes(heading)
            );
          const selectLibraryDetailTab = async (label) => {
            const tab = Array.from(document.querySelectorAll(".library-side-tab")).find((button) =>
              button.textContent?.replace(/\s+/g, " ").trim().startsWith(label)
            );
            tab?.click();
            return Boolean(
              tab &&
                (await waitFor(
                  () => tab.isConnected && tab.getAttribute("aria-selected") === "true",
                  1_500
                ))
            );
          };
        const findButton = (label) =>
          Array.from(document.querySelectorAll("button")).find((button) => {
            const values = [
              button.textContent ?? "",
              button.getAttribute("aria-label") ?? "",
              button.getAttribute("title") ?? "",
            ];
            return values.some((value) => value.includes(label));
          });
        const findExactButton = (label) =>
          Array.from(document.querySelectorAll("button")).find((button) =>
            button.textContent?.replace(/\s+/g, " ").trim() === label
          );
        const rowText = () =>
          Array.from(document.querySelectorAll(".library-table__row"))
            .map((row) => row.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("\n");
        const clickRowByTitle = (title) => {
          const row = Array.from(document.querySelectorAll(".library-table__row")).find((item) =>
            item.textContent?.includes(title)
          );
          row?.click();
          return Boolean(row);
        };
        const dispatchDropEvent = (target, type, dataTransfer) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, "dataTransfer", {
            configurable: true,
            value: dataTransfer
          });
          target.dispatchEvent(event);
        };
        const setInputValue = (input, value) => {
          const previous = input.value;
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
          input.focus();
          input.select?.();
          let changedByEditCommand = false;
          if (typeof document.execCommand === "function") {
            document.execCommand("delete", false);
            changedByEditCommand = value
              ? document.execCommand("insertText", false, value)
              : input.value === "";
          }
          if (!changedByEditCommand || input.value !== value) {
            setter?.call(input, value);
          }
          input._valueTracker?.setValue(previous);
          const inputEvent =
            typeof InputEvent === "function"
              ? new InputEvent("input", {
                  bubbles: true,
                  data: value,
                  inputType: "insertReplacementText"
                })
              : new Event("input", { bubbles: true });
          input.dispatchEvent(inputEvent);
          input.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const dispatchComposingEnter = (target) => {
          const event = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter"
          });
          Object.defineProperty(event, "isComposing", {
            configurable: true,
            value: true
          });
          target.dispatchEvent(event);
        };
        const isMacShortcut = () => /Mac|iPhone|iPad/.test(navigator.platform);
        const defineKeyboardCode = (event, keyCode) => {
          Object.defineProperty(event, "keyCode", {
            configurable: true,
            value: keyCode
          });
          Object.defineProperty(event, "which", {
            configurable: true,
            value: keyCode
          });
          return event;
        };
        const makeSmokePdf = (label = "AuraScholar Smoke PDF") => {
          const escapedLabel = String(label).replace(/[\\()]/g, "\\$&");
          const text = "BT /F1 18 Tf 48 120 Td (" + escapedLabel + ") Tj ET";
          const objects = [
            "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
            "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
            "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
            "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
            "5 0 obj\n<< /Length " + text.length + " >>\nstream\n" + text + "\nendstream\nendobj\n"
          ];
          let body = "%PDF-1.4\n";
          const offsets = [0];
          for (let i = 0; i < objects.length; i += 1) {
            offsets[i + 1] = body.length;
            body += objects[i];
          }
          const xrefOffset = body.length;
          body += "xref\n0 " + (objects.length + 1) + "\n";
          body += "0000000000 65535 f \n";
          for (let i = 1; i <= objects.length; i += 1) {
            body += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
          }
          body +=
            "trailer\n<< /Size " +
            (objects.length + 1) +
            " /Root 1 0 R >>\nstartxref\n" +
            xrefOffset +
            "\n%%EOF\n";
          return new TextEncoder().encode(body);
        };
        const sha256Hex = async (bytes) => {
          if (!window.crypto?.subtle) return "0000000000000000000000000000000000000000000000000000000000000001";
          const digest = await window.crypto.subtle.digest("SHA-256", bytes);
          return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        };

        await waitFor(() => document.querySelector("main") && document.body.innerText.includes("文献库"));
        await waitFor(() => document.documentElement.getAttribute("data-theme") === "dawn", 2_000);
        const themeFallbackApplied = document.documentElement.getAttribute("data-theme") === "dawn";
        const themeStoredInvalid = (() => {
          try {
            return localStorage.getItem("theme") === "__aurascholar-invalid-theme__";
          } catch {
            return false;
          }
        })();
        const aiSettingsFallbackVisible = bodyIncludes("AI 待配置") || bodyIncludes("配置 AI");
        try {
          localStorage.setItem(
            "ai-settings",
            JSON.stringify({
              baseUrl: "https://api.shell-model-only.example/v1",
              kind: "openai-compatible",
              model: "smoke-shell-model-only"
            })
          );
          await window.aura?.secrets?.delete?.("secret:ai:apiKey");
          window.dispatchEvent(new Event("aurascholar:ai-settings-updated"));
        } catch {}
        const appShellAiModelWithoutSecretRequiresConfig = Boolean(
          await waitFor(() => {
            const statusbarButton = Array.from(
              document.querySelectorAll(".app-statusbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "配置 AI");
            return statusbarButton && !bodyIncludes("AI 就绪") ? statusbarButton : null;
          }, 2_000)
        );
        const appStatusbarAiSettingsButton = Array.from(
          document.querySelectorAll(".app-statusbar button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "配置 AI");
        let appShellAiSettingsCtaVisible =
          aiSettingsFallbackVisible && Boolean(appStatusbarAiSettingsButton);
        appStatusbarAiSettingsButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/settings?section=ai") &&
            Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted')) &&
            bodyIncludes("AI 服务") &&
            bodyIncludes("阅读翻译"),
          3_000
        );
        const appShellAiSettingsCtaTargetsSection =
          location.hash.includes("/settings?section=ai") &&
          Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted'));
        const appShellAiSettingsCtaNavigates =
          location.hash.includes("/settings?section=ai") &&
          bodyIncludes("AI 服务") &&
          bodyIncludes("阅读翻译");
        const appShellAiSettingsPreservesModelOnlyDraft = Boolean(
          await waitFor(() => {
            const aiInputs = Array.from(document.querySelectorAll(".settings-card--ai input"));
            return aiInputs[0]?.value === "https://api.shell-model-only.example/v1" &&
              aiInputs[1]?.value === "smoke-shell-model-only" &&
              aiInputs[2]?.value === ""
              ? aiInputs[1]
              : null;
          }, 2_000)
        );
        location.hash = "#/library";
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            Boolean(document.querySelector(".library-page")) &&
            bodyIncludes("文献库"),
          4_000
        );

        let initialWorkCount = null;
        let readingStatus = null;
        let commandCompositionEscapeIgnored = false;
        let commandCompositionIgnored = false;
        let detailVisible = false;
        let discoverySearchCompositionIgnored = false;
        let appShellCanvasStatsRacePreserved = false;
        let canvasLegacyFlashcardsRedirected = false;
        let canvasLegacyRedirectHash = "";
        let canvasLibraryWorkIngressHash = "";
        let canvasLibraryWorkIngressNavigated = false;
        let canvasLibraryWorkIngressPersisted = false;
        let canvasLibraryWorkIngressVisible = false;
        let canvasNodeContextMenuVisible = false;
        let canvasPersistedNodeCount = null;
        let canvasPersistedNodeReloaded = false;
        let canvasSemanticQuickLinkCandidateVisible = false;
        let canvasSemanticQuickLinkCleanupSucceeded = false;
        let canvasSemanticQuickLinkDeferred = false;
        let canvasSemanticQuickLinkPersisted = false;
        let canvasSemanticQuickLinkShortcutHandled = false;
        let canvasSplitReaderClosed = false;
        let canvasSplitReaderCleanupSucceeded = false;
        let canvasSplitReaderExcerptLinked = false;
        let canvasSplitReaderKeptContext = false;
        let canvasSplitReaderOpened = false;
        let canvasToolboxDetailsEditPersisted = false;
        let canvasReaderAnnotationDeepLinkHash = "";
        let canvasReaderAnnotationDeepLinkNavigated = false;
        let canvasReaderAnnotationPersisted = false;
        let canvasReaderAnnotationVisible = false;
        let externalCredentialsRejected = false;
        let externalNavigationBlocked = false;
        let externalUnsafeRejected = false;
        let graphCachedVisible = false;
        let graphDeepLinkParamSyncVisible = false;
        let graphEmptyLatestCtaHash = "";
        let graphEmptyLatestCtaOpened = false;
        let graphEmptyLatestCtaVisible = false;
        let graphInputCompositionIgnored = false;
        let graphImportBusyVisible = false;
        let graphImportFailureFeedbackVisible = false;
        let graphImportSuccessStatsUpdated = false;
        let graphImportSuccessVisible = false;
        let graphUnexpectedBuildMisses = [];
        let graphLoadRacePreserved = false;
        let graphNodeKeyboardSelectable = false;
        let graphRetryRecoveryVisible = false;
        let graphRetryAttempts = 0;
        window.__AURASCHOLAR_SMOKE_BUILD_CITATION_GRAPH__ = async ({ doi }) => {
          if (doi === GRAPH_SMOKE.retryDoi) {
            graphRetryAttempts += 1;
            if (graphRetryAttempts === 1) return null;
            return {
              centerId: "WsmokeGraphRetry",
              nodes: [
                {
                  id: "WsmokeGraphRetry",
                  title: GRAPH_SMOKE.retryTitle,
                  year: 2028,
                  citedByCount: 4,
                  doi: GRAPH_SMOKE.retryDoi,
                  venue: "Smoke Graph Retry Journal",
                  firstAuthor: "Graph Retry",
                  relation: "center"
                }
              ],
              edges: [],
              truncated: false
            };
          }
          graphUnexpectedBuildMisses.push(doi);
          return null;
        };
        let homepageClearSelectedCancelPreserved = false;
        let homepageClearSelectedConfirmVisible = false;
        let homepageClearSelectedUndoDetail = "";
        let homepageClearSelectedUndoFailureBusyVisible = false;
        let homepageClearSelectedUndoFailureDidNotPersist = false;
        let homepageClearSelectedUndoFailurePreserved = false;
        let homepageClearSelectedUndoFailureVisible = false;
        let homepageClearSelectedUndoRecovered = false;
        let homepageClearSelectedUndoRetryPersisted = false;
        let homepageCopyAriaBusyVisible = false;
        let homepageCopyBusyVisible = false;
        let homepageCopyFailureVisible = false;
        let homepageCopySuccessVisible = false;
        let homepageExportAriaBusyVisible = false;
        let homepageExportBusyVisible = false;
        let homepageExportFailureVisible = false;
        let homepageExportSuccessVisible = false;
        let homepageExternalLinkSafetyOk = false;
        let homepageFeaturedOverwriteCancelPreserved = false;
        let homepageFeaturedOverwriteConfirmVisible = false;
        let homepageLibraryReadRetryRecoveryDetail = "";
        let homepageLibraryReadRetryRecoveryVisible = false;
        let homepageLibraryRefreshRacePreserved = false;
        let homepageProfileSaveFailureBusyVisible = false;
        let homepageProfileSaveFailureDidNotPersist = false;
        let homepageProfileSaveFailurePreserved = false;
        let homepageProfileSaveFailureRetryPersisted = false;
        let homepageProfileSaveFailureRetryVisible = false;
        let homepageProfileSaveFailureVisible = false;
        let homepagePublicationFilterActionRestored = false;
        let homepagePublicationFilterActionDetail = "";
        let homepageSafeLinkRelHardened = false;
        let citationBridgeMethodGuard = false;
        let citationBridgePingOk = false;
        let citationBridgeUnauthRejected = false;
        let platformHttpUnsafeRejected = false;
        let researchUnsafeUrlRejected = false;
        let platformSecretsConcurrentWritesPreserved = false;
        let commandCloseRestoresFocus = false;
        let commandEmptyActionRestoresResults = false;
        let commandKeyboardNavigationKeepsActiveVisible = false;
        let commandNonPlatformShortcutIgnored = false;
        let commandShortcutLabel = "";
        let commandShortcutToggleCloses = false;
        let commandShortcutToggleOpens = false;
        let commandTargetedSettingsActionTargetsSection = false;
        let commandTargetedSettingsActionVisible = false;
        let discoveryBrowserHideFailureVisible = false;
        let discoveryDuplicateSiteAddBusyVisible = false;
        let discoveryDuplicateSiteBlocked = false;
        let discoveryDuplicateSiteCount = null;
        let discoveryDuplicateSiteMessageVisible = false;
        let discoveryHiddenSiteAddBusyVisible = false;
        let discoveryHiddenDuplicateSiteCount = null;
        let discoveryHiddenDuplicateSiteMessageVisible = false;
        let discoveryHiddenSiteRestored = false;
        let discoveryManualHiddenSiteRestoreBusyVisible = false;
        let discoveryManualHiddenSiteRestored = false;
        let discoveryManualHiddenSiteRestoredCount = null;
        let discoverySavedSearchSaveFailureBusyVisible = false;
        let discoverySavedSearchSaveFailureDidNotPersist = false;
        let discoverySavedSearchSaveFailurePreserved = false;
        let discoverySavedSearchSaveFailureVisible = false;
        let discoveryDuplicateSavedSearchBlocked = false;
        let discoveryDuplicateSavedSearchCount = null;
        let discoveryDuplicateSavedSearchMessageVisible = false;
        let discoverySavedSearchDeleteFailureBusyVisible = false;
        let discoverySavedSearchDeleteFailureDidNotPersist = false;
        let discoverySavedSearchDeleteFailurePreserved = false;
        let discoverySavedSearchDeleteFailureVisible = false;
        let discoverySavedSearchDeleteBusyVisible = false;
        let discoverySavedSearchDeleteConfirmVisible = false;
        let discoverySavedSearchDeleted = false;
        let discoverySavedSearchDeletePersisted = false;
        let discoverySavedSearchDeleteUndoBusyVisible = false;
        let discoverySavedSearchDeleteUndoFailureBusyVisible = false;
        let discoverySavedSearchDeleteUndoFailureDidNotPersist = false;
        let discoverySavedSearchDeleteUndoFailurePreserved = false;
        let discoverySavedSearchDeleteUndoFailureVisible = false;
        let discoverySavedSearchDeleteUndoRestored = false;
        let discoverySavedSearchDeleteUndoVisible = false;
        let discoveryEzproxyConfigSaveAriaBusyVisible = false;
        let discoveryEzproxyConfigSaveBusyVisible = false;
        let discoveryEzproxyCredentialDidNotPersist = false;
        let discoveryEzproxyCredentialsRejected = false;
        let discoveryEzproxyConfigSaved = false;
        let discoveryEzproxyConfigValue = null;
        let discoveryFulltextCueVisible = false;
        let discoveryImportBusyVisible = false;
        let discoveryImportFulltextFallbackVisible = false;
        let discoveryLoadMoreRetryRecoveryDetail = "";
        let discoveryLoadMoreRetryRecoveryVisible = false;
        let discoverySearchAriaBusyVisible = false;
        let discoverySearchBusyVisible = false;
        let discoverySearchRetryRecoveryDetail = "";
        let discoverySearchRetryRecoveryVisible = false;
        let discoveryTrustSignalsDetail = "";
        let discoverySearchProgressLiveVisible = false;
        let discoverySavedSearchManualCheckBusyVisible = false;
        let discoverySavedSearchManualCheckCompleted = false;
        let discoverySavedSearchHomeOpenBusyVisible = false;
        let discoverySavedSearchHomeOpenClearedNewCount = false;
        let discoveryOpenSearchEmptyClearRestored = false;
        let discoverySavedSearchHomeOpenNavigated = false;
        let discoverySavedSearchHomeOpenReplacedActiveSearch = false;
        let discoverySavedSearchLastErrorVisible = false;
        let discoveryTrustSignalsVisible = false;
        let discoveryProxyConfigSaveAriaBusyVisible = false;
        let discoveryProxyConfigSaveBusyVisible = false;
        let discoveryProxyCredentialDidNotPersist = false;
        let discoveryProxyCredentialsRejected = false;
        let discoveryProxyConfigSaved = false;
        let discoveryProxyConfigValue = null;
        let discoverySiteCredentialDidNotPersist = false;
        let discoverySiteCredentialsRejected = false;
        let discoverySiteProxyToggleBusyVisible = false;
        let discoverySiteProxyToggled = false;
        let discoverySiteProxyValue = null;
        let discoverySiteHideActionBusyVisible = false;
        let discoverySiteHideActionConfirmed = false;
        let discoverySiteHideActionHiddenValue = null;
        let discoverySiteRemoveFailureBusyVisible = false;
        let discoverySiteRemoveFailureDidNotPersist = false;
        let discoverySiteRemoveFailurePreserved = false;
        let discoverySiteRemoveFailureVisible = false;
        let discoverySiteRemoveActionBusyVisible = false;
        let discoverySiteRemoveActionCount = null;
        let discoverySiteRemoveActionDeleted = false;
        let discoverySiteRemoveUndoBusyVisible = false;
        let discoverySiteRemoveUndoFailureBusyVisible = false;
        let discoverySiteRemoveUndoFailureDidNotPersist = false;
        let discoverySiteRemoveUndoFailurePreserved = false;
        let discoverySiteRemoveUndoFailureVisible = false;
        let discoverySiteRemoveUndoRecovered = false;
        let discoverySiteActionConfirmCancelled = false;
        let discoverySiteActionConfirmVisible = false;
        let discoveryReferenceImportCommitBusyVisible = false;
        let discoveryReferenceImportCommitPersisted = false;
        let discoveryReferenceImportCommitSuccessVisible = false;
        let discoveryReferenceImportCancelPreserved = false;
        let discoveryReferenceImportConfirmVisible = false;
        let discoveryReferenceImportRejectsEmptyPersisted = false;
        let discoveryReferenceImportRejectsEmptyVisible = false;
        let discoveryReferenceImportRichFormatsPersisted = false;
        let libraryPdfAttachmentVisible = false;
        let libraryBulkSelectMixedVisible = false;
        let libraryFilterEmptyActionRestoresResults = false;
        let libraryFilterTabsExposeState = false;
        let libraryMissingDeepLinkFeedbackVisible = false;
        let libraryBulkTrashFailureBusyVisible = false;
        let libraryBulkTrashFailureDidNotPersist = false;
        let libraryBulkTrashFailurePreserved = false;
        let libraryBulkTrashFailureVisible = false;
        let libraryTrashFailureBusyVisible = false;
        let libraryTrashFailureDidNotPersist = false;
        let libraryTrashFailurePreserved = false;
        let libraryTrashFailureVisible = false;
        let libraryTrashUndoFailureBusyVisible = false;
        let libraryTrashUndoFailureDidNotPersist = false;
        let libraryTrashUndoFailurePreserved = false;
        let libraryTrashUndoFailureVisible = false;
        let libraryTrashUndoBusyVisible = false;
        let libraryTrashUndoRecovered = false;
        let libraryTrashUndoVisible = false;
        let libraryTrashPurgeFailureBusyVisible = false;
        let libraryTrashPurgeFailureDidNotPersist = false;
        let libraryTrashPurgeFailurePreserved = false;
        let libraryTrashPurgeFailureVisible = false;
        let libraryTrashRestoreFailureBusyVisible = false;
        let libraryTrashRestoreFailureDidNotPersist = false;
        let libraryTrashRestoreFailurePreserved = false;
        let libraryTrashRestoreFailureVisible = false;
        let libraryTrashPurgeBusyVisible = false;
        let libraryTrashPurgePersisted = false;
        let libraryTrashPurgeTypedConfirmProtected = false;
        let libraryLoadRetryAttempts = 0;
        let libraryLoadRetryRecoveryDetail = "";
        let libraryLoadRetryRecoveryVisible = false;
        let libraryRefreshRacePreserved = false;
        let librarySidebarHealthHidden = false;
        let librarySidebarMetaVisible = false;
        let librarySidebarOrganizerActionsVisible = false;
        let libraryCitationContextVisible = false;
        let libraryContextualWorkflowsHidden = false;
        let libraryBulkTagFailureBusyVisible = false;
        let libraryBulkTagFailureDidNotPersist = false;
        let libraryBulkTagFailurePreserved = false;
        let libraryBulkTagFailureVisible = false;
        let libraryBulkTagBusyVisible = false;
        let libraryBulkTagPersisted = false;
        let libraryBulkTagSuccessVisible = false;
        let libraryReadingStatusBusyVisible = false;
        let libraryReadingStatusFailureBusyVisible = false;
        let libraryReadingStatusFailureDidNotPersist = false;
        let libraryReadingStatusFailurePreserved = false;
        let libraryReadingStatusFailureVisible = false;
        let libraryReadingStatusPersisted = false;
        let libraryReadingStatusSuccessVisible = false;
        let libraryStarBusyVisible = false;
        let libraryStarFailureBusyVisible = false;
        let libraryStarFailureDidNotPersist = false;
        let libraryStarFailurePreserved = false;
        let libraryStarFailureVisible = false;
        let libraryStarPersisted = false;
        let libraryStarSuccessVisible = false;
        let libraryCitationCopyBusyVisible = false;
        let libraryCitationCopyFailureVisible = false;
        let libraryCitationCopySuccessVisible = false;
        let libraryCitationExportBusyVisible = false;
        let libraryCitationExportFailureVisible = false;
        let libraryCitationExportPmidVisible = false;
        let libraryCitationExportSuccessVisible = false;
        let libraryCollectionCreateFailureBusyVisible = false;
        let libraryCollectionCreateFailureDidNotPersist = false;
        let libraryCollectionCreateFailurePreserved = false;
        let libraryCollectionCreateFailureVisible = false;
        let libraryCollectionRenameFailureBusyVisible = false;
        let libraryCollectionRenameFailureDidNotPersist = false;
        let libraryCollectionRenameFailurePreserved = false;
        let libraryCollectionRenameFailureVisible = false;
        let libraryCollectionDeleteBusyVisible = false;
        let libraryCollectionDeleteFailureBusyVisible = false;
        let libraryCollectionDeleteFailureDidNotPersist = false;
        let libraryCollectionDeleteFailurePreserved = false;
        let libraryCollectionDeleteFailureVisible = false;
        let libraryCollectionDeletePersisted = false;
        let libraryCollectionDeleteSuccessVisible = false;
        let libraryCollectionDeleteUndoBusyVisible = false;
        let libraryCollectionDeleteUndoFailureBusyVisible = false;
        let libraryCollectionDeleteUndoFailureDidNotPersist = false;
        let libraryCollectionDeleteUndoFailurePreserved = false;
        let libraryCollectionDeleteUndoFailureVisible = false;
        let libraryCollectionDeleteUndoRecovered = false;
        let libraryBodyText = "";
        let libraryHash = "";
        let libraryHeading = "";
        let libraryKeyboardNavigationVisible = false;
        let libraryKeyboardOpenHash = "";
        let libraryKeyboardOpenedId = "";
        let libraryKeyboardNavigationDetail = "";
        let libraryPdfUploadBusyVisible = false;
        let libraryPdfUploadPersisted = false;
        let libraryPdfUploadSuccessVisible = false;
        let libraryMergeBusyVisible = false;
        let libraryMergeFailureBusyVisible = false;
        let libraryMergeFailureDidNotPersist = false;
        let libraryMergeFailurePreserved = false;
        let libraryMergeFailureVisible = false;
        let libraryMergePersisted = false;
        let libraryMergeSuccessVisible = false;
        let libraryMoveToCollectionFailureBusyVisible = false;
        let libraryMoveToCollectionFailureDidNotPersist = false;
        let libraryMoveToCollectionFailurePreserved = false;
        let libraryMoveToCollectionFailureVisible = false;
        let libraryMoveToCollectionBusyVisible = false;
        let libraryMoveToCollectionPersisted = false;
        let libraryMoveToCollectionSuccessVisible = false;
        let libraryTagDeleteBusyVisible = false;
        let libraryTagDeleteFailureBusyVisible = false;
        let libraryTagDeleteFailureDidNotPersist = false;
        let libraryTagDeleteFailurePreserved = false;
        let libraryTagDeleteFailureVisible = false;
        let libraryTagDeletePersisted = false;
        let libraryTagDeleteSuccessVisible = false;
        let libraryTagDeleteUndoBusyVisible = false;
        let libraryTagDeleteUndoFailureBusyVisible = false;
        let libraryTagDeleteUndoFailureDidNotPersist = false;
        let libraryTagDeleteUndoFailurePreserved = false;
        let libraryTagDeleteUndoFailureVisible = false;
        let libraryTagDeleteUndoRecovered = false;
        let libraryTagRenameFailureBusyVisible = false;
        let libraryTagRenameFailureDidNotPersist = false;
        let libraryTagRenameFailurePreserved = false;
        let libraryTagRenameFailureVisible = false;
        let libraryTrashRestoreBusyVisible = false;
        let libraryTrashRestoreSuccessVisible = false;
        let metadataInvalidYearBlocked = false;
        let metadataInvalidYearErrorVisible = false;
        let metadataInvalidYearPreserved = false;
        let metadataDiscardCancelPreserved = false;
        let metadataSaveFailureVisible = false;
        let metadataSaveFailurePreserved = false;
        let metadataSaveFailureDidNotPersist = false;
        let metadataSaveBusyVisible = false;
        let metadataSavePersisted = false;
        let quickAddCompositionIgnored = false;
        let quickImportConfirmCommitBusyVisible = false;
        let quickImportConfirmDialogVisible = false;
        let quickImportConfirmCommitPersisted = false;
        let librarySearchShortcutLabel = "";
        let librarySearchShortcutFocused = false;
        let librarySearchNonPlatformShortcutIgnored = false;
        let populatedStateVisible = false;
        let quickDropImportConfirmBusyVisible = false;
        let quickDropImportFailureBusyVisible = false;
        let quickDropImportFailureDidNotPersist = false;
        let quickDropImportFailurePreserved = false;
        let quickDropImportFailureVisible = false;
        let quickDropImportConfirmPersisted = false;
        let quickDropImportConfirmPmidPersisted = false;
        let quickDropImportConfirmSuccessVisible = false;
        let quickDropImportCount = null;
        let quickDropImportPreviewVisible = false;
        let readerBrokenAttachmentCount = null;
        let readerBrokenBlobRecoveryVisible = false;
        let readerBrokenBlobVisible = false;
        let readerBrokenHash = "";
        let readerAnnotationCreateFailureBusyVisible = false;
        let readerAnnotationCreateFailureDidNotPersist = false;
        let readerAnnotationCreateFailurePreserved = false;
        let readerAnnotationCreateFailureVisible = false;
        let readerAnnotationDeleteBusyVisible = false;
        let readerAnnotationDeleteCancelPreserved = false;
        let readerAnnotationDeleteConfirmVisible = false;
        let readerAnnotationDeleteFailureBusyVisible = false;
        let readerAnnotationDeleteFailureDidNotPersist = false;
        let readerAnnotationDeleteFailurePreserved = false;
        let readerAnnotationDeleteFailureVisible = false;
        let readerAnnotationDeleteSuccessVisible = false;
        let readerAnnotationDeleteUndoFailureBusyVisible = false;
        let readerAnnotationDeleteUndoFailureDidNotPersist = false;
        let readerAnnotationDeleteUndoFailurePreserved = false;
        let readerAnnotationDeleteUndoFailureVisible = false;
        let readerAnnotationDeleteUndoBusyVisible = false;
        let readerAnnotationDeleteUndoRecovered = false;
        let readerCommentDirtyExportBlocked = false;
        let readerCommentDirtyExportDownloadPrevented = false;
        let readerCommentDirtyExportMessageVisible = false;
        let readerCommentDraftCancelPreserved = false;
        let readerCommentDraftConfirmVisible = false;
        let readerCommentDraftDiscarded = false;
        let readerCommentSaveFailureDidNotPersist = false;
        let readerCommentSaveFailurePreserved = false;
        let readerCommentSaveFailureVisible = false;
        let readerCommentSaveBusyVisible = false;
        let readerCommentSavePersisted = false;
        let readerCommentShortcutCompositionIgnored = false;
        let readerArchivedAnnotationRows = 0;
        let readerArchivedAttachmentRows = 0;
        let readerArchivedBackToTrashFilterVisible = false;
        let readerArchivedBackToTrashHash = "";
        let readerArchivedBackToTrashLocated = false;
        let readerArchivedBackToTrashRowVisible = false;
        let readerArchivedBackToTrashSearchCleared = false;
        let readerArchivedCanvasBlocked = false;
        let readerArchivedForbiddenActionsHidden = false;
        let readerArchivedHash = "";
        let readerArchivedRecoveryCtaVisible = false;
        let readerArchivedStateVisible = false;
        let readerCanvasVisible = false;
        let readerCorruptAttachmentCount = null;
        let readerCorruptPdfRecoveryVisible = false;
        let readerCorruptPdfVisible = false;
        let readerCorruptHash = "";
        let readerErrorVisible = false;
        let readerFindFulltextHandoffHash = "";
        let readerFindFulltextHandoffNavigated = false;
        let readerFindFulltextHandoffStatusVisible = false;
        let readerFindFulltextHandoffTargetVisible = false;
        let readerFindFulltextHandoffView = "";
        let readerHash = "";
        let readerAutoReadingStatusPersisted = false;
        let readerLoadRetryAttempts = 0;
        let readerLoadRetryRecoveryDetail = "";
        let readerLoadRetryRecoveryVisible = false;
        let readerMissingBackToLibraryHash = "";
        let readerMissingBackToLibraryDetail = "";
        let readerMissingBackToLibraryLocated = false;
        let readerMissingBackToLibraryPageText = "";
        let readerMissingBackToLibraryRowVisible = false;
        let readerMissingBackToLibrarySearchCleared = false;
        let readerMissingBackToLibraryVisibleRows = "";
        let readerMissingHash = "";
        let readerMissingPdfAttachBusyVisible = false;
        let readerMissingPdfAttachCtaVisible = false;
        let readerMissingPdfRecoveryVisible = false;
        let readerMissingPdfVisible = false;
        let readerNoWorkClearsDocument = false;
        let readerPageBadgeVisible = false;
        let readerRecoveredAttachmentCount = null;
        let readerRecoveredPdfVisible = false;
        let readerSnippetSaveFailureBusyVisible = false;
        let readerSnippetSaveFailureDidNotPersist = false;
        let readerSnippetSaveFailurePreserved = false;
        let readerSnippetSaveFailureVisible = false;
        let readerSnippetSaveBusyVisible = false;
        let readerSnippetSavePersisted = false;
        let readerTabDeepLinkSyncVisible = false;
        let readerTitleVisible = false;
        let readerTranslationClipboardMatches = false;
        let readerTranslationCopyBusyVisible = false;
        let readerTranslationCopyFeedbackVisible = false;
        let readerTranslationCopyStatusText = "";
        let readerTranslationInlineDocumentVisible = false;
        let readerTranslationSelectionPopoverVisible = false;
        let readerTranslationSplitDocumentsVisible = false;
        let readerTranslationStartBusyVisible = false;
        let readerTranslationStartErrorVisible = false;
        let readerTranslationSettingsCtaNavigates = false;
        let readerTranslationSettingsCtaTargetsSection = false;
        let readerTranslationSettingsCtaVisible = false;
        let routeCrashBoundaryVisible = false;
        let routeCrashRecoveredLibraryVisible = false;
        let routeCrashRecoveryHash = "";
        let routeCrashShellVisible = false;
        let searchClearButtonRestoresResults = false;
        let searchDataPathOk = false;
        let searchEmptyActionRestoresResults = false;
        let searchEmptyStateVisible = false;
        let searchEscapeClearsQuery = false;
        let searchResultVisible = false;
        let settingsBackupExportBusyVisible = false;
        let settingsBackupExportAriaBusyVisible = false;
        let settingsBackupExportEphemeralDataExcluded = false;
        let settingsBackupExportFailureVisible = false;
        let settingsBackupExportRecencyVisible = false;
        let settingsBackupExportSecretsSanitized = false;
        let settingsBackupExportSuccessVisible = false;
        let settingsBackupImportAiJobsPortable = false;
        let settingsBackupImportEphemeralDataExcluded = false;
        let settingsBackupImportIgnoredOnlyExplained = false;
        let settingsBackupImportBusyVisible = false;
        let settingsBackupImportAttachmentIdCollisionRemapped = false;
        let settingsBackupImportAttachmentDeactivated = false;
        let settingsBackupImportCancelPreserved = false;
        let settingsBackupImportConfirmVisible = false;
        let settingsBackupImportFailureBusyVisible = false;
        let settingsBackupImportFailureDidNotPersist = false;
        let settingsBackupImportFailureRetryVisible = false;
        let settingsBackupImportFailureVisible = false;
        let settingsBackupImportLibraryScoped = false;
        let settingsBackupImportPersisted = false;
        let settingsBackupImportRejectsFutureVersionVisible = false;
        let settingsBackupImportRejectsInvalidVisible = false;
        let settingsBackupImportReattachAnnotationRestored = false;
        let settingsBackupImportRuntimeSkipExplained = false;
        let settingsBackupImportSearchIndexed = false;
        let settingsBackupImportSettingsSanitized = false;
        let settingsBackupImportStableIdMerged = false;
        let settingsBackupImportSuccessVisible = false;
        let settingsAiTestFailureBusyVisible = false;
        let settingsAiTestFailureConfigSaved = false;
        let settingsAiTestFailureRetryVisible = false;
        let settingsAiTestFailureVisible = false;
        let settingsAiSaveFailureDidNotPersist = false;
        let settingsAiSaveFailurePreserved = false;
        let settingsAiSaveFailureVisible = false;
        let settingsInlineSecretMigrationFailurePreserved = false;
        let settingsInlineSecretMigrationRetrySanitized = false;
        let settingsInlineSecretMigrationVisible = false;
        let settingsAiUrlCredentialsRejected = false;
        let settingsAiUrlInvalidDidNotPersist = false;
        let settingsAiUrlInvalidVisible = false;
        let settingsAiUrlNormalized = false;
        let settingsTranslateSaveFailureDidNotPersist = false;
        let settingsTranslateSaveFailurePreserved = false;
        let settingsTranslateSaveFailureVisible = false;
        let settingsTranslateProviderValidationDidNotPersist = false;
        let settingsTranslateProviderValidationVisible = false;
        let settingsSyncRunFailureBusyVisible = false;
        let settingsSyncRunFailureConfigPreserved = false;
        let settingsSyncRunActionableFailureVisible = false;
        let settingsSyncRunFailureRetryVisible = false;
        let settingsSyncRunFailureVisible = false;
        let settingsSyncRunQuotaGuidanceVisible = false;
        let settingsSyncUrlCredentialsRejected = false;
        let settingsSyncUrlInvalidDidNotPersist = false;
        let settingsSyncUrlInvalidVisible = false;
        let settingsSyncUrlNormalized = false;
        let settingsSyncSaveFailureDidNotPersist = false;
        let settingsSyncSaveFailurePreserved = false;
        let settingsSyncSaveFailureVisible = false;
        let settingsBusySaveAriaVisible = false;
        let settingsBusyNavigationCancelPreserved = false;
        let settingsBusyNavigationConfirmVisible = false;
        let settingsBusySaveControlsDisabled = false;
        let settingsAiLoadRetryAttempts = 0;
        let settingsAiLoadRetryRecoveryDetail = "";
        let settingsAiLoadRetryRecoveryVisible = false;
        let settingsInitialLoadCompleted = false;
        let settingsSyncLoadRetryAttempts = 0;
        let settingsSyncLoadRetryRecoveryDetail = "";
        let settingsSyncLoadRetryRecoveryVisible = false;
        let settingsTargetTranslateSectionVisible = false;
        let settingsTranslateLoadRetryAttempts = 0;
        let settingsTranslateLoadRetryRecoveryDetail = "";
        let settingsTranslateLoadRetryRecoveryVisible = false;
        let settingsTranslationCacheClearBusyVisible = false;
        let settingsTranslationCacheClearCancelled = false;
        let settingsTranslationCacheClearConfirmVisible = false;
        let settingsTranslationCacheClearPersisted = false;
        let settingsTranslationCacheClearSuccessVisible = false;
        let sentinelAddCompositionIgnored = false;
        let sentinelAddBusyVisible = false;
        let sentinelDeleteFailureBusyVisible = false;
        let sentinelDeleteFailureDidNotPersist = false;
        let sentinelDeleteFailurePreserved = false;
        let sentinelDeleteFailureVisible = false;
        let sentinelDeleteUndoFailureBusyVisible = false;
        let sentinelDeleteUndoFailureDidNotPersist = false;
        let sentinelDeleteUndoFailurePreserved = false;
        let sentinelDeleteUndoFailureVisible = false;
        let sentinelDeleteUndoBusyVisible = false;
        let sentinelDeleteUndoRestored = false;
        let sentinelDeleteUndoVisible = false;
        let sentinelDeletedDoiRestored = false;
        let sentinelDeletedDoiRestoredCount = null;
        let sentinelDuplicateDoiBlocked = false;
        let sentinelDuplicateDoiCount = null;
        let sentinelDuplicateDoiMessageVisible = false;
        let sentinelLastErrorVisible = false;
        let sentinelTaskCheckBusyVisible = false;
        let sentinelManualFailureRecorded = false;
        let sentinelManualFailureVisible = false;
        let sentinelFilterEmptyActionRestoresResults = false;
        let sentinelLoadRetryAttempts = 0;
        let sentinelLoadRetryRecoveryDetail = "";
        let sentinelLoadRetryRecoveryVisible = false;
        let sentinelRefreshRacePreserved = false;
        let seededWorkCount = null;
        let snippetCardCopyAriaBusyVisible = false;
        let snippetCardCopyBusyVisible = false;
        let snippetCardCopyCitationAriaBusyVisible = false;
        let snippetCardCopyCitationBusyVisible = false;
        let snippetDeleteAriaBusyVisible = false;
        let snippetDeleteBusyVisible = false;
        let snippetDeleteFailureBusyVisible = false;
        let snippetDeleteFailureDidNotPersist = false;
        let snippetDeleteFailurePreserved = false;
        let snippetDeleteFailureVisible = false;
        let snippetDeleteSuccessVisible = false;
        let snippetDeleteUndoFailureBusyVisible = false;
        let snippetDeleteUndoFailureDidNotPersist = false;
        let snippetDeleteUndoFailurePreserved = false;
        let snippetDeleteUndoFailureVisible = false;
        let snippetDeleteUndoBusyVisible = false;
        let snippetDeleteUndoRecovered = false;
        let snippetDeleteUndoVisible = false;
        let snippetEmptyLatestReaderHash = "";
        let snippetEmptyLatestReaderOpened = false;
        let snippetEmptyLatestReaderVisible = false;
        let snippetFilterEmptyActionRestoresResults = false;
        let snippetLoadRetryAttempts = 0;
        let snippetLoadRetryRecoveryDetail = "";
        let snippetLoadRetryRecoveryVisible = false;
        let snippetDirtyCopyBlocked = false;
        let snippetDirtyCopyClipboardPreserved = false;
        let snippetDirtyCopyMessageVisible = false;
        let snippetEditorClosedAfterShortcut = false;
        let snippetEscapeCompositionIgnored = false;
        let snippetRefreshRacePreserved = false;
        let snippetSavedNote = null;
        let snippetSaveCompositionIgnored = false;
        let snippetSaveFailureDidNotPersist = false;
        let snippetSaveFailurePreserved = false;
        let snippetSaveFailureVisible = false;
        let snippetShortcutEventPrevented = false;
        let snippetShortcutSaveVisible = false;
        let snippetVisibleCopyAriaBusyVisible = false;
        let snippetVisibleCopyBusyVisible = false;
        let snippetVisibleCopySuccessVisible = false;
        let dbError = null;
        try {
          if (window.aura?.db?.queryScalar) {
            initialWorkCount = await window.aura.db.queryScalar("SELECT COUNT(*) FROM works");
          }
        } catch (error) {
          dbError = error instanceof Error ? error.message : String(error);
        }
        try {
          const secretKeys = Array.from({ length: 8 }, (_item, index) =>
            "smoke:concurrent-secret:" + index
          );
          await Promise.all(secretKeys.map((key) => window.aura?.secrets?.delete?.(key)));
          await Promise.all(
            secretKeys.map((key, index) =>
              window.aura?.secrets?.set?.(key, "concurrent-secret-value-" + index)
            )
          );
          const secretValues = await Promise.all(
            secretKeys.map((key) => window.aura?.secrets?.get?.(key))
          );
          platformSecretsConcurrentWritesPreserved = secretValues.every(
            (value, index) => value === "concurrent-secret-value-" + index
          );
          await Promise.all(secretKeys.map((key) => window.aura?.secrets?.delete?.(key)));
        } catch {
          platformSecretsConcurrentWritesPreserved = false;
        }
        try {
          await window.aura?.openExternal?.("javascript:alert('aurascholar-smoke')");
        } catch {
          externalUnsafeRejected = true;
        }
        try {
          await window.aura?.openExternal?.("https://user:pass@example.com/aurascholar-smoke");
        } catch {
          externalCredentialsRejected = true;
        }
        try {
          await window.aura?.http?.({ url: "file:///private/tmp/aurascholar-smoke-http" });
        } catch {
          try {
            await window.aura?.http?.({
              url: "https://user:pass@example.com/aurascholar-smoke-http",
            });
          } catch {
            platformHttpUnsafeRejected = true;
          }
        }
        try {
          await window.aura?.research?.open?.(
            "smoke-unsafe-url",
            "file:///private/tmp/aurascholar-smoke-research",
          );
        } catch {
          try {
            await window.aura?.research?.open?.(
              "smoke-unsafe-url",
              "https://user:pass@example.com/aurascholar-smoke-research",
            );
          } catch {
            researchUnsafeUrlRejected = true;
          }
        }
        try {
          const citationBridgePort = await waitFor(
            async () => window.aura?.citationBridgePort?.(),
            2_000
          );
          if (citationBridgePort) {
            const bridgeBase = "http://127.0.0.1:" + citationBridgePort;
            const pingRes = await fetch(bridgeBase + "/ping");
            const pingJson = await pingRes.json().catch(() => null);
            citationBridgePingOk =
              pingRes.status === 200 &&
              pingJson?.ok === true &&
              pingJson?.app === "aurascholar" &&
              pingRes.headers.get("cache-control") === "no-store";

            const unauthRes = await fetch(bridgeBase + "/works/search?q=smoke");
            const unauthJson = await unauthRes.json().catch(() => null);
            citationBridgeUnauthRejected =
              unauthRes.status === 401 && unauthJson?.error === "bad token";

            const methodRes = await fetch(bridgeBase + "/ping", { method: "POST" });
            const methodJson = await methodRes.json().catch(() => null);
            citationBridgeMethodGuard =
              methodRes.status === 405 &&
              methodJson?.error === "method not allowed" &&
              (methodRes.headers.get("allow") ?? "").includes("GET");
          }
        } catch {
          citationBridgePingOk = false;
          citationBridgeUnauthRejected = false;
          citationBridgeMethodGuard = false;
        }
        const beforeExternalNavigation = location.href;
        try {
          location.href = "file:///private/tmp/aurascholar-smoke-navigation.html";
          await wait(250);
          externalNavigationBlocked =
            location.href === beforeExternalNavigation && document.title === "AuraScholar";
        } catch {
          externalNavigationBlocked =
            location.href === beforeExternalNavigation && document.title === "AuraScholar";
        }

        if (Number(initialWorkCount) === 0) {
          await waitFor(() => bodyIncludes("把第一篇论文放进工作台"), 8_000);
        }
        const emptyStateVisible = bodyIncludes("把第一篇论文放进工作台");
        if (!dbError && Number(initialWorkCount) === 0) {
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__ =
            "Smoke library initial load failure";
          findButton("刷新")?.click();
          await waitFor(
            () =>
              bodyIncludes("文献库暂时不可用") &&
              bodyIncludes("Smoke library initial load failure") &&
              Boolean(document.querySelector('button[aria-label="重试读取文献库"]')),
            3_000
          );
          libraryLoadRetryAttempts = 1;
          document.querySelector('button[aria-label="重试读取文献库"]')?.click();
          await waitFor(
            () =>
              bodyIncludes("把第一篇论文放进工作台") &&
              !bodyIncludes("文献库暂时不可用") &&
              !bodyIncludes("Smoke library initial load failure"),
            5_000
          );
          libraryLoadRetryAttempts += 1;
          libraryLoadRetryRecoveryVisible =
            libraryLoadRetryAttempts === 2 &&
            bodyIncludes("把第一篇论文放进工作台") &&
            !bodyIncludes("文献库暂时不可用") &&
            !bodyIncludes("Smoke library initial load failure");
          libraryLoadRetryRecoveryDetail =
            "attempts=" +
            libraryLoadRetryAttempts +
            "; onboarding=" +
            bodyIncludes("把第一篇论文放进工作台") +
            "; error=" +
            bodyIncludes("文献库暂时不可用");
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READ__;
        } else {
          libraryLoadRetryRecoveryVisible = true;
          libraryLoadRetryRecoveryDetail =
            "skipped=existing-or-unavailable-library; initialWorkCount=" +
            initialWorkCount +
            "; dbError=" +
            dbError;
        }

        if (!dbError && window.aura?.db?.run && window.aura?.db?.exec) {
          const now = Date.now();
          await window.aura.db.exec("BEGIN");
          try {
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, pmid, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                SAMPLE.workId,
                SAMPLE.doi,
                SAMPLE.pmid,
                SAMPLE.title,
                "A deterministic smoke-test paper for validating the populated desktop library state.",
                2026,
                SAMPLE.venue,
                "article",
                "unread",
                0,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MISSING_PDF.workId,
                MISSING_PDF.doi,
                MISSING_PDF.title,
                "A deterministic smoke-test paper for validating the missing-PDF reader recovery state.",
                2026,
                MISSING_PDF.venue,
                "article",
                "unread",
                0,
                now - 10000,
                now - 10000
              ]
            );
            for (let index = 0; index < 35; index += 1) {
              const createdAt = now - 100 - index;
              await window.aura.db.run(
                "INSERT OR REPLACE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  "smoke-work-library-deeplink-filler-" + index,
                  "10.4242/aurascholar.library-deeplink-filler-" + index,
                  "Smoke Library Deep Link Filler " + String(index + 1).padStart(2, "0"),
                  "A deterministic smoke-test paper used to force library deep-link pagination.",
                  2026,
                  "Journal of Library Navigation",
                  "article",
                  "unread",
                  0,
                  createdAt,
                  createdAt
                ]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                BROKEN_BLOB.workId,
                BROKEN_BLOB.doi,
                BROKEN_BLOB.title,
                "A deterministic smoke-test paper for validating broken local blob recovery.",
                2026,
                BROKEN_BLOB.venue,
                "article",
                "unread",
                0,
                now - 2,
                now - 2
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                CORRUPT_PDF.workId,
                CORRUPT_PDF.doi,
                CORRUPT_PDF.title,
                "A deterministic smoke-test paper for validating corrupt PDF repair.",
                2026,
                CORRUPT_PDF.venue,
                "article",
                "unread",
                0,
                now - 3,
                now - 3
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                LIBRARY_UPLOAD_PDF.workId,
                LIBRARY_UPLOAD_PDF.doi,
                LIBRARY_UPLOAD_PDF.title,
                "A deterministic smoke-test paper for validating Library detail PDF upload feedback.",
                2026,
                LIBRARY_UPLOAD_PDF.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_SMOKE.primaryId,
                MERGE_SMOKE.primaryDoi,
                MERGE_SMOKE.primaryTitle,
                null,
                2026,
                "Journal of Merge Smoke",
                "article",
                "unread",
                0,
                now - 5,
                now - 5
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_SMOKE.duplicateId,
                MERGE_SMOKE.duplicateDoi,
                MERGE_SMOKE.duplicateTitle,
                "Metadata moved by merge smoke",
                2026,
                "Journal of Merge Smoke",
                "article",
                "unread",
                0,
                now - 6,
                now - 6
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_FAILURE_SMOKE.primaryId,
                MERGE_FAILURE_SMOKE.primaryDoi,
                MERGE_FAILURE_SMOKE.primaryTitle,
                "Primary record for validating failed merge rollback.",
                2026,
                "Journal of Atomic Merge UX",
                "article",
                "unread",
                0,
                now - 6,
                now - 6
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_FAILURE_SMOKE.duplicateId,
                MERGE_FAILURE_SMOKE.duplicateDoi,
                MERGE_FAILURE_SMOKE.duplicateTitle,
                "Duplicate record for validating failed merge rollback.",
                2026,
                "Journal of Atomic Merge UX",
                "article",
                "unread",
                0,
                now - 6,
                now - 6
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                READER_ARCHIVED_SMOKE.workId,
                READER_ARCHIVED_SMOKE.doi,
                READER_ARCHIVED_SMOKE.title,
                "A deterministic smoke-test paper for validating archived Reader links.",
                2026,
                READER_ARCHIVED_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4,
                now - 4_200
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                TRASH_ACTION_SMOKE.workId,
                TRASH_ACTION_SMOKE.doi,
                TRASH_ACTION_SMOKE.title,
                "A deterministic smoke-test paper for validating recoverable trash actions.",
                2026,
                TRASH_ACTION_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4,
                now - 2_000
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                TRASH_FAILURE_SMOKE.workId,
                TRASH_FAILURE_SMOKE.doi,
                TRASH_FAILURE_SMOKE.title,
                "A deterministic smoke-test paper for validating retryable trash failures.",
                2026,
                TRASH_FAILURE_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4
              ]
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic bulk trash rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4
                ]
              );
            }
            for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic collection move rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4
                ]
              );
            }
            for (const work of BULK_TAG_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic bulk tag rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4
                ]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                TRASH_UNDO_SMOKE.workId,
                TRASH_UNDO_SMOKE.doi,
                TRASH_UNDO_SMOKE.title,
                "A deterministic smoke-test paper for validating instant undo after accidental trash.",
                2026,
                TRASH_UNDO_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                TRASH_PURGE_SMOKE.workId,
                TRASH_PURGE_SMOKE.doi,
                TRASH_PURGE_SMOKE.title,
                "A deterministic smoke-test paper for validating typed confirmation before permanent deletion.",
                2026,
                TRASH_PURGE_SMOKE.venue,
                "article",
                "unread",
                0,
                now - 4,
                now - 4,
                now - 3_000
              ]
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic permanent delete rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4,
                  now - 3_500
                ]
              );
            }
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  work.workId,
                  work.doi,
                  work.title,
                  "A deterministic smoke-test paper for validating atomic trash restore rollback.",
                  2026,
                  work.venue,
                  "article",
                  "unread",
                  0,
                  now - 4,
                  now - 4,
                  now - 3_800
                ]
              );
            }
            await window.aura.db.run(
              "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?",
              [now - 2_000, now - 4, TRASH_ACTION_SMOKE.workId]
            );
            await window.aura.db.run(
              "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ?",
              [now - 4, TRASH_FAILURE_SMOKE.workId]
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ?",
                [now - 4, work.workId]
              );
            }
            for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ?",
                [now - 4, work.workId]
              );
              await window.aura.db.run(
                "DELETE FROM collection_items WHERE work_id = ?",
                [work.workId]
              );
            }
            for (const work of BULK_TAG_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ?",
                [now - 4, work.workId]
              );
            }
            await window.aura.db.run(
              "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id = ?",
              [now - 4, TRASH_UNDO_SMOKE.workId]
            );
            await window.aura.db.run(
              "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?",
              [now - 3_000, now - 4, TRASH_PURGE_SMOKE.workId]
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?",
                [now - 3_500, now - 4, work.workId]
              );
            }
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?",
                [now - 3_800, now - 4, work.workId]
              );
            }
            await window.aura.db.run(
              "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?",
              [now - 4_200, now - 4, READER_ARCHIVED_SMOKE.workId]
            );
            await window.aura.db.run(
              "UPDATE works SET deleted_at = NULL, updated_at = ? WHERE id IN (?, ?)",
              [now - 4, MERGE_FAILURE_SMOKE.primaryId, MERGE_FAILURE_SMOKE.duplicateId]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [SAMPLE.authorId, SAMPLE.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [MISSING_PDF.authorId, MISSING_PDF.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [BROKEN_BLOB.authorId, BROKEN_BLOB.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [CORRUPT_PDF.authorId, CORRUPT_PDF.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [LIBRARY_UPLOAD_PDF.authorId, LIBRARY_UPLOAD_PDF.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [READER_ARCHIVED_SMOKE.authorId, READER_ARCHIVED_SMOKE.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [TRASH_ACTION_SMOKE.authorId, TRASH_ACTION_SMOKE.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [TRASH_FAILURE_SMOKE.authorId, TRASH_FAILURE_SMOKE.author, now, now]
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [work.authorId, work.author, now, now]
              );
            }
            for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [work.authorId, work.author, now, now]
              );
            }
            for (const work of BULK_TAG_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [work.authorId, work.author, now, now]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [TRASH_UNDO_SMOKE.authorId, TRASH_UNDO_SMOKE.author, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
              [TRASH_PURGE_SMOKE.authorId, TRASH_PURGE_SMOKE.author, now, now]
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [work.authorId, work.author, now, now]
              );
            }
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO authors (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                [work.authorId, work.author, now, now]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [SAMPLE.workId, SAMPLE.authorId, 0, SAMPLE.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [MISSING_PDF.workId, MISSING_PDF.authorId, 0, MISSING_PDF.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [BROKEN_BLOB.workId, BROKEN_BLOB.authorId, 0, BROKEN_BLOB.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [CORRUPT_PDF.workId, CORRUPT_PDF.authorId, 0, CORRUPT_PDF.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [LIBRARY_UPLOAD_PDF.workId, LIBRARY_UPLOAD_PDF.authorId, 0, LIBRARY_UPLOAD_PDF.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [
                READER_ARCHIVED_SMOKE.workId,
                READER_ARCHIVED_SMOKE.authorId,
                0,
                READER_ARCHIVED_SMOKE.author,
                "author"
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [TRASH_ACTION_SMOKE.workId, TRASH_ACTION_SMOKE.authorId, 0, TRASH_ACTION_SMOKE.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [TRASH_FAILURE_SMOKE.workId, TRASH_FAILURE_SMOKE.authorId, 0, TRASH_FAILURE_SMOKE.author, "author"]
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            for (const work of BULK_TAG_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [TRASH_UNDO_SMOKE.workId, TRASH_UNDO_SMOKE.authorId, 0, TRASH_UNDO_SMOKE.author, "author"]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
              [TRASH_PURGE_SMOKE.workId, TRASH_PURGE_SMOKE.authorId, 0, TRASH_PURGE_SMOKE.author, "author"]
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              await window.aura.db.run(
                "INSERT OR IGNORE INTO work_authors (work_id, author_id, position, raw_name, role) VALUES (?, ?, ?, ?, ?)",
                [work.workId, work.authorId, 0, work.author, "author"]
              );
            }
            await window.aura.db.run(
              "DELETE FROM work_tags WHERE tag_id IN (SELECT id FROM tags WHERE name = ?)",
              [BULK_TAG_FAILURE_SMOKE.name]
            );
            await window.aura.db.run(
              "DELETE FROM tags WHERE name = ?",
              [BULK_TAG_FAILURE_SMOKE.name]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [SAMPLE.tagId, SAMPLE.tag, "#0f766e", now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              [TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.name, TAG_MANAGER_SMOKE.color, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO collections (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, NULL, 0, ?, ?)",
              [COLLECTION_MANAGER_SMOKE.id, COLLECTION_MANAGER_SMOKE.name, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO collections (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, NULL, 0, ?, ?)",
              [MOVE_COLLECTION_SMOKE.id, MOVE_COLLECTION_SMOKE.name, now, now]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO collection_items (collection_id, work_id) VALUES (?, ?)",
              [COLLECTION_MANAGER_SMOKE.id, MISSING_PDF.workId]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)",
              [SAMPLE.workId, SAMPLE.tagId]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)",
              [MISSING_PDF.workId, TAG_MANAGER_SMOKE.id]
            );
            const pdfBytes = makeSmokePdf();
            const pdfSha = await sha256Hex(pdfBytes);
            const pdfPath = "blobs/" + pdfSha.slice(0, 2) + "/" + pdfSha + ".pdf";
            await window.aura.fs.writeFile(pdfPath, pdfBytes);
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                SAMPLE.attachmentId,
                SAMPLE.workId,
                "pdf",
                pdfSha,
                pdfBytes.byteLength,
                "aurascholar-smoke.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                READER_ARCHIVED_SMOKE.attachmentId,
                READER_ARCHIVED_SMOKE.workId,
                "pdf",
                pdfSha,
                pdfBytes.byteLength,
                "reader-archived-smoke.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                MERGE_FAILURE_SMOKE.attachmentId,
                MERGE_FAILURE_SMOKE.duplicateId,
                "pdf",
                MERGE_FAILURE_SMOKE.attachmentSha,
                2048,
                "merge-failure.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "UPDATE attachments SET work_id = ?, deleted_at = NULL, updated_at = ? WHERE id = ?",
              [MERGE_FAILURE_SMOKE.duplicateId, now, MERGE_FAILURE_SMOKE.attachmentId]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO annotations (id, attachment_id, work_id, type, color, page_index, anchor_json, content_md, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                READER_ARCHIVED_SMOKE.annotationId,
                READER_ARCHIVED_SMOKE.attachmentId,
                READER_ARCHIVED_SMOKE.workId,
                "highlight",
                "#ffd866",
                0,
                JSON.stringify({
                  version: 1,
                  pageIndex: 0,
                  quote: { exact: "Archived Reader Smoke PDF", prefix: "", suffix: "" },
                  position: { start: 0, end: 26 }
                }),
                "Archived annotation should stay hidden until restore.",
                0,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO annotations (id, attachment_id, work_id, type, color, page_index, anchor_json, content_md, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                SAMPLE.annotationId,
                SAMPLE.attachmentId,
                SAMPLE.workId,
                "highlight",
                "#ffd866",
                0,
                JSON.stringify({
                  version: 1,
                  pageIndex: 0,
                  quote: { exact: "AuraScholar Smoke PDF", prefix: "", suffix: "" },
                  position: { start: 0, end: 23 }
                }),
                "Smoke reader note for delete confirmation.",
                0,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO snippets (id, work_id, page_index, quote, note_md, tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              [
                SNIPPET_SMOKE.id,
                SAMPLE.workId,
                0,
                SNIPPET_SMOKE.quote,
                null,
                "smoke",
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'active', ?, ?, NULL)",
              [
                LIBRARY_SENTINEL_LINK_SMOKE.id,
                LIBRARY_SENTINEL_LINK_SMOKE.doi,
                LIBRARY_SENTINEL_LINK_SMOKE.title,
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'active', ?, ?, NULL)",
              [
                SENTINEL_DUPLICATE_SMOKE.id,
                SENTINEL_DUPLICATE_SMOKE.doi,
                SENTINEL_DUPLICATE_SMOKE.title,
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, last_error, status, created_at, updated_at, deleted_at) VALUES (?, NULL, ?, ?, 'accepted', NULL, 86400, ?, ?, 2, ?, 'active', ?, ?, NULL)",
              [
                SENTINEL_ERROR_SMOKE.id,
                SENTINEL_ERROR_SMOKE.doi,
                SENTINEL_ERROR_SMOKE.title,
                now + 43_200_000,
                now - 3_600_000,
                SENTINEL_ERROR_SMOKE.error,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, last_error, status, created_at, updated_at, deleted_at) VALUES (?, NULL, ?, ?, 'accepted', ?, 86400, ?, NULL, 0, NULL, 'active', ?, ?, NULL)",
              [
                SENTINEL_MANUAL_FAILURE_SMOKE.id,
                SENTINEL_MANUAL_FAILURE_SMOKE.doi,
                SENTINEL_MANUAL_FAILURE_SMOKE.title,
                "{broken",
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'active', ?, ?, NULL)",
              [
                SENTINEL_DELETE_UNDO_SMOKE.id,
                SENTINEL_DELETE_UNDO_SMOKE.doi,
                SENTINEL_DELETE_UNDO_SMOKE.title,
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO sentinel_tasks (id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'paused', ?, ?, ?)",
              [
                SENTINEL_RESTORE_SMOKE.id,
                SENTINEL_RESTORE_SMOKE.doi,
                SENTINEL_RESTORE_SMOKE.title,
                now + 43_200_000,
                now,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO saved_searches (id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)",
              [
                SAVED_SEARCH_SMOKE.id,
                SAVED_SEARCH_SMOKE.query,
                null,
                "[]",
                now,
                now + 43_200_000,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO saved_searches (id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)",
              [
                SAVED_SEARCH_MANUAL_SMOKE.id,
                SAVED_SEARCH_MANUAL_SMOKE.query,
                "[]",
                "[]",
                now,
                now + 43_200_000,
                now + 1,
                now + 1
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO saved_searches (id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?)",
              [
                SAVED_SEARCH_HOME_OPEN_SMOKE.id,
                SAVED_SEARCH_HOME_OPEN_SMOKE.query,
                "[]",
                "[]",
                now - 1_000,
                now + 43_200_000,
                now + 2,
                now + 2
              ]
            );
            await window.aura.db.run(
              "UPDATE saved_searches SET query = ?, sources_json = ?, seen_ids_json = ?, new_count = 2, last_run_at = ?, next_run_at = ?, last_error = NULL, updated_at = ?, deleted_at = NULL WHERE id = ?",
              [
                SAVED_SEARCH_HOME_OPEN_SMOKE.query,
                "[]",
                "[]",
                now - 1_000,
                now + 43_200_000,
                now + 2,
                SAVED_SEARCH_HOME_OPEN_SMOKE.id
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO saved_searches (id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
              [
                SAVED_SEARCH_ERROR_SMOKE.id,
                SAVED_SEARCH_ERROR_SMOKE.query,
                null,
                "[]",
                now - 3_600_000,
                now + 43_200_000,
                SAVED_SEARCH_ERROR_SMOKE.error,
                now + 3,
                now + 3
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)",
              [
                DISCOVERY_SITE_SMOKE.id,
                DISCOVERY_SITE_SMOKE.name,
                DISCOVERY_SITE_SMOKE.homeUrl,
                DISCOVERY_SITE_SMOKE.searchUrl,
                990,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)",
              [
                REMOVABLE_DISCOVERY_SITE_SMOKE.id,
                REMOVABLE_DISCOVERY_SITE_SMOKE.name,
                REMOVABLE_DISCOVERY_SITE_SMOKE.homeUrl,
                REMOVABLE_DISCOVERY_SITE_SMOKE.searchUrl,
                991,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, 0, ?, ?)",
              [
                HIDDEN_DISCOVERY_SITE_SMOKE.id,
                HIDDEN_DISCOVERY_SITE_SMOKE.name,
                HIDDEN_DISCOVERY_SITE_SMOKE.homeUrl,
                HIDDEN_DISCOVERY_SITE_SMOKE.searchUrl,
                992,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, 0, ?, ?)",
              [
                MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.id,
                MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.name,
                MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.homeUrl,
                MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.searchUrl,
                993,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                BROKEN_BLOB.attachmentId,
                BROKEN_BLOB.workId,
                "pdf",
                BROKEN_BLOB.sha,
                1234,
                "missing-local-blob.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            const corruptBytes = new TextEncoder().encode("this is not a pdf");
            const corruptSha = await sha256Hex(corruptBytes);
            const corruptPath = "blobs/" + corruptSha.slice(0, 2) + "/" + corruptSha + ".pdf";
            await window.aura.fs.writeFile(corruptPath, corruptBytes);
            await window.aura.db.run(
              "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                CORRUPT_PDF.attachmentId,
                CORRUPT_PDF.workId,
                "pdf",
                corruptSha,
                corruptBytes.byteLength,
                "corrupt-local-pdf.pdf",
                "smoke",
                1,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                SAMPLE.doi,
                JSON.stringify({
                  centerId: "WsmokeReaderGraphCenter",
                  nodes: [
                    {
                      id: "WsmokeReaderGraphCenter",
                      title: SAMPLE.title,
                      year: 2026,
                      citedByCount: 9,
                      doi: SAMPLE.doi,
                      venue: SAMPLE.venue,
                      firstAuthor: SAMPLE.author,
                      relation: "center"
                    }
                  ],
                  edges: [],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                GRAPH_SMOKE.centerDoi,
                JSON.stringify({
                  centerId: "WsmokeGraphCenter",
                  nodes: [
                    {
                      id: "WsmokeGraphCenter",
                      title: GRAPH_SMOKE.centerTitle,
                      year: 2024,
                      citedByCount: 12,
                      doi: GRAPH_SMOKE.centerDoi,
                      venue: "Smoke Graph Journal",
                      firstAuthor: "Graph Center",
                      relation: "center"
                    },
                    {
                      id: "WsmokeGraphReference",
                      title: GRAPH_SMOKE.referenceTitle,
                      year: 2021,
                      citedByCount: 3,
                      doi: GRAPH_SMOKE.referenceDoi,
                      venue: "Smoke Reference Journal",
                      firstAuthor: "Graph Reference",
                      relation: "reference"
                    },
                    {
                      id: "WsmokeGraphImportSuccess",
                      title: GRAPH_SMOKE.successTitle,
                      year: 2025,
                      citedByCount: 7,
                      doi: GRAPH_SMOKE.successDoi,
                      venue: "Smoke Import Journal",
                      firstAuthor: "Graph Success",
                      relation: "citer"
                    }
                  ],
                  edges: [
                    { source: "WsmokeGraphCenter", target: "WsmokeGraphReference" },
                    { source: "WsmokeGraphImportSuccess", target: "WsmokeGraphCenter" }
                  ],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                GRAPH_SMOKE.raceOldDoi,
                JSON.stringify({
                  centerId: "WsmokeGraphRaceOld",
                  nodes: [
                    {
                      id: "WsmokeGraphRaceOld",
                      title: GRAPH_SMOKE.raceOldTitle,
                      year: 2023,
                      citedByCount: 1,
                      doi: GRAPH_SMOKE.raceOldDoi,
                      venue: "Smoke Graph Race Journal",
                      firstAuthor: "Graph Race Old",
                      relation: "center"
                    }
                  ],
                  edges: [],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                GRAPH_SMOKE.raceNewDoi,
                JSON.stringify({
                  centerId: "WsmokeGraphRaceNew",
                  nodes: [
                    {
                      id: "WsmokeGraphRaceNew",
                      title: GRAPH_SMOKE.raceNewTitle,
                      year: 2026,
                      citedByCount: 2,
                      doi: GRAPH_SMOKE.raceNewDoi,
                      venue: "Smoke Graph Race Journal",
                      firstAuthor: "Graph Race New",
                      relation: "center"
                    }
                  ],
                  edges: [],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
              [
                GRAPH_SMOKE.deepLinkDoi,
                JSON.stringify({
                  centerId: "WsmokeGraphDeepLink",
                  nodes: [
                    {
                      id: "WsmokeGraphDeepLink",
                      title: GRAPH_SMOKE.deepLinkTitle,
                      year: 2027,
                      citedByCount: 5,
                      doi: GRAPH_SMOKE.deepLinkDoi,
                      venue: "Smoke Graph Deep Link Journal",
                      firstAuthor: "Graph Deep Link",
                      relation: "center"
                    }
                  ],
                  edges: [],
                  truncated: false
                }),
                now
              ]
            );
            await window.aura.db.exec("COMMIT");
          } catch (error) {
            await window.aura.db.exec("ROLLBACK");
            throw error;
          }

          window.dispatchEvent(new Event("aurascholar:library-updated"));
          findButton("刷新")?.click();
          await waitFor(() => rowText().includes(SAMPLE.title) && rowText().includes(SAMPLE.author), 8_000);
          clickRowByTitle(SAMPLE.title);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title),
            3_000
          );
            await waitFor(
              () =>
                bodyIncludes("全文文件") &&
                bodyIncludes("当前阅读版本") &&
                bodyIncludes("aurascholar-smoke.pdf") &&
                bodyIncludes("1 页"),
              8_000
            );
            libraryPdfAttachmentVisible =
              bodyIncludes("全文文件") &&
              bodyIncludes("当前阅读版本") &&
              bodyIncludes("aurascholar-smoke.pdf") &&
              bodyIncludes("1 页") &&
              bodyIncludes("继续阅读");

            await selectLibraryDetailTab("脉络");
            const relatedPanelText = (
              document.querySelector("#library-detail-panel-related")?.textContent ?? ""
            ).replace(/\s+/g, " ");
            libraryCitationContextVisible =
              relatedPanelText.includes("引用脉络") &&
              relatedPanelText.includes("打开图谱") &&
              relatedPanelText.includes("参考") &&
              relatedPanelText.includes("被引");
            libraryContextualWorkflowsHidden =
              !relatedPanelText.includes("检索哨兵") &&
              !relatedPanelText.includes("Semantic Scholar") &&
              !relatedPanelText.includes("开始监控") &&
              !relatedPanelText.includes("按需读取 S2");

            await selectLibraryDetailTab("笔记");
            const canvasWorkspaceFixtureNow = Date.now();
            await window.aura.db.run(
              "INSERT OR IGNORE INTO canvas_workspaces (id, name, description, schema_version, viewport_json, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)",
              [
                "canvas:default",
                "研究画布",
                1,
                JSON.stringify({ x: 0, y: 0, zoom: 1 }),
                canvasWorkspaceFixtureNow,
                canvasWorkspaceFixtureNow
              ]
            );
            await window.aura.db.run(
              "DELETE FROM canvas_edges WHERE workspace_id = ?",
              ["canvas:default"]
            );
            await window.aura.db.run(
              "DELETE FROM canvas_nodes WHERE workspace_id = ?",
              ["canvas:default"]
            );
            window.dispatchEvent(new Event("aurascholar:canvas-updated"));
          const libraryRaceTitle = "Smoke Library Race Newer Refresh Wins";
          await window.aura.db.run("DELETE FROM works WHERE id = ?", [
            "smoke-library-refresh-race"
          ]);
          window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_DELAY_MS__ = 450;
          window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__ = 0;
          findButton("刷新")?.click();
          await waitFor(
            () => Number(window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__ ?? 0) >= 1,
            1_000
          );
          const libraryRaceNow = Date.now();
          await window.aura.db.run(
            "INSERT OR REPLACE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              "smoke-library-refresh-race",
              "10.4242/aurascholar.library-refresh-race",
              libraryRaceTitle,
              "A deterministic smoke-test paper for validating library refresh race handling.",
              2027,
              "Journal of Library UX",
              "article",
              "unread",
              0,
              libraryRaceNow + 1,
              libraryRaceNow + 1
            ]
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_DELAY_MS__ = 0;
          findButton("刷新")?.click();
          await waitFor(() => rowText().includes(libraryRaceTitle), 2_000);
          await wait(650);
          libraryRefreshRacePreserved =
            rowText().includes(libraryRaceTitle) && !bodyIncludes("浏览器预览无法读取本地文献库");
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_DELAY_MS__;
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_AFTER_READ_COUNT__;

          const positiveSearchRows = await window.aura.db.query(
            "SELECT w.id FROM works w JOIN works_fts f ON f.rowid = w.rowid WHERE works_fts MATCH ? AND w.deleted_at IS NULL",
            ['"Extreme"* "Consumer"*']
          );
          const negativeSearchRows = await window.aura.db.query(
            "SELECT w.id FROM works w JOIN works_fts f ON f.rowid = w.rowid WHERE works_fts MATCH ? AND w.deleted_at IS NULL",
            ['"NoMatchingSmokePaper"*']
          );
          searchDataPathOk =
            positiveSearchRows.some((row) => row.id === SAMPLE.workId) &&
            negativeSearchRows.length === 0;

          const searchInput = document.querySelector('input[placeholder="在结果中搜索"]');
          if (searchInput) {
            setInputValue(searchInput, "Extreme Consumer");
            await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
          }
          searchResultVisible = rowText().includes(SAMPLE.title);

          if (searchInput) {
            setInputValue(searchInput, "NoMatchingSmokePaper");
            await waitFor(() => bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title), 3_000);
            searchEmptyStateVisible = bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title);
            const clearEmptySearchButton = document.querySelector('button[aria-label="清除当前搜索"]');
            clearEmptySearchButton?.click();
            searchEmptyActionRestoresResults = Boolean(
              clearEmptySearchButton &&
                (await waitFor(
                  () =>
                    searchInput.value === "" &&
                    document.activeElement === searchInput &&
                    rowText().includes(SAMPLE.title),
                  3_000
                ))
            );
            setInputValue(searchInput, "NoMatchingSmokePaper");
            await waitFor(() => bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title), 3_000);
            const clearSearchButton = document.querySelector('button[aria-label="清除文献搜索"]');
            clearSearchButton?.click();
            searchClearButtonRestoresResults = Boolean(
              clearSearchButton &&
                (await waitFor(
                  () =>
                    searchInput.value === "" &&
                    document.activeElement === searchInput &&
                    rowText().includes(SAMPLE.title),
                  3_000
                ))
            );
            if (searchClearButtonRestoresResults) {
              setInputValue(searchInput, "NoMatchingSmokePaper");
              await waitFor(() => bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title), 3_000);

              const composingEscape = new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key: "Escape",
              });
              Object.defineProperty(composingEscape, "isComposing", {
                configurable: true,
                value: true,
              });
              searchInput.dispatchEvent(composingEscape);
              await wait(100);
              const compositionPreservedSearch =
                searchInput.value === "NoMatchingSmokePaper" &&
                bodyIncludes("当前筛选无结果") &&
                !rowText().includes(SAMPLE.title);

              searchInput.dispatchEvent(
                new KeyboardEvent("keydown", {
                  bubbles: true,
                  cancelable: true,
                  key: "Escape",
                })
              );
              searchEscapeClearsQuery = Boolean(
                compositionPreservedSearch &&
                  (await waitFor(
                    () =>
                      searchInput.value === "" &&
                      document.activeElement === searchInput &&
                      rowText().includes(SAMPLE.title),
                    3_000
                  ))
              );
            }
          } else {
            searchEmptyStateVisible = true;
            searchEmptyActionRestoresResults = true;
            searchClearButtonRestoresResults = true;
            searchEscapeClearsQuery = true;
          }

          clickRowByTitle(LIBRARY_UPLOAD_PDF.title);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
                LIBRARY_UPLOAD_PDF.title
              ) && bodyIncludes("上传 PDF"),
            3_000
          );
            const libraryUploadButton = () => {
              const panel = selectedLibrarySection("全文文件");
            return (
              Array.from(panel?.querySelectorAll("button") ?? []).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "上传 PDF" || label === "上传中..." || label === "上传新版本";
              }) ?? null
            );
          };
          const selectedPdfInput = Array.from(
            document.querySelectorAll('input[type="file"][accept="application/pdf"]')
          )[1];
          if (selectedPdfInput) {
            const uploadFile = new File(
              [makeSmokePdf("Library Detail Upload PDF")],
              "library-detail-upload.pdf",
              {
                type: "application/pdf"
              }
            );
            const uploadTransfer = new DataTransfer();
            uploadTransfer.items.add(uploadFile);
            Object.defineProperty(selectedPdfInput, "files", {
              configurable: true,
              value: uploadTransfer.files
            });
            selectedPdfInput.dispatchEvent(new Event("change", { bubbles: true }));
            libraryPdfUploadBusyVisible = Boolean(
              await waitFor(() => {
                const button = libraryUploadButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("上传中") &&
                  bodyIncludes("正在为《" + LIBRARY_UPLOAD_PDF.title + "》上传 PDF")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(async () => {
              const rows = await window.aura.db.query(
                "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL AND kind = 'pdf'",
                [LIBRARY_UPLOAD_PDF.workId]
              );
              return Number(rows[0]?.n ?? 0) >= 1;
            }, 10_000);
            await waitFor(
              () =>
                bodyIncludes("已为《" + LIBRARY_UPLOAD_PDF.title + "》上传 PDF") ||
                bodyIncludes("1 个可读") ||
                libraryUploadButton()?.textContent?.includes("上传新版本"),
              3_000
            );
            const uploadRows = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL AND kind = 'pdf'",
              [LIBRARY_UPLOAD_PDF.workId]
            );
            libraryPdfUploadPersisted = Number(uploadRows[0]?.n ?? 0) === 1;
            libraryPdfUploadSuccessVisible =
              libraryPdfUploadPersisted &&
              (bodyIncludes("已为《" + LIBRARY_UPLOAD_PDF.title + "》上传 PDF") ||
                bodyIncludes("1 个可读") ||
                Boolean(libraryUploadButton()?.textContent?.includes("上传新版本")));
          }

          clickRowByTitle(SAMPLE.title);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title),
            2_000
          );
          const sampleCheckbox = document.querySelector(
            '[data-library-row-id="' + SAMPLE.workId + '"] .library-checkbox-input'
          );
          if (sampleCheckbox && !sampleCheckbox.checked) {
            sampleCheckbox.click();
            await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
          }
          if (sampleCheckbox?.checked) {
            libraryBulkSelectMixedVisible = Boolean(
              await waitFor(() => {
                const pageSelectCheckbox = document.querySelector(
                  ".library-table__head .library-checkbox-input"
                );
                return pageSelectCheckbox instanceof HTMLInputElement &&
                  pageSelectCheckbox.indeterminate &&
                  pageSelectCheckbox.getAttribute("aria-checked") === "mixed";
              }, 1_000)
            );
          }
          const libraryCitationMenuButton = () => document.querySelector(".library-cite-menu > button");
          if (sampleCheckbox?.checked && libraryCitationMenuButton()) {
            const originalAnchorClick = HTMLAnchorElement.prototype.click;
            const originalCitationCreateObjectUrl = URL.createObjectURL;
            let libraryCitationDownloadCount = 0;
            let libraryCitationExportTextPromise = null;
            URL.createObjectURL = (blob) => {
              if (blob instanceof Blob) {
                libraryCitationExportTextPromise = blob.text().catch(() => "");
              }
              return "blob:aurascholar-citation-export-smoke";
            };
            HTMLAnchorElement.prototype.click = function () {
              if (this.download === "aurascholar-references.bib") {
                libraryCitationDownloadCount += 1;
                return;
              }
              return originalAnchorClick.call(this);
            };
            try {
              libraryCitationMenuButton()?.click();
              await waitFor(() => Boolean(findExactButton("BibTeX (.bib)")), 1_000);
              findExactButton("BibTeX (.bib)")?.click();
              await waitFor(
                () =>
                  libraryCitationMenuButton()?.disabled &&
                  libraryCitationMenuButton()?.textContent?.includes("导出中") &&
                  bodyIncludes("正在导出 1 篇文献的引用"),
                1_000
              );
              libraryCitationExportBusyVisible = Boolean(
                libraryCitationMenuButton()?.disabled &&
                  libraryCitationMenuButton()?.textContent?.includes("导出中") &&
                  bodyIncludes("正在导出 1 篇文献的引用")
              );
              await waitFor(
                () =>
                  !libraryCitationMenuButton()?.disabled &&
                  bodyIncludes("已导出 1 篇文献的引用(BIBTEX)"),
                2_000
              );
              const libraryCitationExportText = libraryCitationExportTextPromise
                ? await libraryCitationExportTextPromise
                : "";
              libraryCitationExportPmidVisible = libraryCitationExportText.includes(
                "pmid = {" + SAMPLE.pmid + "}"
              );
              libraryCitationExportSuccessVisible =
                libraryCitationDownloadCount === 1 &&
                libraryCitationExportPmidVisible &&
                !libraryCitationMenuButton()?.disabled &&
                bodyIncludes("已导出 1 篇文献的引用(BIBTEX)");
            } finally {
              URL.createObjectURL = originalCitationCreateObjectUrl;
              HTMLAnchorElement.prototype.click = originalAnchorClick;
            }

            const originalCreateObjectUrl = URL.createObjectURL;
            URL.createObjectURL = () => {
              throw new Error("smoke-citation-export-failed");
            };
            try {
              libraryCitationMenuButton()?.click();
              await waitFor(() => Boolean(findExactButton("RIS (.ris)")), 1_000);
              findExactButton("RIS (.ris)")?.click();
              await waitFor(
                () => bodyIncludes("导出失败:smoke-citation-export-failed"),
                2_000
              );
              libraryCitationExportFailureVisible = bodyIncludes(
                "导出失败:smoke-citation-export-failed"
              );
            } finally {
              URL.createObjectURL = originalCreateObjectUrl;
            }

            libraryCitationMenuButton()?.click();
            await waitFor(() => Boolean(findExactButton("APA 7th")), 1_000);
            findExactButton("APA 7th")?.click();
            await waitFor(
              () =>
                libraryCitationMenuButton()?.disabled &&
                libraryCitationMenuButton()?.textContent?.includes("复制中") &&
                bodyIncludes("正在复制 1 条参考文献"),
              1_000
            );
            libraryCitationCopyBusyVisible = Boolean(
              libraryCitationMenuButton()?.disabled &&
                libraryCitationMenuButton()?.textContent?.includes("复制中") &&
                bodyIncludes("正在复制 1 条参考文献")
            );
            await waitFor(
              () =>
                !libraryCitationMenuButton()?.disabled &&
                bodyIncludes("已复制 1 条参考文献到剪贴板"),
              2_000
            );
            let libraryCitationClipboardText = "";
            if (window.aura?.clipboard?.readText) {
              libraryCitationClipboardText = await window.aura.clipboard.readText();
            } else if (navigator.clipboard?.readText) {
              libraryCitationClipboardText = await navigator.clipboard.readText();
            }
            libraryCitationCopySuccessVisible =
              !libraryCitationMenuButton()?.disabled &&
              bodyIncludes("已复制 1 条参考文献到剪贴板") &&
              libraryCitationClipboardText.includes(SAMPLE.title);

            window.__AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__ = "smoke-citation-copy-failed";
            try {
              libraryCitationMenuButton()?.click();
              await waitFor(() => Boolean(findExactButton("IEEE")), 1_000);
              findExactButton("IEEE")?.click();
              await waitFor(
                () => bodyIncludes("复制失败:smoke-citation-copy-failed"),
                2_000
              );
              libraryCitationCopyFailureVisible = bodyIncludes(
                "复制失败:smoke-citation-copy-failed"
              );
            } finally {
              delete window.__AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__;
            }

            if (sampleCheckbox.checked) {
              sampleCheckbox.click();
              await waitFor(() => !bodyIncludes("已选 1 篇"), 1_000);
            }
          }

          if (searchInput) {
            setInputValue(searchInput, BULK_TRASH_FAILURE_SMOKE.query);
            await waitFor(
              () =>
                BULK_TRASH_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
              3_000
            );
            for (const work of BULK_TRASH_FAILURE_SMOKE.works) {
              const checkbox = document.querySelector(
                '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
              );
              if (checkbox && !checkbox.checked) checkbox.click();
            }
            await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
            const bulkTrashFailureButton = () =>
              Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "删除" || label === "移入中...";
              });
            const bulkTrashFailureRowsBefore = await window.aura.db.query(
              "SELECT id, deleted_at FROM works WHERE id IN (?, ?) ORDER BY id",
              BULK_TRASH_FAILURE_SMOKE.works.map((work) => work.workId)
            );
            bulkTrashFailureButton()?.click();
            const bulkTrashFailureDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("批量移入回收站？") ? dialog : null;
            }, 3_000);
            window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TRASH_AFTER_FIRST__ =
              BULK_TRASH_FAILURE_SMOKE.error;
            const bulkTrashFailureConfirmButton = Array.from(
              bulkTrashFailureDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "移入 2 篇");
            bulkTrashFailureConfirmButton?.click();
            libraryBulkTrashFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = bulkTrashFailureButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("移入中") &&
                  bodyIncludes("正在将 2 篇文献移入回收站")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("批量移入回收站失败，所选文献仍保留，可重新移入回收站") &&
                bodyIncludes(BULK_TRASH_FAILURE_SMOKE.error),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TRASH_AFTER_FIRST__;
            const bulkTrashFailureRowsAfter = await window.aura.db.query(
              "SELECT id, deleted_at FROM works WHERE id IN (?, ?) ORDER BY id",
              BULK_TRASH_FAILURE_SMOKE.works.map((work) => work.workId)
            );
            const bulkTrashFailureRetryButton = bulkTrashFailureButton();
            libraryBulkTrashFailureVisible =
              bodyIncludes("批量移入回收站失败，所选文献仍保留，可重新移入回收站") &&
              bodyIncludes(BULK_TRASH_FAILURE_SMOKE.error);
            libraryBulkTrashFailureDidNotPersist =
              bulkTrashFailureRowsBefore.length === BULK_TRASH_FAILURE_SMOKE.works.length &&
              bulkTrashFailureRowsAfter.length === BULK_TRASH_FAILURE_SMOKE.works.length &&
              bulkTrashFailureRowsBefore.every((row) => row.deleted_at == null) &&
              bulkTrashFailureRowsAfter.every((row) => row.deleted_at == null);
            libraryBulkTrashFailurePreserved =
              BULK_TRASH_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
              bodyIncludes("已选 2 篇") &&
              Boolean(bulkTrashFailureRetryButton) &&
              !bulkTrashFailureRetryButton?.disabled &&
              !document.querySelector('button[aria-label="撤销移入回收站"]');
            const bulkTrashFailureClearButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消选择");
            bulkTrashFailureClearButton?.click();
            await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);

            setInputValue(searchInput, TRASH_FAILURE_SMOKE.title);
            await waitFor(() => rowText().includes(TRASH_FAILURE_SMOKE.title), 3_000);
            clickRowByTitle(TRASH_FAILURE_SMOKE.title);
            const selectedDetailTitle = () =>
              document.querySelector(".library-detail--selected h2")?.textContent ?? "";
            await waitFor(
              () => selectedDetailTitle().includes(TRASH_FAILURE_SMOKE.title),
              3_000
            );
            const singleTrashButton = () =>
              Array.from(document.querySelectorAll(".library-detail--selected button")).find(
                (button) => {
                  const label = button.textContent?.replace(/\s+/g, " ").trim();
                  return label === "移入回收站" || label === "移入中...";
                }
              );
            const trashFailureRowsBefore = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? LIMIT 1",
              [TRASH_FAILURE_SMOKE.workId]
            );
            singleTrashButton()?.click();
            const trashFailureDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("移入回收站？") ? dialog : null;
            }, 3_000);
            window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH__ =
              TRASH_FAILURE_ERROR_SMOKE.error;
            const trashFailureConfirmButton = Array.from(
              trashFailureDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "移入回收站");
            trashFailureConfirmButton?.click();
            libraryTrashFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = singleTrashButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("移入中") &&
                  bodyIncludes("正在将《" + TRASH_FAILURE_SMOKE.title + "》移入回收站")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("移入回收站失败，文献仍保留，可重新移入回收站") &&
                bodyIncludes(TRASH_FAILURE_ERROR_SMOKE.error),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH__;
            const trashFailureRowsAfter = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? LIMIT 1",
              [TRASH_FAILURE_SMOKE.workId]
            );
            const retryTrashButton = singleTrashButton();
            libraryTrashFailureVisible =
              bodyIncludes("移入回收站失败，文献仍保留，可重新移入回收站") &&
              bodyIncludes(TRASH_FAILURE_ERROR_SMOKE.error);
            libraryTrashFailureDidNotPersist =
              trashFailureRowsBefore[0]?.deleted_at == null &&
              trashFailureRowsAfter[0]?.deleted_at == null;
            libraryTrashFailurePreserved =
              rowText().includes(TRASH_FAILURE_SMOKE.title) &&
              selectedDetailTitle().includes(TRASH_FAILURE_SMOKE.title) &&
              Boolean(retryTrashButton) &&
              !retryTrashButton?.disabled &&
              !document.querySelector('button[aria-label="撤销移入回收站"]');

            setInputValue(searchInput, TRASH_UNDO_SMOKE.title);
            await waitFor(() => rowText().includes(TRASH_UNDO_SMOKE.title), 3_000);
            const trashUndoCheckbox = document.querySelector(
              '[data-library-row-id="' + TRASH_UNDO_SMOKE.workId + '"] .library-checkbox-input'
            );
            if (trashUndoCheckbox && !trashUndoCheckbox.checked) {
              trashUndoCheckbox.click();
              await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
            }
            const trashUndoDeleteButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
            trashUndoDeleteButton?.click();
            const trashUndoDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("批量移入回收站？") ? dialog : null;
            }, 3_000);
            const trashUndoConfirmButton = Array.from(
              trashUndoDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "移入 1 篇");
            trashUndoConfirmButton?.click();
            await waitFor(
              () =>
                bodyIncludes("已将 1 篇文献移入回收站") &&
                Boolean(document.querySelector('button[aria-label="撤销移入回收站"]')),
              3_000
            );
            const trashUndoButton = document.querySelector('button[aria-label="撤销移入回收站"]');
            libraryTrashUndoVisible = Boolean(
              trashUndoButton &&
                bodyIncludes("已将 1 篇文献移入回收站") &&
                !rowText().includes(TRASH_UNDO_SMOKE.title)
            );
            window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE__ =
              TRASH_UNDO_RESTORE_FAILURE_SMOKE.error;
            trashUndoButton?.click();
            libraryTrashUndoFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = document.querySelector('button[aria-label="撤销移入回收站"]');
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("撤销中") &&
                  bodyIncludes("正在撤销移入回收站:1 篇文献")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("撤销移入回收站失败，撤销入口仍保留，可重新撤销") &&
                bodyIncludes(TRASH_UNDO_RESTORE_FAILURE_SMOKE.error),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE__;
            const trashUndoRowsAfterFailure = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? LIMIT 1",
              [TRASH_UNDO_SMOKE.workId]
            );
            const trashUndoButtonAfterFailure = document.querySelector(
              'button[aria-label="撤销移入回收站"]'
            );
            libraryTrashUndoFailureVisible =
              bodyIncludes("撤销移入回收站失败，撤销入口仍保留，可重新撤销") &&
              bodyIncludes(TRASH_UNDO_RESTORE_FAILURE_SMOKE.error);
            libraryTrashUndoFailureDidNotPersist =
              trashUndoRowsAfterFailure[0]?.deleted_at != null;
            libraryTrashUndoFailurePreserved =
              Boolean(trashUndoButtonAfterFailure) &&
              !trashUndoButtonAfterFailure?.disabled &&
              !rowText().includes(TRASH_UNDO_SMOKE.title);
            trashUndoButtonAfterFailure?.click();
            libraryTrashUndoBusyVisible = Boolean(
              await waitFor(() => {
                const button = document.querySelector('button[aria-label="撤销移入回收站"]');
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("撤销中") &&
                  bodyIncludes("正在撤销移入回收站:1 篇文献")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () => bodyIncludes("已撤销移入回收站") && rowText().includes(TRASH_UNDO_SMOKE.title),
              3_000
            );
            const trashUndoRows = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? LIMIT 1",
              [TRASH_UNDO_SMOKE.workId]
            );
            libraryTrashUndoRecovered =
              libraryTrashUndoVisible &&
              libraryTrashUndoBusyVisible &&
              bodyIncludes("已撤销移入回收站") &&
              rowText().includes(TRASH_UNDO_SMOKE.title) &&
              trashUndoRows[0]?.deleted_at == null;
            setInputValue(searchInput, "");
            await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
          }

            const libraryFilterTabGroup = () =>
              document.querySelector('.library-tabs[role="group"][aria-label="阅读状态筛选"]');
            const libraryFilterTab = (label) =>
              Array.from(libraryFilterTabGroup()?.querySelectorAll(".library-tab") ?? []).find(
                (button) => button.textContent?.includes(label)
              );
            const allInitialTab = libraryFilterTab("全部");
            const readingTab = libraryFilterTab("阅读中");
            libraryFilterTabsExposeState =
              Boolean(libraryFilterTabGroup()) &&
              allInitialTab?.getAttribute("aria-pressed") === "true" &&
              readingTab?.getAttribute("aria-pressed") === "false";

            const trashTab = document.querySelector(".app-sidebar-trash");
            trashTab?.click();
          await waitFor(
            () =>
              document.querySelector('input[placeholder="搜索回收站"]') &&
              bodyIncludes(TRASH_ACTION_SMOKE.title),
            3_000
            );
            libraryFilterTabsExposeState =
              libraryFilterTabsExposeState &&
              Boolean(document.querySelector(".app-sidebar-trash--active"));
          const trashSearchInput = document.querySelector('input[placeholder="搜索回收站"]');
          if (trashSearchInput) {
            setInputValue(trashSearchInput, TRASH_PURGE_FAILURE_SMOKE.query);
            await waitFor(
              () =>
                TRASH_PURGE_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
              3_000
            );
            for (const work of TRASH_PURGE_FAILURE_SMOKE.works) {
              const checkbox = document.querySelector(
                '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
              );
              if (checkbox && !checkbox.checked) checkbox.click();
            }
            await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
            const trashPurgeFailureButton = () =>
              Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "永久删除" || label === "删除中...";
              });
            const purgeFailureRowsBefore = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id IN (?, ?) AND deleted_at IS NOT NULL",
              [
                TRASH_PURGE_FAILURE_SMOKE.works[0].workId,
                TRASH_PURGE_FAILURE_SMOKE.works[1].workId
              ]
            );
            trashPurgeFailureButton()?.click();
            const trashPurgeFailureDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("永久删除文献？") ? dialog : null;
            }, 3_000);
            const trashPurgeFailureConfirmButton = Array.from(
              trashPurgeFailureDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "永久删除");
            const trashPurgeFailurePhraseInput = trashPurgeFailureDialog?.querySelector(
              ".library-confirm-modal__phrase input"
            );
            if (trashPurgeFailurePhraseInput) {
              setInputValue(trashPurgeFailurePhraseInput, "永久删除");
              await waitFor(() => !trashPurgeFailureConfirmButton?.disabled, 1_000);
            }
            await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_purge_failure");
            await window.aura.db.exec(
              "CREATE TEMP TRIGGER aurascholar_smoke_purge_failure BEFORE DELETE ON works WHEN OLD.id = 'smoke-work-trash-purge-failure-b' BEGIN SELECT RAISE(FAIL, 'Smoke library trash purge rollback failure'); END;"
            );
            trashPurgeFailureConfirmButton?.click();
            libraryTrashPurgeFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = trashPurgeFailureButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("删除中") &&
                  bodyIncludes("正在永久删除 2 篇文献")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("永久删除失败，所选文献仍保留在回收站，可重新永久删除") &&
                bodyIncludes(TRASH_PURGE_FAILURE_SMOKE.error),
              3_000
            );
            await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_purge_failure");
            const purgeFailureRowsAfter = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id IN (?, ?) AND deleted_at IS NOT NULL",
              [
                TRASH_PURGE_FAILURE_SMOKE.works[0].workId,
                TRASH_PURGE_FAILURE_SMOKE.works[1].workId
              ]
            );
            const trashPurgeFailureRetryButton = trashPurgeFailureButton();
            libraryTrashPurgeFailureVisible =
              bodyIncludes("永久删除失败，所选文献仍保留在回收站，可重新永久删除") &&
              bodyIncludes(TRASH_PURGE_FAILURE_SMOKE.error);
            libraryTrashPurgeFailureDidNotPersist =
              Number(purgeFailureRowsBefore[0]?.n ?? 0) ===
                TRASH_PURGE_FAILURE_SMOKE.works.length &&
              Number(purgeFailureRowsAfter[0]?.n ?? 0) ===
                TRASH_PURGE_FAILURE_SMOKE.works.length;
            libraryTrashPurgeFailurePreserved =
              TRASH_PURGE_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
              bodyIncludes("已选 2 篇") &&
              Boolean(trashPurgeFailureRetryButton) &&
              !trashPurgeFailureRetryButton?.disabled;
            const trashPurgeFailureClearButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消选择");
            trashPurgeFailureClearButton?.click();
            await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);

            setInputValue(trashSearchInput, TRASH_RESTORE_FAILURE_SMOKE.query);
            await waitFor(
              () =>
                TRASH_RESTORE_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
              3_000
            );
            for (const work of TRASH_RESTORE_FAILURE_SMOKE.works) {
              const checkbox = document.querySelector(
                '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
              );
              if (checkbox && !checkbox.checked) checkbox.click();
            }
            await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
            const trashRestoreFailureButton = () =>
              Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "恢复" || label === "恢复中...";
              });
            const restoreFailureRowsBefore = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id IN (?, ?) AND deleted_at IS NOT NULL",
              [
                TRASH_RESTORE_FAILURE_SMOKE.works[0].workId,
                TRASH_RESTORE_FAILURE_SMOKE.works[1].workId
              ]
            );
            window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE_AFTER_FIRST__ =
              TRASH_RESTORE_FAILURE_SMOKE.error;
            trashRestoreFailureButton()?.click();
            libraryTrashRestoreFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = trashRestoreFailureButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("恢复中") &&
                  bodyIncludes("正在恢复 2 篇文献")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("恢复文献失败，所选文献仍保留在回收站，可重新恢复") &&
                bodyIncludes(TRASH_RESTORE_FAILURE_SMOKE.error),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TRASH_RESTORE_AFTER_FIRST__;
            const restoreFailureRowsAfter = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id IN (?, ?) AND deleted_at IS NOT NULL",
              [
                TRASH_RESTORE_FAILURE_SMOKE.works[0].workId,
                TRASH_RESTORE_FAILURE_SMOKE.works[1].workId
              ]
            );
            const trashRestoreFailureRetryButton = trashRestoreFailureButton();
            libraryTrashRestoreFailureVisible =
              bodyIncludes("恢复文献失败，所选文献仍保留在回收站，可重新恢复") &&
              bodyIncludes(TRASH_RESTORE_FAILURE_SMOKE.error);
            libraryTrashRestoreFailureDidNotPersist =
              Number(restoreFailureRowsBefore[0]?.n ?? 0) ===
                TRASH_RESTORE_FAILURE_SMOKE.works.length &&
              Number(restoreFailureRowsAfter[0]?.n ?? 0) ===
                TRASH_RESTORE_FAILURE_SMOKE.works.length;
            libraryTrashRestoreFailurePreserved =
              TRASH_RESTORE_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
              bodyIncludes("已选 2 篇") &&
              Boolean(trashRestoreFailureRetryButton) &&
              !trashRestoreFailureRetryButton?.disabled;
            const trashRestoreFailureClearButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消选择");
            trashRestoreFailureClearButton?.click();
            await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);

            setInputValue(trashSearchInput, TRASH_PURGE_SMOKE.title);
            await waitFor(() => rowText().includes(TRASH_PURGE_SMOKE.title), 3_000);
            const trashPurgeCheckbox = document.querySelector(
              '[data-library-row-id="' + TRASH_PURGE_SMOKE.workId + '"] .library-checkbox-input'
            );
            if (trashPurgeCheckbox && !trashPurgeCheckbox.checked) {
              trashPurgeCheckbox.click();
              await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
            }
            const trashPurgeButton = () =>
              Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "永久删除" || label === "删除中...";
              });
            trashPurgeButton()?.click();
            const trashPurgeDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("永久删除文献？") ? dialog : null;
            }, 3_000);
            const trashPurgeConfirmButton = Array.from(
              trashPurgeDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "永久删除");
            const trashPurgePhraseInput = trashPurgeDialog?.querySelector(
              ".library-confirm-modal__phrase input"
            );
            const blockedRows = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id = ?",
              [TRASH_PURGE_SMOKE.workId]
            );
            libraryTrashPurgeTypedConfirmProtected =
              Boolean(trashPurgeConfirmButton?.disabled) &&
              Boolean(trashPurgePhraseInput) &&
              bodyIncludes("输入“永久删除”后才会启用确认按钮。") &&
              Number(blockedRows[0]?.n ?? 0) === 1;
            if (trashPurgePhraseInput) {
              setInputValue(trashPurgePhraseInput, "永久删除");
              await waitFor(() => !trashPurgeConfirmButton?.disabled, 1_000);
            }
            trashPurgeConfirmButton?.click();
            await waitFor(
              () =>
                trashPurgeButton()?.disabled &&
                trashPurgeButton()?.getAttribute("aria-busy") === "true" &&
                trashPurgeButton()?.textContent?.includes("删除中") &&
                bodyIncludes("正在永久删除 1 篇文献"),
              1_000
            );
            libraryTrashPurgeBusyVisible = Boolean(
              trashPurgeButton()?.disabled &&
                trashPurgeButton()?.getAttribute("aria-busy") === "true" &&
                trashPurgeButton()?.textContent?.includes("删除中") &&
                bodyIncludes("正在永久删除 1 篇文献")
            );
            await waitFor(
              () => bodyIncludes("已永久删除 1 篇文献") && !rowText().includes(TRASH_PURGE_SMOKE.title),
              3_000
            );
            const purgedRows = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM works WHERE id = ?",
              [TRASH_PURGE_SMOKE.workId]
            );
            libraryTrashPurgePersisted =
              bodyIncludes("已永久删除 1 篇文献") && Number(purgedRows[0]?.n ?? 0) === 0;
            setInputValue(trashSearchInput, "");
            await waitFor(() => bodyIncludes(TRASH_ACTION_SMOKE.title), 3_000);
          }
          const trashActionCheckbox = document.querySelector(
            '[data-library-row-id="' + TRASH_ACTION_SMOKE.workId + '"] .library-checkbox-input'
          );
          if (trashActionCheckbox && !trashActionCheckbox.checked) {
            trashActionCheckbox.click();
            await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
          }
          const trashRestoreButton = () =>
            Array.from(document.querySelectorAll(".library-bulkbar button")).find((button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "恢复" || label === "恢复中...";
            });
          if (trashActionCheckbox?.checked && trashRestoreButton()) {
            trashRestoreButton()?.click();
            await waitFor(
              () =>
                trashRestoreButton()?.disabled &&
                trashRestoreButton()?.textContent?.includes("恢复中") &&
                bodyIncludes("正在恢复 1 篇文献"),
              1_000
            );
            libraryTrashRestoreBusyVisible = Boolean(
              trashRestoreButton()?.disabled &&
                trashRestoreButton()?.textContent?.includes("恢复中") &&
                bodyIncludes("正在恢复 1 篇文献")
            );
            await waitFor(
              () => bodyIncludes("已恢复 1 篇文献") && !bodyIncludes(TRASH_ACTION_SMOKE.title),
              3_000
            );
            const restoredRows = await window.aura.db.query(
              "SELECT deleted_at FROM works WHERE id = ? LIMIT 1",
              [TRASH_ACTION_SMOKE.workId]
            );
            libraryTrashRestoreSuccessVisible =
              bodyIncludes("已恢复 1 篇文献") && restoredRows[0]?.deleted_at == null;
            }
            if (!location.hash.includes("/reader")) {
              findExactButton("返回全部文献")?.click();
            }
          await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
          libraryFilterTabsExposeState =
            libraryFilterTabsExposeState &&
            libraryFilterTab("全部")?.getAttribute("aria-pressed") === "true";

            window.dispatchEvent(
            new CustomEvent("aurascholar:library-view", {
              detail: { filter: "all", tag: SAMPLE.tag },
            })
            );
            await waitFor(() => rowText().includes(SAMPLE.title) && bodyIncludes("标签 " + SAMPLE.tag), 3_000);
            libraryFilterTab("重点")?.click();
          await waitFor(() => bodyIncludes("当前筛选无结果") && !rowText().includes(SAMPLE.title), 3_000);
          const clearFilterEmptyButton = document.querySelector('button[aria-label="清除当前筛选"]');
          clearFilterEmptyButton?.click();
          libraryFilterEmptyActionRestoresResults = Boolean(
            clearFilterEmptyButton &&
              (await waitFor(
                () =>
                  rowText().includes(SAMPLE.title) &&
                  libraryFilterTab("全部")?.getAttribute("aria-pressed") === "true" &&
                  !bodyIncludes("当前筛选无结果"),
                3_000
              ))
          );

          clickRowByTitle(SAMPLE.title);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title),
            2_000
          );
          const selectedReadingStatusButton = () => {
            const detail = document.querySelector(".library-detail--selected");
            return (
              Array.from(detail?.querySelectorAll(".library-reading-toggle button") ?? []).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "阅读中" || label === "更新中...";
              }) ?? null
            );
          };
          const readingStatusRowsBeforeFailure = await window.aura.db.query(
            "SELECT reading_status FROM works WHERE id = ? LIMIT 1",
            [SAMPLE.workId]
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READING_STATUS__ =
            "Smoke library reading status failure";
          selectedReadingStatusButton()?.click();
          libraryReadingStatusFailureBusyVisible = Boolean(
            await waitFor(() => {
              const detail = document.querySelector(".library-detail--selected");
              const busyButton = Array.from(
                detail?.querySelectorAll(".library-reading-toggle button") ?? []
              ).find((button) => button.getAttribute("aria-busy") === "true");
              return busyButton?.disabled &&
                busyButton.textContent?.includes("更新中") &&
                bodyIncludes("正在更新阅读状态:阅读中")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("更新阅读状态失败，阅读状态仍保留，可重新更新") &&
              bodyIncludes("Smoke library reading status failure"),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_READING_STATUS__;
          const readingStatusRowsAfterFailure = await window.aura.db.query(
            "SELECT reading_status FROM works WHERE id = ? LIMIT 1",
            [SAMPLE.workId]
          );
          const activeReadingStatusLabelAfterFailure =
            document
              .querySelector(".library-detail--selected .library-reading-toggle__active")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ?? "";
          libraryReadingStatusFailureVisible =
            bodyIncludes("更新阅读状态失败，阅读状态仍保留，可重新更新") &&
            bodyIncludes("Smoke library reading status failure");
          libraryReadingStatusFailureDidNotPersist =
            readingStatusRowsAfterFailure[0]?.reading_status ===
            readingStatusRowsBeforeFailure[0]?.reading_status;
          libraryReadingStatusFailurePreserved =
            libraryReadingStatusFailureVisible &&
            libraryReadingStatusFailureDidNotPersist &&
            activeReadingStatusLabelAfterFailure === "未读" &&
            selectedReadingStatusButton()?.textContent?.replace(/\s+/g, " ").trim() === "阅读中";

          selectedReadingStatusButton()?.click();
          libraryReadingStatusBusyVisible = Boolean(
            await waitFor(() => {
              const detail = document.querySelector(".library-detail--selected");
              const busyButton = Array.from(
                detail?.querySelectorAll(".library-reading-toggle button") ?? []
              ).find((button) => button.getAttribute("aria-busy") === "true");
              return busyButton?.disabled &&
                busyButton.textContent?.includes("更新中") &&
                bodyIncludes("正在更新阅读状态:阅读中")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("已更新阅读状态:阅读中"), 3_000);
          libraryReadingStatusSuccessVisible = bodyIncludes("已更新阅读状态:阅读中");
          seededWorkCount = await window.aura.db.queryScalar("SELECT COUNT(*) FROM works");
          const statusRows = await window.aura.db.query(
            "SELECT reading_status FROM works WHERE id = ? LIMIT 1",
            [SAMPLE.workId]
          );
          readingStatus = statusRows[0]?.reading_status ?? null;
          libraryReadingStatusPersisted = readingStatus === "reading";

          const selectedDetailStarButton = () => {
            const detail = document.querySelector(".library-detail--selected");
            return (
              Array.from(detail?.querySelectorAll(".library-panel-actions button") ?? []).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return (
                  label === "标为重点" ||
                  label === "取消重点" ||
                  label === "标记中..." ||
                  label === "取消中..."
                );
              }) ?? null
            );
          };
          const libraryStarButton = selectedDetailStarButton();
          if (libraryStarButton) {
            const starTarget = !libraryStarButton.textContent?.includes("取消重点");
            const busyLabel = starTarget ? "标记中" : "取消中";
            const busyMessage = starTarget
              ? "正在标记重点:《" + SAMPLE.title + "》"
              : "正在取消重点:《" + SAMPLE.title + "》";
            const successMessage = starTarget
              ? "已标记重点:《" + SAMPLE.title + "》"
              : "已取消重点:《" + SAMPLE.title + "》";
            const starRowsBeforeFailure = await window.aura.db.query(
              "SELECT starred FROM works WHERE id = ? LIMIT 1",
              [SAMPLE.workId]
            );
            window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_STAR__ =
              "Smoke library star failure";
            libraryStarButton.click();
            libraryStarFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = selectedDetailStarButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes(busyLabel) &&
                  bodyIncludes(busyMessage)
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("更新重点状态失败，重点状态仍保留，可重新切换") &&
                bodyIncludes("Smoke library star failure"),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_STAR__;
            const starRowsAfterFailure = await window.aura.db.query(
              "SELECT starred FROM works WHERE id = ? LIMIT 1",
              [SAMPLE.workId]
            );
            libraryStarFailureVisible =
              bodyIncludes("更新重点状态失败，重点状态仍保留，可重新切换") &&
              bodyIncludes("Smoke library star failure");
            libraryStarFailureDidNotPersist =
              Number(starRowsAfterFailure[0]?.starred ?? -1) ===
              Number(starRowsBeforeFailure[0]?.starred ?? -2);
            libraryStarFailurePreserved =
              libraryStarFailureVisible &&
              libraryStarFailureDidNotPersist &&
              selectedDetailStarButton()?.textContent?.replace(/\s+/g, " ").trim() ===
                (starTarget ? "标为重点" : "取消重点");

            selectedDetailStarButton()?.click();
            libraryStarBusyVisible = Boolean(
              await waitFor(() => {
                const button = selectedDetailStarButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes(busyLabel) &&
                  bodyIncludes(busyMessage)
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(() => bodyIncludes(successMessage), 3_000);
            libraryStarSuccessVisible = bodyIncludes(successMessage);
            const starRows = await window.aura.db.query(
              "SELECT starred FROM works WHERE id = ? LIMIT 1",
              [SAMPLE.workId]
            );
            libraryStarPersisted = Number(starRows[0]?.starred ?? -1) === (starTarget ? 1 : 0);
          }

        }

        await window.aura.db.run("DELETE FROM canvas_nodes WHERE id = ?", [
          "smoke-app-shell-canvas-stats-race"
        ]);
        window.dispatchEvent(new Event("aurascholar:canvas-updated"));
        const appShellCanvasCountBefore = Number(
          await window.aura.db.queryScalar("SELECT COUNT(*) FROM canvas_nodes")
        );
        await waitFor(
          () => statusbarMetric("白板节点") === appShellCanvasCountBefore,
          3_000
        );
        window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_DELAY_MS__ = 450;
        window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_COUNT__ = 0;
        window.dispatchEvent(new Event("aurascholar:canvas-updated"));
        await waitFor(
          () => Number(window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_COUNT__ ?? 0) >= 1,
          1_000
        );
        const appShellRaceNow = Date.now();
        await window.aura.db.run(
          "INSERT OR REPLACE INTO canvas_nodes (id, workspace_id, work_id, type, pos_x, pos_y, width, height, group_id, sort_order, tags_json, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            "smoke-app-shell-canvas-stats-race",
            "canvas:default",
            null,
            "idea-note",
            536,
            140,
            300,
            220,
            null,
            999,
            "[]",
            JSON.stringify({
              title: "Smoke canvas status race",
              contentMarkdown: "Persisted canvas node for app-shell count refresh.",
              hasEquations: false
            }),
            appShellRaceNow,
            appShellRaceNow
          ]
        );
        const appShellCanvasCountAfter = appShellCanvasCountBefore + 1;
        window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_DELAY_MS__ = 0;
        window.dispatchEvent(new Event("aurascholar:canvas-updated"));
        await waitFor(
          () => statusbarMetric("白板节点") === appShellCanvasCountAfter,
          2_000
        );
        await wait(650);
        appShellCanvasStatsRacePreserved =
          statusbarMetric("白板节点") === appShellCanvasCountAfter &&
          Number(await window.aura.db.queryScalar("SELECT COUNT(*) FROM canvas_nodes")) ===
            appShellCanvasCountAfter;
        delete window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_DELAY_MS__;
        delete window.__AURASCHOLAR_SMOKE_APP_STATS_AFTER_READ_COUNT__;
        detailVisible =
          (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title) &&
          bodyIncludes(SAMPLE.venue);
        populatedStateVisible =
          rowText().includes(SAMPLE.title) &&
          rowText().includes(SAMPLE.author) &&
          bodyIncludes(SAMPLE.tag);
        libraryBodyText = document.body.innerText;
        libraryHash = location.hash;
        libraryHeading = text("h1");
        const librarySidebarMeta = document.querySelector(".app-sidebar-meta");
        const librarySidebarHealth = document.querySelector(".app-shell-health");
        librarySidebarMetaVisible = Boolean(librarySidebarMeta);
        if (librarySidebarMeta) {
          const metaRect = librarySidebarMeta.getBoundingClientRect();
          const healthRect = librarySidebarHealth?.getBoundingClientRect();
          const healthStyle = librarySidebarHealth
            ? window.getComputedStyle(librarySidebarHealth)
            : null;
          const healthVisible = Boolean(
            librarySidebarHealth &&
              healthStyle?.display !== "none" &&
              healthStyle?.visibility !== "hidden" &&
              healthStyle?.opacity !== "0" &&
              healthRect &&
              healthRect.width > 0 &&
              healthRect.height > 0
          );
          const overlapsHealth = Boolean(
            healthVisible &&
              healthRect &&
              metaRect.left < healthRect.right &&
              metaRect.right > healthRect.left &&
              metaRect.top < healthRect.bottom &&
              metaRect.bottom > healthRect.top
          );
          librarySidebarHealthHidden = !healthVisible && !overlapsHealth;
          const sidebarRect = document.querySelector(".app-sidebar")?.getBoundingClientRect();
          const organizerActions = [
            'button[title="新建目录"]',
            'button[title="管理目录（管理文件夹）"]',
            'button[title="新建标签"]',
            'button[title="管理标签"]'
          ].map((selector) => librarySidebarMeta.querySelector(selector));
          librarySidebarOrganizerActionsVisible =
            organizerActions.every((action) => {
              if (!action || !sidebarRect) return false;
              const rect = action.getBoundingClientRect();
              const style = window.getComputedStyle(action);
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0 &&
                rect.top >= sidebarRect.top &&
                rect.bottom <= sidebarRect.bottom
              );
            }) && !document.querySelector(".app-sidebar--library .app-workspace-card");
        }
        commandShortcutLabel = text(".app-command-trigger kbd");
        librarySearchShortcutLabel = text(".library-inline-search .au-kbd");
        const appShortcutUsesMeta = isMacShortcut();
        const librarySearchInputForCommandShortcut = document.querySelector(
          'input[placeholder="在结果中搜索"]'
        );
        librarySearchInputForCommandShortcut?.focus?.();
        librarySearchInputForCommandShortcut?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: appShortcutUsesMeta,
            key: "k",
            metaKey: !appShortcutUsesMeta
          })
        );
        await wait(100);
        commandNonPlatformShortcutIgnored =
          !document.querySelector('[role="dialog"]') &&
          (!librarySearchInputForCommandShortcut ||
            document.activeElement === librarySearchInputForCommandShortcut);

        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: !appShortcutUsesMeta,
            key: "k",
            metaKey: appShortcutUsesMeta
          })
        );
        await waitFor(() => document.querySelector('[role="dialog"]'), 2_000);
        commandShortcutToggleOpens = Boolean(
          document.querySelector('[role="dialog"]')?.textContent?.includes("全局命令")
        );
        const commandToggleSearch = document.querySelector('input[aria-label="搜索命令"]');
        commandToggleSearch?.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: !appShortcutUsesMeta,
            key: "k",
            metaKey: appShortcutUsesMeta
          })
        );
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        commandShortcutToggleCloses =
          commandShortcutToggleOpens && !document.querySelector('[role="dialog"]');

        const commandTrigger = findButton("快速打开");
        commandTrigger?.focus();
        commandTrigger?.click();
        await waitFor(() => document.querySelector('[role="dialog"]'), 2_000);
        const commandDialogOpen = Boolean(
          document.querySelector('[role="dialog"]')?.textContent?.includes("全局命令")
        );
        const commandSearch = document.querySelector('input[aria-label="搜索命令"]');
        if (commandSearch) {
          setInputValue(commandSearch, "NoMatchingCommandSmoke");
          await waitFor(() => bodyIncludes("没有匹配命令"), 1_000);
          const clearCommandSearchButton = document.querySelector('button[aria-label="清空命令搜索"]');
          clearCommandSearchButton?.click();
          commandEmptyActionRestoresResults = Boolean(
            clearCommandSearchButton &&
              (await waitFor(
                () =>
                  commandSearch.value === "" &&
                  document.activeElement === commandSearch &&
                  document.querySelectorAll(".app-command-item").length > 0,
                1_000
              ))
          );
          const commandList = document.querySelector(".app-command-list");
          if (commandList instanceof HTMLElement) {
            commandList.style.maxHeight = "180px";
            commandList.scrollTop = 0;
            for (let i = 0; i < 12; i += 1) {
              commandSearch.dispatchEvent(
                new KeyboardEvent("keydown", {
                  bubbles: true,
                  cancelable: true,
                  key: "ArrowDown"
                })
              );
            }
            commandKeyboardNavigationKeepsActiveVisible = Boolean(
              await waitFor(() => {
                const activeCommandItem = document.querySelector(
                  ".app-command-item[aria-selected='true']"
                );
                if (!(activeCommandItem instanceof HTMLElement) || commandList.scrollTop <= 0) {
                  return false;
                }
                const listRect = commandList.getBoundingClientRect();
                const itemRect = activeCommandItem.getBoundingClientRect();
                return itemRect.top >= listRect.top - 1 && itemRect.bottom <= listRect.bottom + 1;
              }, 1_500)
            );
          }
          const beforeCommandHash = location.hash;
          const composingCommandEnter = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter"
          });
          Object.defineProperty(composingCommandEnter, "isComposing", {
            configurable: true,
            value: true
          });
          Object.defineProperty(composingCommandEnter, "keyCode", {
            configurable: true,
            value: 229
          });
          commandSearch.dispatchEvent(composingCommandEnter);
          await wait(100);
          commandCompositionIgnored =
            location.hash === beforeCommandHash &&
            Boolean(document.querySelector('[role="dialog"]')?.textContent?.includes("全局命令"));
          const composingCommandEscape = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape"
          });
          Object.defineProperty(composingCommandEscape, "isComposing", {
            configurable: true,
            value: true
          });
          Object.defineProperty(composingCommandEscape, "keyCode", {
            configurable: true,
            value: 229
          });
          commandSearch.dispatchEvent(composingCommandEscape);
          await wait(100);
          commandCompositionEscapeIgnored = Boolean(
            document.querySelector('[role="dialog"]')?.textContent?.includes("全局命令")
          );
        }
        commandSearch?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        commandCloseRestoresFocus = Boolean(
          commandTrigger &&
            (await waitFor(() => document.activeElement === commandTrigger, 1_000))
        );

        findButton("快速打开")?.click();
        await waitFor(() => document.querySelector('[role="dialog"]'), 2_000);
        const targetedCommandSearch = document.querySelector('input[aria-label="搜索命令"]');
        if (targetedCommandSearch) {
          setInputValue(targetedCommandSearch, "翻译");
          await waitFor(() => bodyIncludes("配置阅读翻译"), 1_000);
          commandTargetedSettingsActionVisible = Boolean(
            Array.from(document.querySelectorAll(".app-command-item")).find((item) =>
              item.textContent?.includes("配置阅读翻译")
            )
          );
          targetedCommandSearch.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "Enter"
            })
          );
          await waitFor(
            () =>
              location.hash.includes("/settings?section=translate") &&
              Boolean(
                document.querySelector('[data-settings-section="translate"].settings-card--targeted')
              ),
            3_000
          );
          commandTargetedSettingsActionTargetsSection =
            location.hash.includes("/settings?section=translate") &&
            Boolean(
              document.querySelector('[data-settings-section="translate"].settings-card--targeted')
            );
          location.hash = "#/library";
          await waitFor(
            () =>
              location.hash.includes("/library") &&
              Boolean(document.querySelector(".library-page")) &&
              bodyIncludes("文献库"),
            4_000
          );
        }

        const librarySearchInput = document.querySelector('input[placeholder="在结果中搜索"]');
        findButton("快速打开")?.focus();
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: appShortcutUsesMeta,
            key: "f",
            metaKey: !appShortcutUsesMeta
          })
        );
        await wait(100);
        librarySearchNonPlatformShortcutIgnored =
          Boolean(librarySearchInput) && document.activeElement !== librarySearchInput;
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: !appShortcutUsesMeta,
            key: "f",
            metaKey: appShortcutUsesMeta
          })
        );
        await waitFor(() => document.activeElement === librarySearchInput, 1_000);
        librarySearchShortcutFocused =
          Boolean(librarySearchInput) && document.activeElement === librarySearchInput;
        librarySearchInput?.blur();

        if (librarySearchInput) {
          findExactButton("取消选择")?.click();
          setInputValue(librarySearchInput, MOVE_COLLECTION_FAILURE_SMOKE.query);
          await waitFor(
            () =>
              MOVE_COLLECTION_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
            3_000
          );
          for (const work of MOVE_COLLECTION_FAILURE_SMOKE.works) {
            const checkbox = document.querySelector(
              '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
            );
            if (checkbox && !checkbox.checked) checkbox.click();
          }
          await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
          const moveFailureRowsBefore = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collection_items WHERE work_id IN (?, ?) AND collection_id = ?",
            [
              MOVE_COLLECTION_FAILURE_SMOKE.works[0].workId,
              MOVE_COLLECTION_FAILURE_SMOKE.works[1].workId,
              MOVE_COLLECTION_SMOKE.id
            ]
          );
          findExactButton("移动到文件夹")?.click();
          const moveFailureDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("移动到文件夹")
            );
            return dialog?.textContent?.includes(MOVE_COLLECTION_SMOKE.name) ? dialog : null;
          }, 2_000);
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_MOVE_AFTER_FIRST__ =
            MOVE_COLLECTION_FAILURE_SMOKE.error;
          const moveFailureTargetButton = Array.from(
            moveFailureDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.includes(MOVE_COLLECTION_SMOKE.name));
          moveFailureTargetButton?.click();
          libraryMoveToCollectionFailureBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("移动到文件夹")
              );
              const button = Array.from(dialog?.querySelectorAll("button") ?? []).find((item) =>
                item.textContent?.includes(MOVE_COLLECTION_SMOKE.name)
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                button?.getAttribute("aria-busy") === "true" &&
                button.disabled &&
                button.textContent?.includes("移动中") &&
                dialog.textContent?.includes("正在移动 2 篇文献")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("移动文件夹失败，所选文献仍保留在原文件夹，可重新移动") &&
              bodyIncludes("移动失败，所选文献仍保留，可重新移动。") &&
              bodyIncludes(MOVE_COLLECTION_FAILURE_SMOKE.error),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_MOVE_AFTER_FIRST__;
          const moveFailureRowsAfter = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collection_items WHERE work_id IN (?, ?) AND collection_id = ?",
            [
              MOVE_COLLECTION_FAILURE_SMOKE.works[0].workId,
              MOVE_COLLECTION_FAILURE_SMOKE.works[1].workId,
              MOVE_COLLECTION_SMOKE.id
            ]
          );
          const moveFailureDialogAfter = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("移动到文件夹"));
          const moveFailureRetryButton = Array.from(
            moveFailureDialogAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.includes(MOVE_COLLECTION_SMOKE.name));
          libraryMoveToCollectionFailureVisible =
            bodyIncludes("移动文件夹失败，所选文献仍保留在原文件夹，可重新移动") &&
            bodyIncludes("移动失败，所选文献仍保留，可重新移动。") &&
            bodyIncludes(MOVE_COLLECTION_FAILURE_SMOKE.error);
          libraryMoveToCollectionFailureDidNotPersist =
            Number(moveFailureRowsBefore[0]?.n ?? 0) === 0 &&
            Number(moveFailureRowsAfter[0]?.n ?? 0) === 0;
          libraryMoveToCollectionFailurePreserved =
            MOVE_COLLECTION_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
            bodyIncludes("已选 2 篇") &&
            Boolean(moveFailureRetryButton) &&
            !moveFailureRetryButton?.disabled;
          moveFailureDialogAfter
            ?.querySelector('button[aria-label="关闭"]')
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("移动到文件夹")
              ),
            1_000
          );
          findExactButton("取消选择")?.click();
          await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);
          setInputValue(librarySearchInput, "");
          await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
        }

        const moveSmokeRow = Array.from(document.querySelectorAll(".library-table__row")).find(
          (item) => item.textContent?.includes(SAMPLE.title)
        );
        const moveSmokeCheckbox = moveSmokeRow?.querySelector('input[type="checkbox"]');
        if (moveSmokeCheckbox && !moveSmokeCheckbox.checked) {
          moveSmokeCheckbox.click();
        }
        await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
        findExactButton("移动到文件夹")?.click();
        const moveDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("移动到文件夹")
          );
          return dialog?.textContent?.includes(MOVE_COLLECTION_SMOKE.name) ? dialog : null;
        }, 2_000);
        if (moveDialog) {
          const moveTargetButton = Array.from(moveDialog.querySelectorAll("button")).find(
            (button) => button.textContent?.includes(MOVE_COLLECTION_SMOKE.name)
          );
          moveTargetButton?.click();
          libraryMoveToCollectionBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("移动到文件夹")
              );
              const button = Array.from(dialog?.querySelectorAll("button") ?? []).find((item) =>
                item.textContent?.includes(MOVE_COLLECTION_SMOKE.name)
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                button?.getAttribute("aria-busy") === "true" &&
                button.disabled &&
                button.textContent?.includes("移动中") &&
                dialog.textContent?.includes("正在移动 1 篇文献")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("移动到文件夹")
              ),
            3_000
          );
          libraryMoveToCollectionSuccessVisible = bodyIncludes(
            "已移动 1 篇文献到「" + MOVE_COLLECTION_SMOKE.name + "」"
          );
          const moveRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collection_items WHERE work_id = ? AND collection_id = ?",
            [SAMPLE.workId, MOVE_COLLECTION_SMOKE.id]
          );
          libraryMoveToCollectionPersisted = Number(moveRows[0]?.n ?? 0) === 1;
        }

        if (librarySearchInput) {
          findExactButton("取消选择")?.click();
          setInputValue(librarySearchInput, BULK_TAG_FAILURE_SMOKE.query);
          await waitFor(
            () => BULK_TAG_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)),
            3_000
          );
          for (const work of BULK_TAG_FAILURE_SMOKE.works) {
            const checkbox = document.querySelector(
              '[data-library-row-id="' + work.workId + '"] .library-checkbox-input'
            );
            if (checkbox && !checkbox.checked) checkbox.click();
          }
          await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
          findExactButton("添加标签")?.click();
          const bulkTagFailureDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("添加标签")
            );
            return dialog?.textContent?.includes("将标签添加到已选的 2 篇文献")
              ? dialog
              : null;
          }, 2_000);
          const bulkTagFailureInput = bulkTagFailureDialog?.querySelector("input");
          if (bulkTagFailureInput) setInputValue(bulkTagFailureInput, BULK_TAG_FAILURE_SMOKE.name);
          const bulkTagFailureRowsBefore = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM tags WHERE name = ?) AS tag_count, (SELECT COUNT(*) FROM work_tags wt JOIN tags t ON t.id = wt.tag_id WHERE t.name = ? AND wt.work_id IN (?, ?)) AS item_count",
            [
              BULK_TAG_FAILURE_SMOKE.name,
              BULK_TAG_FAILURE_SMOKE.name,
              BULK_TAG_FAILURE_SMOKE.works[0].workId,
              BULK_TAG_FAILURE_SMOKE.works[1].workId
            ]
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__ =
            BULK_TAG_FAILURE_SMOKE.error;
          const bulkTagFailureButton = Array.from(
            bulkTagFailureDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加");
          bulkTagFailureButton?.click();
          libraryBulkTagFailureBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("添加标签")
              );
              const busyButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("添加中") &&
                dialog.textContent?.includes("添加中")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("添加标签失败，所选文献和标签仍保持原状，可重新添加") &&
              bodyIncludes(BULK_TAG_FAILURE_SMOKE.error),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_BULK_TAG_AFTER_FIRST__;
          const bulkTagFailureRowsAfter = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM tags WHERE name = ?) AS tag_count, (SELECT COUNT(*) FROM work_tags wt JOIN tags t ON t.id = wt.tag_id WHERE t.name = ? AND wt.work_id IN (?, ?)) AS item_count",
            [
              BULK_TAG_FAILURE_SMOKE.name,
              BULK_TAG_FAILURE_SMOKE.name,
              BULK_TAG_FAILURE_SMOKE.works[0].workId,
              BULK_TAG_FAILURE_SMOKE.works[1].workId
            ]
          );
          const bulkTagFailureDialogAfter = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("添加标签"));
          const bulkTagFailureRetryButton = Array.from(
            bulkTagFailureDialogAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加");
          const bulkTagFailureInputAfter = bulkTagFailureDialogAfter?.querySelector("input");
          libraryBulkTagFailureVisible =
            bodyIncludes("添加标签失败，所选文献和标签仍保持原状，可重新添加") &&
            bodyIncludes(BULK_TAG_FAILURE_SMOKE.error);
          libraryBulkTagFailureDidNotPersist =
            Number(bulkTagFailureRowsBefore[0]?.tag_count ?? 0) === 0 &&
            Number(bulkTagFailureRowsBefore[0]?.item_count ?? 0) === 0 &&
            Number(bulkTagFailureRowsAfter[0]?.tag_count ?? 0) === 0 &&
            Number(bulkTagFailureRowsAfter[0]?.item_count ?? 0) === 0;
          libraryBulkTagFailurePreserved =
            BULK_TAG_FAILURE_SMOKE.works.every((work) => rowText().includes(work.title)) &&
            bodyIncludes("已选 2 篇") &&
            bulkTagFailureInputAfter?.value === BULK_TAG_FAILURE_SMOKE.name &&
            Boolean(bulkTagFailureRetryButton) &&
            !bulkTagFailureRetryButton?.disabled;
          bulkTagFailureDialogAfter
            ?.querySelector('button[aria-label="关闭"]')
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("添加标签")
              ),
            1_000
          );
          findExactButton("取消选择")?.click();
          await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);
          setInputValue(librarySearchInput, "");
          await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
        }

        const bulkTagSmokeRow = Array.from(document.querySelectorAll(".library-table__row")).find(
          (item) => item.textContent?.includes(SAMPLE.title)
        );
        const bulkTagCheckbox = bulkTagSmokeRow?.querySelector('input[type="checkbox"]');
        if (bulkTagCheckbox && !bulkTagCheckbox.checked) {
          bulkTagCheckbox.click();
        }
        await waitFor(() => bodyIncludes("已选 1 篇"), 1_000);
        findExactButton("添加标签")?.click();
        const bulkTagDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("添加标签")
          );
          return dialog?.textContent?.includes("将标签添加到已选的 1 篇文献") ? dialog : null;
        }, 2_000);
        if (bulkTagDialog) {
          const tagInput = bulkTagDialog.querySelector("input");
          if (tagInput) setInputValue(tagInput, BULK_TAG_SMOKE.name);
          const addTagButton = Array.from(bulkTagDialog.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加"
          );
          addTagButton?.click();
          libraryBulkTagBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("添加标签")
              );
              const busyButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("添加中") &&
                dialog.textContent?.includes("添加中")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("添加标签")
              ),
            3_000
          );
          libraryBulkTagSuccessVisible = bodyIncludes(
            "已为 1 篇文献添加标签「" + BULK_TAG_SMOKE.name + "」"
          );
          const bulkTagRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM work_tags wt JOIN tags t ON t.id = wt.tag_id WHERE wt.work_id = ? AND t.name = ? AND t.deleted_at IS NULL",
            [SAMPLE.workId, BULK_TAG_SMOKE.name]
          );
          libraryBulkTagPersisted = Number(bulkTagRows[0]?.n ?? 0) === 1;
        }

        if (librarySearchInput) {
          findExactButton("取消选择")?.click();
          setInputValue(librarySearchInput, MERGE_FAILURE_SMOKE.query);
          await waitFor(
            () =>
              rowText().includes(MERGE_FAILURE_SMOKE.primaryTitle) &&
              rowText().includes(MERGE_FAILURE_SMOKE.duplicateTitle),
            3_000
          );
          clickRowByTitle(MERGE_FAILURE_SMOKE.primaryTitle);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
                MERGE_FAILURE_SMOKE.primaryTitle
              ),
            2_000
          );
          const mergeFailurePrimaryCheckbox = document.querySelector(
            '[data-library-row-id="' + MERGE_FAILURE_SMOKE.primaryId + '"] .library-checkbox-input'
          );
          const mergeFailureDuplicateCheckbox = document.querySelector(
            '[data-library-row-id="' + MERGE_FAILURE_SMOKE.duplicateId + '"] .library-checkbox-input'
          );
          if (mergeFailurePrimaryCheckbox && !mergeFailurePrimaryCheckbox.checked) {
            mergeFailurePrimaryCheckbox.click();
          }
          if (mergeFailureDuplicateCheckbox && !mergeFailureDuplicateCheckbox.checked) {
            mergeFailureDuplicateCheckbox.click();
          }
          await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
          const mergeFailureRowsBefore = await window.aura.db.query(
            "SELECT SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS primary_active, SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS duplicate_active, (SELECT work_id FROM attachments WHERE id = ?) AS attachment_work_id FROM works WHERE id IN (?, ?)",
            [
              MERGE_FAILURE_SMOKE.primaryId,
              MERGE_FAILURE_SMOKE.duplicateId,
              MERGE_FAILURE_SMOKE.attachmentId,
              MERGE_FAILURE_SMOKE.primaryId,
              MERGE_FAILURE_SMOKE.duplicateId
            ]
          );
          await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_merge_failure");
          await window.aura.db.exec(
            "CREATE TEMP TRIGGER aurascholar_smoke_merge_failure BEFORE UPDATE OF deleted_at ON works WHEN OLD.id = 'smoke-work-merge-failure-duplicate' AND NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(FAIL, 'Smoke merge rollback failure'); END;"
          );
          findExactButton("合并文献")?.click();
          const mergeFailureConfirmDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("合并重复文献？")
            );
            return dialog?.textContent?.includes(MERGE_FAILURE_SMOKE.primaryTitle) &&
              dialog.textContent?.includes(MERGE_FAILURE_SMOKE.duplicateTitle)
              ? dialog
              : null;
          }, 2_000);
          const mergeFailureConfirmButton = Array.from(
            mergeFailureConfirmDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "确认合并");
          mergeFailureConfirmButton?.click();
          libraryMergeFailureBusyVisible = Boolean(
            await waitFor(() => {
              const mergeButton = Array.from(
                document.querySelectorAll(".library-bulkbar button")
              ).find((button) => button.textContent?.includes("合并中"));
              return mergeButton?.getAttribute("aria-busy") === "true" &&
                mergeButton.disabled &&
                bodyIncludes("正在合并 1 篇重复文献")
                ? mergeButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("合并失败，主记录和重复文献仍保持原状，可重新合并") &&
              bodyIncludes(MERGE_FAILURE_SMOKE.error),
            3_000
          );
          await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_merge_failure");
          const mergeFailureRowsAfter = await window.aura.db.query(
            "SELECT SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS primary_active, SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS duplicate_active, (SELECT work_id FROM attachments WHERE id = ?) AS attachment_work_id FROM works WHERE id IN (?, ?)",
            [
              MERGE_FAILURE_SMOKE.primaryId,
              MERGE_FAILURE_SMOKE.duplicateId,
              MERGE_FAILURE_SMOKE.attachmentId,
              MERGE_FAILURE_SMOKE.primaryId,
              MERGE_FAILURE_SMOKE.duplicateId
            ]
          );
          const mergeFailureRetryButton = Array.from(
            document.querySelectorAll(".library-bulkbar button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "合并文献");
          libraryMergeFailureVisible =
            bodyIncludes("合并失败，主记录和重复文献仍保持原状，可重新合并") &&
            bodyIncludes(MERGE_FAILURE_SMOKE.error);
          libraryMergeFailureDidNotPersist =
            Number(mergeFailureRowsBefore[0]?.primary_active ?? 0) === 1 &&
            Number(mergeFailureRowsBefore[0]?.duplicate_active ?? 0) === 1 &&
            mergeFailureRowsBefore[0]?.attachment_work_id === MERGE_FAILURE_SMOKE.duplicateId &&
            Number(mergeFailureRowsAfter[0]?.primary_active ?? 0) === 1 &&
            Number(mergeFailureRowsAfter[0]?.duplicate_active ?? 0) === 1 &&
            mergeFailureRowsAfter[0]?.attachment_work_id === MERGE_FAILURE_SMOKE.duplicateId;
          libraryMergeFailurePreserved =
            rowText().includes(MERGE_FAILURE_SMOKE.primaryTitle) &&
            rowText().includes(MERGE_FAILURE_SMOKE.duplicateTitle) &&
            bodyIncludes("已选 2 篇") &&
            Boolean(mergeFailureRetryButton) &&
            !mergeFailureRetryButton?.disabled;
          findExactButton("取消选择")?.click();
          await waitFor(() => !bodyIncludes("已选 2 篇"), 1_000);
          setInputValue(librarySearchInput, "");
          await waitFor(() => rowText().includes(MERGE_SMOKE.primaryTitle), 3_000);
        }

        clickRowByTitle(MERGE_SMOKE.primaryTitle);
        await waitFor(
          () =>
            (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
              MERGE_SMOKE.primaryTitle
            ),
          2_000
        );
        const mergePrimaryCheckbox = document.querySelector(
          '[data-library-row-id="' + MERGE_SMOKE.primaryId + '"] .library-checkbox-input'
        );
        const mergeDuplicateCheckbox = document.querySelector(
          '[data-library-row-id="' + MERGE_SMOKE.duplicateId + '"] .library-checkbox-input'
        );
        if (mergePrimaryCheckbox && !mergePrimaryCheckbox.checked) mergePrimaryCheckbox.click();
        if (mergeDuplicateCheckbox && !mergeDuplicateCheckbox.checked) {
          mergeDuplicateCheckbox.click();
        }
        await waitFor(() => bodyIncludes("已选 2 篇"), 1_000);
        findExactButton("合并文献")?.click();
        const mergeConfirmDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("合并重复文献？")
          );
          return dialog?.textContent?.includes(MERGE_SMOKE.primaryTitle) &&
            dialog.textContent?.includes(MERGE_SMOKE.duplicateTitle)
            ? dialog
            : null;
        }, 2_000);
        const mergeConfirmButton = Array.from(
          mergeConfirmDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "确认合并");
        mergeConfirmButton?.click();
        libraryMergeBusyVisible = Boolean(
          await waitFor(() => {
            const mergeButton = Array.from(
              document.querySelectorAll(".library-bulkbar button")
            ).find((button) => button.textContent?.includes("合并中"));
            return mergeButton?.getAttribute("aria-busy") === "true" &&
              mergeButton.disabled &&
              bodyIncludes("正在合并 1 篇重复文献")
              ? mergeButton
              : null;
          }, 1_000)
        );
        await waitFor(
          () => bodyIncludes("已合并 1 篇重复文献到《" + MERGE_SMOKE.primaryTitle + "》"),
          4_000
        );
        libraryMergeSuccessVisible = bodyIncludes(
          "已合并 1 篇重复文献到《" + MERGE_SMOKE.primaryTitle + "》"
        );
        const mergeRows = await window.aura.db.query(
          "SELECT SUM(CASE WHEN id = ? AND deleted_at IS NULL THEN 1 ELSE 0 END) AS primary_active, SUM(CASE WHEN id = ? AND deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS duplicate_deleted FROM works WHERE id IN (?, ?)",
          [
            MERGE_SMOKE.primaryId,
            MERGE_SMOKE.duplicateId,
            MERGE_SMOKE.primaryId,
            MERGE_SMOKE.duplicateId
          ]
        );
        libraryMergePersisted =
          Number(mergeRows[0]?.primary_active ?? 0) === 1 &&
          Number(mergeRows[0]?.duplicate_deleted ?? 0) === 1;

        findButton("管理文件夹")?.click();
        const collectionManagerDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("管理文件夹")
          );
          return dialog?.textContent?.includes(COLLECTION_MANAGER_SMOKE.name) ? dialog : null;
        }, 3_000);
        if (collectionManagerDialog) {
          const collectionCreateRowsBefore = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collections WHERE deleted_at IS NULL AND name = ?",
            [COLLECTION_CREATE_FAILURE_SMOKE.name]
          );
          const collectionCreateButton = Array.from(
            collectionManagerDialog.querySelectorAll("button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "新建");
          collectionCreateButton?.click();
          const collectionCreatePrompt = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("新建文件夹")
            );
            return dialog?.querySelector("input") ? dialog : null;
          }, 1_000);
          const collectionCreateInput = collectionCreatePrompt?.querySelector("input");
          if (collectionCreateInput) {
            setInputValue(collectionCreateInput, COLLECTION_CREATE_FAILURE_SMOKE.name);
          }
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__ =
            COLLECTION_CREATE_FAILURE_SMOKE.error;
          try {
            const collectionCreateSubmit = Array.from(
              collectionCreatePrompt?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "创建");
            collectionCreateSubmit?.click();
            libraryCollectionCreateFailureBusyVisible = Boolean(
              await waitFor(() => {
                const prompt = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                  (item) => item.textContent?.includes("新建文件夹")
                );
                const button = Array.from(prompt?.querySelectorAll("button") ?? []).find(
                  (item) => item.getAttribute("aria-busy") === "true"
                );
                return prompt?.getAttribute("aria-busy") === "true" &&
                  button?.disabled &&
                  button.textContent?.includes("处理中") &&
                  bodyIncludes("正在创建文件夹")
                  ? prompt
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("创建文件夹失败，名称仍保留，可重新创建") &&
                bodyIncludes(COLLECTION_CREATE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__;
          }
          const collectionCreateRowsAfter = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collections WHERE deleted_at IS NULL AND name = ?",
            [COLLECTION_CREATE_FAILURE_SMOKE.name]
          );
          const collectionCreatePromptAfter = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("新建文件夹"));
          const collectionCreateInputAfter = collectionCreatePromptAfter?.querySelector("input");
          const collectionCreateSubmitAfter = Array.from(
            collectionCreatePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => /创建|处理中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? ""));
          libraryCollectionCreateFailureVisible =
            bodyIncludes("创建文件夹失败，名称仍保留，可重新创建") &&
            bodyIncludes(COLLECTION_CREATE_FAILURE_SMOKE.error);
          libraryCollectionCreateFailurePreserved = Boolean(
            collectionCreateInputAfter?.value === COLLECTION_CREATE_FAILURE_SMOKE.name &&
              collectionCreateSubmitAfter &&
              !collectionCreateSubmitAfter.disabled
          );
          libraryCollectionCreateFailureDidNotPersist =
            Number(collectionCreateRowsBefore[0]?.n ?? 0) ===
            Number(collectionCreateRowsAfter[0]?.n ?? -1);
          const collectionCreateCancel = Array.from(
            collectionCreatePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          collectionCreateCancel?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("新建文件夹")
              ),
            1_000
          );
          const collectionManagerRow = Array.from(
            collectionManagerDialog.querySelectorAll(".library-collection-manager__row")
          ).find((row) => row.textContent?.includes(COLLECTION_MANAGER_SMOKE.name));
          const collectionRenameRowsBefore = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NULL AND name = ?) AS original_count, (SELECT COUNT(*) FROM collections WHERE deleted_at IS NULL AND name = ?) AS draft_count",
            [
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.name,
              COLLECTION_RENAME_FAILURE_SMOKE.name
            ]
          );
          const collectionRenameButton = Array.from(
            collectionManagerRow?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "重命名");
          collectionRenameButton?.click();
          const collectionRenamePrompt = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll(".library-prompt-modal")).find((item) =>
              item.textContent?.includes("重命名文件夹")
            );
            return dialog?.querySelector("input") ? dialog : null;
          }, 1_000);
          const collectionRenameInput = collectionRenamePrompt?.querySelector("input");
          if (collectionRenameInput) {
            setInputValue(collectionRenameInput, COLLECTION_RENAME_FAILURE_SMOKE.name);
          }
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__ =
            COLLECTION_RENAME_FAILURE_SMOKE.error;
          try {
            const collectionRenameSubmit = Array.from(
              collectionRenamePrompt?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存");
            collectionRenameSubmit?.click();
            libraryCollectionRenameFailureBusyVisible = Boolean(
              await waitFor(() => {
                const prompt = Array.from(document.querySelectorAll(".library-prompt-modal")).find(
                  (item) => item.textContent?.includes("重命名文件夹")
                );
                return prompt?.getAttribute("aria-busy") === "true" &&
                  prompt.textContent?.includes("处理中") &&
                  bodyIncludes("正在重命名文件夹")
                  ? prompt
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("重命名文件夹失败，名称仍保留，可重新保存") &&
                bodyIncludes(COLLECTION_RENAME_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__;
          }
          const collectionRenameRowsAfter = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NULL AND name = ?) AS original_count, (SELECT COUNT(*) FROM collections WHERE deleted_at IS NULL AND name = ?) AS draft_count",
            [
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.name,
              COLLECTION_RENAME_FAILURE_SMOKE.name
            ]
          );
          const collectionRenamePromptAfter = Array.from(
            document.querySelectorAll(".library-prompt-modal")
          ).find((item) => item.textContent?.includes("重命名文件夹"));
          const collectionRenameInputAfter = collectionRenamePromptAfter?.querySelector("input");
          const collectionRenameSubmitAfter = Array.from(
            collectionRenamePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => /保存|处理中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? ""));
          libraryCollectionRenameFailureVisible =
            bodyIncludes("重命名文件夹失败，名称仍保留，可重新保存") &&
            bodyIncludes(COLLECTION_RENAME_FAILURE_SMOKE.error);
          libraryCollectionRenameFailurePreserved = Boolean(
            collectionRenameInputAfter?.value === COLLECTION_RENAME_FAILURE_SMOKE.name &&
              collectionRenameSubmitAfter &&
              !collectionRenameSubmitAfter.disabled
          );
          libraryCollectionRenameFailureDidNotPersist =
            Number(collectionRenameRowsBefore[0]?.original_count ?? 0) ===
              Number(collectionRenameRowsAfter[0]?.original_count ?? -1) &&
            Number(collectionRenameRowsBefore[0]?.draft_count ?? 0) ===
              Number(collectionRenameRowsAfter[0]?.draft_count ?? -1);
          const collectionRenameCancel = Array.from(
            collectionRenamePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          collectionRenameCancel?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.classList.contains("library-prompt-modal") &&
                item.textContent?.includes("重命名文件夹")
              ),
            1_000
          );
          const collectionDeleteFailureRowsBefore = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ? AND work_id = ?) AS item_count",
            [
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              MISSING_PDF.workId
            ]
          );
          const collectionManagerRowForFailedDelete = Array.from(
            collectionManagerDialog.querySelectorAll(".library-collection-manager__row")
          ).find((row) => row.textContent?.includes(COLLECTION_MANAGER_SMOKE.name));
          const collectionFailedDeleteButton = Array.from(
            collectionManagerRowForFailedDelete?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
          collectionFailedDeleteButton?.click();
          const collectionFailedDeleteConfirm = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("删除文件夹？")
            );
            return dialog?.textContent?.includes(COLLECTION_MANAGER_SMOKE.name) ? dialog : null;
          }, 1_000);
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__ =
            COLLECTION_DELETE_FAILURE_SMOKE.error;
          try {
            const collectionFailedDeleteConfirmButton = Array.from(
              collectionFailedDeleteConfirm?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除文件夹");
            collectionFailedDeleteConfirmButton?.click();
            libraryCollectionDeleteFailureBusyVisible = Boolean(
              await waitFor(() => {
                const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                  (item) => item.textContent?.includes("管理文件夹")
                );
                const row = Array.from(
                  manager?.querySelectorAll(".library-collection-manager__row") ?? []
                ).find((item) => item.textContent?.includes(COLLECTION_MANAGER_SMOKE.name));
                const busyButton = Array.from(row?.querySelectorAll("button") ?? []).find(
                  (button) => button.getAttribute("aria-busy") === "true"
                );
                return manager?.getAttribute("aria-busy") === "true" &&
                  row?.getAttribute("aria-busy") === "true" &&
                  busyButton?.disabled &&
                  busyButton.textContent?.includes("删除中") &&
                  manager.textContent?.includes("正在删除文件夹")
                  ? row
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("删除文件夹失败，文件夹仍保留，可重新删除") &&
                bodyIncludes(COLLECTION_DELETE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__;
          }
          const collectionDeleteFailureRowsAfter = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ? AND work_id = ?) AS item_count",
            [
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              MISSING_PDF.workId
            ]
          );
          const collectionManagerDialogAfterFailedDelete = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("管理文件夹"));
          const collectionFailedDeleteRowAfter = Array.from(
            collectionManagerDialogAfterFailedDelete?.querySelectorAll(
              ".library-collection-manager__row"
            ) ?? []
          ).find((row) => row.textContent?.includes(COLLECTION_MANAGER_SMOKE.name));
          const collectionFailedDeleteButtonAfter = Array.from(
            collectionFailedDeleteRowAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
          libraryCollectionDeleteFailureVisible = Boolean(
            collectionManagerDialogAfterFailedDelete?.textContent?.includes(
              "删除文件夹失败，文件夹仍保留，可重新删除"
            ) &&
              collectionManagerDialogAfterFailedDelete.textContent.includes(
                COLLECTION_DELETE_FAILURE_SMOKE.error
              )
          );
          libraryCollectionDeleteFailurePreserved = Boolean(
            collectionFailedDeleteRowAfter &&
              collectionFailedDeleteButtonAfter &&
              !collectionFailedDeleteButtonAfter.disabled &&
              collectionFailedDeleteButtonAfter.getAttribute("aria-busy") !== "true" &&
              !collectionManagerDialogAfterFailedDelete?.querySelector(
                'button[aria-label="撤销删除文件夹"]'
              )
          );
          libraryCollectionDeleteFailureDidNotPersist =
            Number(collectionDeleteFailureRowsBefore[0]?.active_count ?? 0) ===
              Number(collectionDeleteFailureRowsAfter[0]?.active_count ?? -1) &&
            Number(collectionDeleteFailureRowsBefore[0]?.deleted_count ?? 0) ===
              Number(collectionDeleteFailureRowsAfter[0]?.deleted_count ?? -1) &&
            Number(collectionDeleteFailureRowsBefore[0]?.item_count ?? 0) ===
              Number(collectionDeleteFailureRowsAfter[0]?.item_count ?? -1);
          const collectionManagerRowForDelete = Array.from(
            collectionManagerDialogAfterFailedDelete?.querySelectorAll(
              ".library-collection-manager__row"
            ) ?? []
          ).find((row) => row.textContent?.includes(COLLECTION_MANAGER_SMOKE.name));
          const collectionDeleteButton = Array.from(
            collectionManagerRowForDelete?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
          collectionDeleteButton?.click();
          const collectionDeleteConfirm = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("删除文件夹？")
            );
            return dialog?.textContent?.includes(COLLECTION_MANAGER_SMOKE.name) ? dialog : null;
          }, 1_000);
          const collectionDeleteConfirmButton = Array.from(
            collectionDeleteConfirm?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除文件夹");
          collectionDeleteConfirmButton?.click();
          libraryCollectionDeleteBusyVisible = Boolean(
            await waitFor(() => {
              const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                (item) => item.textContent?.includes("管理文件夹")
              );
              const row = Array.from(
                manager?.querySelectorAll(".library-collection-manager__row") ?? []
              ).find((item) => item.textContent?.includes(COLLECTION_MANAGER_SMOKE.name));
              const busyButton = Array.from(row?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return manager?.getAttribute("aria-busy") === "true" &&
                row?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("删除中") &&
                manager.textContent?.includes("正在删除文件夹")
                ? row
                : null;
            }, 1_000)
          );
          const collectionDeleteSuccessDialog = await waitFor(() => {
            const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("管理文件夹")
            );
            return manager?.textContent?.includes(
              "已删除文件夹「" + COLLECTION_MANAGER_SMOKE.name + "」"
            )
              ? manager
              : null;
          }, 3_000);
          libraryCollectionDeleteSuccessVisible = Boolean(collectionDeleteSuccessDialog);
          const collectionDeleteRows = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ?) AS item_count",
            [COLLECTION_MANAGER_SMOKE.id, COLLECTION_MANAGER_SMOKE.id]
          );
          libraryCollectionDeletePersisted =
            Number(collectionDeleteRows[0]?.deleted_count ?? 0) === 1 &&
            Number(collectionDeleteRows[0]?.item_count ?? 0) === 0;
          const collectionDeleteUndoButton = await waitFor(
            () => document.querySelector('button[aria-label="撤销删除文件夹"]'),
            1_000
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__ =
            COLLECTION_RESTORE_FAILURE_SMOKE.error;
          try {
            collectionDeleteUndoButton?.click();
            libraryCollectionDeleteUndoFailureBusyVisible = Boolean(
              await waitFor(() => {
                const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                  (item) => item.textContent?.includes("管理文件夹")
                );
                const undoButton = manager?.querySelector('button[aria-label="撤销删除文件夹"]');
                return manager?.getAttribute("aria-busy") === "true" &&
                  undoButton?.getAttribute("aria-busy") === "true" &&
                  undoButton.disabled &&
                  undoButton.textContent?.includes("撤销中") &&
                  manager.textContent?.includes("正在恢复文件夹")
                  ? undoButton
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("恢复文件夹失败，撤销入口仍保留，可重新撤销") &&
                bodyIncludes(COLLECTION_RESTORE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__;
          }
          const collectionRestoreFailureRows = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ? AND work_id = ?) AS item_count",
            [
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              COLLECTION_MANAGER_SMOKE.id,
              MISSING_PDF.workId
            ]
          );
          const collectionManagerDialogAfterFailedRestore = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("管理文件夹"));
          const collectionDeleteUndoButtonAfterFailure = await waitFor(() => {
            const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("管理文件夹")
            );
            const undoButton = manager?.querySelector('button[aria-label="撤销删除文件夹"]');
            return undoButton &&
              !undoButton.disabled &&
              undoButton.getAttribute("aria-busy") !== "true"
              ? undoButton
              : null;
          }, 1_000);
          libraryCollectionDeleteUndoFailureVisible = Boolean(
            collectionManagerDialogAfterFailedRestore?.textContent?.includes(
              "恢复文件夹失败，撤销入口仍保留，可重新撤销"
            ) &&
              collectionManagerDialogAfterFailedRestore.textContent.includes(
                COLLECTION_RESTORE_FAILURE_SMOKE.error
              )
          );
          libraryCollectionDeleteUndoFailurePreserved = Boolean(
            collectionDeleteUndoButtonAfterFailure &&
              !collectionManagerDialogAfterFailedRestore?.textContent?.includes("正在恢复文件夹")
          );
          libraryCollectionDeleteUndoFailureDidNotPersist =
            Number(collectionRestoreFailureRows[0]?.active_count ?? -1) === 0 &&
            Number(collectionRestoreFailureRows[0]?.deleted_count ?? -1) === 1 &&
            Number(collectionRestoreFailureRows[0]?.item_count ?? -1) === 0;
          collectionDeleteUndoButtonAfterFailure?.click();
          libraryCollectionDeleteUndoBusyVisible = Boolean(
            await waitFor(() => {
              const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                (item) => item.textContent?.includes("管理文件夹")
              );
              const undoButton = manager?.querySelector('button[aria-label="撤销删除文件夹"]');
              return manager?.getAttribute("aria-busy") === "true" &&
                undoButton?.getAttribute("aria-busy") === "true" &&
                undoButton.disabled &&
                undoButton.textContent?.includes("撤销中") &&
                manager.textContent?.includes("正在恢复文件夹")
                ? undoButton
                : null;
            }, 1_000)
          );
          const collectionRestoreDialog = await waitFor(() => {
            const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("管理文件夹")
            );
            return manager?.textContent?.includes(
              "已恢复文件夹「" + COLLECTION_MANAGER_SMOKE.name + "」"
            )
              ? manager
              : null;
          }, 3_000);
          const collectionRestoreRows = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM collections WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM collection_items WHERE collection_id = ? AND work_id = ?) AS item_count",
            [COLLECTION_MANAGER_SMOKE.id, COLLECTION_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          libraryCollectionDeleteUndoRecovered =
            Boolean(collectionRestoreDialog?.textContent?.includes(COLLECTION_MANAGER_SMOKE.name)) &&
            Number(collectionRestoreRows[0]?.active_count ?? 0) === 1 &&
            Number(collectionRestoreRows[0]?.item_count ?? 0) === 1;
          const closeButton = collectionDeleteSuccessDialog?.querySelector(
            'button[aria-label="关闭管理文件夹"]'
          );
          closeButton?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("管理文件夹")
              ),
            1_000
          );
        }

        findButton("管理标签")?.click();
        const tagManagerDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("管理标签")
          );
          return dialog?.textContent?.includes(TAG_MANAGER_SMOKE.name) ? dialog : null;
        }, 3_000);
        if (tagManagerDialog) {
          const tagManagerRow = Array.from(
            tagManagerDialog.querySelectorAll(".library-tag-manager__row")
          ).find((row) => row.textContent?.includes(TAG_MANAGER_SMOKE.name));
          const tagRenameRowsBefore = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NULL AND name = ?) AS original_count, (SELECT COUNT(*) FROM tags WHERE deleted_at IS NULL AND name = ?) AS draft_count",
            [TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.name, TAG_RENAME_FAILURE_SMOKE.name]
          );
          const tagRenameButton = Array.from(tagManagerRow?.querySelectorAll("button") ?? []).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "重命名"
          );
          tagRenameButton?.click();
          const tagRenamePrompt = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll(".library-prompt-modal")).find((item) =>
              item.textContent?.includes("重命名标签")
            );
            return dialog?.querySelector("input") ? dialog : null;
          }, 1_000);
          const tagRenameInput = tagRenamePrompt?.querySelector("input");
          if (tagRenameInput) {
            setInputValue(tagRenameInput, TAG_RENAME_FAILURE_SMOKE.name);
          }
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RENAME__ =
            TAG_RENAME_FAILURE_SMOKE.error;
          try {
            const tagRenameSubmit = Array.from(
              tagRenamePrompt?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存");
            tagRenameSubmit?.click();
            libraryTagRenameFailureBusyVisible = Boolean(
              await waitFor(() => {
                const prompt = Array.from(document.querySelectorAll(".library-prompt-modal")).find(
                  (item) => item.textContent?.includes("重命名标签")
                );
                return prompt?.getAttribute("aria-busy") === "true" &&
                  prompt.textContent?.includes("处理中") &&
                  bodyIncludes("正在重命名标签")
                  ? prompt
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("重命名标签失败，名称仍保留，可重新保存") &&
                bodyIncludes(TAG_RENAME_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RENAME__;
          }
          const tagRenameRowsAfter = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NULL AND name = ?) AS original_count, (SELECT COUNT(*) FROM tags WHERE deleted_at IS NULL AND name = ?) AS draft_count",
            [TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.name, TAG_RENAME_FAILURE_SMOKE.name]
          );
          const tagRenamePromptAfter = Array.from(document.querySelectorAll(".library-prompt-modal")).find(
            (item) => item.textContent?.includes("重命名标签")
          );
          const tagRenameInputAfter = tagRenamePromptAfter?.querySelector("input");
          const tagRenameSubmitAfter = Array.from(
            tagRenamePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => /保存|处理中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? ""));
          libraryTagRenameFailureVisible =
            bodyIncludes("重命名标签失败，名称仍保留，可重新保存") &&
            bodyIncludes(TAG_RENAME_FAILURE_SMOKE.error);
          libraryTagRenameFailurePreserved = Boolean(
            tagRenameInputAfter?.value === TAG_RENAME_FAILURE_SMOKE.name &&
              tagRenameSubmitAfter &&
              !tagRenameSubmitAfter.disabled
          );
          libraryTagRenameFailureDidNotPersist =
            Number(tagRenameRowsBefore[0]?.original_count ?? 0) ===
              Number(tagRenameRowsAfter[0]?.original_count ?? -1) &&
            Number(tagRenameRowsBefore[0]?.draft_count ?? 0) ===
              Number(tagRenameRowsAfter[0]?.draft_count ?? -1);
          const tagRenameCancel = Array.from(
            tagRenamePromptAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          tagRenameCancel?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.classList.contains("library-prompt-modal") &&
                item.textContent?.includes("重命名标签")
              ),
            1_000
          );
          const tagDeleteFailureRowsBefore = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ? AND work_id = ?) AS item_count",
            [TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          const tagManagerRowForFailedDelete = Array.from(
            tagManagerDialog.querySelectorAll(".library-tag-manager__row")
          ).find((row) => row.textContent?.includes(TAG_MANAGER_SMOKE.name));
          const tagFailedDeleteButton = Array.from(
            tagManagerRowForFailedDelete?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
          tagFailedDeleteButton?.click();
          const tagFailedDeleteConfirm = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("删除标签？")
            );
            return dialog?.textContent?.includes(TAG_MANAGER_SMOKE.name) ? dialog : null;
          }, 1_000);
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_DELETE__ =
            TAG_DELETE_FAILURE_SMOKE.error;
          try {
            const tagFailedDeleteConfirmButton = Array.from(
              tagFailedDeleteConfirm?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除标签");
            tagFailedDeleteConfirmButton?.click();
            libraryTagDeleteFailureBusyVisible = Boolean(
              await waitFor(() => {
                const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                  (item) => item.textContent?.includes("管理标签")
                );
                const row = Array.from(
                  manager?.querySelectorAll(".library-tag-manager__row") ?? []
                ).find((item) => item.textContent?.includes(TAG_MANAGER_SMOKE.name));
                const busyButton = Array.from(row?.querySelectorAll("button") ?? []).find(
                  (button) => button.getAttribute("aria-busy") === "true"
                );
                return manager?.getAttribute("aria-busy") === "true" &&
                  row?.getAttribute("aria-busy") === "true" &&
                  busyButton?.disabled &&
                  busyButton.textContent?.includes("删除中") &&
                  manager.textContent?.includes("正在删除标签")
                  ? row
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("删除标签失败，标签仍保留，可重新删除") &&
                bodyIncludes(TAG_DELETE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_DELETE__;
          }
          const tagDeleteFailureRowsAfter = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ? AND work_id = ?) AS item_count",
            [TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          const tagManagerDialogAfterFailedDelete = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("管理标签"));
          const tagFailedDeleteRowAfter = Array.from(
            tagManagerDialogAfterFailedDelete?.querySelectorAll(".library-tag-manager__row") ?? []
          ).find((row) => row.textContent?.includes(TAG_MANAGER_SMOKE.name));
          const tagFailedDeleteButtonAfter = Array.from(
            tagFailedDeleteRowAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
          libraryTagDeleteFailureVisible = Boolean(
            tagManagerDialogAfterFailedDelete?.textContent?.includes(
              "删除标签失败，标签仍保留，可重新删除"
            ) &&
              tagManagerDialogAfterFailedDelete.textContent.includes(TAG_DELETE_FAILURE_SMOKE.error)
          );
          libraryTagDeleteFailurePreserved = Boolean(
            tagFailedDeleteRowAfter &&
              tagFailedDeleteButtonAfter &&
              !tagFailedDeleteButtonAfter.disabled &&
              tagFailedDeleteButtonAfter.getAttribute("aria-busy") !== "true" &&
              !tagManagerDialogAfterFailedDelete?.querySelector(
                'button[aria-label="撤销删除标签"]'
              )
          );
          libraryTagDeleteFailureDidNotPersist =
            Number(tagDeleteFailureRowsBefore[0]?.active_count ?? 0) ===
              Number(tagDeleteFailureRowsAfter[0]?.active_count ?? -1) &&
            Number(tagDeleteFailureRowsBefore[0]?.deleted_count ?? 0) ===
              Number(tagDeleteFailureRowsAfter[0]?.deleted_count ?? -1) &&
            Number(tagDeleteFailureRowsBefore[0]?.item_count ?? 0) ===
              Number(tagDeleteFailureRowsAfter[0]?.item_count ?? -1);
          const tagManagerRowForDelete = Array.from(
            tagManagerDialogAfterFailedDelete?.querySelectorAll(".library-tag-manager__row") ?? []
          ).find((row) => row.textContent?.includes(TAG_MANAGER_SMOKE.name));
          const tagDeleteButton = Array.from(
            tagManagerRowForDelete?.querySelectorAll("button") ?? []
          ).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除"
          );
          tagDeleteButton?.click();
          const tagDeleteConfirm = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("删除标签？")
            );
            return dialog?.textContent?.includes(TAG_MANAGER_SMOKE.name) ? dialog : null;
          }, 1_000);
          const tagDeleteConfirmButton = Array.from(
            tagDeleteConfirm?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除标签");
          tagDeleteConfirmButton?.click();
          libraryTagDeleteBusyVisible = Boolean(
            await waitFor(() => {
              const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                (item) => item.textContent?.includes("管理标签")
              );
              const row = Array.from(
                manager?.querySelectorAll(".library-tag-manager__row") ?? []
              ).find((item) => item.textContent?.includes(TAG_MANAGER_SMOKE.name));
              const busyButton = Array.from(row?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return manager?.getAttribute("aria-busy") === "true" &&
                row?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("删除中") &&
                manager.textContent?.includes("正在删除标签")
                ? row
                : null;
            }, 1_000)
          );
          const tagDeleteSuccessDialog = await waitFor(() => {
            const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("管理标签")
            );
            return manager?.textContent?.includes("已删除标签「" + TAG_MANAGER_SMOKE.name + "」")
              ? manager
              : null;
          }, 3_000);
          libraryTagDeleteSuccessVisible = Boolean(tagDeleteSuccessDialog);
          const tagDeleteRows = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ?) AS item_count",
            [TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id]
          );
          libraryTagDeletePersisted =
            Number(tagDeleteRows[0]?.deleted_count ?? 0) === 1 &&
            Number(tagDeleteRows[0]?.item_count ?? 0) === 0;
          const tagDeleteUndoButton = await waitFor(
            () => document.querySelector('button[aria-label="撤销删除标签"]'),
            1_000
          );
          window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RESTORE__ =
            TAG_RESTORE_FAILURE_SMOKE.error;
          try {
            tagDeleteUndoButton?.click();
            libraryTagDeleteUndoFailureBusyVisible = Boolean(
              await waitFor(() => {
                const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                  (item) => item.textContent?.includes("管理标签")
                );
                const undoButton = manager?.querySelector('button[aria-label="撤销删除标签"]');
                return manager?.getAttribute("aria-busy") === "true" &&
                  undoButton?.getAttribute("aria-busy") === "true" &&
                  undoButton.disabled &&
                  undoButton.textContent?.includes("撤销中") &&
                  manager.textContent?.includes("正在恢复标签")
                  ? undoButton
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("恢复标签失败，撤销入口仍保留，可重新撤销") &&
                bodyIncludes(TAG_RESTORE_FAILURE_SMOKE.error),
              3_000
            );
          } finally {
            delete window.__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RESTORE__;
          }
          const tagRestoreFailureRows = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ? AND work_id = ?) AS item_count",
            [TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          const tagManagerDialogAfterFailedRestore = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("管理标签"));
          const tagDeleteUndoButtonAfterFailure = await waitFor(() => {
            const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("管理标签")
            );
            const undoButton = manager?.querySelector('button[aria-label="撤销删除标签"]');
            return undoButton &&
              !undoButton.disabled &&
              undoButton.getAttribute("aria-busy") !== "true"
              ? undoButton
              : null;
          }, 1_000);
          libraryTagDeleteUndoFailureVisible = Boolean(
            tagManagerDialogAfterFailedRestore?.textContent?.includes(
              "恢复标签失败，撤销入口仍保留，可重新撤销"
            ) &&
              tagManagerDialogAfterFailedRestore.textContent.includes(
                TAG_RESTORE_FAILURE_SMOKE.error
              )
          );
          libraryTagDeleteUndoFailurePreserved = Boolean(
            tagDeleteUndoButtonAfterFailure &&
              !tagManagerDialogAfterFailedRestore?.textContent?.includes("正在恢复标签")
          );
          libraryTagDeleteUndoFailureDidNotPersist =
            Number(tagRestoreFailureRows[0]?.active_count ?? -1) === 0 &&
            Number(tagRestoreFailureRows[0]?.deleted_count ?? -1) === 1 &&
            Number(tagRestoreFailureRows[0]?.item_count ?? -1) === 0;
          tagDeleteUndoButtonAfterFailure?.click();
          libraryTagDeleteUndoBusyVisible = Boolean(
            await waitFor(() => {
              const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find(
                (item) => item.textContent?.includes("管理标签")
              );
              const undoButton = manager?.querySelector('button[aria-label="撤销删除标签"]');
              return manager?.getAttribute("aria-busy") === "true" &&
                undoButton?.getAttribute("aria-busy") === "true" &&
                undoButton.disabled &&
                undoButton.textContent?.includes("撤销中") &&
                manager.textContent?.includes("正在恢复标签")
                ? undoButton
                : null;
            }, 1_000)
          );
          const tagRestoreDialog = await waitFor(() => {
            const manager = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("管理标签")
            );
            return manager?.textContent?.includes("已恢复标签「" + TAG_MANAGER_SMOKE.name + "」")
              ? manager
              : null;
          }, 3_000);
          const tagRestoreRows = await window.aura.db.query(
            "SELECT (SELECT COUNT(*) FROM tags WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM work_tags WHERE tag_id = ? AND work_id = ?) AS item_count",
            [TAG_MANAGER_SMOKE.id, TAG_MANAGER_SMOKE.id, MISSING_PDF.workId]
          );
          libraryTagDeleteUndoRecovered =
            Boolean(tagRestoreDialog?.textContent?.includes(TAG_MANAGER_SMOKE.name)) &&
            Number(tagRestoreRows[0]?.active_count ?? 0) === 1 &&
            Number(tagRestoreRows[0]?.item_count ?? 0) === 1;
          const closeButton = tagDeleteSuccessDialog?.querySelector(
            'button[aria-label="关闭管理标签"]'
          );
          closeButton?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("管理标签")
              ),
            1_000
          );
        }

        const quickAddInput = document.querySelector('input[placeholder^="快速入库"]');
        if (quickAddInput) {
          setInputValue(quickAddInput, "Composition Smoke Title");
          const composingEnter = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter"
          });
          Object.defineProperty(composingEnter, "isComposing", {
            configurable: true,
            value: true
          });
          Object.defineProperty(composingEnter, "keyCode", {
            configurable: true,
            value: 229
          });
          quickAddInput.dispatchEvent(composingEnter);
          await wait(350);
          quickAddCompositionIgnored =
            quickAddInput.value === "Composition Smoke Title" &&
            !quickAddInput.disabled &&
            !bodyIncludes("正在识别") &&
            !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
              item.textContent?.includes("确认入库")
            );
          setInputValue(quickAddInput, "");
        }

        const quickDropTarget = document.querySelector(".library-topbar");
        const quickImportDropTarget = await waitFor(
          () => document.querySelector(".library-topbar"),
          1_000
        );
        if (quickImportDropTarget) {
          const bibText = [
            "@article{dragdrop-smoke,",
            "  title = {Drag Import Smoke Test},",
            "  author = {Lovelace, Ada},",
            "  year = {2026},",
            "  doi = {10.4242/aurascholar.dragdrop}",
            "}"
          ].join("\n");
          const bibFile = new File([bibText], "drag-import.bib", { type: "text/plain" });
          const dropTransfer = new DataTransfer();
          dropTransfer.items.add(bibFile);
          dispatchDropEvent(quickDropTarget, "dragenter", dropTransfer);
          dispatchDropEvent(quickDropTarget, "dragover", dropTransfer);
          dispatchDropEvent(quickDropTarget, "drop", dropTransfer);
          await waitFor(
            () => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("导入文献库")
              );
              return dialog?.textContent?.includes("已解析出") ? dialog : null;
            },
            3_000
          );
          const importDialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("导入文献库")
          );
          const importText = importDialog?.textContent ?? "";
          quickDropImportPreviewVisible = importText.includes("已解析出") && importText.includes("1");
          quickDropImportCount = quickDropImportPreviewVisible ? 1 : null;
          const cancelButton = Array.from(importDialog?.querySelectorAll("button") ?? []).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消"
          );
          cancelButton?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("导入文献库")
              ),
            1_000
          );
        }

        const quickDropConfirmTarget = await waitFor(
          () => document.querySelector(".library-topbar"),
          1_000
        );
        if (quickDropConfirmTarget) {
          const failureImportDoiA = "10.4242/aurascholar.dragdrop-failure-a";
          const failureImportDoiB = "10.4242/aurascholar.dragdrop-failure-b";
          const failureImportBib = [
            "@article{dragdrop-failure-a,",
            "  title = {Drag Import Failure Alpha},",
            "  author = {Lovelace, Ada},",
            "  year = {2026},",
            "  doi = {" + failureImportDoiA + "}",
            "}",
            "",
            "@article{dragdrop-failure-b,",
            "  title = {Drag Import Failure Beta},",
            "  author = {Hopper, Grace},",
            "  year = {2026},",
            "  doi = {" + failureImportDoiB + "}",
            "}"
          ].join("\n");
          const failureImportFile = new File([failureImportBib], "drag-import-failure.bib", {
            type: "text/plain"
          });
          const failureDropTransfer = new DataTransfer();
          failureDropTransfer.items.add(failureImportFile);
          dispatchDropEvent(quickDropConfirmTarget, "dragenter", failureDropTransfer);
          dispatchDropEvent(quickDropConfirmTarget, "dragover", failureDropTransfer);
          dispatchDropEvent(quickDropConfirmTarget, "drop", failureDropTransfer);
          const failureImportDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("导入文献库")
            );
            return dialog?.textContent?.includes("已解析出") &&
              dialog.textContent?.includes("2")
              ? dialog
              : null;
          }, 3_000);
          const failureImportRowsBefore = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE doi IN (?, ?) AND deleted_at IS NULL",
            [failureImportDoiA, failureImportDoiB]
          );
          await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_reference_import_failure");
          await window.aura.db.exec(
            "CREATE TEMP TRIGGER aurascholar_smoke_reference_import_failure BEFORE INSERT ON works WHEN NEW.doi = '10.4242/aurascholar.dragdrop-failure-b' BEGIN SELECT RAISE(FAIL, 'Smoke reference import rollback failure'); END;"
          );
          const failureImportButton = Array.from(
            failureImportDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "导入 2 条");
          failureImportButton?.click();
          quickDropImportFailureBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("导入文献库")
              );
              const busyButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("导入中") &&
                dialog.textContent?.includes("正在导入文献库")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("导入失败，当前文献库未写入部分导入，可重新导入") &&
              bodyIncludes("Smoke reference import rollback failure"),
            3_000
          );
          await window.aura.db.exec("DROP TRIGGER IF EXISTS aurascholar_smoke_reference_import_failure");
          const failureImportRowsAfter = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE doi IN (?, ?) AND deleted_at IS NULL",
            [failureImportDoiA, failureImportDoiB]
          );
          const failureImportDialogAfter = Array.from(
            document.querySelectorAll('[role="dialog"]')
          ).find((item) => item.textContent?.includes("导入文献库"));
          const failureImportRetryButton = Array.from(
            failureImportDialogAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "导入 2 条");
          quickDropImportFailureVisible =
            bodyIncludes("导入失败，当前文献库未写入部分导入，可重新导入") &&
            bodyIncludes("Smoke reference import rollback failure");
          quickDropImportFailureDidNotPersist =
            Number(failureImportRowsBefore[0]?.n ?? 0) === 0 &&
            Number(failureImportRowsAfter[0]?.n ?? 0) === 0;
          quickDropImportFailurePreserved =
            Boolean(failureImportDialogAfter) &&
            Boolean(failureImportRetryButton) &&
            !failureImportRetryButton?.disabled &&
            failureImportDialogAfter?.textContent?.includes("已解析出") &&
            failureImportDialogAfter.textContent?.includes("2");
          const failureImportCancelButton = Array.from(
            failureImportDialogAfter?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          failureImportCancelButton?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("导入文献库")
              ),
            1_000
          );

          const confirmImportDoi = "10.4242/aurascholar.dragdrop-confirm";
          const confirmImportPmid = "88004242";
          const confirmImportTitle = "Confirmed Drag Import Smoke Test";
          const confirmImportNbib = [
            "PMID- " + confirmImportPmid,
            "TI  - " + confirmImportTitle + ".",
            "FAU - Hopper, Grace",
            "DP  - 2026",
            "JT  - Aura Scholar Smoke Journal",
            "LID - " + confirmImportDoi + " [doi]",
            "AID - " + confirmImportDoi + " [doi]"
          ].join("\n");
          const confirmImportFile = new File([confirmImportNbib], "drag-import-confirm.nbib", {
            type: "text/plain"
          });
          const confirmDropTransfer = new DataTransfer();
          confirmDropTransfer.items.add(confirmImportFile);
          dispatchDropEvent(quickDropConfirmTarget, "dragenter", confirmDropTransfer);
          dispatchDropEvent(quickDropConfirmTarget, "dragover", confirmDropTransfer);
          dispatchDropEvent(quickDropConfirmTarget, "drop", confirmDropTransfer);
          const confirmImportDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("导入文献库")
            );
            return dialog?.textContent?.includes("已解析出") ? dialog : null;
          }, 3_000);
          const confirmImportButton = Array.from(
            confirmImportDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "导入 1 条");
          confirmImportButton?.click();
          quickDropImportConfirmBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("导入文献库")
              );
              const busyButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("导入中") &&
                dialog.textContent?.includes("正在导入文献库")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("导入完成:新增"), 4_000);
          quickDropImportConfirmSuccessVisible = bodyIncludes("导入完成:新增");
          const confirmImportRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n, MAX(pmid) AS pmid FROM works WHERE deleted_at IS NULL AND (doi = ? OR pmid = ? OR title = ? OR title LIKE ?)",
            [confirmImportDoi, confirmImportPmid, confirmImportTitle, "%" + confirmImportTitle + "%"]
          );
          quickDropImportConfirmPersisted = Number(confirmImportRows[0]?.n ?? 0) >= 1;
          quickDropImportConfirmPmidPersisted =
            String(confirmImportRows[0]?.pmid ?? "") === confirmImportPmid;
        }

        await waitFor(
          () =>
            !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
              item.textContent?.includes("导入文献库")
            ),
          2_000
        );
        const smokeImportPdf = await waitFor(
          () => window.__AURASCHOLAR_SMOKE_IMPORT_PDF__,
          1_000
        );
        if (smokeImportPdf) {
          const importConfirmTitle = "AuraScholar Smoke PDF Import Confirm";
          const importConfirmFileName = importConfirmTitle + ".pdf";
          const importConfirmPdf = new File(
            [makeSmokePdf(importConfirmTitle)],
            importConfirmFileName,
            { type: "application/pdf" }
          );
          const importConfirmPromise = smokeImportPdf(importConfirmPdf).catch(() => {});
          const importConfirmDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("确认入库")
            );
            return dialog?.textContent?.includes("PDF 附件") ? dialog : null;
          }, 8_000);
          quickImportConfirmDialogVisible = Boolean(importConfirmDialog);
          const confirmImportButton = Array.from(
            importConfirmDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "确认入库");
          await importConfirmPromise;
          confirmImportButton?.click();
          quickImportConfirmCommitBusyVisible = Boolean(
            await waitFor(() => {
              const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("确认入库")
              );
              const busyButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              const selectedOption = dialog?.querySelector('input[name="import-selection"]:checked');
              return dialog?.getAttribute("aria-busy") === "true" &&
                busyButton?.disabled &&
                busyButton.textContent?.includes("入库中") &&
                selectedOption?.disabled &&
                dialog.textContent?.includes("正在确认入库")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("已入库:"), 4_000);
          const importConfirmRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works w JOIN attachments a ON a.work_id = w.id WHERE w.deleted_at IS NULL AND a.deleted_at IS NULL AND a.original_filename = ? AND w.title = ?",
            [importConfirmFileName, importConfirmTitle]
          );
          quickImportConfirmCommitPersisted = Number(importConfirmRows[0]?.n ?? 0) >= 1;
        }

        clickRowByTitle(SAMPLE.title);
        await waitFor(
          () => (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title),
          2_000
        );
        const metadataBeforeRows = await window.aura.db.query(
          "SELECT year FROM works WHERE id = ? LIMIT 1",
          [SAMPLE.workId]
        );
        const metadataEditButton = Array.from(
          document.querySelectorAll(".library-inspector__summary .library-panel-actions button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "编辑");
        metadataEditButton?.click();
        const yearInput = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("编辑文献元信息")
          );
          const yearLabel = Array.from(dialog?.querySelectorAll("label") ?? []).find((label) =>
            label.textContent?.includes("年份 Year")
          );
          return yearLabel?.querySelector("input") ?? null;
        }, 5_000);
        const metadataDialog = yearInput?.closest('[role="dialog"]');
        if (yearInput && metadataDialog) {
          setInputValue(yearInput, "20O6");
          await waitFor(() => yearInput.value === "20O6", 1_000);
          const saveMetadataButton = Array.from(metadataDialog.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存"
          );
          saveMetadataButton?.click();
          const yearError = await waitFor(
            () =>
              Array.from(metadataDialog.querySelectorAll('[role="alert"]')).find((item) =>
                item.textContent?.includes("年份必须是四位数字")
              ) ?? null,
            2_000
          );
          const metadataAfterRows = await window.aura.db.query(
            "SELECT year FROM works WHERE id = ? LIMIT 1",
            [SAMPLE.workId]
          );
          metadataInvalidYearErrorVisible = Boolean(yearError);
          metadataInvalidYearBlocked = Boolean(
            Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("编辑文献元信息")
            )
          );
          metadataInvalidYearPreserved =
            metadataBeforeRows.length > 0 &&
            metadataAfterRows.length > 0 &&
            Number(metadataAfterRows[0]?.year ?? 0) === Number(metadataBeforeRows[0]?.year ?? 0);
          setInputValue(yearInput, String(metadataBeforeRows[0]?.year ?? ""));
          await waitFor(
            () =>
              !Array.from(metadataDialog.querySelectorAll('[role="alert"]')).some((item) =>
                item.textContent?.includes("年份必须是四位数字")
              ),
            1_000
          );
          const labelInput = Array.from(metadataDialog.querySelectorAll("label")).find((label) =>
            label.textContent?.includes("标记 Label")
          )?.querySelector("input");
          const metadataCloseButton = () =>
            Array.from(metadataDialog.querySelectorAll("button")).find(
              (button) =>
                button.classList.contains("library-modal__close") ||
                (button.getAttribute("aria-label") ?? "").startsWith("关闭")
            );
          const metadataProtectedLabel = "smoke-metadata-discard-protected-" + Date.now();
          if (labelInput) {
            setInputValue(labelInput, metadataProtectedLabel);
            await waitFor(() => labelInput.value === metadataProtectedLabel, 1_000);
          }
          metadataCloseButton()?.click();
          const metadataDiscardDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("放弃元数据修改吗？")
            );
            return dialog ?? null;
          }, 2_000);
          const metadataContinueEditingButton = Array.from(
            metadataDiscardDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续编辑");
          metadataContinueEditingButton?.click();
          await waitFor(
            () =>
              bodyIncludes("已继续编辑，未保存修改仍在。") &&
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("放弃元数据修改吗？")
              ) &&
              Boolean(
                Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                  item.textContent?.includes("编辑文献元信息")
                )
              ) &&
              labelInput?.value === metadataProtectedLabel,
            2_000
          );
          const metadataProtectedRows = await window.aura.db.query(
            "SELECT label FROM works WHERE id = ? LIMIT 1",
            [SAMPLE.workId]
          );
          metadataDiscardCancelPreserved =
            bodyIncludes("已继续编辑，未保存修改仍在。") &&
            labelInput?.value === metadataProtectedLabel &&
            metadataProtectedRows[0]?.label !== metadataProtectedLabel;
          const validSaveMetadataButton = Array.from(metadataDialog.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存"
          );
          const metadataFailureLabel = "smoke-metadata-save-failure-" + Date.now();
          if (labelInput) {
            setInputValue(labelInput, metadataFailureLabel);
            await waitFor(() => labelInput.value === metadataFailureLabel, 1_000);
          }
          window.__AURASCHOLAR_SMOKE_METADATA_FAIL_NEXT_SAVE__ = "Smoke metadata save failure";
          validSaveMetadataButton?.click();
          const metadataFailureAlert = await waitFor(
            () =>
              Array.from(metadataDialog.querySelectorAll('[role="alert"]')).find((item) => {
                const text = item.textContent ?? "";
                return (
                  text.includes("保存失败，修改仍保留") &&
                  text.includes("Smoke metadata save failure")
                );
              }) ?? null,
            2_000
          );
          delete window.__AURASCHOLAR_SMOKE_METADATA_FAIL_NEXT_SAVE__;
          const metadataFailureRows = await window.aura.db.query(
            "SELECT label FROM works WHERE id = ? LIMIT 1",
            [SAMPLE.workId]
          );
          metadataSaveFailureVisible = Boolean(metadataFailureAlert);
          metadataSaveFailurePreserved =
            Boolean(
              Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("编辑文献元信息")
              )
            ) &&
            labelInput?.value === metadataFailureLabel &&
            Boolean(validSaveMetadataButton && !validSaveMetadataButton.disabled);
          metadataSaveFailureDidNotPersist = metadataFailureRows[0]?.label !== metadataFailureLabel;
          const metadataSavedLabel = "smoke-metadata-saved";
          if (labelInput) {
            setInputValue(labelInput, metadataSavedLabel);
            await waitFor(() => labelInput.value === metadataSavedLabel, 1_000);
          }
          validSaveMetadataButton?.click();
          await waitFor(
            () =>
              metadataDialog.getAttribute("aria-busy") === "true" &&
              validSaveMetadataButton?.disabled &&
              validSaveMetadataButton.getAttribute("aria-busy") === "true" &&
              validSaveMetadataButton.textContent?.includes("保存中") &&
              metadataCloseButton()?.disabled &&
              Boolean(labelInput?.disabled),
            1_000
          );
          metadataSaveBusyVisible =
            metadataDialog.getAttribute("aria-busy") === "true" &&
            Boolean(validSaveMetadataButton?.disabled) &&
            validSaveMetadataButton?.getAttribute("aria-busy") === "true" &&
            Boolean(validSaveMetadataButton?.textContent?.includes("保存中")) &&
            Boolean(metadataCloseButton()?.disabled) &&
            Boolean(labelInput?.disabled);
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("编辑文献元信息")
              ),
            2_000
          );
          const metadataSavedRows = await window.aura.db.query(
            "SELECT label FROM works WHERE id = ? LIMIT 1",
            [SAMPLE.workId]
          );
          metadataSavePersisted = metadataSavedRows[0]?.label === metadataSavedLabel;
        }

        location.hash = "#/library";
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            Boolean(document.querySelector(".library-page")) &&
            bodyIncludes("文献库"),
          4_000
        );
        window.dispatchEvent(
          new CustomEvent("aurascholar:library-view", { detail: { filter: "all" } })
        );
        const keyboardSearchInput = document.querySelector('input[placeholder="在结果中搜索"]');
        if (keyboardSearchInput?.value) setInputValue(keyboardSearchInput, "");
        findExactButton("取消选择")?.click();
        await waitFor(
          () => {
            const rows = Array.from(document.querySelectorAll(".library-table__row"));
            const searchInput = document.querySelector('input[placeholder="在结果中搜索"]');
            return rows.length >= 2 && (!searchInput || searchInput.value === "") ? rows : null;
          },
          4_000
        );
        await wait(250);
        const keyboardRows = Array.from(document.querySelectorAll(".library-table__row")).filter(
          (row) => row.isConnected
        );
        const keyboardSampleIndex = keyboardRows.findIndex(
          (row) => row.getAttribute("data-library-row-id") === SAMPLE.workId
        );
        const keyboardStartIndex =
          keyboardSampleIndex >= 0 && keyboardSampleIndex < keyboardRows.length - 1
            ? keyboardSampleIndex
            : keyboardRows.findIndex((_row, index) => index < keyboardRows.length - 1);
        const keyboardStartRow =
          keyboardStartIndex >= 0 ? keyboardRows[keyboardStartIndex] : null;
        if (keyboardStartRow) {
          const nextRow = keyboardRows[keyboardStartIndex + 1] ?? null;
          const nextId = nextRow?.getAttribute("data-library-row-id") ?? "";
          const nextTitle =
            nextRow?.querySelector(".library-table__paper strong")?.textContent?.trim() ?? "";
          libraryKeyboardNavigationDetail =
            "rows=" +
            keyboardRows.length +
            "; start=" +
            (keyboardStartRow.getAttribute("data-library-row-id") ?? "") +
            "; next=" +
            nextId +
            "; title=" +
            nextTitle;
          keyboardStartRow.focus();
          const keyboardStartFocused = await waitFor(
            () => document.activeElement === keyboardStartRow,
            1_000
          );
          libraryKeyboardNavigationDetail +=
            "; focusStart=" + Boolean(keyboardStartFocused);
          (document.activeElement === keyboardStartRow
            ? document.activeElement
            : keyboardStartRow
          ).dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
          );
          await waitFor(
            () =>
              Boolean(nextId) &&
              document.activeElement?.getAttribute("data-library-row-id") === nextId &&
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(nextTitle),
            3_000
          );
          libraryKeyboardNavigationVisible =
            Boolean(nextId) &&
            document.activeElement?.getAttribute("data-library-row-id") === nextId &&
            (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(nextTitle);
          libraryKeyboardNavigationDetail +=
            "; activeAfter=" +
            (document.activeElement?.getAttribute("data-library-row-id") ?? "") +
            "; selectedAfter=" +
            (document
              .querySelector(".library-table__row--selected")
              ?.getAttribute("data-library-row-id") ?? "") +
            "; detailAfter=" +
            (document.querySelector(".library-detail--selected h2")?.textContent?.trim() ?? "");
          if (libraryKeyboardNavigationVisible) {
            libraryKeyboardOpenedId = nextId;
            document.activeElement?.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
            );
            await waitFor(
              () => location.hash.includes("/reader?work=" + encodeURIComponent(nextId)),
              5_000
            );
            libraryKeyboardOpenHash = location.hash;
          }
        } else {
          libraryKeyboardNavigationDetail =
            "rows=" + keyboardRows.length + "; start=; next=; title=";
        }

        location.hash = "#/library";
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            Boolean(document.querySelector(".library-page")) &&
            rowText().includes(SAMPLE.title),
          5_000
        );
        const libraryCanvasIngressSourceVisible = rowText().includes(SAMPLE.title);
        location.hash = "#/canvas?workId=" + encodeURIComponent(SAMPLE.workId);
        await waitFor(
          () =>
            location.hash.startsWith("#/canvas/") &&
            !location.hash.includes("workId=") &&
            Boolean(document.querySelector(".canvas-workspace")) &&
            Boolean(
              Array.from(document.querySelectorAll(".canvas-card--paper")).find((card) =>
                card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
              )
            ),
          8_000
        );
        canvasLibraryWorkIngressHash = location.hash;
        canvasLibraryWorkIngressNavigated =
          libraryCanvasIngressSourceVisible &&
          canvasLibraryWorkIngressHash.startsWith("#/canvas/") &&
          !canvasLibraryWorkIngressHash.includes("workId=");
        canvasLibraryWorkIngressVisible = Boolean(
          Array.from(document.querySelectorAll(".canvas-card--paper")).find((card) =>
            card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
          )
        );
        const persistedCanvasPaper = await waitFor(async () => {
          const rows = await window.aura.db.query(
            "SELECT id, data_json FROM canvas_nodes WHERE workspace_id = ? AND type = 'paper'",
            ["canvas:default"]
          );
          return rows.find((row) => {
            try {
              const data = JSON.parse(row.data_json);
              return data.workId === SAMPLE.workId && data.title === SAMPLE.title;
            } catch {
              return false;
            }
          }) ?? null;
        }, 5_000);
        canvasLibraryWorkIngressPersisted = Boolean(persistedCanvasPaper);

        const canvasHashBeforeSplitReader = location.hash;
        const splitReaderPaperCard = Array.from(
          document.querySelectorAll(".canvas-card--paper")
        ).find((card) =>
          card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
        );
        splitReaderPaperCard?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
        );
        const splitReader = await waitFor(() => {
          const drawer = document.querySelector(".canvas-reader-drawer");
          return drawer?.querySelector(".au-reader-page__canvas") ? drawer : null;
        }, 10_000);
        canvasSplitReaderOpened = Boolean(splitReader);
        canvasSplitReaderKeptContext =
          Boolean(splitReader) &&
          location.hash === canvasHashBeforeSplitReader &&
          Boolean(document.querySelector(".canvas-workspace")) &&
          !document.querySelector("[data-canvas-toolbox-panel]");

        const splitReaderAnnotation = await waitFor(
          () =>
            splitReader?.querySelector(
              '.au-reader-annotation[data-annotation-id="' +
                SAMPLE.annotationId +
                '"]'
            ) ?? null,
          3_000
        );
        splitReaderAnnotation?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        const splitReaderExcerptChip = await waitFor(
          () =>
            document.querySelector(
              '[data-canvas-annotation-id="' + SAMPLE.annotationId + '"]'
            ),
          2_000
        );
        const splitReaderAddButton = splitReader?.querySelector(
          ".canvas-reader-drawer__add"
        );
        if (splitReaderExcerptChip && splitReaderAddButton instanceof HTMLButtonElement) {
          splitReaderAddButton.click();
        }
        const splitReaderLinkedExcerpt = await waitFor(async () => {
          if (!persistedCanvasPaper) return null;
          const excerptRows = await window.aura.db.query(
            "SELECT id, data_json FROM canvas_nodes WHERE workspace_id = ? AND type = 'excerpt'",
            ["canvas:default"]
          );
          const excerpt = excerptRows.find((row) => {
            try {
              const data = JSON.parse(row.data_json);
              return (
                data.workId === SAMPLE.workId &&
                data.annotationId === SAMPLE.annotationId &&
                data.highlightText === "AuraScholar Smoke PDF"
              );
            } catch {
              return false;
            }
          });
          if (!excerpt) return null;
          const edgeRows = await window.aura.db.query(
            "SELECT source_id, target_id, relation_type " +
              "FROM canvas_edges " +
              "WHERE workspace_id = ? AND source_id = ? AND target_id = ? " +
              "AND relation_type = 'derived-from'",
            ["canvas:default", persistedCanvasPaper.id, excerpt.id]
          );
          return edgeRows.length === 1 ? excerpt : null;
        }, 5_000);
        canvasSplitReaderExcerptLinked =
          Boolean(splitReaderLinkedExcerpt) &&
          Boolean(
            Array.from(document.querySelectorAll(".canvas-card--excerpt")).find((card) =>
              card.querySelector(".canvas-card__quote")?.textContent?.trim() ===
              "AuraScholar Smoke PDF"
            )
          );
        splitReader
          ?.querySelector('button[aria-label="关闭同屏阅读器"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        canvasSplitReaderClosed = Boolean(
          await waitFor(() => !document.querySelector(".canvas-reader-drawer"), 2_000)
        );
        const splitReaderExcerptCard = Array.from(
          document.querySelectorAll(".canvas-card--excerpt")
        ).find(
          (card) =>
            card.querySelector(".canvas-card__quote")?.textContent?.trim() ===
            "AuraScholar Smoke PDF"
        );
        const splitReaderExcerptNodeId =
          splitReaderExcerptCard?.getAttribute("data-canvas-node-id") ??
          splitReaderLinkedExcerpt?.id ??
          "";
        if (splitReaderExcerptCard) {
          const cardRect = splitReaderExcerptCard.getBoundingClientRect();
          splitReaderExcerptCard.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              button: 2,
              clientX: cardRect.left + Math.min(32, cardRect.width / 2),
              clientY: cardRect.top + Math.min(32, cardRect.height / 2)
            })
          );
        }
        const splitReaderExcerptMenu = await waitFor(() => {
          if (!splitReaderExcerptNodeId) return null;
          const menu = document.querySelector(
            '[data-canvas-node-menu-for="' +
              CSS.escape(splitReaderExcerptNodeId) +
              '"]'
          );
          return menu?.querySelector('[data-canvas-node-action="details"]') ? menu : null;
        }, 2_000);
        canvasNodeContextMenuVisible = Boolean(splitReaderExcerptMenu);
        splitReaderExcerptMenu
          ?.querySelector('[data-canvas-node-action="details"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        const splitReaderExcerptDetails = await waitFor(() => {
          if (!splitReaderExcerptNodeId) return null;
          return document.querySelector(
            '[data-canvas-toolbox-panel="details"] ' +
              '[data-canvas-details-for="' +
              CSS.escape(splitReaderExcerptNodeId) +
              '"]'
          );
        }, 2_000);
        const splitReaderExcerptMarginNote =
          splitReaderExcerptDetails?.querySelector("textarea");
        if (splitReaderExcerptMarginNote instanceof HTMLTextAreaElement) {
          setInputValue(splitReaderExcerptMarginNote, "Smoke excerpt toolbox edit");
          canvasToolboxDetailsEditPersisted = Boolean(
            await waitFor(async () => {
              const rows = await window.aura.db.query(
                "SELECT data_json FROM canvas_nodes WHERE workspace_id = ? AND id = ?",
                ["canvas:default", splitReaderExcerptNodeId]
              );
              if (!rows[0]?.data_json) return false;
              try {
                return (
                  JSON.parse(rows[0].data_json).marginNote ===
                  "Smoke excerpt toolbox edit"
                );
              } catch {
                return false;
              }
            }, 5_000)
          );
        }
        const splitReaderCleanupButton = await waitFor(() => {
          const details = document.querySelector(
            '[data-canvas-toolbox-panel="details"] ' +
              '[data-canvas-details-for="' +
              CSS.escape(splitReaderExcerptNodeId) +
              '"]'
          );
          if (!details?.textContent?.includes("摘录与边注")) return null;
          return (
            details.querySelector(".canvas-details__delete") ??
            Array.from(details.querySelectorAll("button")).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === "仅从画布移除"
            ) ??
            null
          );
        }, 2_000);
        if (splitReaderCleanupButton instanceof HTMLButtonElement) {
          splitReaderCleanupButton.click();
          canvasSplitReaderCleanupSucceeded = Boolean(
            await waitFor(async () => {
              const rows = await window.aura.db.query(
                "SELECT data_json FROM canvas_nodes WHERE workspace_id = ? AND type = 'excerpt'",
                ["canvas:default"]
              );
              return !rows.some((row) => {
                try {
                  return JSON.parse(row.data_json).annotationId === SAMPLE.annotationId;
                } catch {
                  return false;
                }
              });
            }, 5_000)
          );
        }

        if (persistedCanvasPaper) {
          const selectTool = document.querySelector(
            '.canvas-dock button[title^="选择与框选"]'
          );
          if (selectTool instanceof HTMLButtonElement) selectTool.click();
          await waitFor(
            () => selectTool?.getAttribute("aria-pressed") === "true",
            1_000
          );

          const semanticNode = (nodeId) =>
            Array.from(document.querySelectorAll(".react-flow__node")).find(
              (node) => node.getAttribute("data-id") === nodeId
            ) ?? null;
          const semanticSourceHandle = semanticNode(persistedCanvasPaper.id)?.querySelector(
            '[data-handleid="link-right"]'
          );
          const semanticTargetHandle = semanticNode(
            "smoke-app-shell-canvas-stats-race"
          )?.querySelector('[data-handleid="link-left"]');
          if (
            semanticSourceHandle instanceof HTMLElement &&
            semanticTargetHandle instanceof HTMLElement
          ) {
            semanticSourceHandle.click();
            semanticTargetHandle.click();
          }

          const semanticMenu = await waitFor(() => {
            const menu = document.querySelector(".canvas-semantic-link-menu");
            return menu?.getAttribute("data-source-id") === persistedCanvasPaper.id &&
              menu?.getAttribute("data-target-id") ===
                "smoke-app-shell-canvas-stats-race" &&
              menu.querySelectorAll(".canvas-semantic-link-menu__option").length === 4
              ? menu
              : null;
          }, 2_000);
          canvasSemanticQuickLinkCandidateVisible = Boolean(semanticMenu);

          await wait(650);
          const semanticRowsBeforeCommit = await window.aura.db.query(
            "SELECT id FROM canvas_edges " +
              "WHERE workspace_id = ? AND source_id = ? AND target_id = ?",
            [
              "canvas:default",
              persistedCanvasPaper.id,
              "smoke-app-shell-canvas-stats-race"
            ]
          );
          canvasSemanticQuickLinkDeferred =
            Boolean(semanticMenu?.isConnected) && semanticRowsBeforeCommit.length === 0;

          if (semanticMenu?.isConnected) {
            const semanticShortcut = new KeyboardEvent("keydown", {
              key: "2",
              code: "Digit2",
              bubbles: true,
              cancelable: true
            });
            window.dispatchEvent(semanticShortcut);
            canvasSemanticQuickLinkShortcutHandled = semanticShortcut.defaultPrevented;
          }

          const persistedSemanticEdge = await waitFor(async () => {
            const rows = await window.aura.db.query(
              "SELECT id, relation_type, label FROM canvas_edges " +
                "WHERE workspace_id = ? AND source_id = ? AND target_id = ?",
              [
                "canvas:default",
                persistedCanvasPaper.id,
                "smoke-app-shell-canvas-stats-race"
              ]
            );
            const row = rows.find(
              (candidate) =>
                candidate.relation_type === "supports" && candidate.label === "支持"
            );
            const label = document.querySelector(".canvas-edge-label--supports");
            return row &&
              label?.textContent?.trim() === "支持" &&
              !document.querySelector(".canvas-semantic-link-menu")
              ? row
              : null;
          }, 5_000);
          canvasSemanticQuickLinkPersisted = Boolean(persistedSemanticEdge);

          if (!document.querySelector('[data-canvas-toolbox-panel="details"]')) {
            document.querySelector('[data-canvas-toolbox-trigger="details"]')?.click();
          }
          const semanticCleanupButton = await waitFor(() => {
            if (!persistedSemanticEdge?.id) return null;
            const details = document.querySelector(
              '[data-canvas-toolbox-panel="details"] ' +
                '[data-canvas-details-for="' +
                CSS.escape(persistedSemanticEdge.id) +
                '"]'
            );
            if (!details?.textContent?.includes("关系连线编辑")) return null;
            return (
              details.querySelector(".canvas-details__delete") ??
              Array.from(details.querySelectorAll("button")).find(
                (button) =>
                  button.textContent?.replace(/\s+/g, " ").trim() === "删除这条连线"
              ) ??
              null
            );
          }, 2_000);
          if (semanticCleanupButton instanceof HTMLButtonElement) {
            semanticCleanupButton.click();
            canvasSemanticQuickLinkCleanupSucceeded = Boolean(
              await waitFor(async () => {
                const rows = await window.aura.db.query(
                  "SELECT id FROM canvas_edges " +
                    "WHERE workspace_id = ? AND source_id = ? AND target_id = ?",
                  [
                    "canvas:default",
                    persistedCanvasPaper.id,
                    "smoke-app-shell-canvas-stats-race"
                  ]
                );
                return (
                  rows.length === 0 &&
                  !document.querySelector(".canvas-edge-label--supports")
                );
              }, 5_000)
            );
          }
        }

        location.hash = "#/flashcards";
        await waitFor(
          () =>
            location.hash.startsWith("#/canvas") &&
            !location.hash.includes("/flashcards") &&
            Boolean(document.querySelector(".canvas-workspace")) &&
            Boolean(
              Array.from(document.querySelectorAll(".canvas-card--paper")).find((card) =>
                card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
              )
            ) &&
            Boolean(
              Array.from(document.querySelectorAll(".canvas-card--idea")).find((card) =>
                card.querySelector(".canvas-card__title")?.textContent?.includes(
                  "Smoke canvas status race"
                )
              )
            ),
          10_000
        );
        canvasLegacyRedirectHash = location.hash;
        canvasLegacyFlashcardsRedirected =
          canvasLegacyRedirectHash.startsWith("#/canvas") &&
          !canvasLegacyRedirectHash.includes("/flashcards") &&
          Boolean(document.querySelector(".canvas-workspace"));
        const persistedCanvasRows = await window.aura.db.query(
          "SELECT id, type, data_json FROM canvas_nodes WHERE workspace_id = ? ORDER BY sort_order, id",
          ["canvas:default"]
        );
        canvasPersistedNodeCount = persistedCanvasRows.length;
        const persistedCanvasPaperVisible = Boolean(
          Array.from(document.querySelectorAll(".canvas-card--paper")).find((card) =>
            card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
          )
        );
        const persistedCanvasIdeaVisible = Boolean(
          Array.from(document.querySelectorAll(".canvas-card--idea")).find((card) =>
            card.querySelector(".canvas-card__title")?.textContent?.includes(
              "Smoke canvas status race"
            )
          )
        );
        const persistedCanvasPaperRow = persistedCanvasRows.find((row) => {
          if (row.type !== "paper") return false;
          try {
            return JSON.parse(row.data_json).workId === SAMPLE.workId;
          } catch {
            return false;
          }
        });
        canvasPersistedNodeReloaded =
          persistedCanvasPaperVisible &&
          persistedCanvasIdeaVisible &&
          Boolean(persistedCanvasPaperRow) &&
          persistedCanvasRows.some((row) => row.id === "smoke-app-shell-canvas-stats-race");
        window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_READ__ =
          "Smoke snippets initial load failure";
        location.hash = "#/snippets";
        await waitFor(
          () =>
            location.hash.includes("/snippets") &&
            bodyIncludes("写作素材") &&
            bodyIncludes("写作素材暂时不可用") &&
            bodyIncludes("Smoke snippets initial load failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取写作素材"]')),
          5_000
        );
        snippetLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取写作素材"]')?.click();
        await waitFor(
          () =>
            bodyIncludes(SNIPPET_SMOKE.quote) &&
            !bodyIncludes("写作素材暂时不可用") &&
            !bodyIncludes("Smoke snippets initial load failure"),
          5_000
        );
        snippetLoadRetryAttempts += 1;
        snippetLoadRetryRecoveryVisible =
          snippetLoadRetryAttempts === 2 &&
          bodyIncludes(SNIPPET_SMOKE.quote) &&
          !bodyIncludes("写作素材暂时不可用") &&
          !bodyIncludes("Smoke snippets initial load failure");
        snippetLoadRetryRecoveryDetail =
          "attempts=" +
          snippetLoadRetryAttempts +
          "; quote=" +
          bodyIncludes(SNIPPET_SMOKE.quote) +
          "; error=" +
          bodyIncludes("写作素材暂时不可用");
        delete window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_READ__;
        const snippetRaceQuote = "Smoke snippet race quote newer refresh wins";
        window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_DELAY_MS__ = 450;
        window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_COUNT__ = 0;
        window.dispatchEvent(new Event("aurascholar:snippets-updated"));
        await waitFor(
          () => Number(window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_COUNT__ ?? 0) >= 1,
          1_000
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO snippets (id, work_id, page_index, quote, note_md, tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            "smoke-snippet-refresh-race",
            SAMPLE.workId,
            0,
            snippetRaceQuote,
            null,
            "smoke",
            Date.now(),
            Date.now()
          ]
        );
        window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_DELAY_MS__ = 0;
        window.dispatchEvent(new Event("aurascholar:snippets-updated"));
        await waitFor(() => bodyIncludes(snippetRaceQuote), 2_000);
        await wait(650);
        snippetRefreshRacePreserved =
          bodyIncludes(SNIPPET_SMOKE.quote) &&
          bodyIncludes(snippetRaceQuote) &&
          !bodyIncludes("正在读取写作素材");
        delete window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_DELAY_MS__;
        delete window.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_COUNT__;

        const snippetsSearchInput = document.querySelector('input[aria-label="搜索写作素材"]');
        if (snippetsSearchInput) {
          setInputValue(snippetsSearchInput, "no matching smoke snippet");
          await waitFor(
            () =>
              bodyIncludes("当前筛选没有素材") &&
              Boolean(document.querySelector('button[aria-label="清空素材筛选"]')),
            1_000
          );
          document.querySelector('button[aria-label="清空素材筛选"]')?.click();
          snippetFilterEmptyActionRestoresResults = Boolean(
            await waitFor(
              () =>
                snippetsSearchInput.value === "" &&
                document.activeElement === snippetsSearchInput &&
                bodyIncludes(SNIPPET_SMOKE.quote) &&
                bodyIncludes(snippetRaceQuote) &&
                !bodyIncludes("当前筛选没有素材"),
              1_000
            )
          );
        }

        const snippetCard = Array.from(document.querySelectorAll(".snippet-card")).find((card) =>
          card.textContent?.includes(SNIPPET_SMOKE.quote)
        );
        const editSnippetNoteButton = Array.from(snippetCard?.querySelectorAll("button") ?? []).find(
          (button) => /加批注|编辑批注/.test(button.textContent ?? "")
        );
        editSnippetNoteButton?.click();
        const snippetEditor = await waitFor(
          () => snippetCard?.querySelector(".snippet-card__note-edit textarea"),
          2_000
        );
        if (snippetEditor) {
          const useMetaShortcut = isMacShortcut();
          setInputValue(snippetEditor, SNIPPET_SMOKE.noteDraft);
          await waitFor(() => snippetEditor.value === SNIPPET_SMOKE.noteDraft, 1_000);
          await waitFor(() => bodyIncludes("批注草稿尚未保存"), 1_000);
          const snippetClipboardSentinel = "aurascholar-snippet-dirty-copy-sentinel";
          if (window.aura?.clipboard?.writeText && window.aura?.clipboard?.readText) {
            await window.aura.clipboard.writeText(snippetClipboardSentinel);
          }
          const copyVisibleSnippetsButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "复制可见素材"
          );
          copyVisibleSnippetsButton?.click();
          await waitFor(() => bodyIncludes("请先保存批注草稿，再复制可见素材。"), 1_000);
          snippetDirtyCopyMessageVisible = bodyIncludes("请先保存批注草稿，再复制可见素材。");
          if (window.aura?.clipboard?.readText) {
            const clipboardText = await window.aura.clipboard.readText();
            snippetDirtyCopyClipboardPreserved = clipboardText === snippetClipboardSentinel;
          } else {
            snippetDirtyCopyClipboardPreserved = snippetDirtyCopyMessageVisible;
          }
          snippetDirtyCopyBlocked =
            snippetDirtyCopyMessageVisible && snippetDirtyCopyClipboardPreserved;
          snippetEditor.focus?.();

          const composingSaveEvent = defineKeyboardCode(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              code: "Enter",
              ctrlKey: !useMetaShortcut,
              key: "Enter",
              metaKey: useMetaShortcut
            }),
            13
          );
          Object.defineProperty(composingSaveEvent, "isComposing", {
            configurable: true,
            value: true
          });
          snippetEditor.dispatchEvent(composingSaveEvent);
          await wait(150);
          snippetSaveCompositionIgnored =
            Boolean(document.querySelector(".snippet-card__note-edit textarea")) &&
            !bodyIncludes("批注已保存");

          const composingEscapeEvent = defineKeyboardCode(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              code: "Escape",
              key: "Escape"
            }),
            27
          );
          Object.defineProperty(composingEscapeEvent, "isComposing", {
            configurable: true,
            value: true
          });
          snippetEditor.dispatchEvent(composingEscapeEvent);
          await wait(150);
          snippetEscapeCompositionIgnored =
            Boolean(document.querySelector(".snippet-card__note-edit textarea")) &&
            !Array.from(document.querySelectorAll('[role="dialog"]')).some((dialog) =>
              dialog.textContent?.includes("放弃这条批注草稿吗")
            );

          const snippetSaveFailureRowsBefore = await window.aura.db.query(
            "SELECT note_md FROM snippets WHERE id = ?",
            [SNIPPET_SMOKE.id]
          );
          window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_SAVE__ =
            "Smoke snippets note save failure";
          const failureSnippetEditor = document.querySelector(".snippet-card__note-edit textarea");
          failureSnippetEditor?.focus?.();
          if (failureSnippetEditor) {
            const failureSaveEvent = defineKeyboardCode(
              new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                code: "Enter",
                ctrlKey: !useMetaShortcut,
                key: "Enter",
                metaKey: useMetaShortcut
              }),
              13
            );
            failureSnippetEditor.dispatchEvent(failureSaveEvent);
          }
          const preservedSnippetEditor = await waitFor(() => {
            const editor = document.querySelector(".snippet-card__note-edit textarea");
            return bodyIncludes("保存批注失败，草稿仍保留，可重新保存") &&
              bodyIncludes("Smoke snippets note save failure") &&
              editor?.value === SNIPPET_SMOKE.noteDraft
              ? editor
              : null;
          }, 2_000);
          delete window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_SAVE__;
          const snippetSaveFailureRowsAfter = await window.aura.db.query(
            "SELECT note_md FROM snippets WHERE id = ?",
            [SNIPPET_SMOKE.id]
          );
          snippetSaveFailureVisible =
            bodyIncludes("保存批注失败，草稿仍保留，可重新保存") &&
            bodyIncludes("Smoke snippets note save failure");
          snippetSaveFailurePreserved =
            Boolean(preservedSnippetEditor) &&
            preservedSnippetEditor.value === SNIPPET_SMOKE.noteDraft;
          snippetSaveFailureDidNotPersist =
            (snippetSaveFailureRowsAfter[0]?.note_md ?? null) ===
            (snippetSaveFailureRowsBefore[0]?.note_md ?? null);

          const activeSnippetEditor = document.querySelector(".snippet-card__note-edit textarea");
          activeSnippetEditor?.focus?.();
          if (activeSnippetEditor) {
            const shortcutSaveEvent = defineKeyboardCode(
              new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                code: "Enter",
                ctrlKey: !useMetaShortcut,
                key: "Enter",
                metaKey: useMetaShortcut
              }),
              13
            );
            snippetShortcutEventPrevented = !activeSnippetEditor.dispatchEvent(shortcutSaveEvent);
          }
          await waitFor(
            () =>
              bodyIncludes("批注已保存") &&
              bodyIncludes(SNIPPET_SMOKE.noteDraft) &&
              !document.querySelector(".snippet-card__note-edit textarea"),
            3_000
          );
          const savedSnippetRows = await window.aura.db.query(
            "SELECT note_md FROM snippets WHERE id = ?",
            [SNIPPET_SMOKE.id]
          );
          snippetSavedNote = savedSnippetRows[0]?.note_md ?? null;
          snippetEditorClosedAfterShortcut = !document.querySelector(".snippet-card__note-edit textarea");
          snippetShortcutSaveVisible =
            snippetSavedNote === SNIPPET_SMOKE.noteDraft &&
            bodyIncludes("批注已保存") &&
            bodyIncludes(SNIPPET_SMOKE.noteDraft) &&
            snippetEditorClosedAfterShortcut;

          const copyVisibleSnippetsButtonAfterSave = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "复制可见素材"
          );
          copyVisibleSnippetsButtonAfterSave?.click();
          await waitFor(
            () =>
              copyVisibleSnippetsButtonAfterSave?.disabled &&
              copyVisibleSnippetsButtonAfterSave.getAttribute("aria-busy") === "true" &&
              copyVisibleSnippetsButtonAfterSave.textContent?.includes("复制中") &&
              bodyIncludes("正在复制可见素材"),
            1_000
          );
          snippetVisibleCopyBusyVisible =
            Boolean(copyVisibleSnippetsButtonAfterSave?.disabled) &&
            Boolean(copyVisibleSnippetsButtonAfterSave?.textContent?.includes("复制中")) &&
            bodyIncludes("正在复制可见素材");
          snippetVisibleCopyAriaBusyVisible =
            snippetVisibleCopyBusyVisible &&
            copyVisibleSnippetsButtonAfterSave?.getAttribute("aria-busy") === "true";
          await waitFor(
            () =>
              !copyVisibleSnippetsButtonAfterSave?.disabled &&
              bodyIncludes("已复制") &&
              bodyIncludes("可见素材"),
            2_000
          );
          snippetVisibleCopySuccessVisible =
            !copyVisibleSnippetsButtonAfterSave?.disabled &&
            bodyIncludes("已复制") &&
            bodyIncludes("可见素材");

          const savedSnippetCard = () =>
            Array.from(document.querySelectorAll(".snippet-card")).find((card) =>
              card.textContent?.includes(SNIPPET_SMOKE.quote)
            );
          const snippetActionButton = (label) =>
            Array.from(savedSnippetCard()?.querySelectorAll("button") ?? []).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === label
            );

          const snippetCopyButton = snippetActionButton("复制");
          snippetCopyButton?.click();
          await waitFor(
            () =>
              snippetCopyButton?.disabled &&
              snippetCopyButton.getAttribute("aria-busy") === "true" &&
              snippetCopyButton.textContent?.includes("复制中") &&
              savedSnippetCard()?.textContent?.includes("复制中"),
            1_000
          );
          snippetCardCopyBusyVisible =
            Boolean(snippetCopyButton?.disabled) &&
            Boolean(snippetCopyButton?.textContent?.includes("复制中")) &&
            Boolean(savedSnippetCard()?.textContent?.includes("复制中"));
          snippetCardCopyAriaBusyVisible =
            snippetCardCopyBusyVisible && snippetCopyButton?.getAttribute("aria-busy") === "true";
          await waitFor(() => savedSnippetCard()?.textContent?.includes("已复制"), 2_000);

          const snippetCopyCitationButton = snippetActionButton("复制+引文");
          snippetCopyCitationButton?.click();
          await waitFor(
            () =>
              snippetCopyCitationButton?.disabled &&
              snippetCopyCitationButton.getAttribute("aria-busy") === "true" &&
              snippetCopyCitationButton.textContent?.includes("生成中") &&
              savedSnippetCard()?.textContent?.includes("生成引文"),
            1_000
          );
          snippetCardCopyCitationBusyVisible =
            Boolean(snippetCopyCitationButton?.disabled) &&
            Boolean(snippetCopyCitationButton?.textContent?.includes("生成中")) &&
            Boolean(savedSnippetCard()?.textContent?.includes("生成引文"));
          snippetCardCopyCitationAriaBusyVisible =
            snippetCardCopyCitationBusyVisible &&
            snippetCopyCitationButton?.getAttribute("aria-busy") === "true";
          await waitFor(
            () => savedSnippetCard()?.textContent?.includes("已复制含引文"),
            2_000
          );

          const clickConfirmSnippetDelete = async () => {
            const dialog = await waitFor(() => {
              const candidate = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
                item.textContent?.includes("删除写作素材？")
              );
              return candidate ?? null;
            }, 1_000);
            const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除素材"
            );
            confirmButton?.click();
          };
          const snippetDeleteRowsBeforeFailure = await window.aura.db.query(
            "SELECT deleted_at FROM snippets WHERE id = ? LIMIT 1",
            [SNIPPET_SMOKE.id]
          );
          const snippetDeleteButtonBeforeFailure = snippetActionButton("删除");
          snippetDeleteButtonBeforeFailure?.click();
          await waitFor(
            () =>
              Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("删除写作素材？")
              ),
            1_000
          );
          window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_DELETE__ =
            SNIPPET_DELETE_FAILURE_SMOKE.error;
          await clickConfirmSnippetDelete();
          snippetDeleteFailureBusyVisible = Boolean(
            await waitFor(() => {
              return bodyIncludes("正在删除素材") &&
                snippetDeleteButtonBeforeFailure?.disabled &&
                snippetDeleteButtonBeforeFailure.getAttribute("aria-busy") === "true" &&
                snippetDeleteButtonBeforeFailure.textContent?.includes("删除中")
                ? snippetDeleteButtonBeforeFailure
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("删除素材失败，素材仍保留，可重新删除") &&
              bodyIncludes(SNIPPET_DELETE_FAILURE_SMOKE.error),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_DELETE__;
          const snippetDeleteRowsAfterFailure = await window.aura.db.query(
            "SELECT deleted_at FROM snippets WHERE id = ? LIMIT 1",
            [SNIPPET_SMOKE.id]
          );
          snippetDeleteFailureVisible =
            bodyIncludes("删除素材失败，素材仍保留，可重新删除") &&
            bodyIncludes(SNIPPET_DELETE_FAILURE_SMOKE.error);
          snippetDeleteFailureDidNotPersist =
            snippetDeleteRowsBeforeFailure[0]?.deleted_at == null &&
            snippetDeleteRowsAfterFailure[0]?.deleted_at == null;
          snippetDeleteFailurePreserved =
            bodyIncludes(SNIPPET_SMOKE.quote) &&
            Boolean(snippetActionButton("删除")) &&
            !document.querySelector('button[aria-label="撤销删除素材"]');

          const snippetDeleteButton = snippetActionButton("删除");
          snippetDeleteButton?.click();
          await clickConfirmSnippetDelete();
          await waitFor(
            () =>
              bodyIncludes("正在删除素材") &&
              snippetDeleteButton?.disabled &&
              snippetDeleteButton.getAttribute("aria-busy") === "true" &&
              snippetDeleteButton.textContent?.includes("删除中"),
            1_000
          );
          snippetDeleteBusyVisible =
            bodyIncludes("正在删除素材") &&
            Boolean(snippetDeleteButton?.disabled) &&
            Boolean(snippetDeleteButton?.textContent?.includes("删除中"));
          snippetDeleteAriaBusyVisible =
            snippetDeleteBusyVisible && snippetDeleteButton?.getAttribute("aria-busy") === "true";
          await waitFor(
            () => bodyIncludes("素材已删除") && !bodyIncludes(SNIPPET_SMOKE.quote),
            3_000
          );
          snippetDeleteSuccessVisible =
            bodyIncludes("素材已删除") && !bodyIncludes(SNIPPET_SMOKE.quote);
          const snippetUndoButton = document.querySelector('button[aria-label="撤销删除素材"]');
          snippetDeleteUndoVisible = Boolean(snippetDeleteSuccessVisible && snippetUndoButton);
          window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_RESTORE__ =
            SNIPPET_RESTORE_FAILURE_SMOKE.error;
          snippetUndoButton?.click();
          snippetDeleteUndoFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="撤销删除素材"]');
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("撤销中") &&
                bodyIncludes("正在撤销删除素材")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("撤销删除素材失败，撤销入口仍保留，可重新撤销") &&
              bodyIncludes(SNIPPET_RESTORE_FAILURE_SMOKE.error),
            3_000
          );
          delete window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_RESTORE__;
          const snippetUndoRowsAfterFailure = await window.aura.db.query(
            "SELECT deleted_at FROM snippets WHERE id = ? LIMIT 1",
            [SNIPPET_SMOKE.id]
          );
          const snippetUndoButtonAfterFailure = document.querySelector(
            'button[aria-label="撤销删除素材"]'
          );
          snippetDeleteUndoFailureVisible =
            bodyIncludes("撤销删除素材失败，撤销入口仍保留，可重新撤销") &&
            bodyIncludes(SNIPPET_RESTORE_FAILURE_SMOKE.error);
          snippetDeleteUndoFailureDidNotPersist =
            snippetUndoRowsAfterFailure[0]?.deleted_at != null;
          snippetDeleteUndoFailurePreserved =
            Boolean(snippetUndoButtonAfterFailure) &&
            !snippetUndoButtonAfterFailure?.disabled &&
            !bodyIncludes(SNIPPET_SMOKE.quote);
          snippetUndoButtonAfterFailure?.click();
          snippetDeleteUndoBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="撤销删除素材"]');
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("撤销中") &&
                bodyIncludes("正在撤销删除素材")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () => bodyIncludes("已撤销删除素材") && bodyIncludes(SNIPPET_SMOKE.quote),
            3_000
          );
          const restoredSnippetRows = await window.aura.db.query(
            "SELECT deleted_at FROM snippets WHERE id = ? LIMIT 1",
            [SNIPPET_SMOKE.id]
          );
          snippetDeleteUndoRecovered =
            snippetDeleteUndoVisible &&
            snippetDeleteUndoBusyVisible &&
            bodyIncludes("已撤销删除素材") &&
            bodyIncludes(SNIPPET_SMOKE.quote) &&
            restoredSnippetRows[0]?.deleted_at == null;
        }

        await window.aura.db.run("DELETE FROM snippets");
        const snippetEmptyNow = Date.now();
        await window.aura.db.run("UPDATE works SET created_at = ?, updated_at = ? WHERE id = ?", [
          snippetEmptyNow,
          snippetEmptyNow,
          SAMPLE.workId
        ]);
        window.dispatchEvent(new Event("aurascholar:snippets-updated"));
        location.hash = "#/snippets";
        await waitFor(
          () =>
            location.hash.includes("/snippets") &&
            bodyIncludes("写作素材") &&
            bodyIncludes("打开最近文献") &&
            bodyIncludes(SAMPLE.title),
          5_000
        );
        const snippetEmptyLatestReaderButton = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.replace(/\s+/g, " ").trim() === "打开最近文献"
        );
        snippetEmptyLatestReaderVisible =
          Boolean(snippetEmptyLatestReaderButton) &&
          bodyIncludes("最近文献") &&
          bodyIncludes(SAMPLE.title);
        snippetEmptyLatestReaderButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/reader?work=" + encodeURIComponent(SAMPLE.workId)) &&
            bodyIncludes("PDF Reader") &&
            bodyIncludes(SAMPLE.title),
          10_000
        );
        snippetEmptyLatestReaderHash = location.hash;
        snippetEmptyLatestReaderOpened =
          snippetEmptyLatestReaderHash.includes("/reader?work=" + encodeURIComponent(SAMPLE.workId)) &&
          bodyIncludes(SAMPLE.title);

        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && bodyIncludes("文献库"),
          5_000
        );
        await window.aura.db.run(
          "UPDATE works SET reading_status = 'unread', updated_at = ? WHERE id = ?",
          [Date.now(), SAMPLE.workId]
        );
        location.hash = "#/reader?work=" + encodeURIComponent(SAMPLE.workId);
        await waitFor(() => location.hash.includes("/reader") && bodyIncludes("PDF Reader"), 10_000);
        await waitFor(
          () =>
            bodyIncludes(SAMPLE.title) &&
            bodyIncludes("已入库") &&
            bodyIncludes("1 页") &&
            Boolean(document.querySelector(".au-reader-page__canvas")),
          10_000
        );
        readerAutoReadingStatusPersisted = Boolean(
          await waitFor(async () => {
            const rows = await window.aura.db.query(
              "SELECT reading_status FROM works WHERE id = ? LIMIT 1",
              [SAMPLE.workId]
            );
            return rows[0]?.reading_status === "reading";
          }, 3_000)
        );
        readerHash = location.hash;
        readerTitleVisible = bodyIncludes(SAMPLE.title);
        readerPageBadgeVisible = bodyIncludes("PDF Reader") && bodyIncludes("1 页") && bodyIncludes("已入库");
        readerCanvasVisible = Boolean(document.querySelector(".au-reader-page__canvas"));
        readerErrorVisible =
          bodyIncludes("这篇文献还没有 PDF 附件") ||
          bodyIncludes("读取 PDF 失败") ||
          bodyIncludes("无法打开阅读器");

        const smokeTextSpan = await waitFor(() => {
          const span = document.querySelector(".au-reader-page__text span");
          return span?.textContent?.includes("AuraScholar Smoke PDF") ? span : null;
        }, 3_000);
        if (smokeTextSpan?.firstChild && smokeTextSpan.textContent) {
          const range = document.createRange();
          const selectedLength = Math.min(smokeTextSpan.textContent.length, "AuraScholar Smoke PDF".length);
          if (selectedLength > 0) {
            range.setStart(smokeTextSpan.firstChild, 0);
            range.setEnd(smokeTextSpan.firstChild, selectedLength);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            smokeTextSpan.dispatchEvent(
              new MouseEvent("mouseup", { bubbles: true, cancelable: true })
            );
            const selectionToolbarButton = (predicate) =>
              Array.from(document.querySelectorAll(".au-reader__selection-toolbar button")).find(
                predicate
              );
            const selectionToolbarPreserved = () =>
              Boolean(document.querySelector(".au-reader__selection-toolbar")) &&
              Boolean(
                selectionToolbarButton((button) =>
                  button.getAttribute("title")?.includes("写作素材")
                )
              ) &&
              Boolean(
                selectionToolbarButton(
                  (button) =>
                    button.classList.contains("au-reader__swatch") ||
                    button.getAttribute("title")?.includes("高亮")
                )
              );
            await waitFor(
              () =>
                selectionToolbarButton((button) => button.getAttribute("title")?.includes("写作素材")),
              2_000
            );
            const annotationRowsBeforeCreateFailure = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM annotations WHERE work_id = ? AND deleted_at IS NULL",
              [SAMPLE.workId]
            );
            window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__ =
              "Smoke reader annotation create failure";
            const annotationCreateFailureButton = await waitFor(
              () =>
                selectionToolbarButton(
                  (button) =>
                    button.classList.contains("au-reader__swatch") ||
                    button.getAttribute("title")?.includes("高亮")
                ),
              1_000
            );
            annotationCreateFailureButton?.click();
            readerAnnotationCreateFailureBusyVisible = Boolean(
              await waitFor(() => {
                const busyButton = selectionToolbarButton(
                  (button) =>
                    button.getAttribute("aria-busy") === "true" &&
                    button.getAttribute("title")?.includes("保存批注")
                );
                return busyButton?.disabled && bodyIncludes("正在保存批注") ? busyButton : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("保存批注失败，选区仍保留，可重新保存") &&
                bodyIncludes("Smoke reader annotation create failure"),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_CREATE__;
            const annotationRowsAfterCreateFailure = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM annotations WHERE work_id = ? AND deleted_at IS NULL",
              [SAMPLE.workId]
            );
            readerAnnotationCreateFailureVisible =
              bodyIncludes("保存批注失败，选区仍保留，可重新保存") &&
              bodyIncludes("Smoke reader annotation create failure");
            readerAnnotationCreateFailureDidNotPersist =
              Number(annotationRowsAfterCreateFailure[0]?.n ?? -1) ===
              Number(annotationRowsBeforeCreateFailure[0]?.n ?? -2);
            readerAnnotationCreateFailurePreserved =
              readerAnnotationCreateFailureVisible && selectionToolbarPreserved();

            const snippetRowsBeforeFailure = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM snippets WHERE work_id = ? AND quote LIKE ? AND deleted_at IS NULL",
              [SAMPLE.workId, "%AuraScholar Smoke PDF%"]
            );
            window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__ =
              "Smoke reader snippet save failure";
            const snippetSaveFailureButton = await waitFor(
              () =>
                selectionToolbarButton((button) =>
                  button.getAttribute("title")?.includes("写作素材")
                ),
              1_000
            );
            snippetSaveFailureButton?.click();
            readerSnippetSaveFailureBusyVisible = Boolean(
              await waitFor(() => {
                const busyButton = selectionToolbarButton(
                  (button) =>
                    button.getAttribute("aria-busy") === "true" &&
                    button.getAttribute("title")?.includes("写作素材")
                );
                return busyButton?.disabled && bodyIncludes("正在保存为写作素材") ? busyButton : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("保存写作素材失败，选中文本仍保留，可重新保存") &&
                bodyIncludes("Smoke reader snippet save failure"),
              3_000
            );
            delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_SNIPPET_SAVE__;
            const snippetRowsAfterFailure = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM snippets WHERE work_id = ? AND quote LIKE ? AND deleted_at IS NULL",
              [SAMPLE.workId, "%AuraScholar Smoke PDF%"]
            );
            readerSnippetSaveFailureVisible =
              bodyIncludes("保存写作素材失败，选中文本仍保留，可重新保存") &&
              bodyIncludes("Smoke reader snippet save failure");
            readerSnippetSaveFailureDidNotPersist =
              Number(snippetRowsAfterFailure[0]?.n ?? -1) ===
              Number(snippetRowsBeforeFailure[0]?.n ?? -2);
            readerSnippetSaveFailurePreserved =
              readerSnippetSaveFailureVisible && selectionToolbarPreserved();

            const snippetSaveButton = await waitFor(
              () =>
                selectionToolbarButton((button) =>
                  button.getAttribute("title")?.includes("写作素材")
                ),
              2_000
            );
            snippetSaveButton?.click();
            readerSnippetSaveBusyVisible = Boolean(
              await waitFor(() => {
                const busyButton = selectionToolbarButton(
                  (button) =>
                    button.getAttribute("aria-busy") === "true" &&
                    button.getAttribute("title")?.includes("写作素材")
                );
                return busyButton?.disabled && bodyIncludes("正在保存为写作素材") ? busyButton : null;
              }, 1_000)
            );
            await waitFor(() => bodyIncludes("已存为写作素材"), 3_000);
            const savedSnippetCount = await window.aura?.db?.queryScalar?.(
              "SELECT COUNT(*) FROM snippets WHERE work_id = 'smoke-work-extreme-c-ux' AND quote LIKE '%AuraScholar Smoke PDF%' AND deleted_at IS NULL"
            );
            readerSnippetSavePersisted = Number(savedSnippetCount) >= 1;
          }
        }

        await waitFor(
          () =>
            bodyIncludes("Smoke reader note for delete confirmation.") &&
            Boolean(document.querySelector(".au-annsidebar__action")),
          3_000
        );
        const annotationComment = document.querySelector(".au-annsidebar__comment");
        annotationComment?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        const commentEditor = await waitFor(
          () => document.querySelector(".au-annsidebar__editor"),
          2_000
        );
        if (commentEditor) {
          const draftText = "Smoke reader note draft protected by discard confirmation.";
          setInputValue(commentEditor, draftText);
          await waitFor(
            () =>
              document.querySelector(".au-annsidebar__editor")?.value === draftText &&
              bodyIncludes("未保存"),
            1_000
          );
          let exportCreateObjectUrlCalled = false;
          const originalCreateObjectUrl = URL.createObjectURL;
          try {
            URL.createObjectURL = (...args) => {
              exportCreateObjectUrlCalled = true;
              return originalCreateObjectUrl.apply(URL, args);
            };
            const exportNotesButton = Array.from(document.querySelectorAll("button")).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === "导出笔记"
            );
            exportNotesButton?.click();
            await waitFor(() => bodyIncludes("请先保存批注评论草稿，再导出笔记。"), 1_000);
            readerCommentDirtyExportMessageVisible = bodyIncludes(
              "请先保存批注评论草稿，再导出笔记。"
            );
            readerCommentDirtyExportDownloadPrevented = !exportCreateObjectUrlCalled;
            readerCommentDirtyExportBlocked =
              readerCommentDirtyExportMessageVisible && readerCommentDirtyExportDownloadPrevented;
          } finally {
            URL.createObjectURL = originalCreateObjectUrl;
          }
          const composingCommentSave = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
            metaKey: true
          });
          Object.defineProperty(composingCommentSave, "isComposing", {
            configurable: true,
            value: true
          });
          commentEditor.dispatchEvent(composingCommentSave);
          await wait(150);
          const composingCommentEscape = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape"
          });
          Object.defineProperty(composingCommentEscape, "isComposing", {
            configurable: true,
            value: true
          });
          commentEditor.dispatchEvent(composingCommentEscape);
          await wait(150);
          readerCommentShortcutCompositionIgnored =
            document.querySelector(".au-annsidebar__editor")?.value === draftText &&
            bodyIncludes("未保存") &&
            !document.querySelector('[role="dialog"]');
          const cancelDraftButton = Array.from(
            document.querySelectorAll(".au-annsidebar__editor-actions button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          cancelDraftButton?.click();
          const draftDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("放弃批注评论草稿？") ? dialog : null;
          }, 3_000);
          readerCommentDraftConfirmVisible = Boolean(
            draftDialog?.textContent?.includes("当前草稿不会写入文献库")
          );
          const keepEditingButton = Array.from(
            draftDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续编辑");
          keepEditingButton?.click();
          await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
          readerCommentDraftCancelPreserved =
            readerCommentDraftConfirmVisible &&
            document.querySelector(".au-annsidebar__editor")?.value === draftText &&
            bodyIncludes("未保存");
          const cancelDraftAgainButton = Array.from(
            document.querySelectorAll(".au-annsidebar__editor-actions button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          cancelDraftAgainButton?.click();
          const discardDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("放弃批注评论草稿？") ? dialog : null;
          }, 3_000);
          const discardDraftButton = Array.from(
            discardDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "放弃草稿");
          discardDraftButton?.click();
          await waitFor(
            () =>
              !document.querySelector(".au-annsidebar__editor") &&
              bodyIncludes("Smoke reader note for delete confirmation."),
            2_000
          );
          readerCommentDraftDiscarded =
            !document.querySelector(".au-annsidebar__editor") &&
            bodyIncludes("Smoke reader note for delete confirmation.");
        }
        const annotationDeleteButton = document.querySelector(".au-annsidebar__action");
        annotationDeleteButton?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        const annotationDeleteDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除这条批注？") ? dialog : null;
        }, 3_000);
        readerAnnotationDeleteConfirmVisible = Boolean(
          annotationDeleteDialog?.textContent?.includes("已入库批注会从文献库中移除")
        );
        const cancelAnnotationDeleteButton = Array.from(
          annotationDeleteDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
        cancelAnnotationDeleteButton?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        readerAnnotationDeleteCancelPreserved =
          readerAnnotationDeleteConfirmVisible &&
          bodyIncludes("Smoke reader note for delete confirmation.") &&
          bodyIncludes("批注 1");

        const savedCommentText = "Smoke reader note saved with busy feedback.";
        const annotationCommentAfterCancel = document.querySelector(".au-annsidebar__comment");
        annotationCommentAfterCancel?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        const saveCommentEditor = await waitFor(
          () => document.querySelector(".au-annsidebar__editor"),
          2_000
        );
        if (saveCommentEditor) {
          const failedCommentText = "Smoke reader comment save failure keeps draft.";
          const commentBeforeFailure = await window.aura?.db?.queryScalar?.(
            "SELECT content_md FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm'"
          );
          setInputValue(saveCommentEditor, failedCommentText);
          await waitFor(
            () =>
              document.querySelector(".au-annsidebar__editor")?.value === failedCommentText &&
              bodyIncludes("未保存"),
            1_000
          );
          window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__ =
            "Smoke reader comment save failure";
          const failSaveCommentButton = Array.from(
            document.querySelectorAll(".au-annsidebar__editor-actions button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存");
          failSaveCommentButton?.click();
          const preservedCommentEditor = await waitFor(() => {
            const editor = document.querySelector(".au-annsidebar__editor");
            const saveButton = Array.from(
              document.querySelectorAll(".au-annsidebar__editor-actions button")
            ).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "保存" && !button.disabled
            );
            return bodyIncludes("保存评论失败，草稿仍保留，可重新保存") &&
              bodyIncludes("Smoke reader comment save failure") &&
              editor?.value === failedCommentText &&
              Boolean(saveButton)
              ? editor
              : null;
          }, 3_000);
          delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_COMMENT_SAVE__;
          const commentAfterFailure = await window.aura?.db?.queryScalar?.(
            "SELECT content_md FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm'"
          );
          readerCommentSaveFailureVisible =
            bodyIncludes("保存评论失败，草稿仍保留，可重新保存") &&
            bodyIncludes("Smoke reader comment save failure");
          readerCommentSaveFailurePreserved =
            Boolean(preservedCommentEditor) &&
            preservedCommentEditor.value === failedCommentText;
          readerCommentSaveFailureDidNotPersist = commentAfterFailure === commentBeforeFailure;
          setInputValue(saveCommentEditor, savedCommentText);
          await waitFor(
            () =>
              document.querySelector(".au-annsidebar__editor")?.value === savedCommentText &&
              bodyIncludes("未保存"),
            1_000
          );
          const saveCommentButton = Array.from(
            document.querySelectorAll(".au-annsidebar__editor-actions button")
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存");
          saveCommentButton?.click();
          readerCommentSaveBusyVisible = Boolean(
            await waitFor(() => {
              const busySaveButton = Array.from(
                document.querySelectorAll(".au-annsidebar__editor-actions button")
              ).find((button) => button.getAttribute("aria-busy") === "true");
              return busySaveButton?.disabled &&
                busySaveButton.textContent?.includes("保存中") &&
                bodyIncludes("保存中")
                ? busySaveButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("批注评论已保存") &&
              bodyIncludes(savedCommentText) &&
              !document.querySelector(".au-annsidebar__editor"),
            3_000
          );
          const savedComment = await window.aura?.db?.queryScalar?.(
            "SELECT content_md FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm'"
          );
          readerCommentSavePersisted = savedComment === savedCommentText && bodyIncludes(savedCommentText);
        }

        const readerAnnotationDeleteButton = () =>
          document.querySelector(".au-annsidebar__action");
        const clickConfirmReaderAnnotationDelete = async () => {
          const dialog = await waitFor(() => {
            const candidate = document.querySelector('[role="dialog"]');
            return candidate?.textContent?.includes("删除这条批注？") ? candidate : null;
          }, 3_000);
          const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除批注"
          );
          confirmButton?.click();
        };
        const annotationCountBeforeDeleteFailure = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        const annotationDeleteButtonForFailure = readerAnnotationDeleteButton();
        annotationDeleteButtonForFailure?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__ =
          READER_ANNOTATION_DELETE_FAILURE_SMOKE.error;
        await clickConfirmReaderAnnotationDelete();
        readerAnnotationDeleteFailureBusyVisible = Boolean(
          await waitFor(() => {
            const item = document.querySelector(".au-annsidebar__item");
            const deleteButton = readerAnnotationDeleteButton();
            return item?.getAttribute("aria-busy") === "true" &&
              deleteButton?.getAttribute("aria-busy") === "true" &&
              deleteButton.disabled &&
              deleteButton.textContent?.includes("…")
              ? deleteButton
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("删除批注失败，批注仍保留，可重新删除") &&
            bodyIncludes(READER_ANNOTATION_DELETE_FAILURE_SMOKE.error),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_DELETE__;
        const annotationCountAfterDeleteFailure = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        readerAnnotationDeleteFailureVisible =
          bodyIncludes("删除批注失败，批注仍保留，可重新删除") &&
          bodyIncludes(READER_ANNOTATION_DELETE_FAILURE_SMOKE.error);
        readerAnnotationDeleteFailureDidNotPersist =
          Number(annotationCountBeforeDeleteFailure) === 1 &&
          Number(annotationCountAfterDeleteFailure) === 1;
        readerAnnotationDeleteFailurePreserved =
          bodyIncludes("批注 1") &&
          bodyIncludes(savedCommentText) &&
          Boolean(readerAnnotationDeleteButton()) &&
          !document.querySelector('button[aria-label="撤销删除批注"]');

        const annotationDeleteButtonForBusy = readerAnnotationDeleteButton();
        annotationDeleteButtonForBusy?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        await clickConfirmReaderAnnotationDelete();
        readerAnnotationDeleteBusyVisible = Boolean(
          await waitFor(() => {
            const item = document.querySelector(".au-annsidebar__item");
            const deleteButton = readerAnnotationDeleteButton();
            return item?.getAttribute("aria-busy") === "true" &&
              deleteButton?.getAttribute("aria-busy") === "true" &&
              deleteButton.disabled &&
              deleteButton.textContent?.includes("…")
              ? deleteButton
              : null;
          }, 1_000)
        );
        await waitFor(
          () => bodyIncludes("已删除批注") && bodyIncludes("批注 0") && !bodyIncludes(savedCommentText),
          3_000
        );
        const remainingAnnotationCount = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        readerAnnotationDeleteSuccessVisible =
          Number(remainingAnnotationCount) === 0 &&
          bodyIncludes("已删除批注") &&
          bodyIncludes("批注 0");
        const undoAnnotationDeleteButton = await waitFor(
          () => document.querySelector('button[aria-label="撤销删除批注"]'),
          1_000
        );
        window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__ =
          READER_ANNOTATION_RESTORE_FAILURE_SMOKE.error;
        undoAnnotationDeleteButton?.click();
        readerAnnotationDeleteUndoFailureBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除批注"]');
            return button?.getAttribute("aria-busy") === "true" &&
              button.disabled &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除批注")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("撤销删除批注失败，撤销入口仍保留，可重新撤销") &&
            bodyIncludes(READER_ANNOTATION_RESTORE_FAILURE_SMOKE.error),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_ANNOTATION_RESTORE__;
        const annotationCountAfterUndoFailure = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        const undoAnnotationDeleteButtonAfterFailure = document.querySelector(
          'button[aria-label="撤销删除批注"]'
        );
        readerAnnotationDeleteUndoFailureVisible =
          bodyIncludes("撤销删除批注失败，撤销入口仍保留，可重新撤销") &&
          bodyIncludes(READER_ANNOTATION_RESTORE_FAILURE_SMOKE.error);
        readerAnnotationDeleteUndoFailureDidNotPersist =
          Number(annotationCountAfterUndoFailure) === 0;
        readerAnnotationDeleteUndoFailurePreserved =
          Boolean(undoAnnotationDeleteButtonAfterFailure) &&
          !undoAnnotationDeleteButtonAfterFailure?.disabled &&
          bodyIncludes("批注 0") &&
          !bodyIncludes(savedCommentText);
        undoAnnotationDeleteButtonAfterFailure?.click();
        readerAnnotationDeleteUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除批注"]');
            return button?.getAttribute("aria-busy") === "true" &&
              button.disabled &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除批注")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("已撤销删除批注") &&
            bodyIncludes("批注 1") &&
            bodyIncludes(savedCommentText),
          3_000
        );
        const restoredAnnotationCount = await window.aura?.db?.queryScalar?.(
          "SELECT COUNT(*) FROM annotations WHERE id = 'smoke-annotation-reader-delete-confirm' AND deleted_at IS NULL"
        );
        readerAnnotationDeleteUndoRecovered =
          Number(restoredAnnotationCount) === 1 &&
          bodyIncludes("已撤销删除批注") &&
          bodyIncludes("批注 1") &&
          bodyIncludes(savedCommentText);
        const readerAnnotationToastAutoDismissed = Boolean(
          await waitFor(() => !document.querySelector(".reader-toast"), 4_000)
        );
        readerAnnotationDeleteUndoRecovered =
          readerAnnotationDeleteUndoRecovered && readerAnnotationToastAutoDismissed;

        const translationSelectionSpan = document.querySelector(".au-reader-page__text span");
        if (translationSelectionSpan?.firstChild && translationSelectionSpan.textContent) {
          const range = document.createRange();
          range.setStart(translationSelectionSpan.firstChild, 0);
          range.setEnd(
            translationSelectionSpan.firstChild,
            Math.min(translationSelectionSpan.textContent.length, 20)
          );
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          translationSelectionSpan.dispatchEvent(
            new MouseEvent("mouseup", { bubbles: true, cancelable: true })
          );
          const selectionTranslateButton = await waitFor(
            () => document.querySelector('button[title="翻译选中文本"]'),
            2_000
          );
          selectionTranslateButton?.click();
          const selectionTranslationPopover = await waitFor(
            () => document.querySelector(".reader-selection-translation"),
            2_000
          );
          if (selectionTranslationPopover) {
            const rect = selectionTranslationPopover.getBoundingClientRect();
            readerTranslationSelectionPopoverVisible =
              selectionTranslationPopover.textContent?.includes("AuraScholar") === true &&
              rect.left >= 0 &&
              rect.top >= 0 &&
              rect.right <= window.innerWidth &&
              rect.bottom <= window.innerHeight;
            selectionTranslationPopover.querySelector('button[aria-label="关闭划词翻译"]')?.click();
          }
        }

        const translateTab = Array.from(document.querySelectorAll(".reader-tabs button")).find(
          (button) => button.textContent?.includes("翻译")
        );
        translateTab?.click();
        await waitFor(() => Boolean(document.querySelector(".reader-translate-panel")), 2_000);
        const translationModeButtons = Array.from(
          document.querySelectorAll(".reader-translate-modebar button")
        );
        const translationModesVisible = ["划词翻译", "双栏对照", "文内对照"].every((label) =>
          translationModeButtons.some(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === label
          )
        );
        translationModeButtons
          .find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "双栏对照")
          ?.click();
        await waitFor(
          () =>
            Boolean(document.querySelector(".reader-translate-panel--split")) &&
            Boolean(document.querySelector(".reader-pdf-pane--source")) &&
            Boolean(document.querySelector('.reader-translation-document[aria-label="译文 PDF"]')),
          1_000
        );
        readerTranslationSplitDocumentsVisible =
          Boolean(document.querySelector(".reader-pdf-pane--source")) &&
          Boolean(document.querySelector('.reader-translation-document[aria-label="译文 PDF"]')) &&
          bodyIncludes("原文 PDF") &&
          bodyIncludes("译文 PDF");
        const translatePageButton = Array.from(
          document.querySelectorAll(".reader-translate-panel button")
        ).find((button) => button.textContent?.includes("翻译该页"));
        translatePageButton?.click();
        readerTranslationStartBusyVisible = Boolean(
          await waitFor(() => {
            const panel = document.querySelector(".reader-translate-panel");
            const busyButton = Array.from(panel?.querySelectorAll("button") ?? []).find(
              (button) => button.getAttribute("aria-busy") === "true" && button.disabled
            );
            return panel?.getAttribute("aria-busy") === "true" &&
              busyButton?.textContent?.includes("翻译中") &&
              panel.textContent?.includes("翻译中")
              ? busyButton
              : null;
          }, 1_000)
        );
        await waitFor(() => bodyIncludes("请先在设置页配置 AI 服务"), 3_000);
        readerTranslationStartErrorVisible =
          translationModesVisible &&
          readerTranslationStartBusyVisible &&
          bodyIncludes("请先在设置页配置 AI 服务");
        const translateSettingsButton = Array.from(
          document.querySelectorAll(".reader-translate-panel button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "去配置 AI");
        readerTranslationSettingsCtaVisible =
          readerTranslationStartErrorVisible && Boolean(translateSettingsButton);
        translateSettingsButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/settings?section=ai") &&
            Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted')) &&
            bodyIncludes("AI 服务") &&
            bodyIncludes("阅读翻译"),
          3_000
        );
        readerTranslationSettingsCtaTargetsSection =
          location.hash.includes("/settings?section=ai") &&
          Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted'));
        readerTranslationSettingsCtaNavigates =
          location.hash.includes("/settings?section=ai") &&
          bodyIncludes("AI 服务") &&
          bodyIncludes("阅读翻译");
        location.hash =
          "#/reader?work=" + encodeURIComponent(SAMPLE.workId) + "&tab=translate";
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            Boolean(document.querySelector(".reader-translate-panel")),
          4_000
        );
        const splitModeButtonAfterReturn = Array.from(
          document.querySelectorAll(".reader-translate-modebar button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "双栏对照");
        splitModeButtonAfterReturn?.click();
        await waitFor(
          () => Boolean(document.querySelector('.reader-translation-document[aria-label="译文 PDF"]')),
          2_000
        );
        const expectedTranslationCopy = [
          "Smoke translated paragraph one.",
          "Smoke translated paragraph two."
        ].join("\n\n");
        window.dispatchEvent(
          new CustomEvent("aurascholar:reader-translation-smoke-segments", {
            detail: {
              engine: "smoke",
              segments: [
                { source: "Smoke source paragraph one.", result: "Smoke translated paragraph one." },
                { source: "Smoke source paragraph two.", result: "Smoke translated paragraph two." }
              ]
            }
          })
        );
        await waitFor(
          () =>
            bodyIncludes("Smoke translated paragraph one.") &&
            Boolean(
              Array.from(document.querySelectorAll("button")).find((button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "复制译文"
              )
            ),
          2_000
        );
        const inlineModeButton = Array.from(
          document.querySelectorAll(".reader-translate-modebar button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "文内对照");
        inlineModeButton?.click();
        const inlineDocument = await waitFor(
          () => document.querySelector('.reader-translation-document[aria-label="文内对照 PDF"]'),
          2_000
        );
        const firstBilingualSection = inlineDocument?.querySelector(
          ".reader-translation-page__bilingual section"
        );
        readerTranslationInlineDocumentVisible =
          Boolean(inlineDocument) &&
          firstBilingualSection?.querySelector(".reader-translation-page__source")?.textContent?.includes(
            "Smoke source paragraph one."
          ) === true &&
          firstBilingualSection?.querySelector(".reader-translation-page__result")?.textContent?.includes(
            "Smoke translated paragraph one."
          ) === true;
        const copyTranslationButton = Array.from(document.querySelectorAll("button")).find((button) =>
          button.textContent?.replace(/\s+/g, " ").trim() === "复制译文"
        );
        copyTranslationButton?.click();
        readerTranslationCopyBusyVisible = Boolean(
          await waitFor(() => {
            const busyButton = Array.from(document.querySelectorAll("button")).find(
              (button) => button.getAttribute("aria-busy") === "true" && button.disabled
            );
            return busyButton?.textContent?.includes("复制中") ? busyButton : null;
          }, 1_000)
        );
        await waitFor(() => bodyIncludes("已复制 2 段译文"), 2_000);
        readerTranslationCopyStatusText =
          document.querySelector(".reader-translate-copy-status")?.textContent?.trim() ?? "";
        readerTranslationCopyFeedbackVisible = readerTranslationCopyStatusText.includes(
          "已复制 2 段译文"
        );
        try {
          if (window.aura?.clipboard?.readText) {
            const clipboardText = await window.aura.clipboard.readText();
            readerTranslationClipboardMatches = clipboardText === expectedTranslationCopy;
          } else if (navigator.clipboard?.readText) {
            const clipboardText = await navigator.clipboard.readText();
            readerTranslationClipboardMatches = clipboardText === expectedTranslationCopy;
          } else {
            readerTranslationClipboardMatches = readerTranslationCopyFeedbackVisible;
          }
        } catch {
          readerTranslationClipboardMatches = readerTranslationCopyFeedbackVisible;
        }

        const readerAnnotationsTab = Array.from(
          document.querySelectorAll(".reader-tabs button")
        ).find((button) => button.textContent?.includes("批注"));
        readerAnnotationsTab?.click();
        const readerAnnotationCanvasButton = await waitFor(() => {
          const activeReaderTab = document.querySelector(".reader-tabs .au-tab--active");
          if (!activeReaderTab?.textContent?.includes("批注")) return null;
          return (
            Array.from(document.querySelectorAll(".au-annsidebar__canvas")).find((button) =>
              button.getAttribute("aria-label")?.includes("AuraScholar Smoke PDF")
            ) ?? null
          );
        }, 3_000);
        readerAnnotationCanvasButton?.click();
        await waitFor(
          () =>
            location.hash.startsWith("#/canvas/") &&
            !location.hash.includes("workId=") &&
            !location.hash.includes("annotationId=") &&
            Boolean(document.querySelector(".canvas-workspace")) &&
            Boolean(
              Array.from(document.querySelectorAll(".canvas-card--excerpt")).find((card) =>
                card.querySelector(".canvas-card__quote")?.textContent?.includes(
                  "AuraScholar Smoke PDF"
                )
              )
            ),
          8_000
        );
        canvasReaderAnnotationDeepLinkHash = location.hash;
        canvasReaderAnnotationDeepLinkNavigated =
          Boolean(readerAnnotationCanvasButton) &&
          canvasReaderAnnotationDeepLinkHash.startsWith("#/canvas/") &&
          !canvasReaderAnnotationDeepLinkHash.includes("workId=") &&
          !canvasReaderAnnotationDeepLinkHash.includes("annotationId=");
        canvasReaderAnnotationVisible = Boolean(
          Array.from(document.querySelectorAll(".canvas-card--excerpt")).find((card) =>
            card.querySelector(".canvas-card__quote")?.textContent?.includes(
              "AuraScholar Smoke PDF"
            )
          )
        );
        const persistedCanvasAnnotation = await waitFor(async () => {
          const rows = await window.aura.db.query(
            "SELECT id, data_json FROM canvas_nodes WHERE workspace_id = ? AND type = 'excerpt'",
            ["canvas:default"]
          );
          return rows.find((row) => {
            try {
              const data = JSON.parse(row.data_json);
              return (
                data.workId === SAMPLE.workId &&
                data.annotationId === SAMPLE.annotationId &&
                data.highlightText === "AuraScholar Smoke PDF"
              );
            } catch {
              return false;
            }
          }) ?? null;
        }, 5_000);
        canvasReaderAnnotationPersisted = Boolean(persistedCanvasAnnotation);
        location.hash =
          "#/reader?work=" + encodeURIComponent(SAMPLE.workId) + "&tab=graph";
        await waitFor(
          () => {
            const activeReaderTab = document.querySelector(".reader-tabs .au-tab--active");
            return (
              location.hash.includes("tab=graph") &&
              activeReaderTab?.textContent?.includes("脉络") &&
              Boolean(document.querySelector(".citation-graph-view .citation-graph-node")) &&
              bodyIncludes(SAMPLE.doi)
            );
          },
          3_000
        );
        readerTabDeepLinkSyncVisible = Boolean(
          document.querySelector(".reader-tabs .au-tab--active")?.textContent?.includes("脉络")
        ) &&
          Boolean(document.querySelector(".citation-graph-view .citation-graph-node")) &&
          Boolean(document.querySelector('.citation-graph-zoom button[aria-label="放大图谱"]')) &&
          Boolean(document.querySelector(".citation-graph-focus")) &&
          Math.max(
            ...Array.from(document.querySelectorAll(".citation-graph-node")).map((node) =>
              Number(node.getAttribute("r") ?? 0)
            )
          ) <= 22;

        location.hash = "#/reader";
        await waitFor(
          () =>
            location.hash === "#/reader" &&
            bodyIncludes("阅读器") &&
            bodyIncludes("等待一篇 PDF") &&
            !bodyIncludes(SAMPLE.title) &&
            !document.querySelector(".au-reader-page__canvas"),
          3_000
        );
        readerNoWorkClearsDocument =
          location.hash === "#/reader" &&
          bodyIncludes("阅读器") &&
          bodyIncludes("等待一篇 PDF") &&
          !bodyIncludes(SAMPLE.title) &&
          !document.querySelector(".au-reader-page__canvas");

        window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__ =
          "Smoke reader transient open failure";
        location.hash = "#/reader?work=" + encodeURIComponent(SAMPLE.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("Smoke reader transient open failure") &&
            Boolean(
              Array.from(document.querySelectorAll(".reader-empty-hero__actions button")).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "重试打开"
              )
            ) &&
            !document.querySelector(".au-reader-page__canvas"),
          5_000
        );
        readerLoadRetryAttempts = 1;
        Array.from(document.querySelectorAll(".reader-empty-hero__actions button"))
          .find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "重试打开")
          ?.click();
        await waitFor(
          () =>
            bodyIncludes("PDF Reader") &&
            bodyIncludes(SAMPLE.title) &&
            Boolean(document.querySelector(".au-reader-page__canvas")) &&
            !bodyIncludes("Smoke reader transient open failure"),
          10_000
        );
        readerLoadRetryAttempts += 1;
        readerLoadRetryRecoveryVisible =
          readerLoadRetryAttempts === 2 &&
          bodyIncludes("PDF Reader") &&
          bodyIncludes(SAMPLE.title) &&
          Boolean(document.querySelector(".au-reader-page__canvas")) &&
          !bodyIncludes("Smoke reader transient open failure");
        readerLoadRetryRecoveryDetail =
          "attempts=" +
          readerLoadRetryAttempts +
          "; canvas=" +
          Boolean(document.querySelector(".au-reader-page__canvas")) +
          "; error=" +
          bodyIncludes("Smoke reader transient open failure");
        delete window.__AURASCHOLAR_SMOKE_READER_FAIL_NEXT_OPEN__;

        const archivedAttachmentRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL",
          [READER_ARCHIVED_SMOKE.workId]
        );
        const archivedAnnotationRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM annotations WHERE work_id = ? AND deleted_at IS NULL",
          [READER_ARCHIVED_SMOKE.workId]
        );
        readerArchivedAttachmentRows = Number(archivedAttachmentRows[0]?.n ?? 0);
        readerArchivedAnnotationRows = Number(archivedAnnotationRows[0]?.n ?? 0);
        location.hash = "#/reader?work=" + encodeURIComponent(READER_ARCHIVED_SMOKE.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("文献在回收站") &&
            bodyIncludes("待恢复文献") &&
            bodyIncludes(READER_ARCHIVED_SMOKE.title),
          10_000
        );
        const archivedActionText = Array.from(
          document.querySelectorAll(".reader-empty-hero__actions button")
        )
          .map((button) => button.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .join(" ");
        readerArchivedHash = location.hash;
        readerArchivedStateVisible =
          bodyIncludes("文献在回收站") &&
          bodyIncludes("待恢复文献") &&
          bodyIncludes(READER_ARCHIVED_SMOKE.title) &&
          bodyIncludes(READER_ARCHIVED_SMOKE.author) &&
          bodyIncludes("这篇文献已在回收站");
        readerArchivedRecoveryCtaVisible = archivedActionText.includes("去文献库恢复");
        readerArchivedForbiddenActionsHidden =
          !archivedActionText.includes("补上 PDF") &&
          !archivedActionText.includes("去找全文") &&
          !archivedActionText.includes("打开本地 PDF") &&
          !archivedActionText.includes("重试打开");
        readerArchivedCanvasBlocked =
          !document.querySelector(".au-reader-page__canvas") &&
          !bodyIncludes("PDF Reader") &&
          !bodyIncludes("Archived annotation should stay hidden until restore.");
        Array.from(document.querySelectorAll(".reader-empty-hero__actions button"))
          .find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "去文献库恢复")
          ?.click();
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
              READER_ARCHIVED_SMOKE.title
            ) &&
            Boolean(
              document.querySelector(
                '.library-table__row--selected[data-library-row-id="' +
                  READER_ARCHIVED_SMOKE.workId +
                  '"]'
              )
              ) &&
              Boolean(
                document.querySelector(".app-sidebar-trash--active")
              ),
          10_000
        );
        const archivedBackToTrashRow = document.querySelector(
          '.library-table__row--selected[data-library-row-id="' +
            READER_ARCHIVED_SMOKE.workId +
            '"]'
        );
        const archivedBackToTrashSearchInput = document.querySelector(
          ".library-inline-search--header input"
        );
        readerArchivedBackToTrashHash = location.hash;
        readerArchivedBackToTrashRowVisible = Boolean(archivedBackToTrashRow);
          readerArchivedBackToTrashSearchCleared =
            archivedBackToTrashSearchInput?.value === "";
          readerArchivedBackToTrashFilterVisible = Boolean(
            document.querySelector(".app-sidebar-trash--active")
          );
        readerArchivedBackToTrashLocated =
          readerArchivedBackToTrashRowVisible &&
          readerArchivedBackToTrashSearchCleared &&
          readerArchivedBackToTrashFilterVisible &&
          (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
            READER_ARCHIVED_SMOKE.title
          );

        location.hash = "#/reader?work=" + encodeURIComponent(MISSING_PDF.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(MISSING_PDF.title),
          10_000
        );
        readerMissingHash = location.hash;
        readerMissingPdfVisible =
          bodyIncludes("PDF 未就绪") &&
          bodyIncludes(MISSING_PDF.title) &&
          bodyIncludes(MISSING_PDF.author) &&
          bodyIncludes("这篇文献还没有 PDF 附件");
        readerMissingPdfRecoveryVisible =
          bodyIncludes("补上 PDF 并打开") &&
          bodyIncludes("去找全文") &&
          bodyIncludes("回文献库定位");
        readerMissingPdfAttachCtaVisible = bodyIncludes("补上 PDF 并打开");

        const findFulltextButton = Array.from(
          document.querySelectorAll(".reader-empty-hero__actions button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "去找全文");
        findFulltextButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/discovery") &&
            Boolean(document.querySelector(".discovery-page--browser")) &&
            bodyIncludes("补全文目标") &&
            bodyIncludes(MISSING_PDF.title),
          5_000
        );
        readerFindFulltextHandoffHash = location.hash;
        readerFindFulltextHandoffView =
          document.querySelector(".discovery-page")?.className?.toString() ?? "";
        readerFindFulltextHandoffNavigated =
          location.hash.includes("/discovery") &&
          Boolean(document.querySelector(".discovery-page--browser"));
        readerFindFulltextHandoffTargetVisible =
          bodyIncludes("补全文目标") &&
          bodyIncludes(MISSING_PDF.title) &&
          bodyIncludes("下载或抓取到的 PDF 会优先挂回这篇文献");
        readerFindFulltextHandoffStatusVisible = bodyIncludes(
          "正在为《" + MISSING_PDF.title + "》打开全文来源"
        );
        location.hash = "#/reader?work=" + encodeURIComponent(MISSING_PDF.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(MISSING_PDF.title),
          10_000
        );

        const backToLibraryButton = Array.from(
          document.querySelectorAll(".reader-empty-hero__actions button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "回文献库定位");
        backToLibraryButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
              MISSING_PDF.title
            ) &&
            Boolean(
              document.querySelector(
                '.library-table__row--selected[data-library-row-id="' + MISSING_PDF.workId + '"]'
              )
            ),
          10_000
        );
        const backToLibrarySelectedRow = document.querySelector(
          '.library-table__row--selected[data-library-row-id="' + MISSING_PDF.workId + '"]'
        );
        const backToLibrarySearchInput = document.querySelector(
          ".library-inline-search--header input"
        );
        readerMissingBackToLibraryHash = location.hash;
        readerMissingBackToLibraryDetail =
          document.querySelector(".library-detail--selected h2")?.textContent?.trim() ?? "";
        readerMissingBackToLibraryPageText =
          document.querySelector(".library-pagination__page")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        readerMissingBackToLibraryRowVisible = Boolean(backToLibrarySelectedRow);
        readerMissingBackToLibrarySearchCleared = backToLibrarySearchInput?.value === "";
        readerMissingBackToLibraryVisibleRows = Array.from(
          document.querySelectorAll(".library-table__row")
        )
          .map((row) => row.getAttribute("data-library-row-id") ?? "")
          .filter(Boolean)
          .join(",");
        readerMissingBackToLibraryLocated =
          location.hash.includes("/library") &&
          !location.hash.includes("work=") &&
          readerMissingBackToLibraryRowVisible &&
          readerMissingBackToLibrarySearchCleared &&
          (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
            MISSING_PDF.title
          );

        location.hash = "#/library?work=" + encodeURIComponent("smoke-work-not-in-library");
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            bodyIncludes("没有找到要定位的文献"),
          3_000
        );
        libraryMissingDeepLinkFeedbackVisible = bodyIncludes("没有找到要定位的文献");

        location.hash = "#/reader?work=" + encodeURIComponent(MISSING_PDF.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(MISSING_PDF.title),
          10_000
        );

        const recoveryInput = document.querySelector('.reader-empty-hero__actions input[type="file"]');
        if (recoveryInput) {
          const recoveryFile = new File([makeSmokePdf()], "reader-recovery.pdf", {
            type: "application/pdf"
          });
          const transfer = new DataTransfer();
          transfer.items.add(recoveryFile);
          Object.defineProperty(recoveryInput, "files", {
            configurable: true,
            value: transfer.files
          });
          recoveryInput.dispatchEvent(new Event("change", { bubbles: true }));
          readerMissingPdfAttachBusyVisible = Boolean(
            await waitFor(() => {
              const busyButton = Array.from(
                document.querySelectorAll(".reader-empty-hero__actions button")
              ).find((button) => button.getAttribute("aria-busy") === "true");
              return busyButton?.disabled &&
                busyButton.textContent?.includes("正在补上")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("PDF Reader") &&
              bodyIncludes(MISSING_PDF.title) &&
              bodyIncludes("已入库") &&
              bodyIncludes("1 页") &&
              Boolean(document.querySelector(".au-reader-page__canvas")),
            10_000
          );
          readerRecoveredPdfVisible =
            bodyIncludes("PDF Reader") &&
            bodyIncludes(MISSING_PDF.title) &&
            bodyIncludes("已入库") &&
            Boolean(document.querySelector(".au-reader-page__canvas"));
          const recoveredRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL",
            [MISSING_PDF.workId]
          );
          readerRecoveredAttachmentCount = Number(recoveredRows[0]?.n ?? 0);
        }

        location.hash = "#/reader?work=" + encodeURIComponent(BROKEN_BLOB.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(BROKEN_BLOB.title),
          10_000
        );
        readerBrokenHash = location.hash;
        readerBrokenBlobVisible =
          bodyIncludes("PDF 未就绪") &&
          bodyIncludes(BROKEN_BLOB.title) &&
          bodyIncludes(BROKEN_BLOB.author) &&
          bodyIncludes("本地文件无法读取");
        readerBrokenBlobRecoveryVisible =
          bodyIncludes("补上 PDF 并打开") &&
          bodyIncludes("去找全文") &&
          bodyIncludes("回文献库定位");

        const repairInput = document.querySelector('.reader-empty-hero__actions input[type="file"]');
        if (repairInput) {
          const repairFile = new File([makeSmokePdf()], "reader-broken-repair.pdf", {
            type: "application/pdf"
          });
          const repairTransfer = new DataTransfer();
          repairTransfer.items.add(repairFile);
          Object.defineProperty(repairInput, "files", {
            configurable: true,
            value: repairTransfer.files
          });
          repairInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("PDF Reader") &&
              bodyIncludes(BROKEN_BLOB.title) &&
              bodyIncludes("已入库") &&
              bodyIncludes("1 页") &&
              Boolean(document.querySelector(".au-reader-page__canvas")),
            10_000
          );
          const repairedRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL",
            [BROKEN_BLOB.workId]
          );
          readerBrokenAttachmentCount = Number(repairedRows[0]?.n ?? 0);
        }

        location.hash = "#/reader?work=" + encodeURIComponent(CORRUPT_PDF.workId);
        await waitFor(
          () =>
            location.hash.includes("/reader") &&
            bodyIncludes("PDF 未就绪") &&
            bodyIncludes(CORRUPT_PDF.title),
          10_000
        );
        readerCorruptHash = location.hash;
        readerCorruptPdfVisible =
          bodyIncludes("PDF 未就绪") &&
          bodyIncludes(CORRUPT_PDF.title) &&
          bodyIncludes(CORRUPT_PDF.author) &&
          bodyIncludes("PDF 附件文件无法解析");
        readerCorruptPdfRecoveryVisible =
          bodyIncludes("补上 PDF 并打开") &&
          bodyIncludes("去找全文") &&
          bodyIncludes("回文献库定位");

        const corruptRepairInput = document.querySelector('.reader-empty-hero__actions input[type="file"]');
        if (corruptRepairInput) {
          const corruptRepairFile = new File([makeSmokePdf()], "reader-corrupt-repair.pdf", {
            type: "application/pdf"
          });
          const corruptTransfer = new DataTransfer();
          corruptTransfer.items.add(corruptRepairFile);
          Object.defineProperty(corruptRepairInput, "files", {
            configurable: true,
            value: corruptTransfer.files
          });
          corruptRepairInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("PDF Reader") &&
              bodyIncludes(CORRUPT_PDF.title) &&
              bodyIncludes("已入库") &&
              bodyIncludes("1 页") &&
              Boolean(document.querySelector(".au-reader-page__canvas")),
            10_000
          );
          const corruptRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE work_id = ? AND deleted_at IS NULL",
            [CORRUPT_PDF.workId]
          );
          readerCorruptAttachmentCount = Number(corruptRows[0]?.n ?? 0);
        }

        window.__AURASCHOLAR_SMOKE_ROUTE_CRASH__ = {
          message: "AURASCHOLAR_SMOKE_ROUTE_CRASH",
          pathPrefix: "/reader"
        };
        location.hash = "#/reader?work=smoke-route-crash";
        await waitFor(
          () => {
            const boundary = document.querySelector(".app-error-boundary--route");
            return boundary?.textContent?.includes("PDF 阅读器 暂时不可用") ? boundary : null;
          },
          4_000
        );
        const routeCrashBoundary = document.querySelector(".app-error-boundary--route");
        routeCrashBoundaryVisible = Boolean(
          routeCrashBoundary?.textContent?.includes("PDF 阅读器 暂时不可用") &&
            routeCrashBoundary.textContent.includes("回到文献库")
        );
        routeCrashShellVisible =
          Boolean(document.querySelector(".app-sidebar")) &&
          bodyIncludes("AuraScholar") &&
          bodyIncludes("快速打开") &&
          bodyIncludes("文献库");
        const recoverButton = Array.from(
          routeCrashBoundary?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "回到文献库");
        delete window.__AURASCHOLAR_SMOKE_ROUTE_CRASH__;
        recoverButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            Boolean(document.querySelector(".library-page")) &&
            !document.querySelector(".app-error-boundary--route"),
          4_000
        );
        routeCrashRecoveryHash = location.hash;
        routeCrashRecoveredLibraryVisible =
          location.hash.includes("/library") &&
          Boolean(document.querySelector(".library-page")) &&
          bodyIncludes("文献库") &&
          !document.querySelector(".app-error-boundary--route");

        location.hash = "#/discovery";
        await waitFor(
          () =>
            location.hash.includes("/discovery") &&
            Boolean(document.querySelector(".discovery-page--home")) &&
            bodyIncludes("学术检索"),
          4_000
        );
        const discoveryHomeInput = document.querySelector('input[aria-label="学术检索关键词"]');
        if (discoveryHomeInput) {
          setInputValue(discoveryHomeInput, "Composition Discovery Search");
          dispatchComposingEnter(discoveryHomeInput);
          await wait(200);
          discoverySearchCompositionIgnored =
            Boolean(document.querySelector(".discovery-page--home")) &&
            !document.querySelector(".discovery-command-card") &&
            !bodyIncludes("检索中");
        }
        if (window.aura?.research) {
          try {
            window.__AURASCHOLAR_SMOKE_RESEARCH_HIDE_ERROR__ = "smoke-hide-failed";
            location.hash = "#/settings";
            await waitFor(
              () =>
                location.hash.includes("/settings") &&
                bodyIncludes("内置浏览器视图隐藏失败") &&
                bodyIncludes("smoke-hide-failed"),
              3_000
            );
            discoveryBrowserHideFailureVisible =
              bodyIncludes("内置浏览器视图隐藏失败") && bodyIncludes("smoke-hide-failed");
            const closeRuntimeIssue = Array.from(
              document.querySelectorAll(".app-runtime-issue button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "关闭");
            closeRuntimeIssue?.click();
          } finally {
            delete window.__AURASCHOLAR_SMOKE_RESEARCH_HIDE_ERROR__;
            try {
              await window.aura.research.hide();
            } catch {}
          }
          location.hash = "#/discovery";
          await waitFor(
            () =>
              location.hash.includes("/discovery") &&
              Boolean(document.querySelector(".discovery-page--home")) &&
              bodyIncludes("学术检索"),
            4_000
          );
          const restoredDiscoveryInput = document.querySelector('input[aria-label="学术检索关键词"]');
          if (restoredDiscoveryInput) {
            setInputValue(restoredDiscoveryInput, SAVED_SEARCH_SMOKE.query);
          }
        }
        await waitFor(
          () => bodyIncludes(SAVED_SEARCH_HOME_OPEN_SMOKE.query) && bodyIncludes("2 新"),
          3_000
        );
        await waitFor(
          () => typeof window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__ === "function",
          2_000
        );
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          acceptAnyQuery: true,
          delayMs: 1_000,
          query: "Smoke Active Search To Replace",
          title: "Smoke Active Search Should Be Replaced",
          doi: "10.4242/aurascholar.replace-active-search"
        };
        window.__AURASCHOLAR_SMOKE_DISCOVERY_REPLACED_ACTIVE_SEARCH__ = false;
        const activeSearchPromise =
          window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__?.("Smoke Active Search To Replace", [
            "openalex"
          ]) ?? Promise.resolve(false);
        await waitFor(() => Boolean(document.querySelector(".discovery-page--opensource")), 500);
        await wait(50);
        delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          acceptAnyQuery: true,
          empty: true,
          query: SAVED_SEARCH_HOME_OPEN_SMOKE.query,
          title: "Smoke Home Saved Search Empty Result"
        };
        const homeSavedSearchButton = Array.from(
          document.querySelectorAll(".discovery-sub__main")
        ).find((button) => button.textContent?.includes(SAVED_SEARCH_HOME_OPEN_SMOKE.query));
        homeSavedSearchButton?.click();
        await waitFor(
          () => {
            const openingSub = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
              item.textContent?.includes(SAVED_SEARCH_HOME_OPEN_SMOKE.query)
            );
            const openingMain = openingSub?.querySelector(".discovery-sub__main");
            return (
              Boolean(document.querySelector(".discovery-page--opensource")) &&
              openingMain?.getAttribute("aria-busy") === "true" &&
              openingMain?.textContent?.includes("正在打开订阅") &&
              bodyIncludes("正在打开订阅")
            );
          },
          1_000
        );
        const openingHomeSub = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
          item.textContent?.includes(SAVED_SEARCH_HOME_OPEN_SMOKE.query)
        );
        const openingHomeMain = openingHomeSub?.querySelector(".discovery-sub__main");
        discoverySavedSearchHomeOpenBusyVisible = Boolean(
          document.querySelector(".discovery-page--opensource") &&
            openingHomeMain?.getAttribute("aria-busy") === "true" &&
            openingHomeMain?.textContent?.includes("正在打开订阅") &&
            bodyIncludes("正在打开订阅")
        );
        await waitFor(
          () =>
            Boolean(document.querySelector(".discovery-page--opensource")) &&
            bodyIncludes("开放源聚合检索") &&
            bodyIncludes("没有找到结果"),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        await waitFor(async () => {
          const rows = await window.aura.db.query(
            "SELECT new_count FROM saved_searches WHERE id = ? LIMIT 1",
            [SAVED_SEARCH_HOME_OPEN_SMOKE.id]
          );
          return Number(rows[0]?.new_count ?? -1) === 0;
        }, 2_000);
        const homeOpenRows = await window.aura.db.query(
          "SELECT new_count FROM saved_searches WHERE id = ? LIMIT 1",
          [SAVED_SEARCH_HOME_OPEN_SMOKE.id]
        );
        discoverySavedSearchHomeOpenNavigated =
          Boolean(document.querySelector(".discovery-page--opensource")) &&
          bodyIncludes("开放源聚合检索") &&
          bodyIncludes(SAVED_SEARCH_HOME_OPEN_SMOKE.query);
        discoverySavedSearchHomeOpenClearedNewCount =
          discoverySavedSearchHomeOpenNavigated && Number(homeOpenRows[0]?.new_count ?? -1) === 0;
        await activeSearchPromise.catch(() => false);
        discoverySavedSearchHomeOpenReplacedActiveSearch =
          window.__AURASCHOLAR_SMOKE_DISCOVERY_REPLACED_ACTIVE_SEARCH__ === true &&
          discoverySavedSearchHomeOpenNavigated &&
          discoverySavedSearchHomeOpenClearedNewCount;
        const openSourceSearchInput = document.querySelector('input[aria-label="开放源检索关键词"]');
        const clearOpenSearchButton = document.querySelector('button[aria-label="清空开放源检索"]');
        clearOpenSearchButton?.click();
        discoveryOpenSearchEmptyClearRestored = Boolean(
          clearOpenSearchButton &&
            openSourceSearchInput &&
            (await waitFor(
              () =>
                openSourceSearchInput.value === "" &&
                document.activeElement === openSourceSearchInput &&
                bodyIncludes("从开放数据源发现文献") &&
                !bodyIncludes("没有找到匹配文献"),
              1_000
            ))
        );
        const discoveryBackLink = Array.from(document.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("返回学术检索")
        );
        discoveryBackLink?.click();
        await waitFor(() => Boolean(document.querySelector(".discovery-page--home")), 2_000);
        const discoveryImportDoi = "10.4242/aurascholar.discovery-preview";
        const discoveryImportBeforeRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM works WHERE doi = ? AND deleted_at IS NULL",
          [discoveryImportDoi]
        );
        const discoveryReferenceInput = document.querySelector('.web-import-card input[type="file"]');
        if (discoveryReferenceInput) {
          const discoveryBibText = [
            "@article{discovery-preview-smoke,",
            "  title = {Discovery Reference Preview Smoke},",
            "  author = {Hopper, Grace},",
            "  year = {2026},",
            "  doi = {" + discoveryImportDoi + "}",
            "}"
          ].join("\n");
          const discoveryBibFile = new File([discoveryBibText], "discovery-preview.bib", {
            type: "text/plain"
          });
          const discoveryTransfer = new DataTransfer();
          discoveryTransfer.items.add(discoveryBibFile);
          Object.defineProperty(discoveryReferenceInput, "files", {
            configurable: true,
            value: discoveryTransfer.files
          });
          discoveryReferenceInput.dispatchEvent(new Event("change", { bubbles: true }));
          const discoveryImportDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("确认导入引用文件") ? dialog : null;
          }, 3_000);
          discoveryReferenceImportConfirmVisible = Boolean(
            discoveryImportDialog?.textContent?.includes("discovery-preview.bib") &&
              discoveryImportDialog.textContent.includes("导入 1 条")
          );
          const cancelDiscoveryImport = Array.from(
            discoveryImportDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          cancelDiscoveryImport?.click();
          await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
          const discoveryImportAfterRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE doi = ? AND deleted_at IS NULL",
            [discoveryImportDoi]
          );
          discoveryReferenceImportCancelPreserved =
            discoveryReferenceImportConfirmVisible &&
            Number(discoveryImportBeforeRows[0]?.n ?? 0) === 0 &&
            Number(discoveryImportAfterRows[0]?.n ?? 0) === 0 &&
            bodyIncludes("已取消导入引用文件");

          const discoveryConfirmTransfer = new DataTransfer();
          discoveryConfirmTransfer.items.add(discoveryBibFile);
          Object.defineProperty(discoveryReferenceInput, "files", {
            configurable: true,
            value: discoveryConfirmTransfer.files
          });
          discoveryReferenceInput.dispatchEvent(new Event("change", { bubbles: true }));
          const discoveryConfirmImportDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("确认导入引用文件") ? dialog : null;
          }, 3_000);
          const confirmDiscoveryImport = Array.from(
            discoveryConfirmImportDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "导入 1 条");
          confirmDiscoveryImport?.click();
          await waitFor(
            () =>
              discoveryConfirmImportDialog?.getAttribute("aria-busy") === "true" &&
              confirmDiscoveryImport?.disabled &&
              confirmDiscoveryImport.getAttribute("aria-busy") === "true" &&
              confirmDiscoveryImport.textContent?.includes("导入中") &&
              discoveryConfirmImportDialog.textContent?.includes("正在导入引用文件"),
            1_000
          );
          discoveryReferenceImportCommitBusyVisible = Boolean(
            discoveryConfirmImportDialog?.getAttribute("aria-busy") === "true" &&
              confirmDiscoveryImport?.disabled &&
              confirmDiscoveryImport.getAttribute("aria-busy") === "true" &&
              confirmDiscoveryImport.textContent?.includes("导入中") &&
              discoveryConfirmImportDialog.textContent?.includes("正在导入引用文件")
          );
          await waitFor(
            () =>
              !document.querySelector('[role="dialog"]') &&
              bodyIncludes("引用文件导入完成"),
            3_000
          );
          const discoveryImportedRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE doi = ? AND deleted_at IS NULL",
            [discoveryImportDoi]
          );
          discoveryReferenceImportCommitPersisted = Number(discoveryImportedRows[0]?.n ?? 0) === 1;
          discoveryReferenceImportCommitSuccessVisible =
            discoveryReferenceImportCommitBusyVisible &&
            discoveryReferenceImportCommitPersisted &&
            bodyIncludes("引用文件导入完成");

          const emptyReferenceBeforeRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE title = ? AND deleted_at IS NULL",
            ["(无标题)"]
          );
          const emptyReferenceFile = new File(
            ["@article{empty-discovery-smoke,\n}"],
            "empty-reference.bib",
            {
              type: "text/plain"
            }
          );
          const emptyReferenceTransfer = new DataTransfer();
          emptyReferenceTransfer.items.add(emptyReferenceFile);
          Object.defineProperty(discoveryReferenceInput, "files", {
            configurable: true,
            value: emptyReferenceTransfer.files
          });
          discoveryReferenceInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(() => bodyIncludes("没有解析出文献。请选择"), 2_000);
          const emptyReferenceDialogOpen = Boolean(
            document.querySelector('[role="dialog"]')?.textContent?.includes("确认导入引用文件")
          );
          const emptyReferenceAfterRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE title = ? AND deleted_at IS NULL",
            ["(无标题)"]
          );
          discoveryReferenceImportRejectsEmptyVisible =
            bodyIncludes("没有解析出文献。请选择") && !emptyReferenceDialogOpen;
          discoveryReferenceImportRejectsEmptyPersisted =
            Number(emptyReferenceBeforeRows[0]?.n ?? 0) ===
            Number(emptyReferenceAfterRows[0]?.n ?? 0);

          const richReferenceImports = [
            {
              doi: "10.4242/aurascholar.discovery-nbib",
              pmid: "42000001",
              fileName: "discovery-rich-format.nbib",
              text: [
                "PMID- 42000001",
                "TI  - Discovery NBIB Import Smoke.",
                "FAU - Hopper, Grace",
                "JT  - Journal of Discovery Migration",
                "DP  - 2026",
                "VI  - 8",
                "IP  - 1",
                "PG  - 12-18",
                "LID - 10.4242/aurascholar.discovery-nbib [doi]",
                "AB  - PubMed NBIB import smoke fixture."
              ].join("\n")
            },
            {
              doi: "10.4242/aurascholar.discovery-enw",
              pmid: null,
              fileName: "discovery-rich-format.enw",
              text: [
                "%0 Journal Article",
                "%T Discovery ENW Import Smoke",
                "%A Hopper, Grace",
                "%J Journal of Discovery Migration",
                "%D 2026",
                "%V 8",
                "%N 1",
                "%P 19-24",
                "%R 10.4242/aurascholar.discovery-enw",
                "%U https://doi.org/10.4242/aurascholar.discovery-enw",
                "%X EndNote tagged import smoke fixture."
              ].join("\n")
            }
          ];
          const richReferenceResults = [];
          for (const richReferenceImport of richReferenceImports) {
            const richReferenceFile = new File(
              [richReferenceImport.text],
              richReferenceImport.fileName,
              {
                type: "text/plain"
              }
            );
            const richReferenceTransfer = new DataTransfer();
            richReferenceTransfer.items.add(richReferenceFile);
            Object.defineProperty(discoveryReferenceInput, "files", {
              configurable: true,
              value: richReferenceTransfer.files
            });
            discoveryReferenceInput.dispatchEvent(new Event("change", { bubbles: true }));
            const richReferenceDialog = await waitFor(() => {
              const dialog = document.querySelector('[role="dialog"]');
              return dialog?.textContent?.includes("确认导入引用文件") &&
                dialog.textContent.includes(richReferenceImport.fileName) &&
                dialog.textContent.includes("导入 1 条")
                ? dialog
                : null;
            }, 3_000);
            const richReferenceConfirm = Array.from(
              richReferenceDialog?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "导入 1 条");
            richReferenceConfirm?.click();
            const richReferencePersisted = Boolean(
              await waitFor(async () => {
                const rows = await window.aura.db.query(
                  "SELECT COUNT(*) AS n, COALESCE(MAX(CASE WHEN pmid IS ? THEN 1 ELSE 0 END), 0) AS pmid_ok FROM works WHERE doi = ? AND deleted_at IS NULL",
                  [richReferenceImport.pmid, richReferenceImport.doi]
                );
                return (
                  Number(rows[0]?.n ?? 0) === 1 &&
                  Number(rows[0]?.pmid_ok ?? 0) === 1
                );
              }, 4_000)
            );
            const richReferenceMetadataPersisted = Boolean(
              await waitFor(async () => {
                const rows = await window.aura.db.query(
                  "SELECT pmid FROM works WHERE doi = ? AND deleted_at IS NULL LIMIT 1",
                  [richReferenceImport.doi]
                );
                return richReferenceImport.pmid === null
                  ? rows[0]?.pmid == null
                  : rows[0]?.pmid === richReferenceImport.pmid;
              }, 4_000)
            );
            await waitFor(() => !document.querySelector('[role="dialog"]'), 3_000);
            richReferenceResults.push(
              Boolean(richReferenceDialog) &&
                Boolean(richReferenceConfirm) &&
                richReferencePersisted &&
                richReferenceMetadataPersisted
            );
          }
          discoveryReferenceImportRichFormatsPersisted =
            richReferenceResults.length === richReferenceImports.length &&
            richReferenceResults.every(Boolean);
        }
        findButton("管理站点")?.click();
        await waitFor(() => document.querySelector(".discovery-card__manage"), 2_000);
        const proxyConfigInputs = Array.from(document.querySelectorAll(".discovery-proxy-bar input"));
        const proxyConfigInput = proxyConfigInputs[0];
        const ezproxyConfigInput = proxyConfigInputs[1];
        if (proxyConfigInput) {
          setInputValue(proxyConfigInput, DISCOVERY_PROXY_CONFIG_SMOKE);
          await wait(100);
          const saveProxyButton = findExactButton("保存代理");
          saveProxyButton?.click();
          await waitFor(
            () =>
              saveProxyButton?.disabled &&
              saveProxyButton.getAttribute("aria-busy") === "true" &&
              saveProxyButton.textContent?.includes("保存中") &&
              bodyIncludes("保存代理地址..."),
            1_000
          );
          discoveryProxyConfigSaveBusyVisible = Boolean(
            saveProxyButton?.disabled &&
              saveProxyButton.textContent?.includes("保存中") &&
              bodyIncludes("保存代理地址...")
          );
          discoveryProxyConfigSaveAriaBusyVisible =
            discoveryProxyConfigSaveBusyVisible &&
            saveProxyButton?.getAttribute("aria-busy") === "true";
          await waitFor(() => bodyIncludes("已保存代理地址"), 3_000);
          const proxyConfigRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'research.proxy'"
          );
          try {
            discoveryProxyConfigValue = JSON.parse(proxyConfigRows[0]?.value_json ?? "null");
          } catch {
            discoveryProxyConfigValue = null;
          }
          discoveryProxyConfigSaved =
            discoveryProxyConfigSaveBusyVisible &&
            discoveryProxyConfigSaveAriaBusyVisible &&
            discoveryProxyConfigValue === DISCOVERY_PROXY_CONFIG_SMOKE;
          setInputValue(proxyConfigInput, DISCOVERY_PROXY_CREDENTIAL_SMOKE);
          await wait(100);
          saveProxyButton?.click();
          await waitFor(() => bodyIncludes("代理配置无效:代理地址中不能包含用户名或密码"), 2_000);
          discoveryProxyCredentialsRejected = bodyIncludes(
            "代理配置无效:代理地址中不能包含用户名或密码"
          );
          const proxyCredentialRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'research.proxy'"
          );
          let proxyCredentialValue = null;
          try {
            proxyCredentialValue = JSON.parse(proxyCredentialRows[0]?.value_json ?? "null");
          } catch {
            proxyCredentialValue = null;
          }
          discoveryProxyCredentialDidNotPersist =
            proxyCredentialValue === DISCOVERY_PROXY_CONFIG_SMOKE &&
            !String(proxyCredentialRows[0]?.value_json ?? "").includes("smoke-user");
        }
        if (ezproxyConfigInput) {
          setInputValue(ezproxyConfigInput, DISCOVERY_EZPROXY_CONFIG_SMOKE);
          await wait(100);
          const saveEzproxyButton = findExactButton("保存前缀");
          saveEzproxyButton?.click();
          await waitFor(
            () =>
              saveEzproxyButton?.disabled &&
              saveEzproxyButton.getAttribute("aria-busy") === "true" &&
              saveEzproxyButton.textContent?.includes("保存中") &&
              bodyIncludes("保存图书馆前缀..."),
            1_000
          );
          discoveryEzproxyConfigSaveBusyVisible = Boolean(
            saveEzproxyButton?.disabled &&
              saveEzproxyButton.textContent?.includes("保存中") &&
              bodyIncludes("保存图书馆前缀...")
          );
          discoveryEzproxyConfigSaveAriaBusyVisible =
            discoveryEzproxyConfigSaveBusyVisible &&
            saveEzproxyButton?.getAttribute("aria-busy") === "true";
          await waitFor(() => bodyIncludes("已保存图书馆前缀"), 3_000);
          const ezproxyConfigRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'research.ezproxy'"
          );
          try {
            discoveryEzproxyConfigValue = JSON.parse(ezproxyConfigRows[0]?.value_json ?? "null");
          } catch {
            discoveryEzproxyConfigValue = null;
          }
          discoveryEzproxyConfigSaved =
            discoveryEzproxyConfigSaveBusyVisible &&
            discoveryEzproxyConfigSaveAriaBusyVisible &&
            discoveryEzproxyConfigValue === DISCOVERY_EZPROXY_CONFIG_SMOKE;
          setInputValue(ezproxyConfigInput, DISCOVERY_EZPROXY_CREDENTIAL_SMOKE);
          await wait(100);
          saveEzproxyButton?.click();
          await waitFor(
            () => bodyIncludes("图书馆前缀无效:图书馆前缀中不能包含用户名或密码"),
            2_000
          );
          discoveryEzproxyCredentialsRejected = bodyIncludes(
            "图书馆前缀无效:图书馆前缀中不能包含用户名或密码"
          );
          const ezproxyCredentialRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'research.ezproxy'"
          );
          let ezproxyCredentialValue = null;
          try {
            ezproxyCredentialValue = JSON.parse(ezproxyCredentialRows[0]?.value_json ?? "null");
          } catch {
            ezproxyCredentialValue = null;
          }
          discoveryEzproxyCredentialDidNotPersist =
            ezproxyCredentialValue === DISCOVERY_EZPROXY_CONFIG_SMOKE &&
            !String(ezproxyCredentialRows[0]?.value_json ?? "").includes("smoke-user");
        }
        const proxySiteCard = Array.from(document.querySelectorAll(".discovery-card-wrap")).find(
          (card) => card.textContent?.includes(DISCOVERY_PROXY_SITE_SMOKE.name)
        );
        const proxyToggleButton = Array.from(
          proxySiteCard?.querySelectorAll(".discovery-card__manage button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "走代理");
        proxyToggleButton?.click();
        await waitFor(
          () =>
            proxyToggleButton?.disabled &&
            proxyToggleButton.getAttribute("aria-busy") === "true" &&
            proxyToggleButton.textContent?.includes("更新中"),
          1_000
        );
        discoverySiteProxyToggleBusyVisible = Boolean(
          proxyToggleButton?.disabled &&
            proxyToggleButton.getAttribute("aria-busy") === "true" &&
            proxyToggleButton.textContent?.includes("更新中")
        );
        await waitFor(
          () => bodyIncludes("已开启站点代理:" + DISCOVERY_PROXY_SITE_SMOKE.name),
          3_000
        );
        const proxyRows = await window.aura.db.query(
          "SELECT use_proxy FROM discovery_sites WHERE id = ?",
          [DISCOVERY_PROXY_SITE_SMOKE.id]
        );
        discoverySiteProxyValue = Number(proxyRows[0]?.use_proxy ?? 0);
        discoverySiteProxyToggled =
          discoverySiteProxyToggleBusyVisible &&
          bodyIncludes("已开启站点代理:" + DISCOVERY_PROXY_SITE_SMOKE.name) &&
          discoverySiteProxyValue === 1;

        const hideSiteButton = Array.from(
          document.querySelectorAll(".discovery-card__manage button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "隐藏");
        const hideSiteName =
          hideSiteButton
            ?.closest(".discovery-card-wrap")
            ?.querySelector(".discovery-card__body strong")
            ?.textContent?.trim() ?? "";
        hideSiteButton?.click();
        const discoveryConfirm = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("隐藏内置站点？") ? dialog : null;
        }, 3_000);
        discoverySiteActionConfirmVisible = Boolean(
          discoveryConfirm?.textContent?.includes("可以在管理站点时从隐藏列表恢复")
        );
        const cancelDiscoveryConfirm = Array.from(
          discoveryConfirm?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
        cancelDiscoveryConfirm?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        discoverySiteActionConfirmCancelled =
          discoverySiteActionConfirmVisible &&
          Boolean(document.querySelector(".discovery-page--home")) &&
          !document.querySelector('[role="dialog"]') &&
          bodyIncludes("学术检索");

        hideSiteButton?.click();
        const discoveryConfirmHide = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("隐藏内置站点？") ? dialog : null;
        }, 3_000);
        const confirmHideButton = Array.from(
          discoveryConfirmHide?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "隐藏站点");
        confirmHideButton?.click();
        await waitFor(
          () =>
            hideSiteButton?.disabled &&
            hideSiteButton.getAttribute("aria-busy") === "true" &&
            hideSiteButton.textContent?.includes("隐藏中"),
          1_000
        );
        discoverySiteHideActionBusyVisible = Boolean(
          hideSiteButton?.disabled &&
            hideSiteButton.getAttribute("aria-busy") === "true" &&
            hideSiteButton.textContent?.includes("隐藏中")
        );
        await waitFor(() => bodyIncludes("已隐藏站点:" + hideSiteName), 3_000);
        const hiddenSiteRows = await window.aura.db.query(
          "SELECT hidden FROM discovery_sites WHERE name = ? LIMIT 1",
          [hideSiteName]
        );
        discoverySiteHideActionHiddenValue = Number(hiddenSiteRows[0]?.hidden ?? 0);
        discoverySiteHideActionConfirmed =
          discoverySiteHideActionBusyVisible &&
          Boolean(hideSiteName) &&
          bodyIncludes("已隐藏站点:" + hideSiteName) &&
          discoverySiteHideActionHiddenValue === 1;

        const removableSiteCard = Array.from(document.querySelectorAll(".discovery-card-wrap")).find(
          (card) => card.textContent?.includes(REMOVABLE_DISCOVERY_SITE_SMOKE.name)
        );
        const removeSiteButton = Array.from(
          removableSiteCard?.querySelectorAll(".discovery-card__manage button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
        const removeSiteFailureRowsBefore = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        removeSiteButton?.click();
        const removeSiteFailureConfirm = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除自定义站点？") ? dialog : null;
        }, 3_000);
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_REMOVE_SITE__ =
          DISCOVERY_SITE_REMOVE_FAILURE_SMOKE.error;
        try {
          const confirmFailedRemoveButton = Array.from(
            removeSiteFailureConfirm?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除站点");
          confirmFailedRemoveButton?.click();
          discoverySiteRemoveFailureBusyVisible = Boolean(
            await waitFor(
              () =>
                removeSiteButton?.disabled &&
                removeSiteButton.getAttribute("aria-busy") === "true" &&
                removeSiteButton.textContent?.includes("删除中")
                  ? removeSiteButton
                  : null,
              1_000
            )
          );
          await waitFor(
            () =>
              bodyIncludes("删除站点失败，站点仍保留，可重新删除") &&
              bodyIncludes(DISCOVERY_SITE_REMOVE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_REMOVE_SITE__;
        }
        const removeSiteFailureRowsAfter = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        const removableSiteCardAfterFailure = Array.from(
          document.querySelectorAll(".discovery-card-wrap")
        ).find((card) => card.textContent?.includes(REMOVABLE_DISCOVERY_SITE_SMOKE.name));
        const removeSiteButtonAfterFailure = Array.from(
          removableSiteCardAfterFailure?.querySelectorAll(".discovery-card__manage button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除");
        discoverySiteRemoveFailureVisible =
          bodyIncludes("删除站点失败，站点仍保留，可重新删除") &&
          bodyIncludes(DISCOVERY_SITE_REMOVE_FAILURE_SMOKE.error);
        discoverySiteRemoveFailurePreserved = Boolean(
          removableSiteCardAfterFailure &&
            removeSiteButtonAfterFailure &&
            !removeSiteButtonAfterFailure.disabled &&
            removeSiteButtonAfterFailure.getAttribute("aria-busy") !== "true" &&
            !document.querySelector('button[aria-label="撤销删除站点"]')
        );
        discoverySiteRemoveFailureDidNotPersist =
          Number(removeSiteFailureRowsBefore[0]?.n ?? 0) ===
          Number(removeSiteFailureRowsAfter[0]?.n ?? -1);
        removeSiteButtonAfterFailure?.click();
        const removeSiteConfirm = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除自定义站点？") ? dialog : null;
        }, 3_000);
        const confirmRemoveButton = Array.from(
          removeSiteConfirm?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除站点");
        confirmRemoveButton?.click();
        await waitFor(
          () =>
            removeSiteButtonAfterFailure?.disabled &&
            removeSiteButtonAfterFailure.getAttribute("aria-busy") === "true" &&
            removeSiteButtonAfterFailure.textContent?.includes("删除中"),
          1_000
        );
        discoverySiteRemoveActionBusyVisible = Boolean(
          removeSiteButtonAfterFailure?.disabled &&
            removeSiteButtonAfterFailure.getAttribute("aria-busy") === "true" &&
            removeSiteButtonAfterFailure.textContent?.includes("删除中")
        );
        await waitFor(
          () => bodyIncludes("已删除站点:" + REMOVABLE_DISCOVERY_SITE_SMOKE.name),
          3_000
        );
        const removableSiteRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        discoverySiteRemoveActionCount = Number(removableSiteRows[0]?.n ?? 0);
        discoverySiteRemoveActionDeleted =
          discoverySiteRemoveActionBusyVisible &&
          bodyIncludes("已删除站点:" + REMOVABLE_DISCOVERY_SITE_SMOKE.name) &&
          discoverySiteRemoveActionCount === 0;

        const removeSiteUndoButton = await waitFor(
          () => document.querySelector('button[aria-label="撤销删除站点"]'),
          1_000
        );
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SITE__ =
          DISCOVERY_SITE_RESTORE_FAILURE_SMOKE.error;
        try {
          removeSiteUndoButton?.click();
          discoverySiteRemoveUndoFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="撤销删除站点"]');
              return button instanceof HTMLButtonElement &&
                button.getAttribute("aria-busy") === "true" &&
                button.disabled &&
                button.textContent?.includes("撤销中") &&
                bodyIncludes("正在撤销删除站点")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("撤销删除站点失败，撤销入口仍保留，可重新撤销") &&
              bodyIncludes(DISCOVERY_SITE_RESTORE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SITE__;
        }
        const removeSiteUndoFailureRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        const removeSiteUndoButtonAfterFailure = await waitFor(() => {
          const button = document.querySelector('button[aria-label="撤销删除站点"]');
          return button instanceof HTMLButtonElement &&
            !button.disabled &&
            button.getAttribute("aria-busy") !== "true"
            ? button
            : null;
        }, 1_000);
        discoverySiteRemoveUndoFailureVisible =
          bodyIncludes("撤销删除站点失败，撤销入口仍保留，可重新撤销") &&
          bodyIncludes(DISCOVERY_SITE_RESTORE_FAILURE_SMOKE.error);
        discoverySiteRemoveUndoFailurePreserved = Boolean(removeSiteUndoButtonAfterFailure);
        discoverySiteRemoveUndoFailureDidNotPersist =
          Number(removeSiteUndoFailureRows[0]?.n ?? -1) === 0;
        removeSiteUndoButtonAfterFailure?.click();
        discoverySiteRemoveUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除站点"]');
            return button instanceof HTMLButtonElement &&
              button.getAttribute("aria-busy") === "true" &&
              button.disabled &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除站点")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("已恢复站点:" + REMOVABLE_DISCOVERY_SITE_SMOKE.name) &&
            Boolean(
              Array.from(document.querySelectorAll(".discovery-card-wrap")).find((card) =>
                card.textContent?.includes(REMOVABLE_DISCOVERY_SITE_SMOKE.name)
              )
            ),
          3_000
        );
        const restoredSiteRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n, COALESCE(MAX(name), '') AS name, COALESCE(MAX(home_url), '') AS home_url, COALESCE(MAX(search_url), '') AS search_url, COALESCE(MAX(hidden), 1) AS hidden FROM discovery_sites WHERE id = ?",
          [REMOVABLE_DISCOVERY_SITE_SMOKE.id]
        );
        discoverySiteRemoveUndoRecovered =
          discoverySiteRemoveUndoBusyVisible &&
          Number(restoredSiteRows[0]?.n ?? 0) === 1 &&
          restoredSiteRows[0]?.name === REMOVABLE_DISCOVERY_SITE_SMOKE.name &&
          restoredSiteRows[0]?.home_url === REMOVABLE_DISCOVERY_SITE_SMOKE.homeUrl &&
          restoredSiteRows[0]?.search_url === REMOVABLE_DISCOVERY_SITE_SMOKE.searchUrl &&
          Number(restoredSiteRows[0]?.hidden ?? 1) === 0;

        const manualHiddenRestoreButton = Array.from(
          document.querySelectorAll(".discovery-hidden-row button")
        ).find((button) => button.textContent?.includes(MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.name));
        manualHiddenRestoreButton?.click();
        await waitFor(
          () =>
            manualHiddenRestoreButton?.disabled &&
            manualHiddenRestoreButton.getAttribute("aria-busy") === "true" &&
            manualHiddenRestoreButton.textContent?.includes("恢复中"),
          1_000
        );
        discoveryManualHiddenSiteRestoreBusyVisible = Boolean(
          manualHiddenRestoreButton?.disabled &&
            manualHiddenRestoreButton.getAttribute("aria-busy") === "true" &&
            manualHiddenRestoreButton.textContent?.includes("恢复中")
        );
        await waitFor(
          () => bodyIncludes("已恢复站点:" + MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.name),
          3_000
        );
        const manualHiddenSiteRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n, COALESCE(MAX(hidden), 0) AS hidden FROM discovery_sites WHERE home_url = ?",
          [MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.homeUrl]
        );
        discoveryManualHiddenSiteRestoredCount = Number(manualHiddenSiteRows[0]?.n ?? 0);
        discoveryManualHiddenSiteRestored =
          discoveryManualHiddenSiteRestoreBusyVisible &&
          bodyIncludes("已恢复站点:" + MANUAL_HIDDEN_DISCOVERY_SITE_SMOKE.name) &&
          discoveryManualHiddenSiteRestoredCount === 1 &&
          Number(manualHiddenSiteRows[0]?.hidden ?? 1) === 0;

        findButton("添加站点")?.click();
        await waitFor(() => document.querySelector(".discovery-add-form"), 2_000);
        const addSiteForm = document.querySelector(".discovery-add-form");
        const siteNameInput = addSiteForm?.querySelector('input[placeholder^="站点名称"]');
        const siteHomeInput = addSiteForm?.querySelector('input[placeholder^="主页 URL"]');
        const siteSearchInput = addSiteForm?.querySelector('input[placeholder^="可选:检索 URL"]');
        if (addSiteForm && siteNameInput && siteHomeInput) {
          setInputValue(siteNameInput, "Smoke Duplicate Site Copy");
          setInputValue(siteHomeInput, "smoke-site.example");
          if (siteSearchInput) setInputValue(siteSearchInput, DISCOVERY_SITE_SMOKE.searchUrl);
          const addSiteSubmit = Array.from(addSiteForm.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加"
          );
          addSiteSubmit?.click();
          await waitFor(
            () =>
              addSiteForm.getAttribute("aria-busy") === "true" &&
              addSiteSubmit?.disabled &&
              addSiteSubmit.getAttribute("aria-busy") === "true" &&
              addSiteSubmit.textContent?.includes("添加中"),
            1_000
          );
          discoveryDuplicateSiteAddBusyVisible = Boolean(
            addSiteForm.getAttribute("aria-busy") === "true" &&
              addSiteSubmit?.disabled &&
              addSiteSubmit.getAttribute("aria-busy") === "true" &&
              addSiteSubmit.textContent?.includes("添加中")
          );
          await waitFor(() => bodyIncludes("站点已存在"), 2_000);
          const duplicateSiteRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM discovery_sites WHERE home_url = ?",
            [DISCOVERY_SITE_SMOKE.homeUrl]
          );
          discoveryDuplicateSiteCount = Number(duplicateSiteRows[0]?.n ?? 0);
          discoveryDuplicateSiteMessageVisible = bodyIncludes("站点已存在");
          discoveryDuplicateSiteBlocked =
            discoveryDuplicateSiteAddBusyVisible &&
            discoveryDuplicateSiteMessageVisible &&
            discoveryDuplicateSiteCount === 1;
        }

        findButton("添加站点")?.click();
        await waitFor(() => document.querySelector(".discovery-add-form"), 2_000);
        const restoreSiteForm = document.querySelector(".discovery-add-form");
        const restoreSiteNameInput = restoreSiteForm?.querySelector('input[placeholder^="站点名称"]');
        const restoreSiteHomeInput = restoreSiteForm?.querySelector('input[placeholder^="主页 URL"]');
        const restoreSiteSearchInput = restoreSiteForm?.querySelector(
          'input[placeholder^="可选:检索 URL"]'
        );
        if (restoreSiteForm && restoreSiteNameInput && restoreSiteHomeInput) {
          setInputValue(restoreSiteNameInput, "Smoke Hidden Duplicate Site Copy");
          setInputValue(restoreSiteHomeInput, "hidden-smoke-site.example");
          if (restoreSiteSearchInput) {
            setInputValue(restoreSiteSearchInput, HIDDEN_DISCOVERY_SITE_SMOKE.searchUrl);
          }
          const restoreSiteSubmit = Array.from(restoreSiteForm.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加"
          );
          restoreSiteSubmit?.click();
          await waitFor(
            () =>
              restoreSiteForm.getAttribute("aria-busy") === "true" &&
              restoreSiteSubmit?.disabled &&
              restoreSiteSubmit.getAttribute("aria-busy") === "true" &&
              restoreSiteSubmit.textContent?.includes("添加中"),
            1_000
          );
          discoveryHiddenSiteAddBusyVisible = Boolean(
            restoreSiteForm.getAttribute("aria-busy") === "true" &&
              restoreSiteSubmit?.disabled &&
              restoreSiteSubmit.getAttribute("aria-busy") === "true" &&
              restoreSiteSubmit.textContent?.includes("添加中")
          );
          await waitFor(() => bodyIncludes("已恢复站点"), 2_000);
          const hiddenDuplicateSiteRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n, COALESCE(MAX(hidden), 0) AS hidden FROM discovery_sites WHERE home_url = ?",
            [HIDDEN_DISCOVERY_SITE_SMOKE.homeUrl]
          );
          discoveryHiddenDuplicateSiteCount = Number(hiddenDuplicateSiteRows[0]?.n ?? 0);
          discoveryHiddenDuplicateSiteMessageVisible = bodyIncludes("已恢复站点");
          discoveryHiddenSiteRestored =
            discoveryHiddenSiteAddBusyVisible &&
            discoveryHiddenDuplicateSiteMessageVisible &&
            discoveryHiddenDuplicateSiteCount === 1 &&
            Number(hiddenDuplicateSiteRows[0]?.hidden ?? 1) === 0;
        }

        findButton("添加站点")?.click();
        await waitFor(() => document.querySelector(".discovery-add-form"), 2_000);
        const credentialSiteForm = document.querySelector(".discovery-add-form");
        const credentialSiteNameInput = credentialSiteForm?.querySelector(
          'input[placeholder^="站点名称"]'
        );
        const credentialSiteHomeInput = credentialSiteForm?.querySelector(
          'input[placeholder^="主页 URL"]'
        );
        const credentialSiteSearchInput = credentialSiteForm?.querySelector(
          'input[placeholder^="可选:检索 URL"]'
        );
        if (credentialSiteForm && credentialSiteNameInput && credentialSiteHomeInput) {
          setInputValue(credentialSiteNameInput, DISCOVERY_CREDENTIAL_SITE_SMOKE.name);
          setInputValue(credentialSiteHomeInput, DISCOVERY_CREDENTIAL_SITE_SMOKE.homeUrl);
          if (credentialSiteSearchInput) {
            setInputValue(credentialSiteSearchInput, DISCOVERY_CREDENTIAL_SITE_SMOKE.searchUrl);
          }
          const credentialSiteSubmit = Array.from(credentialSiteForm.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "添加"
          );
          credentialSiteSubmit?.click();
          await waitFor(
            () => bodyIncludes("添加站点失败:主页 URL 中不能包含用户名或密码"),
            2_000
          );
          const credentialSiteRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM discovery_sites WHERE home_url LIKE ?",
            ["%credential-smoke-site.example%"]
          );
          discoverySiteCredentialsRejected = bodyIncludes(
            "添加站点失败:主页 URL 中不能包含用户名或密码"
          );
          discoverySiteCredentialDidNotPersist = Number(credentialSiteRows[0]?.n ?? 0) === 0;
          const credentialSiteCancel = Array.from(credentialSiteForm.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消"
          );
          credentialSiteCancel?.click();
        }

        const openSourceCard = Array.from(document.querySelectorAll(".discovery-card")).find((card) =>
          card.textContent?.includes("开放源聚合检索")
        );
        openSourceCard?.click();
        await waitFor(
          () =>
            Boolean(document.querySelector(".discovery-command-card")) &&
            bodyIncludes("保存为订阅"),
          2_000
        );
        discoverySavedSearchLastErrorVisible =
          bodyIncludes(SAVED_SEARCH_ERROR_SMOKE.query) &&
          bodyIncludes("检查失败") &&
          bodyIncludes(SAVED_SEARCH_ERROR_SMOKE.error);
        const duplicateSavedSearchInput = document.querySelector(
          'input[aria-label="开放源检索关键词"]'
        );
        if (duplicateSavedSearchInput) {
          setInputValue(duplicateSavedSearchInput, SAVED_SEARCH_SMOKE.query);
        }
        const saveDuplicateSearchButton = () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) =>
              /保存为订阅|保存中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? "")
          );
        await waitFor(() => {
          const button = saveDuplicateSearchButton();
          return Boolean(button && !button.disabled);
        }, 1_000);
        const savedSearchSaveFailureRowsBefore = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM saved_searches WHERE deleted_at IS NULL AND query = ?",
          [SAVED_SEARCH_SAVE_FAILURE_SMOKE.query]
        );
        if (duplicateSavedSearchInput) {
          setInputValue(duplicateSavedSearchInput, SAVED_SEARCH_SAVE_FAILURE_SMOKE.query);
          await waitFor(
            () => duplicateSavedSearchInput.value === SAVED_SEARCH_SAVE_FAILURE_SMOKE.query,
            500
          );
          await wait(50);
        }
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SAVE_SEARCH__ =
          SAVED_SEARCH_SAVE_FAILURE_SMOKE.error;
        try {
          saveDuplicateSearchButton()?.click();
          discoverySavedSearchSaveFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = saveDuplicateSearchButton();
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("保存中")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("保存订阅失败，检索条件仍保留，可重新保存") &&
              bodyIncludes(SAVED_SEARCH_SAVE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SAVE_SEARCH__;
        }
        const savedSearchSaveFailureRowsAfter = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM saved_searches WHERE deleted_at IS NULL AND query = ?",
          [SAVED_SEARCH_SAVE_FAILURE_SMOKE.query]
        );
        const saveFailureButtonAfter = saveDuplicateSearchButton();
        discoverySavedSearchSaveFailureVisible =
          bodyIncludes("保存订阅失败，检索条件仍保留，可重新保存") &&
          bodyIncludes(SAVED_SEARCH_SAVE_FAILURE_SMOKE.error);
        discoverySavedSearchSaveFailurePreserved = Boolean(
          duplicateSavedSearchInput?.value === SAVED_SEARCH_SAVE_FAILURE_SMOKE.query &&
            saveFailureButtonAfter &&
            !saveFailureButtonAfter.disabled
        );
        discoverySavedSearchSaveFailureDidNotPersist =
          Number(savedSearchSaveFailureRowsBefore[0]?.n ?? 0) ===
          Number(savedSearchSaveFailureRowsAfter[0]?.n ?? -1);
        if (duplicateSavedSearchInput) {
          setInputValue(duplicateSavedSearchInput, SAVED_SEARCH_SMOKE.query);
          await waitFor(() => duplicateSavedSearchInput.value === SAVED_SEARCH_SMOKE.query, 500);
          await wait(50);
        }
        await waitFor(() => {
          const button = saveDuplicateSearchButton();
          return Boolean(button && !button.disabled);
        }, 1_000);
        saveDuplicateSearchButton()?.click();
        await waitFor(() => bodyIncludes("检索订阅已存在"), 2_000);
        const duplicateSearchRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM saved_searches WHERE deleted_at IS NULL AND query = ?",
          [SAVED_SEARCH_SMOKE.query]
        );
        discoveryDuplicateSavedSearchCount = Number(duplicateSearchRows[0]?.n ?? 0);
        discoveryDuplicateSavedSearchMessageVisible = bodyIncludes("检索订阅已存在");
        discoveryDuplicateSavedSearchBlocked =
          discoveryDuplicateSavedSearchMessageVisible && discoveryDuplicateSavedSearchCount === 1;

        const savedSearchSub = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
          item.textContent?.includes(SAVED_SEARCH_MANUAL_SMOKE.query)
        );
        const savedSearchCheckButton = Array.from(savedSearchSub?.querySelectorAll("button") ?? []).find(
          (button) => button.getAttribute("title")?.includes("立即检查新结果")
        );
        if (savedSearchCheckButton) {
          window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
            acceptAnyQuery: true,
            delayMs: 450,
            empty: true,
            query: SAVED_SEARCH_MANUAL_SMOKE.query,
            title: "Smoke Manual Saved Search Empty Result"
          };
          try {
            savedSearchCheckButton.click();
            await waitFor(
              () =>
                savedSearchCheckButton.disabled &&
                savedSearchCheckButton.getAttribute("aria-busy") === "true" &&
                savedSearchCheckButton.textContent?.includes("…") &&
                bodyIncludes("正在检查订阅的新结果"),
              1_000
            );
            discoverySavedSearchManualCheckBusyVisible =
              savedSearchCheckButton.disabled &&
              savedSearchCheckButton.getAttribute("aria-busy") === "true" &&
              savedSearchCheckButton.textContent?.includes("…") &&
              bodyIncludes("正在检查订阅的新结果");
            savedSearchCheckButton.click();
            await waitFor(
              () =>
                !savedSearchCheckButton.disabled &&
                savedSearchCheckButton.textContent?.includes("↻") &&
                bodyIncludes("暂无新结果"),
              4_000
            );
            discoverySavedSearchManualCheckCompleted =
              !savedSearchCheckButton.disabled &&
              savedSearchCheckButton.textContent?.includes("↻") &&
              bodyIncludes("暂无新结果");
          } finally {
            delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
          }
        }

        const savedSearchDeleteSub = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
          item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
        );
        const savedSearchDeleteButton = Array.from(savedSearchDeleteSub?.querySelectorAll("button") ?? []).find(
          (button) => button.getAttribute("title")?.includes("删除订阅")
        );
        const savedSearchDeleteFailureRowsBefore = await window.aura.db.query(
          "SELECT (SELECT COUNT(*) FROM saved_searches WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM saved_searches WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count",
          [SAVED_SEARCH_ERROR_SMOKE.id, SAVED_SEARCH_ERROR_SMOKE.id]
        );
        savedSearchDeleteButton?.click();
        const savedSearchDeleteFailureDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除检索订阅？") ? dialog : null;
        }, 3_000);
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_DELETE_SEARCH__ =
          SAVED_SEARCH_DELETE_FAILURE_SMOKE.error;
        try {
          const confirmFailedSavedSearchDeleteButton = Array.from(
            savedSearchDeleteFailureDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除订阅");
          confirmFailedSavedSearchDeleteButton?.click();
          discoverySavedSearchDeleteFailureBusyVisible = Boolean(
            await waitFor(() => {
              const row = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
                item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
              );
              const button = Array.from(row?.querySelectorAll("button") ?? []).find((item) =>
                item.getAttribute("aria-busy") === "true" && item.textContent?.includes("…")
              );
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("…") &&
                row?.textContent?.includes("正在删除订阅")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("删除订阅失败，订阅仍保留，可重新删除") &&
              bodyIncludes(SAVED_SEARCH_DELETE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_DELETE_SEARCH__;
        }
        const savedSearchDeleteFailureRowsAfter = await window.aura.db.query(
          "SELECT (SELECT COUNT(*) FROM saved_searches WHERE id = ? AND deleted_at IS NULL) AS active_count, (SELECT COUNT(*) FROM saved_searches WHERE id = ? AND deleted_at IS NOT NULL) AS deleted_count",
          [SAVED_SEARCH_ERROR_SMOKE.id, SAVED_SEARCH_ERROR_SMOKE.id]
        );
        const savedSearchDeleteSubAfterFailure = Array.from(
          document.querySelectorAll(".discovery-sub")
        ).find((item) => item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query));
        const savedSearchDeleteButtonAfterFailure = Array.from(
          savedSearchDeleteSubAfterFailure?.querySelectorAll("button") ?? []
        ).find((button) => button.getAttribute("title")?.includes("删除订阅"));
        discoverySavedSearchDeleteFailureVisible =
          bodyIncludes("删除订阅失败，订阅仍保留，可重新删除") &&
          bodyIncludes(SAVED_SEARCH_DELETE_FAILURE_SMOKE.error);
        discoverySavedSearchDeleteFailurePreserved = Boolean(
          savedSearchDeleteSubAfterFailure &&
            savedSearchDeleteButtonAfterFailure &&
            !savedSearchDeleteButtonAfterFailure.disabled &&
            savedSearchDeleteButtonAfterFailure.getAttribute("aria-busy") !== "true" &&
            !document.querySelector('button[aria-label="撤销删除检索订阅"]')
        );
        discoverySavedSearchDeleteFailureDidNotPersist =
          Number(savedSearchDeleteFailureRowsBefore[0]?.active_count ?? 0) ===
            Number(savedSearchDeleteFailureRowsAfter[0]?.active_count ?? -1) &&
          Number(savedSearchDeleteFailureRowsBefore[0]?.deleted_count ?? 0) ===
            Number(savedSearchDeleteFailureRowsAfter[0]?.deleted_count ?? -1);
        savedSearchDeleteButtonAfterFailure?.click();
        const savedSearchDeleteDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除检索订阅？") ? dialog : null;
        }, 3_000);
        discoverySavedSearchDeleteConfirmVisible = Boolean(
          savedSearchDeleteDialog?.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
        );
        const confirmSavedSearchDeleteButton = Array.from(
          savedSearchDeleteDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除订阅");
        confirmSavedSearchDeleteButton?.click();
        await waitFor(
          () =>
            savedSearchDeleteButton?.disabled &&
            savedSearchDeleteButton.getAttribute("aria-busy") === "true" &&
            savedSearchDeleteButton.textContent?.includes("…") &&
            savedSearchDeleteSub?.textContent?.includes("正在删除订阅"),
          1_000
        );
        discoverySavedSearchDeleteBusyVisible = Boolean(
          savedSearchDeleteButton?.disabled &&
            savedSearchDeleteButton.getAttribute("aria-busy") === "true" &&
            savedSearchDeleteButton.textContent?.includes("…") &&
            savedSearchDeleteSub?.textContent?.includes("正在删除订阅")
        );
        await waitFor(
          () =>
            bodyIncludes("已删除检索订阅") &&
            !Array.from(document.querySelectorAll(".discovery-sub")).some((item) =>
              item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
            ),
          3_000
        );
        const savedSearchDeleteRows = await window.aura.db.query(
          "SELECT COUNT(*) AS n FROM saved_searches WHERE deleted_at IS NULL AND query = ?",
          [SAVED_SEARCH_ERROR_SMOKE.query]
        );
        discoverySavedSearchDeletePersisted = Number(savedSearchDeleteRows[0]?.n ?? 0) === 0;
        discoverySavedSearchDeleted =
          discoverySavedSearchDeleteConfirmVisible &&
          discoverySavedSearchDeleteBusyVisible &&
          discoverySavedSearchDeletePersisted &&
          bodyIncludes("已删除检索订阅");
        const savedSearchUndoButton = document.querySelector('button[aria-label="撤销删除检索订阅"]');
        discoverySavedSearchDeleteUndoVisible = Boolean(
          discoverySavedSearchDeleted && savedSearchUndoButton
        );
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SEARCH__ =
          SAVED_SEARCH_RESTORE_FAILURE_SMOKE.error;
        try {
          savedSearchUndoButton?.click();
          discoverySavedSearchDeleteUndoFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="撤销删除检索订阅"]');
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("撤销中") &&
                bodyIncludes("正在撤销删除检索订阅")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(
            () =>
              bodyIncludes("撤销删除订阅失败，撤销入口仍保留，可重新撤销") &&
              bodyIncludes(SAVED_SEARCH_RESTORE_FAILURE_SMOKE.error),
            3_000
          );
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SEARCH__;
        }
        const savedSearchUndoFailureRows = await window.aura.db.query(
          "SELECT deleted_at, last_error FROM saved_searches WHERE id = ? LIMIT 1",
          [SAVED_SEARCH_ERROR_SMOKE.id]
        );
        const savedSearchUndoButtonAfterFailure = await waitFor(() => {
          const button = document.querySelector('button[aria-label="撤销删除检索订阅"]');
          return button && !button.disabled && button.getAttribute("aria-busy") !== "true"
            ? button
            : null;
        }, 1_000);
        discoverySavedSearchDeleteUndoFailureVisible =
          bodyIncludes("撤销删除订阅失败，撤销入口仍保留，可重新撤销") &&
          bodyIncludes(SAVED_SEARCH_RESTORE_FAILURE_SMOKE.error);
        discoverySavedSearchDeleteUndoFailurePreserved = Boolean(savedSearchUndoButtonAfterFailure);
        discoverySavedSearchDeleteUndoFailureDidNotPersist =
          savedSearchUndoFailureRows[0]?.deleted_at != null &&
          savedSearchUndoFailureRows[0]?.last_error === SAVED_SEARCH_ERROR_SMOKE.error;
        savedSearchUndoButtonAfterFailure?.click();
        discoverySavedSearchDeleteUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除检索订阅"]');
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除检索订阅")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("已撤销删除检索订阅") &&
            Array.from(document.querySelectorAll(".discovery-sub")).some((item) =>
              item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
            ),
          3_000
        );
        const restoredSavedSearchRows = await window.aura.db.query(
          "SELECT deleted_at, last_error FROM saved_searches WHERE id = ? LIMIT 1",
          [SAVED_SEARCH_ERROR_SMOKE.id]
        );
        discoverySavedSearchDeleteUndoRestored =
          discoverySavedSearchDeleteUndoVisible &&
          discoverySavedSearchDeleteUndoBusyVisible &&
          bodyIncludes("已撤销删除检索订阅") &&
          restoredSavedSearchRows[0]?.deleted_at == null &&
          restoredSavedSearchRows[0]?.last_error === SAVED_SEARCH_ERROR_SMOKE.error;

        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          acceptAnyQuery: true,
          query: DISCOVERY_SEARCH_RETRY_SMOKE.query,
          title: DISCOVERY_SEARCH_RETRY_SMOKE.title,
          doi: DISCOVERY_SEARCH_RETRY_SMOKE.doi
        };
        window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SEARCH__ =
          DISCOVERY_SEARCH_RETRY_SMOKE.error;
        try {
          const failedSearch =
            window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__?.(
              DISCOVERY_SEARCH_RETRY_SMOKE.query,
              ["crossref"]
            ) ?? Promise.resolve(false);
          await failedSearch;
          await waitFor(
            () =>
              bodyIncludes("检索没有完成") &&
              bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.error) &&
              Boolean(findExactButton("重试检索")),
            4_000
          );
          const searchFailureVisible =
            bodyIncludes("检索没有完成") &&
            bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.error) &&
            Boolean(findExactButton("重试检索"));
          findExactButton("重试检索")?.click();
          await waitFor(
            () =>
              bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.title) &&
              !bodyIncludes("检索没有完成") &&
              !bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.error),
            4_000
          );
          const searchRecovered =
            bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.title) &&
            !bodyIncludes("检索没有完成") &&
            !bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.error);
          discoverySearchRetryRecoveryVisible =
            searchFailureVisible && searchRecovered;
          discoverySearchRetryRecoveryDetail = [
            "failure=" + searchFailureVisible,
            "status=" + bodyIncludes("失败"),
            "recovered=" + searchRecovered,
            "title=" + bodyIncludes(DISCOVERY_SEARCH_RETRY_SMOKE.title),
            "results=" + text(".discovery-results").slice(0, 220)
          ].join("; ");
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SEARCH__;
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        }

        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          ...DISCOVERY_TRUST_SMOKE,
          acceptAnyQuery: true
        };
        try {
          const discoverySearchButton = () =>
            Array.from(document.querySelectorAll(".discovery-command button")).find((button) =>
              /检索开放源|检索中/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? "")
            );
          const discoverySearchPromise =
            window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__?.(
              DISCOVERY_TRUST_SMOKE.query
            ) ?? Promise.resolve(false);
          await waitFor(
            () => {
              const button = discoverySearchButton();
              const progress = document.querySelector(".discovery-search-progress");
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("检索中") &&
                progress?.getAttribute("role") === "status" &&
                progress.getAttribute("aria-live") === "polite" &&
                progress.getAttribute("aria-busy") === "true"
                ? button
                : null;
            },
            1_000
          );
          discoverySearchBusyVisible = Boolean(
            discoverySearchButton()?.disabled &&
              discoverySearchButton()?.textContent?.includes("检索中")
          );
          discoverySearchAriaBusyVisible =
            discoverySearchBusyVisible &&
            discoverySearchButton()?.getAttribute("aria-busy") === "true";
          const discoverySearchProgress = document.querySelector(".discovery-search-progress");
          discoverySearchProgressLiveVisible =
            discoverySearchAriaBusyVisible &&
            discoverySearchProgress?.getAttribute("role") === "status" &&
            discoverySearchProgress.getAttribute("aria-live") === "polite" &&
            discoverySearchProgress.getAttribute("aria-busy") === "true";
          await discoverySearchPromise;
          await waitFor(
            () =>
              bodyIncludes(DISCOVERY_TRUST_SMOKE.title) &&
              bodyIncludes("可信度强") &&
              bodyIncludes("开放 PDF 可用"),
            4_000
          );
          discoveryTrustSignalsVisible =
            bodyIncludes(DISCOVERY_TRUST_SMOKE.title) &&
            bodyIncludes("可信度强") &&
            bodyIncludes("稳定标识") &&
            bodyIncludes("3 个数据源佐证") &&
            bodyIncludes("DOI " + DISCOVERY_TRUST_SMOKE.doi);
          discoveryFulltextCueVisible =
            bodyIncludes("开放 PDF 可用") &&
            bodyIncludes("入库时会尝试获取开放 PDF") &&
            bodyIncludes("全文状态");
          discoveryTrustSignalsDetail = [
            "title=" + bodyIncludes(DISCOVERY_TRUST_SMOKE.title),
            "strong=" + bodyIncludes("可信度强"),
            "stable=" + bodyIncludes("稳定标识"),
            "sources=" + bodyIncludes("3 个数据源佐证"),
            "doi=" + bodyIncludes("DOI " + DISCOVERY_TRUST_SMOKE.doi),
            "fulltext=" + bodyIncludes("开放 PDF 可用"),
            "fulltextDetail=" + bodyIncludes("入库时会尝试获取开放 PDF"),
            "searchBusy=" + discoverySearchBusyVisible,
            "searchAria=" + discoverySearchAriaBusyVisible,
            "progressLive=" + discoverySearchProgressLiveVisible,
            "results=" + text(".discovery-results").slice(0, 220),
            "detail=" + text(".discovery-detail-card").slice(0, 220)
          ].join("; ");

          const detailImportButton = () =>
            Array.from(document.querySelectorAll(".discovery-detail-actions button")).find(
              (button) => button.textContent?.includes("加入文献库")
            );
          detailImportButton()?.click();
          await waitFor(
            () =>
              bodyIncludes("正在加入文献库并获取开放 PDF") &&
              bodyIncludes("导入并抓取 PDF..."),
            1_000
          );
          discoveryImportBusyVisible =
            bodyIncludes("正在加入文献库并获取开放 PDF") &&
            bodyIncludes("导入并抓取 PDF...");
          await waitFor(
            () =>
              bodyIncludes("开放 PDF 未能自动获取") &&
              bodyIncludes("待补全文") &&
              bodyIncludes("去找全文"),
            4_000
          );
          discoveryImportFulltextFallbackVisible =
            bodyIncludes("开放 PDF 未能自动获取") &&
            bodyIncludes("待补全文") &&
            bodyIncludes("去找全文") &&
            bodyIncludes("开放 PDF 未能自动挂载");
          discoveryTrustSignalsDetail +=
            "; importBusy=" +
            discoveryImportBusyVisible +
            "; importFallback=" +
            discoveryImportFulltextFallbackVisible +
            "; afterImportDetail=" +
            text(".discovery-detail-card").slice(0, 220);
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        }

        window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
          acceptAnyQuery: true,
          query: DISCOVERY_LOAD_MORE_SMOKE.query,
          title: DISCOVERY_LOAD_MORE_SMOKE.firstTitle,
          doi: DISCOVERY_LOAD_MORE_SMOKE.firstDoi,
          hasMore: true,
          page: 1
        };
        try {
          await (window.__AURASCHOLAR_SMOKE_RUN_DISCOVERY_SEARCH__?.(
            DISCOVERY_LOAD_MORE_SMOKE.query,
            ["crossref"]
          ) ?? Promise.resolve(false));
          await waitFor(
            () =>
              bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.firstTitle) && bodyIncludes("加载更多"),
            4_000
          );
          window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__ = {
            acceptAnyQuery: true,
            query: DISCOVERY_LOAD_MORE_SMOKE.query,
            title: DISCOVERY_LOAD_MORE_SMOKE.recoveredTitle,
            doi: DISCOVERY_LOAD_MORE_SMOKE.recoveredDoi,
            hasMore: false,
            page: 2
          };
          window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_LOAD_MORE__ =
            DISCOVERY_LOAD_MORE_SMOKE.error;
          const loadMoreButton = () =>
            Array.from(document.querySelectorAll(".discovery-load-more > button")).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === "加载更多"
            );
          loadMoreButton()?.click();
          await waitFor(
            () =>
              bodyIncludes("加载更多没有完成") &&
              bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.error) &&
              Boolean(document.querySelector('button[aria-label="重试加载更多结果"]')),
            4_000
          );
          const retryButtonReady = () =>
            Array.from(
              document.querySelectorAll('button[aria-label="重试加载更多结果"]')
            ).find(
              (button) =>
                !button.disabled &&
                button.textContent?.replace(/\s+/g, " ").trim() === "重试加载更多"
            );
          await waitFor(() => retryButtonReady(), 4_000);
          const retryVisible =
            bodyIncludes("加载更多没有完成") &&
            bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.error) &&
            Boolean(retryButtonReady());
          const retryButton = retryButtonReady();
          retryButton?.click();
          await waitFor(
            () =>
              bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.recoveredTitle) &&
              !bodyIncludes("加载更多没有完成") &&
              !document.querySelector('button[aria-label="重试加载更多结果"]'),
            4_000
          );
          const recovered =
            bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.recoveredTitle) &&
            !bodyIncludes("加载更多没有完成") &&
            !document.querySelector('button[aria-label="重试加载更多结果"]');
          discoveryLoadMoreRetryRecoveryVisible = retryVisible && recovered;
          discoveryLoadMoreRetryRecoveryDetail = [
            "retryVisible=" + retryVisible,
            "error=" + bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.error),
            "recovered=" + recovered,
            "first=" + bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.firstTitle),
            "next=" + bodyIncludes(DISCOVERY_LOAD_MORE_SMOKE.recoveredTitle),
            "results=" + text(".discovery-results").slice(0, 220)
          ].join("; ");
        } finally {
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_LOAD_MORE__;
          delete window.__AURASCHOLAR_SMOKE_DISCOVERY_FIXTURE__;
        }

        window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_READ__ =
          "Smoke settings AI config read failure";
        location.hash = "#/settings?section=ai";
        await waitFor(
          () =>
            location.hash.includes("/settings?section=ai") &&
            Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted')) &&
            bodyIncludes("读取 AI 配置失败") &&
            bodyIncludes("Smoke settings AI config read failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取 AI 配置"]')),
          4_000
        );
        settingsAiLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取 AI 配置"]')?.click();
        await waitFor(
          () =>
            !bodyIncludes("读取 AI 配置失败") &&
            !bodyIncludes("Smoke settings AI config read failure") &&
            !bodyIncludes("正在读取 AI 配置") &&
            Boolean(document.querySelector(".settings-card--ai input:not(:disabled)")),
          4_000
        );
        settingsAiLoadRetryAttempts += 1;
        settingsAiLoadRetryRecoveryVisible =
          settingsAiLoadRetryAttempts === 2 &&
          !bodyIncludes("读取 AI 配置失败") &&
          !bodyIncludes("Smoke settings AI config read failure") &&
          Boolean(document.querySelector(".settings-card--ai input:not(:disabled)"));
        settingsAiLoadRetryRecoveryDetail =
          "attempts=" +
          settingsAiLoadRetryAttempts +
          "; inputEnabled=" +
          Boolean(document.querySelector(".settings-card--ai input:not(:disabled)")) +
          "; error=" +
          bodyIncludes("读取 AI 配置失败");
        delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_READ__;

        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && document.querySelector(".library-page"),
          4_000
        );
        const inlineMigrationKey = "smoke-inline-migration-ai-key";
        const inlineMigrationSettings = {
          apiKey: inlineMigrationKey,
          baseUrl: "https://api.inline-migration.example/v1",
          kind: "openai-compatible",
          model: "smoke-inline-migration-model"
        };
        localStorage.setItem("ai-settings", JSON.stringify(inlineMigrationSettings));
        await window.aura?.secrets?.delete?.("secret:ai:apiKey");
        window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__ =
          "Smoke inline AI migration failure";
        location.hash = "#/settings?section=ai";
        const inlineMigrationFailureInput = await waitFor(() => {
          const currentApiKeyInput = Array.from(
            document.querySelectorAll(".settings-card--ai input")
          )[2];
          return location.hash.includes("/settings?section=ai") &&
            !bodyIncludes("读取 AI 配置失败") &&
            currentApiKeyInput?.value === inlineMigrationKey &&
            !currentApiKeyInput.disabled
            ? currentApiKeyInput
            : null;
        }, 4_000);
        const inlineSettingsAfterFailure = localStorage.getItem("ai-settings") ?? "";
        const inlineSecretAfterFailure = await window.aura?.secrets?.get?.("secret:ai:apiKey");
        settingsInlineSecretMigrationVisible = Boolean(inlineMigrationFailureInput);
        settingsInlineSecretMigrationFailurePreserved =
          settingsInlineSecretMigrationVisible &&
          inlineSettingsAfterFailure.includes(inlineMigrationKey) &&
          !inlineSecretAfterFailure;
        delete window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && document.querySelector(".library-page"),
          4_000
        );
        location.hash = "#/settings?section=ai";
        const migratedInlineInput = await waitFor(() => {
          const currentApiKeyInput = Array.from(
            document.querySelectorAll(".settings-card--ai input")
          )[2];
          return location.hash.includes("/settings?section=ai") &&
            !bodyIncludes("读取 AI 配置失败") &&
            currentApiKeyInput?.value === inlineMigrationKey
            ? currentApiKeyInput
            : null;
        }, 4_000);
        const inlineSettingsAfterRetry = localStorage.getItem("ai-settings") ?? "";
        const inlineSecretAfterRetry = await window.aura?.secrets?.get?.("secret:ai:apiKey");
        settingsInlineSecretMigrationRetrySanitized =
          Boolean(migratedInlineInput) &&
          inlineSecretAfterRetry === inlineMigrationKey &&
          !inlineSettingsAfterRetry.includes(inlineMigrationKey) &&
          !inlineSettingsAfterRetry.includes("apiKey");

        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && document.querySelector(".library-page"),
          4_000
        );
        window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_READ__ =
          "Smoke settings translate config read failure";
        location.hash = "#/settings?section=translate";
        await waitFor(
          () =>
            location.hash.includes("/settings?section=translate") &&
            Boolean(
              document.querySelector('[data-settings-section="translate"].settings-card--targeted')
            ) &&
            bodyIncludes("读取翻译配置失败") &&
            bodyIncludes("Smoke settings translate config read failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取翻译配置"]')),
          4_000
        );
        settingsTranslateLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取翻译配置"]')?.click();
        await waitFor(
          () =>
            !bodyIncludes("读取翻译配置失败") &&
            !bodyIncludes("Smoke settings translate config read failure") &&
            !bodyIncludes("正在读取翻译配置") &&
            Boolean(
              document.querySelector('[data-settings-section="translate"] select:not(:disabled)')
            ),
          4_000
        );
        settingsTranslateLoadRetryAttempts += 1;
        settingsTranslateLoadRetryRecoveryVisible =
          settingsTranslateLoadRetryAttempts === 2 &&
          !bodyIncludes("读取翻译配置失败") &&
          !bodyIncludes("Smoke settings translate config read failure") &&
          Boolean(
            document.querySelector('[data-settings-section="translate"] select:not(:disabled)')
          );
        settingsTranslateLoadRetryRecoveryDetail =
          "attempts=" +
          settingsTranslateLoadRetryAttempts +
          "; selectEnabled=" +
          Boolean(
            document.querySelector('[data-settings-section="translate"] select:not(:disabled)')
          ) +
          "; error=" +
          bodyIncludes("读取翻译配置失败");
        delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_READ__;

        location.hash = "#/settings?section=translate";
        await waitFor(
          () =>
            location.hash.includes("/settings?section=translate") &&
            Boolean(
              document.querySelector('[data-settings-section="translate"].settings-card--targeted')
            ) &&
            bodyIncludes("阅读翻译"),
          4_000
        );
        settingsTargetTranslateSectionVisible =
          location.hash.includes("/settings?section=translate") &&
          Boolean(
            document.querySelector('[data-settings-section="translate"].settings-card--targeted')
          );
        const translateCardForFailure = document.querySelector('[data-settings-section="translate"]');
        const deeplEngineButton = Array.from(
          translateCardForFailure?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "DeepL");
        deeplEngineButton?.click();
        const deeplKeyInput = await waitFor(
          () => {
            const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
            if (!currentTranslateCard?.textContent?.includes("DeepL API Key")) return null;
            return (
              Array.from(currentTranslateCard.querySelectorAll("input")).find(
                (input) => input.getAttribute("type") === "password"
              ) ?? null
            );
          },
          1_000
        );
        if (deeplKeyInput) {
          const translateSettingsBeforeValidation = localStorage.getItem("translate-settings");
          const deeplSecretBeforeValidation =
            await window.aura?.secrets?.get?.("secret:translate:deepl");
          const baiduSecretBeforeValidation =
            await window.aura?.secrets?.get?.("secret:translate:baidu");
          setInputValue(deeplKeyInput, "");
          await waitFor(() => deeplKeyInput.value === "", 1_000);
          const validateDeepLButton = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置");
          validateDeepLButton?.click();
          const deepLValidationVisible = Boolean(
            await waitFor(() => {
              const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
              const saveButton = Array.from(currentTranslateCard?.querySelectorAll("button") ?? []).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置"
              );
              return bodyIncludes("请填写 DeepL API Key") && saveButton && !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          const baiduEngineButton = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "百度翻译");
          baiduEngineButton?.click();
          const baiduInputs = await waitFor(() => {
            const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
            if (!currentTranslateCard?.textContent?.includes("百度翻译 APPID")) return null;
            const inputs = Array.from(currentTranslateCard.querySelectorAll("input"));
            return inputs.length >= 2 ? inputs : null;
          }, 1_000);
          if (baiduInputs) {
            setInputValue(baiduInputs[0], "smoke-baidu-appid-only");
            setInputValue(baiduInputs[1], "");
            await waitFor(
              () => baiduInputs[0].value === "smoke-baidu-appid-only" && baiduInputs[1].value === "",
              1_000
            );
            const validateBaiduButton = Array.from(
              document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
                []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置");
            validateBaiduButton?.click();
          }
          const baiduValidationVisible = Boolean(
            await waitFor(() => {
              const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
              const saveButton = Array.from(currentTranslateCard?.querySelectorAll("button") ?? []).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置"
              );
              return bodyIncludes("请填写百度翻译 APPID 和密钥") &&
                saveButton &&
                !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          const translateSettingsAfterValidation = localStorage.getItem("translate-settings");
          const deeplSecretAfterValidation =
            await window.aura?.secrets?.get?.("secret:translate:deepl");
          const baiduSecretAfterValidation =
            await window.aura?.secrets?.get?.("secret:translate:baidu");
          settingsTranslateProviderValidationVisible =
            deepLValidationVisible && baiduValidationVisible;
          settingsTranslateProviderValidationDidNotPersist =
            translateSettingsAfterValidation === translateSettingsBeforeValidation &&
            deeplSecretAfterValidation === deeplSecretBeforeValidation &&
            baiduSecretAfterValidation === baiduSecretBeforeValidation;
          const deeplEngineButtonAgain = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "DeepL");
          deeplEngineButtonAgain?.click();
          const currentDeeplKeyInput = await waitFor(
            () => {
              const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
              if (!currentTranslateCard?.textContent?.includes("DeepL API Key")) return null;
              return (
                Array.from(currentTranslateCard.querySelectorAll("input")).find(
                  (input) => input.getAttribute("type") === "password"
                ) ?? null
              );
            },
            1_000
          );
          const translateSettingsBeforeFailure = localStorage.getItem("translate-settings");
          const translateSecretBeforeFailure =
            await window.aura?.secrets?.get?.("secret:translate:deepl");
          const translateFailureDraft = "smoke-translate-save-failure-key";
          setInputValue(currentDeeplKeyInput, translateFailureDraft);
          await waitFor(() => currentDeeplKeyInput?.value === translateFailureDraft, 1_000);
          window.__AURASCHOLAR_SMOKE_FAIL_SECRET_WRITE_AFTER__ = 1;
          window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__ =
            "Smoke settings translate save failure";
          const failSaveTranslateButton = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置");
          failSaveTranslateButton?.click();
          const preservedTranslateInput = await waitFor(() => {
            const currentTranslateCard = document.querySelector('[data-settings-section="translate"]');
            const currentKeyInput = Array.from(currentTranslateCard?.querySelectorAll("input") ?? []).find(
              (input) => input.getAttribute("type") === "password"
            );
            const saveButton = Array.from(currentTranslateCard?.querySelectorAll("button") ?? []).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "保存翻译配置" &&
                !button.disabled
            );
            return bodyIncludes("保存失败，修改仍保留，可重新保存") &&
              bodyIncludes("Smoke settings translate save failure") &&
              currentKeyInput?.value === translateFailureDraft &&
              Boolean(saveButton)
              ? currentKeyInput
              : null;
          }, 3_000);
          delete window.__AURASCHOLAR_SMOKE_FAIL_SECRET_WRITE_AFTER__;
          delete window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
          const translateSettingsAfterFailure = localStorage.getItem("translate-settings");
          const translateSecretAfterFailure =
            await window.aura?.secrets?.get?.("secret:translate:deepl");
          settingsTranslateSaveFailureVisible =
            bodyIncludes("保存失败，修改仍保留，可重新保存") &&
            bodyIncludes("Smoke settings translate save failure");
          settingsTranslateSaveFailurePreserved =
            Boolean(preservedTranslateInput) &&
            preservedTranslateInput.value === translateFailureDraft;
          settingsTranslateSaveFailureDidNotPersist =
            translateSettingsAfterFailure === translateSettingsBeforeFailure &&
            translateSecretAfterFailure === translateSecretBeforeFailure;
          const resetTranslateButton = Array.from(
            document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "撤销修改");
          resetTranslateButton?.click();
          await waitFor(
            () =>
              !bodyIncludes("Smoke settings translate save failure") &&
              !Array.from(
                document.querySelector('[data-settings-section="translate"]')?.querySelectorAll("input") ??
                  []
              ).some((input) => input.value === translateFailureDraft),
            1_000
          );
        }

        location.hash = "#/library";
        await waitFor(
          () => location.hash.includes("/library") && bodyIncludes("文献库"),
          4_000
        );
        window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_READ__ =
          "Smoke settings sync config read failure";
        location.hash = "#/settings?section=sync";
        await waitFor(
          () =>
            location.hash.includes("/settings?section=sync") &&
            Boolean(document.querySelector('[data-settings-section="sync"].settings-card--targeted')) &&
            bodyIncludes("读取同步配置失败") &&
            bodyIncludes("Smoke settings sync config read failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取同步配置"]')),
          4_000
        );
        settingsSyncLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取同步配置"]')?.click();
        await waitFor(
          () =>
            !bodyIncludes("读取同步配置失败") &&
            !bodyIncludes("Smoke settings sync config read failure") &&
            !bodyIncludes("正在读取同步配置") &&
            Boolean(document.querySelector('[data-settings-section="sync"] input:not(:disabled)')),
          4_000
        );
        settingsSyncLoadRetryAttempts += 1;
        settingsSyncLoadRetryRecoveryVisible =
          settingsSyncLoadRetryAttempts === 2 &&
          !bodyIncludes("读取同步配置失败") &&
          !bodyIncludes("Smoke settings sync config read failure") &&
          Boolean(document.querySelector('[data-settings-section="sync"] input:not(:disabled)'));
        settingsSyncLoadRetryRecoveryDetail =
          "attempts=" +
          settingsSyncLoadRetryAttempts +
          "; inputEnabled=" +
          Boolean(document.querySelector('[data-settings-section="sync"] input:not(:disabled)')) +
          "; error=" +
          bodyIncludes("读取同步配置失败");
        delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_READ__;
        const syncCardForFailure = document.querySelector('[data-settings-section="sync"]');
        const syncFailureInputs = Array.from(syncCardForFailure?.querySelectorAll("input") ?? []);
        const syncUrlInput = syncFailureInputs[0];
        const syncUserInput = syncFailureInputs[1];
        const syncPassInput = syncFailureInputs[2];
        if (syncUrlInput && syncUserInput && syncPassInput) {
          const syncSettingsBeforeInvalidUrl = localStorage.getItem("sync-settings");
          const syncSecretBeforeInvalidUrl = await window.aura?.secrets?.get?.(
            "secret:sync:password"
          );
          const syncInvalidUrl = "dav.example.invalid/aurascholar";
          const syncCredentialUrl = "https://user:pass@dav.example.invalid/aurascholar";
          setInputValue(syncUrlInput, syncInvalidUrl);
          setInputValue(syncUserInput, "smoke-sync-invalid-user");
          setInputValue(syncPassInput, "smoke-sync-invalid-pass");
          await waitFor(
            () =>
              syncUrlInput.value === syncInvalidUrl &&
              syncUserInput.value === "smoke-sync-invalid-user" &&
              syncPassInput.value === "smoke-sync-invalid-pass",
            1_000
          );
          const invalidSyncUrlSaveButton = Array.from(
            syncCardForFailure?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置");
          invalidSyncUrlSaveButton?.click();
          const invalidUrlMessageVisible = Boolean(
            await waitFor(() => {
              const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
              const saveButton = Array.from(currentSyncCard?.querySelectorAll("button") ?? []).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置"
              );
              return bodyIncludes("WebDAV 地址格式不正确") && saveButton && !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          setInputValue(syncUrlInput, syncCredentialUrl);
          await waitFor(() => syncUrlInput.value === syncCredentialUrl, 1_000);
          const credentialSyncUrlSaveButton = Array.from(
            document.querySelector('[data-settings-section="sync"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置");
          credentialSyncUrlSaveButton?.click();
          const credentialUrlMessageVisible = Boolean(
            await waitFor(() => {
              const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
              const saveButton = Array.from(currentSyncCard?.querySelectorAll("button") ?? []).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置"
              );
              return bodyIncludes("WebDAV 地址不要包含用户名或密码") &&
                saveButton &&
                !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          const syncSettingsAfterInvalidUrl = localStorage.getItem("sync-settings");
          const syncSecretAfterInvalidUrl = await window.aura?.secrets?.get?.(
            "secret:sync:password"
          );
          settingsSyncUrlInvalidVisible = invalidUrlMessageVisible;
          settingsSyncUrlCredentialsRejected = credentialUrlMessageVisible;
          settingsSyncUrlInvalidDidNotPersist =
            syncSettingsAfterInvalidUrl === syncSettingsBeforeInvalidUrl &&
            syncSecretAfterInvalidUrl === syncSecretBeforeInvalidUrl;

          const syncSettingsBeforeFailure = localStorage.getItem("sync-settings");
          const syncSecretBeforeFailure = await window.aura?.secrets?.get?.("secret:sync:password");
          const syncFailureUrl = "https://dav.example.invalid/aurascholar";
          const syncFailureUser = "smoke-sync-save-failure-user";
          const syncFailurePass = "smoke-sync-save-failure-pass";
          setInputValue(syncUrlInput, syncFailureUrl);
          setInputValue(syncUserInput, syncFailureUser);
          setInputValue(syncPassInput, syncFailurePass);
          await waitFor(
            () =>
              syncUrlInput.value === syncFailureUrl &&
              syncUserInput.value === syncFailureUser &&
              syncPassInput.value === syncFailurePass,
            1_000
          );
          window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__ =
            "Smoke settings sync save failure";
          const failSaveSyncButton = Array.from(
            syncCardForFailure?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置");
          failSaveSyncButton?.click();
          const preservedSyncPassInput = await waitFor(() => {
            const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
            const inputs = Array.from(currentSyncCard?.querySelectorAll("input") ?? []);
            const saveButton = Array.from(currentSyncCard?.querySelectorAll("button") ?? []).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "保存同步配置" &&
                !button.disabled
            );
            return bodyIncludes("保存失败，修改仍保留，可重新保存") &&
              bodyIncludes("Smoke settings sync save failure") &&
              inputs[0]?.value === syncFailureUrl &&
              inputs[1]?.value === syncFailureUser &&
              inputs[2]?.value === syncFailurePass &&
              Boolean(saveButton)
              ? inputs[2]
              : null;
          }, 3_000);
          delete window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
          const syncSettingsAfterFailure = localStorage.getItem("sync-settings");
          const syncSecretAfterFailure = await window.aura?.secrets?.get?.("secret:sync:password");
          settingsSyncSaveFailureVisible =
            bodyIncludes("保存失败，修改仍保留，可重新保存") &&
            bodyIncludes("Smoke settings sync save failure");
          settingsSyncSaveFailurePreserved =
            Boolean(preservedSyncPassInput) && preservedSyncPassInput.value === syncFailurePass;
          settingsSyncSaveFailureDidNotPersist =
            syncSettingsAfterFailure === syncSettingsBeforeFailure &&
            syncSecretAfterFailure === syncSecretBeforeFailure;
          const resetSyncButton = Array.from(
            document.querySelector('[data-settings-section="sync"]')?.querySelectorAll("button") ??
              []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "撤销修改");
          resetSyncButton?.click();
          await waitFor(
            () =>
              !bodyIncludes("Smoke settings sync save failure") &&
              !Array.from(
                document.querySelector('[data-settings-section="sync"]')?.querySelectorAll("input") ??
                  []
              ).some((input) =>
                [syncFailureUrl, syncFailureUser, syncFailurePass].includes(input.value)
              ),
            1_000
          );

          const syncRunUrlInputValue = "https://dav.example.invalid/smoke-run///";
          const syncRunUrl = "https://dav.example.invalid/smoke-run";
          const syncRunUser = "smoke-sync-run-user";
          const syncRunPass = "smoke-sync-run-pass";
          const syncCardForRun = document.querySelector('[data-settings-section="sync"]');
          const syncRunInputs = Array.from(syncCardForRun?.querySelectorAll("input") ?? []);
          const syncRunUrlInput = syncRunInputs[0];
          const syncRunUserInput = syncRunInputs[1];
          const syncRunPassInput = syncRunInputs[2];
          if (syncRunUrlInput && syncRunUserInput && syncRunPassInput) {
            setInputValue(syncRunUrlInput, syncRunUrlInputValue);
            setInputValue(syncRunUserInput, syncRunUser);
            setInputValue(syncRunPassInput, syncRunPass);
            await waitFor(
              () =>
                syncRunUrlInput.value === syncRunUrlInputValue &&
                syncRunUserInput.value === syncRunUser &&
                syncRunPassInput.value === syncRunPass,
              1_000
            );
            window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__ =
              'Unsupported sync column "works.future_column" in journal/dev-a/000000000001-000000000001.jsonl; update AuraScholar before syncing this library';
            const syncRunButton = Array.from(
              syncCardForRun?.querySelectorAll("button") ?? []
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "立即同步");
            syncRunButton?.click();
            settingsSyncRunFailureBusyVisible = Boolean(
              await waitFor(() => {
                const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
                const currentRunButton = Array.from(
                  currentSyncCard?.querySelectorAll("button") ?? []
                ).find((button) => {
                  const label = button.textContent?.replace(/\s+/g, " ").trim();
                  return label === "同步中..." || label === "立即同步";
                });
                return currentRunButton?.disabled &&
                  currentRunButton.getAttribute("aria-busy") === "true" &&
                  currentRunButton.textContent?.includes("同步中") &&
                  bodyIncludes("同步中...")
                  ? currentRunButton
                  : null;
              }, 1_000)
            );
            const syncRunRetryButton = await waitFor(() => {
              const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
              const buttons = Array.from(currentSyncCard?.querySelectorAll("button") ?? []);
              return bodyIncludes("同步失败，配置已保留，可重新同步") &&
                bodyIncludes("远端同步目录包含当前版本还不支持的数据结构") &&
                bodyIncludes("确认所有设备使用同一版本")
                ? buttons.find(
                    (button) =>
                      button.textContent?.replace(/\s+/g, " ").trim() === "立即同步" &&
                      !button.disabled
                  )
                : null;
            }, 3_000);
            delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__;
            const syncRunSettingsRows = localStorage.getItem("sync-settings");
            const syncRunSecret = await window.aura?.secrets?.get?.("secret:sync:password");
            let syncRunStoredUrl = "";
            let syncRunStoredUser = "";
            try {
              const parsedSyncRunSettings = JSON.parse(syncRunSettingsRows ?? "null");
              syncRunStoredUrl =
                typeof parsedSyncRunSettings?.baseUrl === "string"
                  ? parsedSyncRunSettings.baseUrl
                  : "";
              syncRunStoredUser =
                typeof parsedSyncRunSettings?.username === "string"
                  ? parsedSyncRunSettings.username
                  : "";
            } catch {
              syncRunStoredUrl = "";
              syncRunStoredUser = "";
            }
            settingsSyncRunFailureVisible =
              bodyIncludes("同步失败，配置已保留，可重新同步") &&
              bodyIncludes("远端同步目录包含当前版本还不支持的数据结构");
            settingsSyncRunActionableFailureVisible =
              settingsSyncRunFailureVisible &&
              bodyIncludes("请先升级 AuraScholar") &&
              bodyIncludes("确认所有设备使用同一版本") &&
              !bodyIncludes("Unsupported sync column");
            settingsSyncRunFailureRetryVisible = Boolean(syncRunRetryButton);
            settingsSyncRunFailureConfigPreserved =
              syncRunStoredUrl === syncRunUrl &&
              syncRunStoredUser === syncRunUser &&
              syncRunSecret === syncRunPass &&
              syncRunUrlInput.value === syncRunUrl &&
              syncRunUserInput.value === syncRunUser &&
              syncRunPassInput.value === syncRunPass;
            window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__ =
              "WebDAV MOVE journal/dev-a/0001-0002.jsonl failed: 507";
            syncRunRetryButton?.click();
            const syncRunQuotaRetryButton = await waitFor(() => {
              const currentSyncCard = document.querySelector('[data-settings-section="sync"]');
              const buttons = Array.from(currentSyncCard?.querySelectorAll("button") ?? []);
              return bodyIncludes("同步失败，配置已保留，可重新同步") &&
                bodyIncludes("WebDAV 服务返回 507") &&
                bodyIncludes("远端空间不足") &&
                bodyIncludes("清理云盘空间")
                ? buttons.find(
                    (button) =>
                      button.textContent?.replace(/\s+/g, " ").trim() === "立即同步" &&
                      !button.disabled
                  )
                : null;
            }, 3_000);
            delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__;
            settingsSyncRunQuotaGuidanceVisible =
              Boolean(syncRunQuotaRetryButton) &&
              !bodyIncludes("认证失败或没有目录权限") &&
              !bodyIncludes("Unsupported sync column");
            settingsSyncUrlNormalized =
              syncRunStoredUrl === syncRunUrl && syncRunUrlInput.value === syncRunUrl;
          }
        }

        location.hash = "#/settings";
        await waitFor(
          () =>
            location.hash.includes("/settings") &&
            bodyIncludes("设置") &&
            bodyIncludes("阅读翻译"),
          4_000
        );
        await waitFor(
          () =>
            !bodyIncludes("正在读取 AI 配置") &&
            !bodyIncludes("正在读取翻译配置") &&
            !bodyIncludes("正在读取同步配置"),
          4_000
        );
        const aiInputs = Array.from(document.querySelectorAll(".settings-card--ai input"));
        const aiBaseUrlInput = aiInputs[0];
        const aiModelInput = aiInputs[1];
        const apiKeyInput = aiInputs[2];
        let expectedAiNormalizedUrl = "";
        settingsInitialLoadCompleted =
          Boolean(apiKeyInput) &&
          !apiKeyInput.disabled &&
          !bodyIncludes("正在读取 AI 配置") &&
          !bodyIncludes("正在读取翻译配置") &&
          !bodyIncludes("正在读取同步配置");
        if (aiBaseUrlInput && aiModelInput && apiKeyInput) {
          const aiSettingsBeforeInvalidUrl = localStorage.getItem("ai-settings");
          const aiSecretBeforeInvalidUrl = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          const invalidAiUrl = "api.smoke-ai.example/v1";
          const credentialAiUrl = "https://sk-smoke-secret@api.smoke-ai.example/v1";
          const validAiUrlInputValue = "https://api.smoke-ai.example/v1///";
          const validAiUrl = "https://api.smoke-ai.example/v1";
          expectedAiNormalizedUrl = validAiUrl;
          const aiModel = "smoke-ai-model";
          setInputValue(aiBaseUrlInput, invalidAiUrl);
          setInputValue(aiModelInput, aiModel);
          setInputValue(apiKeyInput, "smoke-ai-invalid-key");
          await waitFor(
            () =>
              aiBaseUrlInput.value === invalidAiUrl &&
              aiModelInput.value === aiModel &&
              apiKeyInput.value === "smoke-ai-invalid-key",
            1_000
          );
          const invalidAiUrlSaveButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
          );
          invalidAiUrlSaveButton?.click();
          settingsAiUrlInvalidVisible = Boolean(
            await waitFor(() => {
              const saveButton = Array.from(document.querySelectorAll("button")).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
              );
              return bodyIncludes("AI API 地址格式不正确") && saveButton && !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          setInputValue(aiBaseUrlInput, credentialAiUrl);
          await waitFor(() => aiBaseUrlInput.value === credentialAiUrl, 1_000);
          const credentialAiUrlSaveButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
          );
          credentialAiUrlSaveButton?.click();
          settingsAiUrlCredentialsRejected = Boolean(
            await waitFor(() => {
              const saveButton = Array.from(document.querySelectorAll("button")).find(
                (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
              );
              return bodyIncludes("AI API 地址不要包含密钥或账号") &&
                saveButton &&
                !saveButton.disabled
                ? saveButton
                : null;
            }, 1_000)
          );
          const aiSettingsAfterInvalidUrl = localStorage.getItem("ai-settings");
          const aiSecretAfterInvalidUrl = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          settingsAiUrlInvalidDidNotPersist =
            aiSettingsAfterInvalidUrl === aiSettingsBeforeInvalidUrl &&
            aiSecretAfterInvalidUrl === aiSecretBeforeInvalidUrl;
          setInputValue(aiBaseUrlInput, validAiUrlInputValue);
          await waitFor(() => aiBaseUrlInput.value === validAiUrlInputValue, 1_000);

          const aiSettingsBeforeFailure = localStorage.getItem("ai-settings");
          const aiSecretBeforeFailure = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          const aiFailureDraft = "smoke-ai-save-failure-key";
          setInputValue(apiKeyInput, aiFailureDraft);
          await waitFor(() => apiKeyInput.value === aiFailureDraft, 1_000);
          window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__ =
            "Smoke settings AI save failure";
          const failSaveAiButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
          );
          failSaveAiButton?.click();
          const preservedAiInput = await waitFor(() => {
            const currentApiKeyInput = Array.from(
              document.querySelectorAll(".settings-card--ai input")
            )[2];
            const saveButton = Array.from(document.querySelectorAll("button")).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置" &&
                !button.disabled
            );
            return bodyIncludes("保存失败，修改仍保留，可重新保存") &&
              bodyIncludes("Smoke settings AI save failure") &&
              currentApiKeyInput?.value === aiFailureDraft &&
              Boolean(saveButton)
              ? currentApiKeyInput
              : null;
          }, 3_000);
          delete window.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
          const aiSettingsAfterFailure = localStorage.getItem("ai-settings");
          const aiSecretAfterFailure = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          settingsAiSaveFailureVisible =
            bodyIncludes("保存失败，修改仍保留，可重新保存") &&
            bodyIncludes("Smoke settings AI save failure");
          settingsAiSaveFailurePreserved =
            Boolean(preservedAiInput) && preservedAiInput.value === aiFailureDraft;
          settingsAiSaveFailureDidNotPersist =
            aiSettingsAfterFailure === aiSettingsBeforeFailure &&
            aiSecretAfterFailure === aiSecretBeforeFailure;
          setInputValue(apiKeyInput, "smoke-ai-busy-key");
          await waitFor(() => apiKeyInput.value === "smoke-ai-busy-key", 1_000);
          const saveAiButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存 AI 配置"
          );
          saveAiButton?.click();
          await waitFor(
            () =>
              bodyIncludes("配置操作正在进行") &&
              bodyIncludes("AI 服务 正在处理") &&
              bodyIncludes("保存中..."),
            2_000
          );
          settingsBusySaveControlsDisabled =
            Boolean(saveAiButton?.disabled) &&
            Array.from(document.querySelectorAll(".settings-card--ai input")).every(
              (input) => input.disabled
            );
          settingsBusySaveAriaVisible =
            settingsBusySaveControlsDisabled &&
            saveAiButton?.getAttribute("aria-busy") === "true";
          document.querySelector('.app-nav a[aria-label="文献库"]')?.click();
          const busyNavigationDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("当前有设置操作正在进行") ? dialog : null;
          }, 3_000);
          settingsBusyNavigationConfirmVisible = Boolean(
            busyNavigationDialog?.textContent?.includes("正在处理：AI 服务")
          );
          const keepEditingSettings = Array.from(
            busyNavigationDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续编辑");
          keepEditingSettings?.click();
          await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
          settingsBusyNavigationCancelPreserved =
            settingsBusyNavigationConfirmVisible && location.hash.includes("/settings");
        }
        await waitFor(() => bodyIncludes("已保存，新的 AI 配置会用于摘要、闪卡与翻译。"), 3_000);
        if (expectedAiNormalizedUrl) {
          const savedAiSettingsText = localStorage.getItem("ai-settings");
          const currentAiBaseUrlInput = document.querySelector(".settings-card--ai input");
          try {
            const savedAiSettings = JSON.parse(savedAiSettingsText ?? "null");
            settingsAiUrlNormalized =
              savedAiSettings?.baseUrl === expectedAiNormalizedUrl &&
              currentAiBaseUrlInput?.value === expectedAiNormalizedUrl;
          } catch {
            settingsAiUrlNormalized = false;
          }
        }
        if (aiBaseUrlInput && aiModelInput && apiKeyInput) {
          window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_TEST__ =
            "Smoke settings AI test failure";
          const testAiButton = Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "测试连接"
          );
          testAiButton?.click();
          settingsAiTestFailureBusyVisible = Boolean(
            await waitFor(() => {
              const currentTestButton = Array.from(document.querySelectorAll("button")).find(
                (button) => /测试中|测试连接/.test(button.textContent?.replace(/\s+/g, " ").trim() ?? "")
              );
              return bodyIncludes("测试中...") &&
                currentTestButton?.getAttribute("aria-busy") === "true"
                ? currentTestButton
                : null;
            }, 4_000)
          );
          settingsAiTestFailureVisible = Boolean(
            await waitFor(
              () =>
                bodyIncludes("连接失败，配置已保存，可修改后重新测试") &&
                bodyIncludes("Smoke settings AI test failure"),
              4_000
            )
          );
          delete window.__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_TEST__;
          const aiSettingsAfterTestFailureText = localStorage.getItem("ai-settings");
          const aiSecretAfterTestFailure = await window.aura?.secrets?.get?.("secret:ai:apiKey");
          try {
            const savedAiSettingsAfterTest = JSON.parse(aiSettingsAfterTestFailureText ?? "null");
            settingsAiTestFailureConfigSaved =
              savedAiSettingsAfterTest?.baseUrl === expectedAiNormalizedUrl &&
              savedAiSettingsAfterTest?.model === "smoke-ai-model" &&
              savedAiSettingsAfterTest?.kind === "openai-compatible" &&
              aiSecretAfterTestFailure === "smoke-ai-busy-key" &&
              aiBaseUrlInput.value === expectedAiNormalizedUrl &&
              aiModelInput.value === "smoke-ai-model" &&
              apiKeyInput.value === "smoke-ai-busy-key";
          } catch {
            settingsAiTestFailureConfigSaved = false;
          }
          settingsAiTestFailureRetryVisible = Boolean(
            Array.from(document.querySelectorAll("button")).find(
              (button) =>
                button.textContent?.replace(/\s+/g, " ").trim() === "测试连接" &&
                !button.disabled
            )
          );
        }

        const backupExportButton = () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "导出整库备份" || label === "导出中...";
            }
          );
        const backupExportGraphCacheKey = "smoke-backup-export-graph-cache";
        const backupExportTranslationCacheKey = "smoke-backup-export-translation-cache";
        const backupExportDiscoverySiteId = "smoke-backup-export-discovery-site";
        const backupExportSavedSearchId = "smoke-backup-export-saved-search";
        const backupExportDerivedArtifactId = "smoke-backup-export-derived-artifact";
        await window.aura.db.run(
          "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
          [
            backupExportGraphCacheKey,
            JSON.stringify({ stale: "backup-export-graph-cache" }),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO translation_cache (cache_key, engine, target_lang, result, created_at) VALUES (?, ?, ?, ?, ?)",
          [
            backupExportTranslationCacheKey,
            "smoke-export-cache",
            "zh",
            "backup-export-translation-cache",
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 9999, 0, ?, ?)",
          [
            backupExportDiscoverySiteId,
            "Smoke Backup Credential Site",
            "https://site-user:site-pass@discovery.example.test/",
            "https://search-user:search-pass@search.example.test/search",
            Date.now(),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO saved_searches (id, query, sources_json, seen_ids_json, new_count, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
          [
            backupExportSavedSearchId,
            "Smoke backup credential source",
            JSON.stringify(["https://source-user:source-pass@source.example.test/feed"]),
            "[]",
            "Fetch failed https://inline-user:inline-pass@inline.example.test/error",
            Date.now(),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO derived_artifacts (id, library_id, source_table, source_id, kind, model, prompt_hash, input_hash, payload_json, local_only, syncable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
          [
            backupExportDerivedArtifactId,
            "smoke-backup-export-library",
            "works",
            "smoke-backup-export-work",
            "reader-digest",
            "smoke-model",
            "smoke-prompt",
            "smoke-input",
            JSON.stringify({
              apiKey: "artifact-secret-key",
              nested: {
                accessToken: "artifact-access-token",
                client_secret: "artifact-client-secret",
                cookie: "artifact-cookie",
                id_token: "artifact-id-token",
                session_id: "artifact-session-id",
                sourceUrl: "https://artifact-user:artifact-pass@artifact.example.test/path"
              }
            }),
            Date.now(),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          [
            "research.proxy",
            JSON.stringify("http://backup-user:backup-pass@127.0.0.1:9876"),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          [
            "research.ezproxy",
            JSON.stringify("https://campus-user:campus-pass@login.ezproxy.example.edu/login?url="),
            Date.now()
          ]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          ["secret:legacy:apiKey", JSON.stringify("backup-secret-key"), Date.now()]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          ["local.library_id", JSON.stringify("smoke-backup-local-library"), Date.now()]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          ["local.device_id", JSON.stringify("smoke-backup-local-device"), Date.now()]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          ["sync.smoke-backup.last_pushed_at", JSON.stringify(123456), Date.now()]
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)",
          [
            "sync.conflict.smoke-backup.works.w1.title",
            JSON.stringify({ losingValue: "stale" }),
            Date.now()
          ]
        );
        const originalBackupAnchorClick = HTMLAnchorElement.prototype.click;
        const originalBackupExportCreateObjectUrl = URL.createObjectURL;
        let backupDownloadCount = 0;
        let backupDownloadName = "";
        let backupExportTextPromise = Promise.resolve("");
        URL.createObjectURL = (blob) => {
          if (blob instanceof Blob) backupExportTextPromise = blob.text();
          return "blob:aurascholar-backup-smoke";
        };
        HTMLAnchorElement.prototype.click = function () {
          if (this.download?.startsWith("aurascholar-backup-") && this.download.endsWith(".json")) {
            backupDownloadCount += 1;
            backupDownloadName = this.download;
            return;
          }
          return originalBackupAnchorClick.call(this);
        };
        try {
          backupExportButton()?.click();
          await waitFor(
            () =>
              backupExportButton()?.disabled &&
              bodyIncludes("正在导出整库备份") &&
              bodyIncludes("导出中..."),
            1_000
          );
          settingsBackupExportBusyVisible = Boolean(
            backupExportButton()?.disabled &&
              bodyIncludes("正在导出整库备份") &&
              bodyIncludes("导出中...")
          );
          settingsBackupExportAriaBusyVisible = Boolean(
            settingsBackupExportBusyVisible &&
              backupExportButton()?.getAttribute("aria-busy") === "true"
          );
          await waitFor(
            () =>
              !backupExportButton()?.disabled &&
              bodyIncludes("整库 JSON 备份已导出") &&
              bodyIncludes(".json") &&
              bodyIncludes("KB"),
            3_000
          );
          settingsBackupExportSuccessVisible =
            backupDownloadCount === 1 &&
            backupDownloadName.startsWith("aurascholar-backup-") &&
            bodyIncludes("整库 JSON 备份已导出") &&
            bodyIncludes(backupDownloadName);
          try {
            const backupSafety = JSON.parse(
              localStorage.getItem("library-backup-safety") ?? "null"
            );
            settingsBackupExportRecencyVisible =
              bodyIncludes("最近备份") &&
              bodyIncludes("已备份") &&
              bodyIncludes("恢复提醒") &&
              bodyIncludes("PDF 需重挂载") &&
              backupSafety?.filename === backupDownloadName &&
              typeof backupSafety?.exportedAt === "string" &&
              Number.isFinite(Date.parse(backupSafety.exportedAt)) &&
              backupSafety?.size > 0;
          } catch {
            settingsBackupExportRecencyVisible = false;
          }
          const exportedBackupText = await backupExportTextPromise;
          try {
            const exportedBackup = JSON.parse(exportedBackupText);
            const settingsRows = Array.isArray(exportedBackup?.tables?.settings)
              ? exportedBackup.tables.settings
              : [];
            const exportedTables =
              exportedBackup?.tables && typeof exportedBackup.tables === "object"
                ? exportedBackup.tables
                : {};
            const proxyRow = settingsRows.find((row) => row?.key === "research.proxy");
            const ezproxyRow = settingsRows.find((row) => row?.key === "research.ezproxy");
            const discoveryRows = Array.isArray(exportedBackup?.tables?.discovery_sites)
              ? exportedBackup.tables.discovery_sites
              : [];
            const savedSearchRows = Array.isArray(exportedBackup?.tables?.saved_searches)
              ? exportedBackup.tables.saved_searches
              : [];
            const derivedArtifactRows = Array.isArray(exportedBackup?.tables?.derived_artifacts)
              ? exportedBackup.tables.derived_artifacts
              : [];
            const discoveryRow = discoveryRows.find(
              (row) => row?.id === backupExportDiscoverySiteId
            );
            const savedSearchRow = savedSearchRows.find(
              (row) => row?.id === backupExportSavedSearchId
            );
            const derivedArtifactRow = derivedArtifactRows.find(
              (row) => row?.id === backupExportDerivedArtifactId
            );
            const proxyValue = proxyRow ? JSON.parse(proxyRow.value_json) : "";
            const ezproxyValue = ezproxyRow ? JSON.parse(ezproxyRow.value_json) : "";
            const savedSearchSources = savedSearchRow
              ? JSON.parse(savedSearchRow.sources_json)
              : [];
            const derivedArtifactPayload = derivedArtifactRow
              ? JSON.parse(derivedArtifactRow.payload_json)
              : null;
            settingsBackupExportEphemeralDataExcluded =
              !Object.hasOwn(exportedTables, "graph_cache") &&
              !Object.hasOwn(exportedTables, "translation_cache") &&
              !exportedBackupText.includes(backupExportGraphCacheKey) &&
              !exportedBackupText.includes(backupExportTranslationCacheKey) &&
              !exportedBackupText.includes("backup-export-graph-cache") &&
              !exportedBackupText.includes("backup-export-translation-cache");
            settingsBackupExportSecretsSanitized =
              proxyValue === "http://127.0.0.1:9876/" &&
              ezproxyValue === "https://login.ezproxy.example.edu/login?url=" &&
              discoveryRow?.home_url === "https://discovery.example.test/" &&
              discoveryRow?.search_url === "https://search.example.test/search" &&
              savedSearchSources[0] === "https://source.example.test/feed" &&
              savedSearchRow?.last_error ===
                "Fetch failed https://inline.example.test/error" &&
              derivedArtifactPayload?.apiKey === "" &&
              derivedArtifactPayload?.nested?.accessToken === "" &&
              derivedArtifactPayload?.nested?.client_secret === "" &&
              derivedArtifactPayload?.nested?.cookie === "" &&
              derivedArtifactPayload?.nested?.id_token === "" &&
              derivedArtifactPayload?.nested?.session_id === "" &&
              derivedArtifactPayload?.nested?.sourceUrl === "https://artifact.example.test/path" &&
              !settingsRows.some((row) => row?.key === "secret:legacy:apiKey") &&
              !settingsRows.some(
                (row) =>
                  row?.key === "local.library_id" ||
                  row?.key === "local.device_id" ||
                  (typeof row?.key === "string" && row.key.startsWith("sync."))
              ) &&
              !exportedBackupText.includes("backup-pass") &&
              !exportedBackupText.includes("campus-pass") &&
              !exportedBackupText.includes("site-user") &&
              !exportedBackupText.includes("site-pass") &&
              !exportedBackupText.includes("source-user") &&
              !exportedBackupText.includes("source-pass") &&
              !exportedBackupText.includes("inline-user") &&
              !exportedBackupText.includes("inline-pass") &&
              !exportedBackupText.includes("artifact-user") &&
              !exportedBackupText.includes("artifact-pass") &&
              !exportedBackupText.includes("artifact-secret-key") &&
              !exportedBackupText.includes("artifact-access-token") &&
              !exportedBackupText.includes("artifact-client-secret") &&
              !exportedBackupText.includes("artifact-cookie") &&
              !exportedBackupText.includes("artifact-id-token") &&
              !exportedBackupText.includes("artifact-session-id") &&
              !exportedBackupText.includes("backup-secret-key") &&
              !exportedBackupText.includes("smoke-backup-local-library") &&
              !exportedBackupText.includes("smoke-backup-local-device") &&
              !exportedBackupText.includes("sync.smoke-backup.last_pushed_at") &&
              !exportedBackupText.includes("sync.conflict.smoke-backup");
          } catch {
            settingsBackupExportSecretsSanitized = false;
          }
        } finally {
          HTMLAnchorElement.prototype.click = originalBackupAnchorClick;
          URL.createObjectURL = originalBackupExportCreateObjectUrl;
        }

        const originalBackupCreateObjectUrl = URL.createObjectURL;
        URL.createObjectURL = () => {
          throw new Error("smoke-backup-export-failed");
        };
        try {
          backupExportButton()?.click();
          await waitFor(
            () => bodyIncludes("导出失败：smoke-backup-export-failed"),
            3_000
          );
          settingsBackupExportFailureVisible = bodyIncludes("导出失败：smoke-backup-export-failed");
        } finally {
          URL.createObjectURL = originalBackupCreateObjectUrl;
        }

        const backupImportButton = () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "导入备份" || label === "导入中...";
            }
          );
        const backupImportInput = document.querySelector('input[type="file"][accept=".json,application/json"]');
        if (backupImportInput) {
          const backupImportWorkId = "smoke-backup-import-work";
          const backupImportAttachmentId = "smoke-backup-import-attachment";
          const backupImportAnnotationId = "smoke-backup-import-annotation";
          const backupImportSnippetId = "smoke-backup-import-snippet";
          const backupImportSavedSearchId = "smoke-backup-import-saved-search";
          const backupImportAuthorId = "smoke-backup-import-author";
          const backupMergeExistingWorkId = "smoke-backup-existing-work";
          const backupMergeDoi = "10.4242/aurascholar.backup-merge";
          const backupMergeWorkId = "smoke-backup-conflicting-work";
          const backupMergeAttachmentId = "smoke-backup-conflicting-attachment";
          const backupMergeAnnotationId = "smoke-backup-conflicting-annotation";
          const backupMergeSnippetId = "smoke-backup-conflicting-snippet";
          const backupCollisionLocalWorkId = "smoke-backup-attachment-collision-local-work";
          const backupCollisionImportWorkId = "smoke-backup-attachment-collision-work";
          const backupCollisionAttachmentId = "smoke-backup-attachment-collision-attachment";
          const backupCollisionAnnotationId = "smoke-backup-attachment-collision-annotation";
          const backupImportOldLibraryId = "smoke-backup-old-library";
          const backupImportDerivedArtifactId = "smoke-backup-import-derived-artifact";
          const backupImportPendingAiJobId = "smoke-backup-import-pending-ai-job";
          const backupImportDoneAiJobId = "smoke-backup-import-done-ai-job";
          const backupImportGraphCacheKey = "smoke-backup-import-graph-cache";
          const backupImportTranslationCacheKey = "smoke-backup-import-translation-cache";
          const backupImportProxySettingKey = "research.proxy.import-smoke";
          const backupImportSafeSettingKey = "safe.setting.import-smoke";
          const backupImportSecretSettingKey = "secret:import:apiKey";
          const backupImportRuntimeSyncKey = "sync.import-smoke.last_pushed_at";
          const backupImportRuntimeConflictKey = "sync.conflict.import-smoke.works.w1.title";
          const now = Date.now();
          await window.aura.db.run(
            "INSERT OR IGNORE INTO works (id, doi, title, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, 'article', 'unread', 0, ?, ?)",
            [
              backupMergeExistingWorkId,
              backupMergeDoi,
              "Existing Backup Merge Target",
              now,
              now
            ]
          );
          await window.aura.db.run(
            "INSERT OR IGNORE INTO works (id, doi, title, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, 'article', 'unread', 0, ?, ?)",
            [
              backupCollisionLocalWorkId,
              "10.4242/aurascholar.backup-attachment-collision-local",
              "Existing Attachment Collision Local Work",
              now,
              now
            ]
          );
          await window.aura.db.run(
            "INSERT OR IGNORE INTO attachments (id, work_id, kind, sha256, byte_size, original_filename, fetched_via, page_count, created_at, updated_at) VALUES (?, ?, 'pdf', ?, ?, ?, 'backup-smoke-local', 1, ?, ?)",
            [
              backupCollisionAttachmentId,
              backupCollisionLocalWorkId,
              "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              4096,
              "local-collision-existing.pdf",
              now,
              now
            ]
          );
          const backupPayload = {
            version: 1,
            exportedAt: new Date(now).toISOString(),
            tables: {
              libraries: [
                {
                  id: backupImportOldLibraryId,
                  name: "Old Backup Library",
                  kind: "personal",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              works: [
                {
                  id: backupImportWorkId,
                  doi: "10.4242/aurascholar.backup-import",
                  title: "Backup Import Smoke Work",
                  abstract: "Imported from a user JSON backup.",
                  year: 2026,
                  publication_date: "2026",
                  venue_name: "Journal of Backup UX",
                  venue_type: "journal",
                  type: "article",
                  reading_status: "unread",
                  starred: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupMergeWorkId,
                  doi: backupMergeDoi,
                  title: "Backup Duplicate Should Merge",
                  abstract: "This backup row has the same DOI as an existing local work.",
                  year: 2026,
                  publication_date: "2026",
                  venue_name: "Journal of Backup Merge",
                  venue_type: "journal",
                  type: "article",
                  reading_status: "unread",
                  starred: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupCollisionImportWorkId,
                  doi: "10.4242/aurascholar.backup-attachment-collision-import",
                  title: "Backup Attachment Collision Import Work",
                  abstract: "This backup row reuses a local attachment id and must be remapped.",
                  year: 2026,
                  publication_date: "2026",
                  venue_name: "Journal of Backup Collisions",
                  venue_type: "journal",
                  type: "article",
                  reading_status: "unread",
                  starred: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              authors: [
                {
                  id: backupImportAuthorId,
                  display_name: "Backup Import Author",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              work_authors: [
                {
                  work_id: backupImportWorkId,
                  author_id: backupImportAuthorId,
                  position: 1,
                  is_corresponding: 0,
                  raw_name: "Backup Import Author",
                  role: "author"
                }
              ],
              attachments: [
                {
                  id: backupImportAttachmentId,
                  work_id: backupImportWorkId,
                  kind: "pdf",
                  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  byte_size: 1024,
                  original_filename: "backup-import-missing.pdf",
                  source_url: null,
                  fetched_via: "backup-smoke",
                  page_count: 1,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupMergeAttachmentId,
                  work_id: backupMergeWorkId,
                  kind: "pdf",
                  sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  byte_size: 2048,
                  original_filename: "backup-merge-missing.pdf",
                  source_url: null,
                  fetched_via: "backup-smoke",
                  page_count: 1,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupCollisionAttachmentId,
                  work_id: backupCollisionImportWorkId,
                  kind: "pdf",
                  sha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                  byte_size: 3072,
                  original_filename: "backup-collision-missing.pdf",
                  source_url: null,
                  fetched_via: "backup-smoke",
                  page_count: 1,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              annotations: [
                {
                  id: backupImportAnnotationId,
                  attachment_id: backupImportAttachmentId,
                  work_id: backupImportWorkId,
                  type: "highlight",
                  color: "yellow",
                  page_index: 0,
                  anchor_json: "{}",
                  content_md: "Backup import annotation",
                  ink_paths_json: null,
                  sort_key: 1,
                  orphaned: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupMergeAnnotationId,
                  attachment_id: backupMergeAttachmentId,
                  work_id: backupMergeWorkId,
                  type: "highlight",
                  color: "yellow",
                  page_index: 0,
                  anchor_json: "{}",
                  content_md: "Backup merge annotation",
                  ink_paths_json: null,
                  sort_key: 2,
                  orphaned: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupCollisionAnnotationId,
                  attachment_id: backupCollisionAttachmentId,
                  work_id: backupCollisionImportWorkId,
                  type: "highlight",
                  color: "yellow",
                  page_index: 0,
                  anchor_json: "{}",
                  content_md: "Backup attachment collision annotation",
                  ink_paths_json: null,
                  sort_key: 3,
                  orphaned: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              snippets: [
                {
                  id: backupImportSnippetId,
                  work_id: backupImportWorkId,
                  page_index: 0,
                  quote: "Backup import snippet quote",
                  note_md: "Backup import snippet note",
                  tag: "backup",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                },
                {
                  id: backupMergeSnippetId,
                  work_id: backupMergeWorkId,
                  page_index: 0,
                  quote: "Backup merge snippet quote",
                  note_md: "Backup merge snippet note",
                  tag: "backup",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              saved_searches: [
                {
                  id: backupImportSavedSearchId,
                  query: "Backup Import Saved Search",
                  sources_json: "[\"openalex\"]",
                  seen_ids_json: "[]",
                  new_count: 0,
                  last_run_at: null,
                  next_run_at: null,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null,
                  last_error: null
                }
              ],
              ai_jobs: [
                {
                  id: backupImportPendingAiJobId,
                  kind: "flashcards",
                  work_id: backupImportWorkId,
                  status: "pending",
                  model: "smoke-model",
                  prompt_version: "smoke-prompt",
                  result_json: null,
                  error: null,
                  created_at: now,
                  updated_at: now
                },
                {
                  id: backupImportDoneAiJobId,
                  kind: "reader-digest",
                  work_id: backupImportWorkId,
                  status: "done",
                  model: "smoke-model",
                  prompt_version: "smoke-prompt",
                  result_json: JSON.stringify({ summary: "Imported completed AI job" }),
                  error: null,
                  created_at: now,
                  updated_at: now
                }
              ],
              settings: [
                {
                  key: backupImportProxySettingKey,
                  value_json: JSON.stringify("http://import-user:import-pass@127.0.0.1:7777"),
                  scope: "local",
                  updated_at: now
                },
                {
                  key: backupImportSafeSettingKey,
                  value_json: JSON.stringify({
                    label: "safe",
                    apiKey: "nested-import-secret",
                    client_secret: "nested-import-client-secret",
                    cookie: "nested-import-cookie",
                    id_token: "nested-import-id-token",
                    proxy: "http://nested:nested-pass@proxy.example.test:8090"
                  }),
                  scope: "local",
                  updated_at: now
                },
                {
                  key: backupImportSecretSettingKey,
                  value_json: JSON.stringify("import-secret-key"),
                  scope: "local",
                  updated_at: now
                },
                {
                  key: backupImportRuntimeSyncKey,
                  value_json: JSON.stringify(987654),
                  scope: "local",
                  updated_at: now
                },
                {
                  key: backupImportRuntimeConflictKey,
                  value_json: JSON.stringify({ losingValue: "runtime-conflict" }),
                  scope: "local",
                  updated_at: now
                }
              ],
              derived_artifacts: [
                {
                  id: backupImportDerivedArtifactId,
                  library_id: backupImportOldLibraryId,
                  source_table: "works",
                  source_id: backupImportWorkId,
                  kind: "reader-digest",
                  model: "smoke-model",
                  prompt_hash: "smoke-prompt",
                  input_hash: "smoke-input",
                  payload_json: JSON.stringify({
                    summary: "Backup import derived artifact",
                    apiKey: "backup-import-artifact-secret",
                    nested: {
                      accessToken: "backup-import-artifact-token",
                      client_secret: "backup-import-artifact-client-secret",
                      cookie: "backup-import-artifact-cookie",
                      id_token: "backup-import-artifact-id-token",
                      session_id: "backup-import-artifact-session-id",
                      sourceUrl:
                        "https://artifact-import-user:artifact-import-pass@artifact-import.example.test/path"
                    }
                  }),
                  local_only: 1,
                  syncable: 0,
                  created_at: now,
                  updated_at: now,
                  expires_at: null,
                  deleted_at: null
                }
              ],
              graph_cache: [
                {
                  work_id: backupImportGraphCacheKey,
                  payload_json: JSON.stringify({ stale: "backup-import-graph-cache" }),
                  fetched_at: now
                }
              ],
              translation_cache: [
                {
                  cache_key: backupImportTranslationCacheKey,
                  engine: "smoke-import-cache",
                  target_lang: "zh",
                  result: "backup-import-translation-cache",
                  created_at: now
                }
              ],
              future_smoke_table: [{ id: "ignored" }]
            }
          };
          const backupImportFile = new File(
            [JSON.stringify(backupPayload)],
            "aurascholar-backup-import-smoke.json",
            { type: "application/json" }
          );
          const beforeBackupImportRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ?",
            [backupImportWorkId]
          );
          const cancelledBackupTransfer = new DataTransfer();
          cancelledBackupTransfer.items.add(backupImportFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: cancelledBackupTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          const backupImportDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("合并导入整库备份") ? dialog : null;
          }, 3_000);
          settingsBackupImportConfirmVisible = Boolean(
            backupImportDialog?.textContent?.includes("aurascholar-backup-import-smoke.json") &&
              backupImportDialog.textContent.includes("不会覆盖当前内容") &&
              backupImportDialog.textContent.includes(
                "将忽略 3 个不支持或运行态数据表（graph_cache、translation_cache、future_smoke_table）"
              ) &&
              backupImportDialog.textContent.includes("缓存、同步运行态和本机临时数据会在使用时重新生成")
          );
          const cancelBackupImport = Array.from(
            backupImportDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "取消");
          cancelBackupImport?.click();
          await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
          const cancelledBackupRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ?",
            [backupImportWorkId]
          );
          settingsBackupImportCancelPreserved =
            settingsBackupImportConfirmVisible &&
            Number(beforeBackupImportRows[0]?.n ?? 0) === 0 &&
            Number(cancelledBackupRows[0]?.n ?? 0) === 0 &&
            bodyIncludes("已取消导入备份");

          const ignoredOnlyGraphCacheKey = "smoke-backup-ignored-only-graph-cache";
          const ignoredOnlyTranslationCacheKey = "smoke-backup-ignored-only-translation-cache";
          const ignoredOnlyPayload = {
            version: 1,
            exportedAt: new Date(now).toISOString(),
            tables: {
              graph_cache: [
                {
                  work_id: ignoredOnlyGraphCacheKey,
                  payload_json: JSON.stringify({ stale: "ignored-only-graph-cache" }),
                  fetched_at: now
                }
              ],
              translation_cache: [
                {
                  cache_key: ignoredOnlyTranslationCacheKey,
                  engine: "smoke-ignored-only-cache",
                  target_lang: "zh",
                  result: "ignored-only-translation-cache",
                  created_at: now
                }
              ],
              future_smoke_ignored_only: [{ id: "ignored-only" }]
            }
          };
          const ignoredOnlyFile = new File(
            [JSON.stringify(ignoredOnlyPayload)],
            "aurascholar-backup-ignored-only-smoke.json",
            { type: "application/json" }
          );
          const ignoredOnlyTransfer = new DataTransfer();
          ignoredOnlyTransfer.items.add(ignoredOnlyFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: ignoredOnlyTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("备份文件里没有可导入的用户数据") &&
              bodyIncludes(
                "已识别并忽略 3 个不支持或运行态数据表（graph_cache、translation_cache、future_smoke_ignored_only）"
              ),
            3_000
          );
          const ignoredOnlyGraphRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM graph_cache WHERE work_id = ?",
            [ignoredOnlyGraphCacheKey]
          );
          const ignoredOnlyTranslationRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM translation_cache WHERE cache_key = ?",
            [ignoredOnlyTranslationCacheKey]
          );
          settingsBackupImportIgnoredOnlyExplained =
            !document.querySelector('[role="dialog"]') &&
            Number(ignoredOnlyGraphRows[0]?.n ?? 0) === 0 &&
            Number(ignoredOnlyTranslationRows[0]?.n ?? 0) === 0 &&
            bodyIncludes("备份文件里没有可导入的用户数据") &&
            bodyIncludes(
              "已识别并忽略 3 个不支持或运行态数据表（graph_cache、translation_cache、future_smoke_ignored_only）"
            );

          const backupFailureWorkId = "smoke-backup-import-rollback-work";
          const backupFailureAuthorId = "smoke-backup-import-rollback-author";
          const backupFailureSettingKey = "safe.setting.import-rollback-smoke";
          const backupFailurePayload = {
            version: 1,
            exportedAt: new Date(now).toISOString(),
            tables: {
              settings: [
                {
                  key: backupFailureSettingKey,
                  value_json: JSON.stringify({ label: "rollback" }),
                  scope: "local",
                  updated_at: now
                }
              ],
              works: [
                {
                  id: backupFailureWorkId,
                  doi: "10.4242/aurascholar.backup-import-rollback",
                  title: "Backup Import Rollback Smoke Work",
                  abstract: "This row must roll back if a later backup table fails.",
                  year: 2026,
                  publication_date: "2026",
                  venue_name: "Journal of Backup Rollbacks",
                  venue_type: "journal",
                  type: "article",
                  reading_status: "unread",
                  starred: 0,
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ],
              authors: [
                {
                  id: backupFailureAuthorId,
                  display_name: "Backup Rollback Author",
                  created_at: now,
                  updated_at: now,
                  deleted_at: null
                }
              ]
            }
          };
          const backupFailureFile = new File(
            [JSON.stringify(backupFailurePayload)],
            "aurascholar-backup-import-rollback-smoke.json",
            { type: "application/json" }
          );
          const backupFailureTransfer = new DataTransfer();
          backupFailureTransfer.items.add(backupFailureFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: backupFailureTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          const backupFailureDialog = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("合并导入整库备份") ? dialog : null;
          }, 3_000);
          const confirmBackupFailureImport = Array.from(
            backupFailureDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "合并导入");
          await window.aura.db.run(
            "CREATE TEMP TRIGGER aurascholar_smoke_backup_import_failure BEFORE INSERT ON authors WHEN NEW.id = 'smoke-backup-import-rollback-author' BEGIN SELECT RAISE(FAIL, 'Smoke backup import rollback failure'); END;"
          );
          try {
            confirmBackupFailureImport?.click();
            settingsBackupImportFailureBusyVisible = Boolean(
              await waitFor(() => {
                const button = backupImportButton();
                return button?.disabled &&
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("导入中") &&
                  bodyIncludes("正在合并导入备份")
                  ? button
                  : null;
              }, 1_000)
            );
            await waitFor(
              () =>
                bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入") &&
                bodyIncludes("Smoke backup import rollback failure"),
              4_000
            );
            settingsBackupImportFailureVisible =
              bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入") &&
              bodyIncludes("Smoke backup import rollback failure");
          } finally {
            await window.aura.db.run(
              "DROP TRIGGER IF EXISTS aurascholar_smoke_backup_import_failure"
            );
          }
          const failedImportWorkRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ?",
            [backupFailureWorkId]
          );
          const failedImportAuthorRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM authors WHERE id = ?",
            [backupFailureAuthorId]
          );
          const failedImportSettingRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM settings WHERE key = ?",
            [backupFailureSettingKey]
          );
          settingsBackupImportFailureDidNotPersist =
            Number(failedImportWorkRows[0]?.n ?? 0) === 0 &&
            Number(failedImportAuthorRows[0]?.n ?? 0) === 0 &&
            Number(failedImportSettingRows[0]?.n ?? 0) === 0;
          settingsBackupImportFailureRetryVisible = Boolean(
            await waitFor(() => {
              const button = backupImportButton();
              return button &&
                !button.disabled &&
                bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入")
                ? button
                : null;
            }, 1_000)
          );

          const confirmBackupTransfer = new DataTransfer();
          confirmBackupTransfer.items.add(backupImportFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: confirmBackupTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          const backupImportDialogAgain = await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog?.textContent?.includes("合并导入整库备份") ? dialog : null;
          }, 3_000);
          const confirmBackupImport = Array.from(
            backupImportDialogAgain?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "合并导入");
          confirmBackupImport?.click();
          settingsBackupImportBusyVisible = Boolean(
            await waitFor(() => {
              const button = backupImportButton();
              return button?.disabled &&
                button.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("导入中") &&
                bodyIncludes("正在合并导入备份")
                ? button
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("备份导入完成：新增"), 4_000);
          settingsBackupImportSuccessVisible =
            bodyIncludes("备份导入完成：新增") &&
            bodyIncludes(
              "已忽略 3 个不支持或运行态数据表（graph_cache、translation_cache、future_smoke_table）"
            );
          settingsBackupImportRuntimeSkipExplained = bodyIncludes(
            "1 条旧设备未完成的 AI 任务未恢复，可在新设备重新生成"
          );
          const importedBackupRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ?",
            [backupImportWorkId]
          );
          const importedSnippetRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM snippets WHERE id = ?",
            [backupImportSnippetId]
          );
          const importedSavedSearchRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM saved_searches WHERE id = ?",
            [backupImportSavedSearchId]
          );
          const importedProxySettingRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = ?",
            [backupImportProxySettingKey]
          );
          const importedSafeSettingRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = ?",
            [backupImportSafeSettingKey]
          );
          const importedSecretSettingRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM settings WHERE key = ?",
            [backupImportSecretSettingKey]
          );
          const importedRuntimeSettingRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM settings WHERE key IN (?, ?)",
            [backupImportRuntimeSyncKey, backupImportRuntimeConflictKey]
          );
          const currentLibraryRows = await window.aura.db.query(
            "SELECT value_json FROM settings WHERE key = 'local.library_id'"
          );
          let currentLibraryId = "";
          try {
            currentLibraryId = currentLibraryRows[0]
              ? JSON.parse(currentLibraryRows[0].value_json)
              : "";
          } catch {
            currentLibraryId = "";
          }
          const importedDerivedArtifactRows = await window.aura.db.query(
            "SELECT library_id, source_id, payload_json FROM derived_artifacts WHERE id = ?",
            [backupImportDerivedArtifactId]
          );
          const oldBackupLibraryRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM libraries WHERE id = ?",
            [backupImportOldLibraryId]
          );
          const importedSearchRows = await window.aura.db.query(
            "SELECT w.id FROM works w JOIN works_fts f ON f.rowid = w.rowid WHERE works_fts MATCH ? AND w.deleted_at IS NULL",
            ['"Backup"* "Import"*']
          );
          const importedAttachmentRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE id = ? AND deleted_at IS NOT NULL",
            [backupImportAttachmentId]
          );
          const activeAttachmentRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE id = ? AND deleted_at IS NULL",
            [backupImportAttachmentId]
          );
          const importedAnnotationRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM annotations WHERE id = ?",
            [backupImportAnnotationId]
          );
          const duplicateWorkRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ?",
            [backupMergeWorkId]
          );
          const mergedSnippetRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM snippets WHERE id = ? AND work_id = ?",
            [backupMergeSnippetId, backupMergeExistingWorkId]
          );
          const mergedAttachmentRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE id = ? AND work_id = ? AND deleted_at IS NOT NULL",
            [backupMergeAttachmentId, backupMergeExistingWorkId]
          );
          const mergedAnnotationRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM annotations WHERE id = ? AND work_id = ? AND attachment_id = ?",
            [backupMergeAnnotationId, backupMergeExistingWorkId, backupMergeAttachmentId]
          );
          const collisionLocalAttachmentRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM attachments WHERE id = ? AND work_id = ? AND deleted_at IS NULL",
            [backupCollisionAttachmentId, backupCollisionLocalWorkId]
          );
          const collisionImportedAttachmentRows = await window.aura.db.query(
            "SELECT id FROM attachments WHERE work_id = ? AND original_filename = ? AND deleted_at IS NOT NULL",
            [backupCollisionImportWorkId, "backup-collision-missing.pdf"]
          );
          const collisionImportedAttachmentId =
            typeof collisionImportedAttachmentRows[0]?.id === "string"
              ? collisionImportedAttachmentRows[0].id
              : "";
          const collisionAnnotationRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM annotations ann JOIN attachments att ON att.id = ann.attachment_id WHERE ann.id = ? AND ann.work_id = ? AND ann.attachment_id = ? AND ann.attachment_id != ? AND att.work_id = ? AND att.deleted_at IS NOT NULL",
            [
              backupCollisionAnnotationId,
              backupCollisionImportWorkId,
              collisionImportedAttachmentId,
              backupCollisionAttachmentId,
              backupCollisionImportWorkId
            ]
          );
          const importedPendingAiJobRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM ai_jobs WHERE id = ?",
            [backupImportPendingAiJobId]
          );
          const importedDoneAiJobRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM ai_jobs WHERE id = ? AND work_id = ? AND status = 'done'",
            [backupImportDoneAiJobId, backupImportWorkId]
          );
          settingsBackupImportAiJobsPortable =
            Number(importedPendingAiJobRows[0]?.n ?? 0) === 0 &&
            Number(importedDoneAiJobRows[0]?.n ?? 0) === 1;
          const importedGraphCacheRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM graph_cache WHERE work_id = ?",
            [backupImportGraphCacheKey]
          );
          const importedTranslationCacheRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM translation_cache WHERE cache_key = ?",
            [backupImportTranslationCacheKey]
          );
          settingsBackupImportEphemeralDataExcluded =
            Number(importedGraphCacheRows[0]?.n ?? 0) === 0 &&
            Number(importedTranslationCacheRows[0]?.n ?? 0) === 0;
          settingsBackupImportStableIdMerged =
            Number(duplicateWorkRows[0]?.n ?? 0) === 0 &&
            Number(mergedSnippetRows[0]?.n ?? 0) === 1 &&
            Number(mergedAttachmentRows[0]?.n ?? 0) === 1 &&
            Number(mergedAnnotationRows[0]?.n ?? 0) === 1 &&
            bodyIncludes("已合并");
          settingsBackupImportLibraryScoped =
            currentLibraryId !== "" &&
            importedDerivedArtifactRows[0]?.library_id === currentLibraryId &&
            importedDerivedArtifactRows[0]?.source_id === backupImportWorkId &&
            importedDerivedArtifactRows[0]?.library_id !== backupImportOldLibraryId &&
            Number(oldBackupLibraryRows[0]?.n ?? 0) === 0;
          try {
            const importedDerivedPayload = importedDerivedArtifactRows[0]?.payload_json
              ? JSON.parse(importedDerivedArtifactRows[0].payload_json)
              : null;
            settingsBackupImportLibraryScoped =
              settingsBackupImportLibraryScoped &&
              importedDerivedPayload?.apiKey === "" &&
              importedDerivedPayload?.nested?.accessToken === "" &&
              importedDerivedPayload?.nested?.client_secret === "" &&
              importedDerivedPayload?.nested?.cookie === "" &&
              importedDerivedPayload?.nested?.id_token === "" &&
              importedDerivedPayload?.nested?.session_id === "" &&
              importedDerivedPayload?.nested?.sourceUrl ===
                "https://artifact-import.example.test/path" &&
              !JSON.stringify(importedDerivedPayload).includes("backup-import-artifact-secret") &&
              !JSON.stringify(importedDerivedPayload).includes("backup-import-artifact-token") &&
              !JSON.stringify(importedDerivedPayload).includes(
                "backup-import-artifact-client-secret"
              ) &&
              !JSON.stringify(importedDerivedPayload).includes("backup-import-artifact-cookie") &&
              !JSON.stringify(importedDerivedPayload).includes("backup-import-artifact-id-token") &&
              !JSON.stringify(importedDerivedPayload).includes(
                "backup-import-artifact-session-id"
              ) &&
              !JSON.stringify(importedDerivedPayload).includes("artifact-import-pass");
          } catch {
            settingsBackupImportLibraryScoped = false;
          }
          settingsBackupImportAttachmentIdCollisionRemapped =
            Number(collisionLocalAttachmentRows[0]?.n ?? 0) === 1 &&
            collisionImportedAttachmentId !== "" &&
            collisionImportedAttachmentId !== backupCollisionAttachmentId &&
            Number(collisionAnnotationRows[0]?.n ?? 0) === 1;
          settingsBackupImportSearchIndexed = importedSearchRows.some(
            (row) => row.id === backupImportWorkId
          );
          try {
            const importedProxyValue = importedProxySettingRows[0]
              ? JSON.parse(importedProxySettingRows[0].value_json)
              : "";
            const importedSafeValue = importedSafeSettingRows[0]
              ? JSON.parse(importedSafeSettingRows[0].value_json)
              : null;
            const importedSafeText = JSON.stringify(importedSafeValue);
            settingsBackupImportSettingsSanitized =
              importedProxyValue === "http://127.0.0.1:7777/" &&
              importedSafeValue?.apiKey === "" &&
              importedSafeValue?.client_secret === "" &&
              importedSafeValue?.cookie === "" &&
              importedSafeValue?.id_token === "" &&
              importedSafeValue?.proxy === "http://proxy.example.test:8090/" &&
              Number(importedSecretSettingRows[0]?.n ?? 0) === 0 &&
              Number(importedRuntimeSettingRows[0]?.n ?? 0) === 0 &&
              !importedSafeText.includes("nested-import-secret") &&
              !importedSafeText.includes("nested-import-client-secret") &&
              !importedSafeText.includes("nested-import-cookie") &&
              !importedSafeText.includes("nested-import-id-token") &&
              !importedSafeText.includes("nested-pass");
          } catch {
            settingsBackupImportSettingsSanitized = false;
          }
          settingsBackupImportAttachmentDeactivated =
            Number(importedAttachmentRows[0]?.n ?? 0) === 1 &&
            Number(activeAttachmentRows[0]?.n ?? 0) === 0 &&
            Number(importedAnnotationRows[0]?.n ?? 0) === 1 &&
            bodyIncludes("附件记录已标记为待重新挂载");
          settingsBackupImportPersisted =
            Number(importedBackupRows[0]?.n ?? 0) === 1 &&
            Number(importedSnippetRows[0]?.n ?? 0) === 1 &&
            Number(importedSavedSearchRows[0]?.n ?? 0) === 1 &&
            settingsBackupImportAttachmentDeactivated;

          const invalidBackupFile = new File(["{"], "bad-backup.json", {
            type: "application/json"
          });
          const invalidBackupTransfer = new DataTransfer();
          invalidBackupTransfer.items.add(invalidBackupFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: invalidBackupTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入：备份文件不是有效的 JSON。"),
            3_000
          );
          settingsBackupImportRejectsInvalidVisible = bodyIncludes(
            "导入失败，当前库未写入任何备份数据，可重新导入：备份文件不是有效的 JSON。"
          );

          const futureVersionBackupFile = new File(
            [
              JSON.stringify({
                version: 2,
                exportedAt: new Date(now).toISOString(),
                tables: {
                  works: [
                    {
                      id: "smoke-backup-future-version-work",
                      title: "Future Version Backup Work",
                      created_at: now,
                      updated_at: now,
                      deleted_at: null
                    }
                  ]
                }
              })
            ],
            "future-backup.json",
            { type: "application/json" }
          );
          const futureVersionBackupTransfer = new DataTransfer();
          futureVersionBackupTransfer.items.add(futureVersionBackupFile);
          Object.defineProperty(backupImportInput, "files", {
            configurable: true,
            value: futureVersionBackupTransfer.files
          });
          backupImportInput.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(
            () =>
              bodyIncludes("导入失败，当前库未写入任何备份数据，可重新导入") &&
              bodyIncludes("备份文件版本 2 高于当前支持的版本 1") &&
              bodyIncludes("请先升级 AuraScholar 后再导入"),
            3_000
          );
          const futureVersionRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM works WHERE id = ?",
            ["smoke-backup-future-version-work"]
          );
          settingsBackupImportRejectsFutureVersionVisible =
            Number(futureVersionRows[0]?.n ?? 0) === 0 &&
            bodyIncludes("备份文件版本 2 高于当前支持的版本 1") &&
            bodyIncludes("请先升级 AuraScholar 后再导入");

          location.hash = "#/library";
          await waitFor(
            () => location.hash.includes("/library") && bodyIncludes("文献库"),
            3_000
          );
          const backupSearchInput = await waitFor(
            () => document.querySelector('input[placeholder="在结果中搜索"]'),
            3_000
          );
          if (backupSearchInput) {
            setInputValue(backupSearchInput, "Backup Import Smoke Work");
            await waitFor(() => rowText().includes("Backup Import Smoke Work"), 3_000);
          }
          clickRowByTitle("Backup Import Smoke Work");
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(
                "Backup Import Smoke Work"
              ) && bodyIncludes("上传 PDF"),
            3_000
          );
          const backupPdfInput = Array.from(
            document.querySelectorAll('input[type="file"][accept="application/pdf"]')
          )[1];
          if (backupPdfInput) {
            const backupPdfFile = new File(
              [makeSmokePdf("Backup Import Restored PDF")],
              "backup-import-restored.pdf",
              { type: "application/pdf" }
            );
            const backupPdfTransfer = new DataTransfer();
            backupPdfTransfer.items.add(backupPdfFile);
            Object.defineProperty(backupPdfInput, "files", {
              configurable: true,
              value: backupPdfTransfer.files
            });
            backupPdfInput.dispatchEvent(new Event("change", { bubbles: true }));
            await waitFor(
              () =>
                bodyIncludes("已为《Backup Import Smoke Work》上传 PDF") &&
                bodyIncludes("已恢复 1 条备份批注"),
              4_000
          );
          const restoredRows = await window.aura.db.query(
              "SELECT COUNT(*) AS n FROM annotations ann JOIN attachments att ON att.id = ann.attachment_id WHERE ann.id = ? AND ann.attachment_id != ? AND ann.deleted_at IS NULL AND att.work_id = ? AND att.deleted_at IS NULL",
              [backupImportAnnotationId, backupImportAttachmentId, backupImportWorkId]
            );
            settingsBackupImportReattachAnnotationRestored =
              Number(restoredRows[0]?.n ?? 0) === 1;
          }

          location.hash = "#/settings";
          await waitFor(
            () =>
              location.hash.includes("/settings") &&
              bodyIncludes("设置") &&
              bodyIncludes("阅读翻译"),
            4_000
          );
          await waitFor(
            () =>
              !bodyIncludes("正在读取 AI 配置") &&
              !bodyIncludes("正在读取翻译配置") &&
              !bodyIncludes("正在读取同步配置"),
            4_000
          );
        }

        await window.aura?.db?.run?.("DELETE FROM translation_cache");
        await window.aura?.db?.run?.(
          "INSERT OR REPLACE INTO translation_cache (cache_key, engine, target_lang, result, created_at) VALUES (?, ?, ?, ?, ?)",
          ["smoke-translation-cache-clear", "smoke", "zh", "缓存译文", Date.now()]
        );
        const clearTranslationCacheButton = () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "清除翻译缓存" || label === "清除中...";
            }
          );
        clearTranslationCacheButton()?.click();
        const settingsCacheConfirm = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("清除翻译缓存？") ? dialog : null;
        }, 3_000);
        settingsTranslationCacheClearConfirmVisible = Boolean(
          settingsCacheConfirm?.textContent?.includes("重新调用翻译服务")
        );
        const cancelSettingsCacheClear = Array.from(
          settingsCacheConfirm?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "保留缓存");
        cancelSettingsCacheClear?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        settingsTranslationCacheClearCancelled =
          settingsTranslationCacheClearConfirmVisible &&
          bodyIncludes("已取消清除翻译缓存。") &&
          !document.querySelector('[role="dialog"]') &&
          Number(
            await window.aura?.db?.queryScalar?.(
              "SELECT COUNT(*) FROM translation_cache WHERE cache_key = 'smoke-translation-cache-clear'"
            )
          ) === 1;

        clearTranslationCacheButton()?.click();
        const settingsCacheConfirmAgain = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("清除翻译缓存？") ? dialog : null;
        }, 3_000);
        const confirmSettingsCacheClear = Array.from(
          settingsCacheConfirmAgain?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "清除缓存");
        confirmSettingsCacheClear?.click();
        settingsTranslationCacheClearBusyVisible = Boolean(
          await waitFor(() => {
            const button = clearTranslationCacheButton();
            return button?.getAttribute("aria-busy") === "true" &&
              button.disabled &&
              button.textContent?.includes("清除中") &&
              bodyIncludes("正在清除翻译缓存")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(() => bodyIncludes("已清除 1 条翻译缓存。"), 3_000);
        settingsTranslationCacheClearSuccessVisible = bodyIncludes("已清除 1 条翻译缓存。");
        settingsTranslationCacheClearPersisted =
          Number(await window.aura?.db?.queryScalar?.("SELECT COUNT(*) FROM translation_cache")) === 0;

        window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_READ__ =
          "Smoke sentinel initial load failure";
        location.hash = "#/sentinel";
        await waitFor(
          () =>
            location.hash.includes("/sentinel") &&
            bodyIncludes("检索哨兵") &&
            bodyIncludes("检索哨兵暂时不可用") &&
            bodyIncludes("Smoke sentinel initial load failure") &&
            Boolean(document.querySelector('button[aria-label="重试读取检索哨兵"]')) &&
            Boolean(document.querySelector(".sentinel-mode-tabs")),
          4_000
        );
        sentinelLoadRetryAttempts = 1;
        document.querySelector('button[aria-label="重试读取检索哨兵"]')?.click();
        await waitFor(
          () =>
            bodyIncludes(SENTINEL_ERROR_SMOKE.title) &&
            !bodyIncludes("检索哨兵暂时不可用") &&
            !bodyIncludes("Smoke sentinel initial load failure"),
          5_000
        );
        sentinelLoadRetryAttempts += 1;
        sentinelLoadRetryRecoveryVisible =
          sentinelLoadRetryAttempts === 2 &&
          bodyIncludes(SENTINEL_ERROR_SMOKE.title) &&
          !bodyIncludes("检索哨兵暂时不可用") &&
          !bodyIncludes("Smoke sentinel initial load failure");
        sentinelLoadRetryRecoveryDetail =
          "attempts=" +
          sentinelLoadRetryAttempts +
          "; task=" +
          bodyIncludes(SENTINEL_ERROR_SMOKE.title) +
          "; error=" +
          bodyIncludes("检索哨兵暂时不可用");
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_READ__;
        const sentinelRaceTitle = "Smoke Sentinel Race Newer Refresh Wins";
        const sentinelRaceNow = Date.now();
        window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_DELAY_MS__ = 450;
        window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_COUNT__ = 0;
        window.dispatchEvent(new Event("aurascholar:sentinel-updated"));
        await waitFor(
          () => Number(window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_COUNT__ ?? 0) >= 1,
          1_000
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO sentinel_tasks (id, work_id, doi, title, current_state, target_flags, poll_interval_s, next_poll_at, last_polled_at, error_count, status, created_at, updated_at, deleted_at) VALUES (?, NULL, ?, ?, 'accepted', NULL, 86400, ?, NULL, 0, 'active', ?, ?, NULL)",
          [
            "smoke-sentinel-refresh-race",
            "10.4242/aurascholar.sentinel-refresh-race",
            sentinelRaceTitle,
            sentinelRaceNow + 86_400_000,
            sentinelRaceNow,
            sentinelRaceNow
          ]
        );
        window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_DELAY_MS__ = 0;
        window.dispatchEvent(new Event("aurascholar:sentinel-updated"));
        await waitFor(() => bodyIncludes(sentinelRaceTitle), 2_000);
        await wait(650);
        sentinelRefreshRacePreserved =
          bodyIncludes(sentinelRaceTitle) &&
          bodyIncludes(SENTINEL_ERROR_SMOKE.title) &&
          !bodyIncludes("读取哨兵任务");
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_DELAY_MS__;
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_AFTER_READ_COUNT__;

        const sentinelTitleViewButton = Array.from(
          document.querySelectorAll(".sentinel-view-tabs button")
        ).find((button) => button.textContent?.includes("找 DOI"));
        sentinelTitleViewButton?.click();
        await waitFor(
          () =>
            bodyIncludes("当前视图没有任务") &&
            Boolean(document.querySelector('button[aria-label="查看全部哨兵任务"]')),
          1_000
        );
        document.querySelector('button[aria-label="查看全部哨兵任务"]')?.click();
        sentinelFilterEmptyActionRestoresResults = Boolean(
          await waitFor(
            () => {
              const allViewButton = Array.from(
                document.querySelectorAll(".sentinel-view-tabs button")
              ).find((button) => button.textContent?.includes("全部"));
              return (
                bodyIncludes(sentinelRaceTitle) &&
                !bodyIncludes("当前视图没有任务") &&
                allViewButton?.classList.contains("sentinel-view-tab--active") &&
                document.activeElement === allViewButton
              );
            },
            1_000
          )
        );

        sentinelLastErrorVisible =
          bodyIncludes(SENTINEL_ERROR_SMOKE.title) &&
          bodyIncludes("最近失败") &&
          bodyIncludes(SENTINEL_ERROR_SMOKE.error);
        const sentinelManualFailureCard = Array.from(
          document.querySelectorAll(".sentinel-task-card")
        ).find((card) => card.textContent?.includes(SENTINEL_MANUAL_FAILURE_SMOKE.title));
        const sentinelManualFailureButton = sentinelManualFailureCard
          ? Array.from(sentinelManualFailureCard.querySelectorAll("button")).find(
              (button) => button.textContent?.replace(/\s+/g, " ").trim() === "单独检查"
            )
          : null;
        sentinelManualFailureButton?.click();
        sentinelTaskCheckBusyVisible = Boolean(
          await waitFor(() => {
            const card = Array.from(document.querySelectorAll(".sentinel-task-card")).find((item) =>
              item.textContent?.includes(SENTINEL_MANUAL_FAILURE_SMOKE.title)
            );
            const busyButton = Array.from(card?.querySelectorAll("button") ?? []).find(
              (button) => button.getAttribute("aria-busy") === "true"
            );
            return card?.getAttribute("aria-busy") === "true" &&
              busyButton?.disabled &&
              busyButton.textContent?.includes("检查中") &&
              bodyIncludes("正在检查该监控")
              ? busyButton
              : null;
          }, 1_000)
        );
        sentinelManualFailureVisible = Boolean(
          await waitFor(
            () =>
              bodyIncludes("单篇检查失败") &&
              bodyIncludes(SENTINEL_MANUAL_FAILURE_SMOKE.title) &&
              bodyIncludes(SENTINEL_MANUAL_FAILURE_SMOKE.errorFragment),
            2_000
          )
        );
        const sentinelManualFailureRows = await window.aura.db.query(
          "SELECT error_count, last_error FROM sentinel_tasks WHERE id = ?",
          [SENTINEL_MANUAL_FAILURE_SMOKE.id]
        );
        sentinelManualFailureRecorded =
          Number(sentinelManualFailureRows[0]?.error_count ?? 0) > 0 &&
          String(sentinelManualFailureRows[0]?.last_error ?? "").includes(
            SENTINEL_MANUAL_FAILURE_SMOKE.errorFragment
          );
        const sentinelTitleTab = Array.from(
          document.querySelectorAll(".sentinel-mode-tabs button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "标题");
        sentinelTitleTab?.click();
        const sentinelTitleInput = await waitFor(
          () => document.querySelector('input[placeholder="论文标题"]'),
          1_000
        );
        if (sentinelTitleInput) {
          setInputValue(sentinelTitleInput, "Composition Sentinel Title");
          dispatchComposingEnter(sentinelTitleInput);
          await wait(250);
          sentinelAddCompositionIgnored =
            !bodyIncludes("已添加标题监控") &&
            !bodyIncludes("创建监控失败") &&
            !bodyIncludes("处理中");
        }
        const sentinelDoiTab = Array.from(
          document.querySelectorAll(".sentinel-mode-tabs button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "DOI");
        sentinelDoiTab?.click();
        const sentinelDoiInput = await waitFor(
          () => document.querySelector('input[placeholder^="DOI"]'),
          1_000
        );
        if (sentinelDoiInput) {
          setInputValue(sentinelDoiInput, SENTINEL_DUPLICATE_SMOKE.doi);
          const sentinelAddButton = findExactButton("开始监控");
          sentinelAddButton?.click();
          sentinelAddBusyVisible = Boolean(
            await waitFor(() => {
              const busyButton = Array.from(document.querySelectorAll("button")).find(
                (button) =>
                  button.getAttribute("aria-busy") === "true" &&
                  button.textContent?.includes("创建中")
              );
              return busyButton?.disabled &&
                sentinelDoiInput.disabled &&
                bodyIncludes("正在创建监控")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(() => bodyIncludes("监控已存在"), 2_000);
          const sentinelDuplicateRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM sentinel_tasks WHERE doi = ? AND deleted_at IS NULL",
            [SENTINEL_DUPLICATE_SMOKE.doi]
          );
          sentinelDuplicateDoiCount = Number(sentinelDuplicateRows[0]?.n ?? 0);
          sentinelDuplicateDoiMessageVisible = bodyIncludes("监控已存在");
          sentinelDuplicateDoiBlocked =
            sentinelDuplicateDoiMessageVisible && sentinelDuplicateDoiCount === 1;

          setInputValue(sentinelDoiInput, SENTINEL_RESTORE_SMOKE.doi);
          findExactButton("开始监控")?.click();
          await waitFor(() => bodyIncludes("已恢复监控"), 2_000);
          const sentinelRestoreRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n, COALESCE(MAX(CASE WHEN deleted_at IS NULL AND status = 'active' THEN 1 ELSE 0 END), 0) AS active FROM sentinel_tasks WHERE doi = ?",
            [SENTINEL_RESTORE_SMOKE.doi]
          );
          sentinelDeletedDoiRestoredCount = Number(sentinelRestoreRows[0]?.n ?? 0);
          sentinelDeletedDoiRestored =
            bodyIncludes("已恢复监控") &&
            sentinelDeletedDoiRestoredCount === 1 &&
            Number(sentinelRestoreRows[0]?.active ?? 0) === 1;
        }

        const findSentinelDeleteUndoCard = () =>
          Array.from(document.querySelectorAll(".sentinel-task-card")).find((card) =>
            card.textContent?.includes(SENTINEL_DELETE_UNDO_SMOKE.title)
          );
        const findSentinelDeleteUndoDeleteButton = () =>
          Array.from(findSentinelDeleteUndoCard()?.querySelectorAll("button") ?? []).find(
            (button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "删除" || Boolean(label?.includes("删除中"));
            }
          );
        const clickConfirmSentinelDelete = async () => {
          const dialog = await waitFor(() => {
            const candidate = document.querySelector('[role="dialog"]');
            return candidate?.textContent?.includes("删除哨兵监控？") ? candidate : null;
          }, 3_000);
          const confirmButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除监控"
          );
          confirmButton?.click();
        };

        const sentinelDeleteRowsBeforeFailure = await window.aura.db.query(
          "SELECT COUNT(*) AS n, COALESCE(MAX(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS active FROM sentinel_tasks WHERE id = ?",
          [SENTINEL_DELETE_UNDO_SMOKE.id]
        );
        findSentinelDeleteUndoDeleteButton()?.click();
        await waitFor(() => document.querySelector('[role="dialog"]')?.textContent?.includes("删除哨兵监控？"), 3_000);
        window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_DELETE__ =
          SENTINEL_DELETE_FAILURE_SMOKE.error;
        await clickConfirmSentinelDelete();
        sentinelDeleteFailureBusyVisible = Boolean(
          await waitFor(() => {
            const button = findSentinelDeleteUndoDeleteButton();
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("删除中") &&
              bodyIncludes("正在删除监控任务")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("删除监控失败，监控任务仍保留，可重新删除") &&
            bodyIncludes(SENTINEL_DELETE_FAILURE_SMOKE.error),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_DELETE__;
        const sentinelDeleteRowsAfterFailure = await window.aura.db.query(
          "SELECT COUNT(*) AS n, COALESCE(MAX(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0) AS active FROM sentinel_tasks WHERE id = ?",
          [SENTINEL_DELETE_UNDO_SMOKE.id]
        );
        const sentinelDeleteUndoButtonAfterFailure = findSentinelDeleteUndoDeleteButton();
        sentinelDeleteFailureVisible =
          bodyIncludes("删除监控失败，监控任务仍保留，可重新删除") &&
          bodyIncludes(SENTINEL_DELETE_FAILURE_SMOKE.error);
        sentinelDeleteFailureDidNotPersist =
          Number(sentinelDeleteRowsBeforeFailure[0]?.n ?? 0) === 1 &&
          Number(sentinelDeleteRowsBeforeFailure[0]?.active ?? 0) === 1 &&
          Number(sentinelDeleteRowsAfterFailure[0]?.n ?? 0) === 1 &&
          Number(sentinelDeleteRowsAfterFailure[0]?.active ?? 0) === 1;
        sentinelDeleteFailurePreserved =
          Boolean(findSentinelDeleteUndoCard()) &&
          Boolean(sentinelDeleteUndoButtonAfterFailure) &&
          !sentinelDeleteUndoButtonAfterFailure?.disabled &&
          !document.querySelector('button[aria-label="撤销删除监控任务"]');

        sentinelDeleteUndoButtonAfterFailure?.click();
        await clickConfirmSentinelDelete();
        await waitFor(
          () => {
            const button = findSentinelDeleteUndoDeleteButton();
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("删除中") &&
              bodyIncludes("正在删除监控任务")
              ? button
              : null;
          },
          1_000
        );
        await waitFor(
          () =>
            bodyIncludes("已删除监控任务") &&
            !Array.from(document.querySelectorAll(".sentinel-task-card")).some((card) =>
              card.textContent?.includes(SENTINEL_DELETE_UNDO_SMOKE.title)
            ) &&
            Boolean(document.querySelector('button[aria-label="撤销删除监控任务"]')),
          3_000
        );
        const sentinelDeleteUndoAction = document.querySelector(
          'button[aria-label="撤销删除监控任务"]'
        );
        sentinelDeleteUndoVisible = Boolean(sentinelDeleteUndoAction);
        window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_RESTORE__ =
          SENTINEL_RESTORE_FAILURE_SMOKE.error;
        sentinelDeleteUndoAction?.click();
        sentinelDeleteUndoFailureBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除监控任务"]');
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除监控任务")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("撤销删除监控失败，撤销入口仍保留，可重新撤销") &&
            bodyIncludes(SENTINEL_RESTORE_FAILURE_SMOKE.error),
          3_000
        );
        delete window.__AURASCHOLAR_SMOKE_SENTINEL_FAIL_NEXT_RESTORE__;
        const sentinelDeleteUndoRowsAfterFailure = await window.aura.db.query(
          "SELECT deleted_at, status FROM sentinel_tasks WHERE id = ? LIMIT 1",
          [SENTINEL_DELETE_UNDO_SMOKE.id]
        );
        const sentinelDeleteUndoActionAfterFailure = document.querySelector(
          'button[aria-label="撤销删除监控任务"]'
        );
        sentinelDeleteUndoFailureVisible =
          bodyIncludes("撤销删除监控失败，撤销入口仍保留，可重新撤销") &&
          bodyIncludes(SENTINEL_RESTORE_FAILURE_SMOKE.error);
        sentinelDeleteUndoFailureDidNotPersist =
          sentinelDeleteUndoRowsAfterFailure[0]?.deleted_at != null;
        sentinelDeleteUndoFailurePreserved =
          Boolean(sentinelDeleteUndoActionAfterFailure) &&
          !sentinelDeleteUndoActionAfterFailure?.disabled &&
          !findSentinelDeleteUndoCard();
        sentinelDeleteUndoActionAfterFailure?.click();
        sentinelDeleteUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销删除监控任务"]');
            return button?.disabled &&
              button.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销删除监控任务")
              ? button
              : null;
          }, 1_000)
        );
        await waitFor(
          () =>
            bodyIncludes("已撤销删除监控任务") &&
            Array.from(document.querySelectorAll(".sentinel-task-card")).some((card) =>
              card.textContent?.includes(SENTINEL_DELETE_UNDO_SMOKE.title)
            ),
          3_000
        );
        const sentinelDeleteUndoRows = await window.aura.db.query(
          "SELECT deleted_at, status FROM sentinel_tasks WHERE id = ? LIMIT 1",
          [SENTINEL_DELETE_UNDO_SMOKE.id]
        );
        sentinelDeleteUndoRestored =
          sentinelDeleteUndoVisible &&
          sentinelDeleteUndoBusyVisible &&
          bodyIncludes("已撤销删除监控任务") &&
          sentinelDeleteUndoRows[0]?.deleted_at == null &&
          sentinelDeleteUndoRows[0]?.status === "active";

        const graphEmptyLatestNow = Date.now();
        await window.aura.db.run("UPDATE works SET created_at = ?, updated_at = ? WHERE id = ?", [
          graphEmptyLatestNow,
          graphEmptyLatestNow,
          SAMPLE.workId
        ]);
        location.hash = "#/graph";
        await waitFor(
          () =>
            location.hash === "#/graph" &&
            bodyIncludes("引文脉络") &&
            bodyIncludes("生成最近文献图谱") &&
            bodyIncludes(SAMPLE.title),
          5_000
        );
        const graphEmptyLatestButton = findExactButton("生成最近文献图谱");
        graphEmptyLatestCtaVisible =
          Boolean(graphEmptyLatestButton) &&
          bodyIncludes("最近可构建") &&
          bodyIncludes(SAMPLE.title);
        graphEmptyLatestButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/graph?doi=" + encodeURIComponent(SAMPLE.doi)) &&
            bodyIncludes("引文脉络") &&
            Boolean(document.querySelector(".citation-graph-node")),
          5_000
        );
        graphEmptyLatestCtaHash = location.hash;
        graphEmptyLatestCtaOpened =
          graphEmptyLatestCtaHash.includes("/graph?doi=" + encodeURIComponent(SAMPLE.doi)) &&
          Boolean(document.querySelector(".citation-graph-node"));

        location.hash = "#/graph?doi=" + encodeURIComponent(GRAPH_SMOKE.retryDoi);
        await waitFor(
          () =>
            location.hash.includes("/graph") &&
            bodyIncludes("暂时无法构建图谱") &&
            bodyIncludes("OpenAlex 中找不到这篇论文") &&
            Boolean(findExactButton("重试构建")),
          3_000
        );
        findExactButton("重试构建")?.click();
        await waitFor(
          () =>
            bodyIncludes(GRAPH_SMOKE.retryTitle) &&
            Boolean(document.querySelector(".citation-graph-node")) &&
            !bodyIncludes("暂时无法构建图谱"),
          3_000
        );
        graphRetryRecoveryVisible =
          graphRetryAttempts === 2 &&
          bodyIncludes(GRAPH_SMOKE.retryTitle) &&
          Boolean(document.querySelector(".citation-graph-node")) &&
          !bodyIncludes("暂时无法构建图谱");

        location.hash = "#/graph?doi=" + encodeURIComponent(GRAPH_SMOKE.centerDoi);
        await waitFor(
          () =>
            location.hash.includes("/graph") &&
            bodyIncludes("引文脉络") &&
            bodyIncludes(GRAPH_SMOKE.centerTitle) &&
            Boolean(document.querySelector(".citation-graph-node")),
          5_000
        );
        graphCachedVisible =
          bodyIncludes(GRAPH_SMOKE.centerTitle) &&
          bodyIncludes("思想来源") &&
          Boolean(document.querySelector('[aria-label*="' + GRAPH_SMOKE.referenceTitle + '"]'));
        const graphDoiInput = document.querySelector('input[aria-label="图谱中心论文 DOI"]');
        if (graphDoiInput) {
          setInputValue(graphDoiInput, "10.4242/aurascholar.graph-ime");
          dispatchComposingEnter(graphDoiInput);
          await wait(200);
          graphInputCompositionIgnored =
            location.hash === "#/graph?doi=" + encodeURIComponent(GRAPH_SMOKE.centerDoi) &&
            bodyIncludes(GRAPH_SMOKE.centerTitle) &&
            !bodyIncludes("graph-ime");
        }
        const graphReferenceNode = document.querySelector(
          '[aria-label*="' + GRAPH_SMOKE.referenceTitle + '"]'
        );
        graphReferenceNode?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
        );
        await waitFor(
          () => bodyIncludes(GRAPH_SMOKE.referenceTitle) && Boolean(findExactButton("加入文献库")),
          1_500
        );
        graphNodeKeyboardSelectable =
          graphCachedVisible &&
          bodyIncludes(GRAPH_SMOKE.referenceTitle) &&
          Boolean(findExactButton("加入文献库"));
        window.__AURASCHOLAR_SMOKE_INGEST_FROM_INPUT__ = async (input) => {
          if (input === GRAPH_SMOKE.referenceDoi) return null;
          return undefined;
        };
        const graphImportButton = findExactButton("加入文献库");
        graphImportButton?.click();
        await waitFor(
          () =>
            graphImportButton?.disabled &&
            graphImportButton.getAttribute("aria-busy") === "true" &&
            graphImportButton.textContent?.includes("入库中") &&
            bodyIncludes("正在将《" + GRAPH_SMOKE.referenceTitle + "》加入文献库") &&
            Boolean(findExactButton("以此为中心展开")?.disabled),
          1_000
        );
        graphImportBusyVisible =
          Boolean(graphImportButton?.disabled) &&
          graphImportButton?.getAttribute("aria-busy") === "true" &&
          Boolean(graphImportButton?.textContent?.includes("入库中")) &&
          bodyIncludes("正在将《" + GRAPH_SMOKE.referenceTitle + "》加入文献库") &&
          Boolean(findExactButton("以此为中心展开")?.disabled);
        await waitFor(() => bodyIncludes("没有解析出可入库文献"), 3_000);
        graphImportFailureFeedbackVisible = bodyIncludes("没有解析出可入库文献");
        const graphLibraryCountBefore =
          statusbarMetric("文献") ??
          Number(await window.aura?.db?.queryScalar?.("SELECT COUNT(*) FROM works WHERE deleted_at IS NULL"));
        window.__AURASCHOLAR_SMOKE_INGEST_FROM_INPUT__ = async (input) => {
          if (input === GRAPH_SMOKE.referenceDoi) return null;
          if (input !== GRAPH_SMOKE.successDoi) return undefined;
          const now = Date.now();
          await window.aura.db.run(
            "INSERT OR REPLACE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              "smoke-work-graph-import-success",
              GRAPH_SMOKE.successDoi,
              GRAPH_SMOKE.successTitle,
              "A deterministic smoke-test paper for validating graph import success refresh handling.",
              2025,
              "Smoke Import Journal",
              "article",
              "unread",
              0,
              now,
              now
            ]
          );
          return {
            workId: "smoke-work-graph-import-success",
            deduped: false,
            title: GRAPH_SMOKE.successTitle,
            pdfFetched: false
          };
        };
        const graphSuccessNode = document.querySelector(
          '[aria-label*="' + GRAPH_SMOKE.successTitle + '"]'
        );
        graphSuccessNode?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
        );
        await waitFor(
          () => bodyIncludes(GRAPH_SMOKE.successTitle) && Boolean(findExactButton("加入文献库")),
          1_500
        );
        const graphSuccessImportButton = findExactButton("加入文献库");
        graphSuccessImportButton?.click();
        await waitFor(
          () =>
            bodyIncludes("已加入文献库：《" + GRAPH_SMOKE.successTitle + "》。") &&
            statusbarMetric("文献") === graphLibraryCountBefore + 1,
          3_000
        );
        graphImportSuccessVisible = bodyIncludes(
          "已加入文献库：《" + GRAPH_SMOKE.successTitle + "》。"
        );
        graphImportSuccessStatsUpdated =
          graphImportSuccessVisible && statusbarMetric("文献") === graphLibraryCountBefore + 1;
        delete window.__AURASCHOLAR_SMOKE_INGEST_FROM_INPUT__;
        if (graphDoiInput) {
          window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_DELAY_MS__ = 450;
          window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_COUNT__ = 0;
          setInputValue(graphDoiInput, GRAPH_SMOKE.raceOldDoi);
          findExactButton("生成图谱")?.click();
          await waitFor(
            () => Number(window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_COUNT__ ?? 0) >= 1,
            1_000
          );
          window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_DELAY_MS__ = 0;
          setInputValue(graphDoiInput, GRAPH_SMOKE.raceNewDoi);
          findExactButton("生成图谱")?.click();
          await waitFor(() => bodyIncludes(GRAPH_SMOKE.raceNewTitle), 2_000);
          await wait(650);
          graphLoadRacePreserved =
            bodyIncludes(GRAPH_SMOKE.raceNewTitle) &&
            !bodyIncludes(GRAPH_SMOKE.raceOldTitle) &&
            !bodyIncludes("暂时无法构建图谱");
          delete window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_DELAY_MS__;
          delete window.__AURASCHOLAR_SMOKE_GRAPH_AFTER_LAYOUT_COUNT__;
        }
        location.hash = "#/graph?doi=" + encodeURIComponent(GRAPH_SMOKE.deepLinkDoi);
        await waitFor(
          () =>
            location.hash.includes("/graph") &&
            bodyIncludes(GRAPH_SMOKE.deepLinkTitle) &&
            Boolean(document.querySelector(".citation-graph-node")),
          2_000
        );
        const graphDeepLinkInput = document.querySelector('input[aria-label="图谱中心论文 DOI"]');
        graphDeepLinkParamSyncVisible =
          bodyIncludes(GRAPH_SMOKE.deepLinkTitle) &&
          graphDeepLinkInput?.value === GRAPH_SMOKE.deepLinkDoi &&
          !bodyIncludes(GRAPH_SMOKE.raceNewTitle) &&
          !bodyIncludes("暂时无法构建图谱");

        window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_READ__ =
          "Smoke homepage library read failure";
        location.hash = "#/homepage";
        await waitFor(
          () =>
            location.hash.includes("/homepage") &&
            bodyIncludes("学术主页") &&
            bodyIncludes("展示成果"),
          4_000
        );
        const homepageLibraryRetryPanel = () =>
          document.querySelector(".homepage-card--publications")?.textContent ?? "";
        const homepageLibraryRetryButton = await waitFor(
          () => document.querySelector('button[aria-label="重试读取主页文献库"]'),
          3_000
        );
        const homepageLibraryReadRetryErrorVisible =
          homepageLibraryRetryPanel().includes("文献库暂时不可用") &&
          homepageLibraryRetryPanel().includes("Smoke homepage library read failure");
        homepageLibraryRetryButton?.click();
        homepageLibraryReadRetryRecoveryVisible =
          homepageLibraryReadRetryErrorVisible &&
          Boolean(
            await waitFor(
              () =>
                Boolean(document.querySelector(".homepage-publication-row")) &&
                !homepageLibraryRetryPanel().includes("文献库暂时不可用") &&
                !homepageLibraryRetryPanel().includes("Smoke homepage library read failure"),
              5_000
            )
          );
        homepageLibraryReadRetryRecoveryDetail = [
          "error=" + homepageLibraryReadRetryErrorVisible,
          "button=" + Boolean(homepageLibraryRetryButton),
          "row=" + Boolean(document.querySelector(".homepage-publication-row")),
          "errorText=" + homepageLibraryRetryPanel().includes("文献库暂时不可用"),
        ].join("; ");
        delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_READ__;
        await waitFor(() => !bodyIncludes("正在读取文献库..."), 5_000);
        const homepageRaceTitle = "Smoke Homepage Race Newer Library Work";
        const homepageRaceNow = Date.now();
        window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_DELAY_MS__ = 450;
        window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_COUNT__ = 0;
        window.dispatchEvent(new Event("aurascholar:library-updated"));
        await waitFor(
          () => Number(window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_COUNT__ ?? 0) >= 1,
          1_000
        );
        await window.aura.db.run(
          "INSERT OR REPLACE INTO works (id, doi, title, abstract, year, venue_name, type, reading_status, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            "smoke-homepage-refresh-race",
            "10.4242/aurascholar.homepage-refresh-race",
            homepageRaceTitle,
            "A deterministic smoke-test paper for validating homepage library refresh race handling.",
            2027,
            "Journal of Homepage UX",
            "article",
            "unread",
            1,
            homepageRaceNow + 1,
            homepageRaceNow + 1
          ]
        );
        window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_DELAY_MS__ = 0;
        window.dispatchEvent(new Event("aurascholar:library-updated"));
        await waitFor(() => bodyIncludes(homepageRaceTitle), 2_000);
        await wait(650);
        homepageLibraryRefreshRacePreserved =
          bodyIncludes(homepageRaceTitle) &&
          bodyIncludes("展示成果") &&
          !bodyIncludes("正在读取文献库...");
        delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_DELAY_MS__;
        delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_COUNT__;
        const homepageInputByLabel = (label) =>
          Array.from(document.querySelectorAll(".homepage-field")).find((field) =>
            field.textContent?.includes(label)
          )?.querySelector("input, textarea");
        const homepageStoredProfile = () => {
          try {
            const stored = JSON.parse(localStorage.getItem("homepage-profile") ?? "{}");
            return stored && typeof stored === "object" ? stored : {};
          } catch {
            return {};
          }
        };
        const homepagePreviewSource = () => {
          const frame = document.querySelector('iframe[title="主页实时预览"]');
          return (
            frame?.getAttribute("srcdoc") ||
            frame?.srcdoc ||
            frame?.contentDocument?.documentElement?.outerHTML ||
            ""
          );
        };
        const homepageNameInput = homepageInputByLabel("姓名");
        if (homepageNameInput) {
          const homepageProfileSaveFailureName = "Smoke Homepage Save Failure " + Date.now();
          setInputValue(homepageNameInput, "");
          await waitFor(
            () => homepageNameInput.value === "" && homepageStoredProfile().displayName === "",
            2_000
          );
          window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__ =
            "Smoke homepage profile save failure";
          window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_PROFILE_SAVE_COUNT__ = 2;
          setInputValue(homepageNameInput, homepageProfileSaveFailureName);
          homepageProfileSaveFailureVisible = Boolean(
            await waitFor(
              () =>
                bodyIncludes("主页草稿保存失败，当前页面已更新但刷新后可能丢失") &&
                bodyIncludes("Smoke homepage profile save failure") &&
                document.querySelector(".homepage-status.inline-notice--danger") &&
                document.querySelector('button[aria-label="重试保存主页草稿"]'),
              2_000
            )
          );
          const homepageProfileRetryButton = document.querySelector(
            'button[aria-label="重试保存主页草稿"]'
          );
          homepageProfileSaveFailureRetryVisible = Boolean(homepageProfileRetryButton);
          homepageProfileSaveFailureDidNotPersist =
            homepageStoredProfile().displayName !== homepageProfileSaveFailureName;
          homepageProfileSaveFailurePreserved =
            homepageNameInput.value === homepageProfileSaveFailureName &&
            homepagePreviewSource().includes(homepageProfileSaveFailureName);
          delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_PROFILE_SAVE_COUNT__;
          delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__;
          homepageProfileRetryButton?.click();
          homepageProfileSaveFailureBusyVisible = Boolean(
            await waitFor(() => {
              const button = document.querySelector('button[aria-label="重试保存主页草稿"]');
              return button?.getAttribute("aria-busy") === "true" &&
                button.textContent?.includes("保存中") &&
                bodyIncludes("正在保存主页草稿") &&
                document.querySelector(".homepage-status.inline-notice--busy")
                ? button
                : null;
            }, 1_000)
          );
          homepageProfileSaveFailureRetryPersisted = Boolean(
            await waitFor(
              () =>
                bodyIncludes("主页草稿已保存。") &&
                homepageStoredProfile().displayName === homepageProfileSaveFailureName,
              2_000
            )
          );
        }
        const homepageScholarInput = homepageInputByLabel("Google Scholar");
        const homepageGithubInput = homepageInputByLabel("GitHub");
        if (homepageScholarInput && homepageGithubInput) {
          setInputValue(homepageScholarInput, "javascript:alert('homepage-smoke')");
          setInputValue(homepageGithubInput, "github.com/aurascholar/aurascholar");
          await waitFor(
            () => homepagePreviewSource().includes("https://github.com/aurascholar/aurascholar"),
            2_000
          );
          const homepagePreviewHtml = homepagePreviewSource();
          homepageSafeLinkRelHardened = homepagePreviewHtml.includes(
            'href="https://github.com/aurascholar/aurascholar" target="_blank" rel="noopener noreferrer"'
          );
          homepageExternalLinkSafetyOk =
            homepageSafeLinkRelHardened &&
            !homepagePreviewHtml.includes("javascript:") &&
            !homepagePreviewHtml.includes("homepage-smoke") &&
            !homepagePreviewHtml.includes("Google Scholar");
        }
        const homepagePublicationPanel = () =>
          document.querySelector(".homepage-card--publications")?.textContent ?? "";
        const homepagePublicationSearchInput = document.querySelector(
          'input[aria-label="搜索可展示成果"]'
        );
        homepagePublicationFilterActionDetail = "input=" + Boolean(homepagePublicationSearchInput);
        if (homepagePublicationSearchInput) {
          setInputValue(homepagePublicationSearchInput, "NoMatchingHomepagePublication");
          await waitFor(() => homepagePublicationPanel().includes("没有匹配的成果"), 1_500);
          const homepagePublicationClearButton = document.querySelector(
            'button[aria-label="清空主页成果筛选"]'
          );
          homepagePublicationClearButton?.click();
          homepagePublicationFilterActionRestored = Boolean(
            await waitFor(
              () =>
                homepagePublicationSearchInput.value === "" &&
                document.activeElement === homepagePublicationSearchInput &&
                Boolean(document.querySelector(".homepage-publication-row")) &&
                !homepagePublicationPanel().includes("没有匹配的成果"),
              1_500
            )
          );
          homepagePublicationFilterActionDetail = [
            "button=" + Boolean(homepagePublicationClearButton),
            "value=" + homepagePublicationSearchInput.value,
            "focused=" + (document.activeElement === homepagePublicationSearchInput),
            "row=" + Boolean(document.querySelector(".homepage-publication-row")),
            "empty=" + homepagePublicationPanel().includes("没有匹配的成果"),
          ].join("; ");
        }
        const homepageFeaturedButton = Array.from(
          document.querySelectorAll(".homepage-card--publications button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "精选成果");
        const firstHomepageWorkCheckbox = await waitFor(
          () => document.querySelector('.homepage-publication-row input[type="checkbox"]'),
          3_000
        );
        firstHomepageWorkCheckbox?.click();
        await waitFor(() => homepagePublicationPanel().includes("1 已选"), 2_000);
        const homepageManualSelectionText = homepagePublicationPanel();
        homepageFeaturedButton?.click();
        const homepageFeaturedDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("用精选成果覆盖当前选择？") ? dialog : null;
        }, 3_000);
        homepageFeaturedOverwriteConfirmVisible = Boolean(
          homepageFeaturedDialog?.textContent?.includes("主页草稿会自动保存")
        );
        const keepManualSelection = Array.from(
          homepageFeaturedDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续手动选择");
        keepManualSelection?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        homepageFeaturedOverwriteCancelPreserved =
          homepageFeaturedOverwriteConfirmVisible &&
          homepagePublicationPanel() === homepageManualSelectionText &&
          bodyIncludes("已保留手动选择的主页成果。");
        await waitFor(
          () =>
            homepagePublicationPanel().includes("已选") &&
            !homepagePublicationPanel().includes("0 已选"),
          2_000
        );
        const homepageSelectedBeforeClear = homepagePublicationPanel();
        const homepageClearButton = Array.from(
          document.querySelectorAll(".homepage-card--publications button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "清空");
        const homepageStoredSelectedWorkIds = () => {
          try {
            const stored = JSON.parse(localStorage.getItem("homepage-profile") ?? "{}");
            return Array.isArray(stored.selectedWorkIds) ? stored.selectedWorkIds : [];
          } catch {
            return [];
          }
        };
        homepageClearButton?.click();
        const homepageClearDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("清空主页成果列表？") ? dialog : null;
        }, 3_000);
        homepageClearSelectedConfirmVisible = Boolean(
          homepageClearDialog?.textContent?.includes("主页草稿会自动保存")
        );
        const keepHomepageSelection = Array.from(
          homepageClearDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "继续保留");
        keepHomepageSelection?.click();
        await waitFor(() => !document.querySelector('[role="dialog"]'), 1_000);
        homepageClearSelectedCancelPreserved =
          homepageClearSelectedConfirmVisible &&
          homepagePublicationPanel() === homepageSelectedBeforeClear &&
          bodyIncludes("已保留主页成果列表。");
        const homepageSelectedIdsBeforeClear = homepageStoredSelectedWorkIds();
        homepageClearButton?.click();
        const homepageClearUndoDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("清空主页成果列表？") ? dialog : null;
        }, 3_000);
        const clearHomepageSelection = Array.from(
          homepageClearUndoDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "清空列表");
        clearHomepageSelection?.click();
        const homepageUndoButton = await waitFor(
          () => document.querySelector('button[aria-label="撤销主页成果修改"]'),
          2_000
        );
        const homepageClearedSelectionVisible = Boolean(
          homepageUndoButton &&
            bodyIncludes("已清空主页成果列表。") &&
            homepagePublicationPanel().includes("0 已选")
        );
        window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__ =
          "Smoke homepage profile save failure";
        homepageUndoButton?.click();
        homepageClearSelectedUndoFailureBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销主页成果修改"]');
            return button?.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销主页成果修改")
              ? button
              : null;
          }, 1_000)
        );
        homepageClearSelectedUndoFailureVisible = Boolean(
          await waitFor(
            () =>
              bodyIncludes("撤销主页成果修改失败，当前页面已恢复但草稿保存失败") &&
              bodyIncludes("Smoke homepage profile save failure") &&
              document.querySelector('button[aria-label="撤销主页成果修改"]'),
            2_000
          )
        );
        homepageClearSelectedUndoFailureDidNotPersist =
          homepageStoredSelectedWorkIds().length === 0;
        homepageClearSelectedUndoFailurePreserved = Boolean(
          homepageClearSelectedUndoFailureVisible &&
            homepagePublicationPanel() === homepageSelectedBeforeClear &&
            document.querySelector('button[aria-label="撤销主页成果修改"]')
        );
        delete window.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__;
        const homepageUndoRetryButton = document.querySelector(
          'button[aria-label="撤销主页成果修改"]'
        );
        homepageUndoRetryButton?.click();
        const homepageUndoBusyVisible = Boolean(
          await waitFor(() => {
            const button = document.querySelector('button[aria-label="撤销主页成果修改"]');
            return button?.getAttribute("aria-busy") === "true" &&
              button.textContent?.includes("撤销中") &&
              bodyIncludes("正在撤销主页成果修改")
              ? button
              : null;
          }, 1_000)
        );
        homepageClearSelectedUndoRecovered = Boolean(
          homepageClearedSelectionVisible &&
            homepageUndoBusyVisible &&
            (await waitFor(
              () =>
                homepagePublicationPanel() === homepageSelectedBeforeClear &&
                bodyIncludes("已撤销主页成果修改。"),
              2_000
            ))
        );
        homepageClearSelectedUndoRetryPersisted =
          homepageStoredSelectedWorkIds().length === homepageSelectedIdsBeforeClear.length &&
          homepageSelectedIdsBeforeClear.every((id) => homepageStoredSelectedWorkIds().includes(id));
        homepageClearSelectedUndoDetail = [
          "cleared=" + homepageClearedSelectionVisible,
          "busy=" + homepageUndoBusyVisible,
          "failureVisible=" + homepageClearSelectedUndoFailureVisible,
          "failureBusy=" + homepageClearSelectedUndoFailureBusyVisible,
          "failurePreserved=" + homepageClearSelectedUndoFailurePreserved,
          "failureNotPersisted=" + homepageClearSelectedUndoFailureDidNotPersist,
          "restored=" + (homepagePublicationPanel() === homepageSelectedBeforeClear),
          "retryPersisted=" + homepageClearSelectedUndoRetryPersisted,
          "success=" + bodyIncludes("已撤销主页成果修改。"),
        ].join("; ");
        const homepageExportButton = Array.from(document.querySelectorAll(".homepage-publish-actions button")).find(
          (button) => button.textContent?.replace(/\s+/g, " ").trim() === "导出 HTML"
        );
        const homepageCopyButton = Array.from(document.querySelectorAll(".homepage-publish-actions button")).find(
          (button) => button.textContent?.replace(/\s+/g, " ").trim() === "复制源码"
        );
        if (homepageCopyButton && homepageExportButton) {
          homepageCopyButton.click();
          await waitFor(
            () =>
              homepageCopyButton.disabled &&
              homepageExportButton.disabled &&
              homepageCopyButton.textContent?.includes("复制中") &&
              bodyIncludes("正在复制主页源码"),
            1_000
          );
          homepageCopyBusyVisible = Boolean(
            homepageCopyButton.disabled &&
              homepageExportButton.disabled &&
              homepageCopyButton.textContent?.includes("复制中") &&
              bodyIncludes("正在复制主页源码")
          );
          homepageCopyAriaBusyVisible =
            homepageCopyBusyVisible && homepageCopyButton.getAttribute("aria-busy") === "true";
          await waitFor(
            () =>
              !homepageCopyButton.disabled &&
              bodyIncludes("主页 HTML 已复制到剪贴板"),
            2_000
          );
          let homepageCopiedText = "";
          if (window.aura?.clipboard?.readText) {
            homepageCopiedText = await window.aura.clipboard.readText();
          } else if (navigator.clipboard?.readText) {
            homepageCopiedText = await navigator.clipboard.readText();
          }
          homepageCopySuccessVisible =
            !homepageCopyButton.disabled &&
            bodyIncludes("主页 HTML 已复制到剪贴板") &&
            homepageCopiedText.includes("<!doctype html>");

          window.__AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__ = "smoke-copy-failed";
          try {
            homepageCopyButton.click();
            await waitFor(
              () =>
                !homepageCopyButton.disabled &&
                bodyIncludes("复制失败") &&
                bodyIncludes("smoke-copy-failed"),
              2_000
            );
            homepageCopyFailureVisible =
              !homepageCopyButton.disabled &&
              bodyIncludes("复制失败") &&
              bodyIncludes("smoke-copy-failed");
          } finally {
            delete window.__AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__;
          }
        }
        if (homepageExportButton) {
          const originalAnchorClick = HTMLAnchorElement.prototype.click;
          let homepageDownloadClickCount = 0;
          HTMLAnchorElement.prototype.click = function () {
            if (this.download?.endsWith("-index.html")) {
              homepageDownloadClickCount += 1;
              return;
            }
            return originalAnchorClick.call(this);
          };
          try {
            homepageExportButton.click();
            await waitFor(
              () =>
                homepageExportButton.disabled &&
                homepageCopyButton?.disabled &&
                homepageExportButton.textContent?.includes("导出中") &&
                bodyIncludes("正在导出主页 HTML"),
              1_000
            );
            homepageExportBusyVisible = Boolean(
              homepageExportButton.disabled &&
                homepageCopyButton?.disabled &&
                homepageExportButton.textContent?.includes("导出中") &&
                bodyIncludes("正在导出主页 HTML")
            );
            homepageExportAriaBusyVisible =
              homepageExportBusyVisible && homepageExportButton.getAttribute("aria-busy") === "true";
            await waitFor(
              () =>
                !homepageExportButton.disabled &&
                bodyIncludes("已导出") &&
                bodyIncludes("index.html"),
              2_000
            );
            homepageExportSuccessVisible =
              homepageDownloadClickCount === 1 &&
              !homepageExportButton.disabled &&
              bodyIncludes("已导出") &&
              bodyIncludes("index.html");

            const originalCreateObjectUrl = URL.createObjectURL;
            URL.createObjectURL = () => {
              throw new Error("smoke-export-failed");
            };
            try {
              homepageExportButton.click();
              await waitFor(
                () => bodyIncludes("导出失败") && bodyIncludes("smoke-export-failed"),
                2_000
              );
              homepageExportFailureVisible =
                bodyIncludes("导出失败") && bodyIncludes("smoke-export-failed");
            } finally {
              URL.createObjectURL = originalCreateObjectUrl;
            }
          } finally {
            HTMLAnchorElement.prototype.click = originalAnchorClick;
          }
        }

        return {
          appShellAiSettingsCtaNavigates,
          appShellAiSettingsCtaTargetsSection,
          appShellAiSettingsCtaVisible,
          appShellAiSettingsPreservesModelOnlyDraft,
          appShellAiModelWithoutSecretRequiresConfig,
          aiSettingsFallbackVisible,
          bodyText: libraryBodyText,
          browserPreviewWarning: libraryBodyText.includes("浏览器预览无法读取本地文献库"),
          citationBridgeMethodGuard,
          citationBridgePingOk,
          citationBridgeUnauthRejected,
          commandCompositionEscapeIgnored,
          commandCompositionIgnored,
          commandCloseRestoresFocus,
          commandDialogOpen,
          commandEmptyActionRestoresResults,
          commandKeyboardNavigationKeepsActiveVisible,
          commandNonPlatformShortcutIgnored,
          commandShortcutLabel,
          commandShortcutToggleCloses,
          commandShortcutToggleOpens,
          commandTargetedSettingsActionTargetsSection,
          commandTargetedSettingsActionVisible,
          detailVisible,
          discoveryBrowserHideFailureVisible,
          discoveryDuplicateSiteAddBusyVisible,
          discoveryDuplicateSiteBlocked,
          discoveryDuplicateSiteCount:
            typeof discoveryDuplicateSiteCount === "number"
              ? discoveryDuplicateSiteCount
              : Number(discoveryDuplicateSiteCount),
          discoveryDuplicateSiteMessageVisible,
          discoveryHiddenSiteAddBusyVisible,
          discoveryHiddenDuplicateSiteCount:
            typeof discoveryHiddenDuplicateSiteCount === "number"
              ? discoveryHiddenDuplicateSiteCount
              : Number(discoveryHiddenDuplicateSiteCount),
          discoveryHiddenDuplicateSiteMessageVisible,
          discoveryHiddenSiteRestored,
          discoveryManualHiddenSiteRestoreBusyVisible,
          discoveryManualHiddenSiteRestored,
          discoveryManualHiddenSiteRestoredCount:
            typeof discoveryManualHiddenSiteRestoredCount === "number"
              ? discoveryManualHiddenSiteRestoredCount
              : Number(discoveryManualHiddenSiteRestoredCount),
          discoverySavedSearchSaveFailureBusyVisible,
          discoverySavedSearchSaveFailureDidNotPersist,
          discoverySavedSearchSaveFailurePreserved,
          discoverySavedSearchSaveFailureVisible,
          discoveryDuplicateSavedSearchBlocked,
          discoveryDuplicateSavedSearchCount:
            typeof discoveryDuplicateSavedSearchCount === "number"
              ? discoveryDuplicateSavedSearchCount
              : Number(discoveryDuplicateSavedSearchCount),
          discoveryDuplicateSavedSearchMessageVisible,
          discoverySavedSearchDeleteFailureBusyVisible,
          discoverySavedSearchDeleteFailureDidNotPersist,
          discoverySavedSearchDeleteFailurePreserved,
          discoverySavedSearchDeleteFailureVisible,
          discoverySavedSearchDeleteBusyVisible,
          discoverySavedSearchDeleteConfirmVisible,
          discoverySavedSearchDeleted,
          discoverySavedSearchDeletePersisted,
          discoverySavedSearchDeleteUndoBusyVisible,
          discoverySavedSearchDeleteUndoFailureBusyVisible,
          discoverySavedSearchDeleteUndoFailureDidNotPersist,
          discoverySavedSearchDeleteUndoFailurePreserved,
          discoverySavedSearchDeleteUndoFailureVisible,
          discoverySavedSearchDeleteUndoRestored,
          discoverySavedSearchDeleteUndoVisible,
          discoveryEzproxyConfigSaveAriaBusyVisible,
          discoveryEzproxyConfigSaveBusyVisible,
          discoveryEzproxyCredentialDidNotPersist,
          discoveryEzproxyCredentialsRejected,
          discoveryEzproxyConfigSaved,
          discoveryEzproxyConfigValue,
          discoveryFulltextCueVisible,
          discoveryImportBusyVisible,
          discoveryImportFulltextFallbackVisible,
          discoveryLoadMoreRetryRecoveryDetail,
          discoveryLoadMoreRetryRecoveryVisible,
          discoverySearchAriaBusyVisible,
          discoverySearchBusyVisible,
          discoverySearchRetryRecoveryDetail,
          discoverySearchRetryRecoveryVisible,
          discoveryTrustSignalsDetail,
          discoverySearchProgressLiveVisible,
          discoveryOpenSearchEmptyClearRestored,
          discoveryProxyConfigSaveAriaBusyVisible,
          discoveryProxyConfigSaveBusyVisible,
          discoveryProxyCredentialDidNotPersist,
          discoveryProxyCredentialsRejected,
          discoveryProxyConfigSaved,
          discoveryProxyConfigValue,
          discoverySavedSearchManualCheckBusyVisible,
          discoverySavedSearchManualCheckCompleted,
          discoverySavedSearchHomeOpenBusyVisible,
          discoverySavedSearchHomeOpenClearedNewCount,
          discoverySavedSearchHomeOpenNavigated,
          discoverySavedSearchHomeOpenReplacedActiveSearch,
          discoverySavedSearchLastErrorVisible,
          discoverySiteCredentialDidNotPersist,
          discoverySiteCredentialsRejected,
          discoveryTrustSignalsVisible,
          discoverySearchCompositionIgnored,
          discoverySiteProxyToggleBusyVisible,
          discoverySiteProxyToggled,
          discoverySiteProxyValue:
            typeof discoverySiteProxyValue === "number"
              ? discoverySiteProxyValue
              : Number(discoverySiteProxyValue),
          discoverySiteHideActionBusyVisible,
          discoverySiteHideActionConfirmed,
          discoverySiteHideActionHiddenValue:
            typeof discoverySiteHideActionHiddenValue === "number"
              ? discoverySiteHideActionHiddenValue
              : Number(discoverySiteHideActionHiddenValue),
          discoverySiteRemoveFailureBusyVisible,
          discoverySiteRemoveFailureDidNotPersist,
          discoverySiteRemoveFailurePreserved,
          discoverySiteRemoveFailureVisible,
          discoverySiteRemoveActionBusyVisible,
          discoverySiteRemoveActionCount:
            typeof discoverySiteRemoveActionCount === "number"
              ? discoverySiteRemoveActionCount
              : Number(discoverySiteRemoveActionCount),
          discoverySiteRemoveActionDeleted,
          discoverySiteRemoveUndoBusyVisible,
          discoverySiteRemoveUndoFailureBusyVisible,
          discoverySiteRemoveUndoFailureDidNotPersist,
          discoverySiteRemoveUndoFailurePreserved,
          discoverySiteRemoveUndoFailureVisible,
          discoverySiteRemoveUndoRecovered,
          discoveryReferenceImportCommitBusyVisible,
          discoveryReferenceImportCommitPersisted,
          discoveryReferenceImportCommitSuccessVisible,
          discoveryReferenceImportCancelPreserved,
          discoveryReferenceImportConfirmVisible,
          discoveryReferenceImportRejectsEmptyPersisted,
          discoveryReferenceImportRejectsEmptyVisible,
          discoveryReferenceImportRichFormatsPersisted,
          appShellCanvasStatsRacePreserved,
          canvasLegacyFlashcardsRedirected,
          canvasLegacyRedirectHash,
          canvasLibraryWorkIngressHash,
          canvasLibraryWorkIngressNavigated,
          canvasLibraryWorkIngressPersisted,
          canvasLibraryWorkIngressVisible,
          canvasNodeContextMenuVisible,
          canvasPersistedNodeCount:
            typeof canvasPersistedNodeCount === "number"
              ? canvasPersistedNodeCount
              : Number(canvasPersistedNodeCount),
          canvasPersistedNodeReloaded,
          canvasSemanticQuickLinkCandidateVisible,
          canvasSemanticQuickLinkCleanupSucceeded,
          canvasSemanticQuickLinkDeferred,
          canvasSemanticQuickLinkPersisted,
          canvasSemanticQuickLinkShortcutHandled,
          canvasSplitReaderClosed,
          canvasSplitReaderCleanupSucceeded,
          canvasSplitReaderExcerptLinked,
          canvasSplitReaderKeptContext,
          canvasSplitReaderOpened,
          canvasToolboxDetailsEditPersisted,
          canvasReaderAnnotationDeepLinkHash,
          canvasReaderAnnotationDeepLinkNavigated,
          canvasReaderAnnotationPersisted,
          canvasReaderAnnotationVisible,
          discoverySiteActionConfirmCancelled,
          discoverySiteActionConfirmVisible,
          dbError,
          emptyStateVisible,
          externalCredentialsRejected,
          externalNavigationBlocked,
          externalUnsafeRejected,
          graphCachedVisible,
          graphDeepLinkParamSyncVisible,
          graphEmptyLatestCtaHash,
          graphEmptyLatestCtaOpened,
          graphEmptyLatestCtaVisible,
          graphInputCompositionIgnored,
          graphImportBusyVisible,
          graphImportFailureFeedbackVisible,
          graphImportSuccessStatsUpdated,
          graphImportSuccessVisible,
          graphUnexpectedBuildMisses,
          graphLoadRacePreserved,
          graphNodeKeyboardSelectable,
          graphRetryRecoveryVisible,
          hash: libraryHash,
          hasAuraBridge: Boolean(window.aura?.db && window.aura?.research && window.aura?.deviceId),
          heading: libraryHeading,
          homepageClearSelectedCancelPreserved,
          homepageClearSelectedConfirmVisible,
          homepageClearSelectedUndoDetail,
          homepageClearSelectedUndoFailureBusyVisible,
          homepageClearSelectedUndoFailureDidNotPersist,
          homepageClearSelectedUndoFailurePreserved,
          homepageClearSelectedUndoFailureVisible,
          homepageClearSelectedUndoRecovered,
          homepageClearSelectedUndoRetryPersisted,
          homepageCopyAriaBusyVisible,
          homepageCopyBusyVisible,
          homepageCopyFailureVisible,
          homepageCopySuccessVisible,
          homepageExportAriaBusyVisible,
          homepageExportBusyVisible,
          homepageExportFailureVisible,
          homepageExportSuccessVisible,
          homepageExternalLinkSafetyOk,
          homepageFeaturedOverwriteCancelPreserved,
          homepageFeaturedOverwriteConfirmVisible,
          homepageLibraryReadRetryRecoveryDetail,
          homepageLibraryReadRetryRecoveryVisible,
          homepageLibraryRefreshRacePreserved,
          homepageProfileSaveFailureBusyVisible,
          homepageProfileSaveFailureDidNotPersist,
          homepageProfileSaveFailurePreserved,
          homepageProfileSaveFailureRetryPersisted,
          homepageProfileSaveFailureRetryVisible,
          homepageProfileSaveFailureVisible,
          homepagePublicationFilterActionRestored,
          homepagePublicationFilterActionDetail,
          homepageSafeLinkRelHardened,
          platformHttpUnsafeRejected,
          researchUnsafeUrlRejected,
          platformSecretsConcurrentWritesPreserved,
          libraryBulkSelectMixedVisible,
          libraryFilterEmptyActionRestoresResults,
          libraryFilterTabsExposeState,
          libraryMissingDeepLinkFeedbackVisible,
          libraryBulkTrashFailureBusyVisible,
          libraryBulkTrashFailureDidNotPersist,
          libraryBulkTrashFailurePreserved,
          libraryBulkTrashFailureVisible,
          libraryTrashFailureBusyVisible,
          libraryTrashFailureDidNotPersist,
          libraryTrashFailurePreserved,
          libraryTrashFailureVisible,
          libraryTrashUndoFailureBusyVisible,
          libraryTrashUndoFailureDidNotPersist,
          libraryTrashUndoFailurePreserved,
          libraryTrashUndoFailureVisible,
          libraryTrashUndoBusyVisible,
          libraryTrashUndoRecovered,
          libraryTrashUndoVisible,
          libraryTrashPurgeFailureBusyVisible,
          libraryTrashPurgeFailureDidNotPersist,
          libraryTrashPurgeFailurePreserved,
          libraryTrashPurgeFailureVisible,
          libraryTrashRestoreFailureBusyVisible,
          libraryTrashRestoreFailureDidNotPersist,
          libraryTrashRestoreFailurePreserved,
          libraryTrashRestoreFailureVisible,
          libraryTrashPurgeBusyVisible,
          libraryTrashPurgePersisted,
          libraryTrashPurgeTypedConfirmProtected,
          libraryLoadRetryAttempts,
          libraryLoadRetryRecoveryDetail,
          libraryLoadRetryRecoveryVisible,
          libraryRefreshRacePreserved,
          librarySidebarHealthHidden,
          librarySidebarMetaVisible,
          librarySidebarOrganizerActionsVisible,
          libraryCitationContextVisible,
          libraryContextualWorkflowsHidden,
          initialWorkCount: typeof initialWorkCount === "number" ? initialWorkCount : Number(initialWorkCount),
          libraryBulkTagFailureBusyVisible,
          libraryBulkTagFailureDidNotPersist,
          libraryBulkTagFailurePreserved,
          libraryBulkTagFailureVisible,
          libraryBulkTagBusyVisible,
          libraryBulkTagPersisted,
          libraryBulkTagSuccessVisible,
          libraryCitationCopyBusyVisible,
          libraryCitationCopyFailureVisible,
          libraryCitationCopySuccessVisible,
          libraryCitationExportBusyVisible,
          libraryCitationExportFailureVisible,
          libraryCitationExportPmidVisible,
          libraryCitationExportSuccessVisible,
          libraryCollectionCreateFailureBusyVisible,
          libraryCollectionCreateFailureDidNotPersist,
          libraryCollectionCreateFailurePreserved,
          libraryCollectionCreateFailureVisible,
          libraryCollectionRenameFailureBusyVisible,
          libraryCollectionRenameFailureDidNotPersist,
          libraryCollectionRenameFailurePreserved,
          libraryCollectionRenameFailureVisible,
          libraryCollectionDeleteBusyVisible,
          libraryCollectionDeleteFailureBusyVisible,
          libraryCollectionDeleteFailureDidNotPersist,
          libraryCollectionDeleteFailurePreserved,
          libraryCollectionDeleteFailureVisible,
          libraryCollectionDeletePersisted,
          libraryCollectionDeleteSuccessVisible,
          libraryCollectionDeleteUndoBusyVisible,
          libraryCollectionDeleteUndoFailureBusyVisible,
          libraryCollectionDeleteUndoFailureDidNotPersist,
          libraryCollectionDeleteUndoFailurePreserved,
          libraryCollectionDeleteUndoFailureVisible,
          libraryCollectionDeleteUndoRecovered,
          libraryKeyboardNavigationVisible,
          libraryKeyboardOpenHash,
          libraryKeyboardOpenedId,
          libraryKeyboardNavigationDetail,
          libraryPdfUploadBusyVisible,
          libraryPdfUploadPersisted,
          libraryPdfUploadSuccessVisible,
          libraryMergeBusyVisible,
          libraryMergeFailureBusyVisible,
          libraryMergeFailureDidNotPersist,
          libraryMergeFailurePreserved,
          libraryMergeFailureVisible,
          libraryMergePersisted,
          libraryMergeSuccessVisible,
          libraryMoveToCollectionFailureBusyVisible,
          libraryMoveToCollectionFailureDidNotPersist,
          libraryMoveToCollectionFailurePreserved,
          libraryMoveToCollectionFailureVisible,
          libraryMoveToCollectionBusyVisible,
          libraryMoveToCollectionPersisted,
          libraryMoveToCollectionSuccessVisible,
          libraryTagDeleteBusyVisible,
          libraryTagDeleteFailureBusyVisible,
          libraryTagDeleteFailureDidNotPersist,
          libraryTagDeleteFailurePreserved,
          libraryTagDeleteFailureVisible,
          libraryTagDeletePersisted,
          libraryTagDeleteSuccessVisible,
          libraryTagDeleteUndoBusyVisible,
          libraryTagDeleteUndoFailureBusyVisible,
          libraryTagDeleteUndoFailureDidNotPersist,
          libraryTagDeleteUndoFailurePreserved,
          libraryTagDeleteUndoFailureVisible,
          libraryTagDeleteUndoRecovered,
          libraryTagRenameFailureBusyVisible,
          libraryTagRenameFailureDidNotPersist,
          libraryTagRenameFailurePreserved,
          libraryTagRenameFailureVisible,
          libraryTrashRestoreBusyVisible,
          libraryTrashRestoreSuccessVisible,
          metadataInvalidYearBlocked,
          metadataInvalidYearErrorVisible,
          metadataInvalidYearPreserved,
          metadataDiscardCancelPreserved,
          metadataSaveFailureVisible,
          metadataSaveFailurePreserved,
          metadataSaveFailureDidNotPersist,
          metadataSaveBusyVisible,
          metadataSavePersisted,
          libraryPdfAttachmentVisible,
          libraryReadingStatusBusyVisible,
          libraryReadingStatusFailureBusyVisible,
          libraryReadingStatusFailureDidNotPersist,
          libraryReadingStatusFailurePreserved,
          libraryReadingStatusFailureVisible,
          libraryReadingStatusPersisted,
          libraryReadingStatusSuccessVisible,
          libraryStarBusyVisible,
          libraryStarFailureBusyVisible,
          libraryStarFailureDidNotPersist,
          libraryStarFailurePreserved,
          libraryStarFailureVisible,
          libraryStarPersisted,
          libraryStarSuccessVisible,
          quickAddCompositionIgnored,
          quickImportConfirmCommitBusyVisible,
          quickImportConfirmDialogVisible,
          quickImportConfirmCommitPersisted,
          librarySearchShortcutLabel,
          librarySearchShortcutFocused,
          librarySearchNonPlatformShortcutIgnored,
          populatedStateVisible,
          quickDropImportConfirmBusyVisible,
          quickDropImportFailureBusyVisible,
          quickDropImportFailureDidNotPersist,
          quickDropImportFailurePreserved,
          quickDropImportFailureVisible,
          quickDropImportConfirmPersisted,
          quickDropImportConfirmPmidPersisted,
          quickDropImportConfirmSuccessVisible,
          quickDropImportCount,
          quickDropImportPreviewVisible,
          readingStatus,
          readerAutoReadingStatusPersisted,
          readerBrokenAttachmentCount,
          readerBrokenBlobRecoveryVisible,
          readerBrokenBlobVisible,
          readerBrokenHash,
          readerAnnotationCreateFailureBusyVisible,
          readerAnnotationCreateFailureDidNotPersist,
          readerAnnotationCreateFailurePreserved,
          readerAnnotationCreateFailureVisible,
          readerAnnotationDeleteBusyVisible,
          readerAnnotationDeleteCancelPreserved,
          readerAnnotationDeleteConfirmVisible,
          readerAnnotationDeleteFailureBusyVisible,
          readerAnnotationDeleteFailureDidNotPersist,
          readerAnnotationDeleteFailurePreserved,
          readerAnnotationDeleteFailureVisible,
          readerAnnotationDeleteSuccessVisible,
          readerAnnotationDeleteUndoFailureBusyVisible,
          readerAnnotationDeleteUndoFailureDidNotPersist,
          readerAnnotationDeleteUndoFailurePreserved,
          readerAnnotationDeleteUndoFailureVisible,
          readerAnnotationDeleteUndoBusyVisible,
          readerAnnotationDeleteUndoRecovered,
          readerCommentDirtyExportBlocked,
          readerCommentDirtyExportDownloadPrevented,
          readerCommentDirtyExportMessageVisible,
          readerCommentDraftCancelPreserved,
          readerCommentDraftConfirmVisible,
          readerCommentDraftDiscarded,
          readerCommentSaveFailureDidNotPersist,
          readerCommentSaveFailurePreserved,
          readerCommentSaveFailureVisible,
          readerCommentSaveBusyVisible,
          readerCommentSavePersisted,
          readerCommentShortcutCompositionIgnored,
          readerArchivedAnnotationRows,
          readerArchivedAttachmentRows,
          readerArchivedBackToTrashFilterVisible,
          readerArchivedBackToTrashHash,
          readerArchivedBackToTrashLocated,
          readerArchivedBackToTrashRowVisible,
          readerArchivedBackToTrashSearchCleared,
          readerArchivedCanvasBlocked,
          readerArchivedForbiddenActionsHidden,
          readerArchivedHash,
          readerArchivedRecoveryCtaVisible,
          readerArchivedStateVisible,
          readerCanvasVisible,
          readerCorruptAttachmentCount,
          readerCorruptPdfRecoveryVisible,
          readerCorruptPdfVisible,
          readerCorruptHash,
          readerErrorVisible,
          readerFindFulltextHandoffHash,
          readerFindFulltextHandoffNavigated,
          readerFindFulltextHandoffStatusVisible,
          readerFindFulltextHandoffTargetVisible,
          readerFindFulltextHandoffView,
          readerHash,
          readerLoadRetryAttempts,
          readerLoadRetryRecoveryDetail,
          readerLoadRetryRecoveryVisible,
          readerMissingBackToLibraryHash,
          readerMissingBackToLibraryDetail,
          readerMissingBackToLibraryLocated,
          readerMissingBackToLibraryPageText,
          readerMissingBackToLibraryRowVisible,
          readerMissingBackToLibrarySearchCleared,
          readerMissingBackToLibraryVisibleRows,
          readerMissingHash,
          readerMissingPdfAttachBusyVisible,
          readerMissingPdfAttachCtaVisible,
          readerMissingPdfRecoveryVisible,
          readerMissingPdfVisible,
          readerNoWorkClearsDocument,
          readerPageBadgeVisible,
          readerRecoveredAttachmentCount,
          readerRecoveredPdfVisible,
          readerSnippetSaveFailureBusyVisible,
          readerSnippetSaveFailureDidNotPersist,
          readerSnippetSaveFailurePreserved,
          readerSnippetSaveFailureVisible,
          readerSnippetSaveBusyVisible,
          readerSnippetSavePersisted,
          readerTabDeepLinkSyncVisible,
          readerTitleVisible,
          readerTranslationClipboardMatches,
          readerTranslationCopyBusyVisible,
          readerTranslationCopyFeedbackVisible,
          readerTranslationCopyStatusText,
          readerTranslationInlineDocumentVisible,
          readerTranslationSelectionPopoverVisible,
          readerTranslationSplitDocumentsVisible,
          readerTranslationStartBusyVisible,
          readerTranslationStartErrorVisible,
          readerTranslationSettingsCtaNavigates,
          readerTranslationSettingsCtaTargetsSection,
          readerTranslationSettingsCtaVisible,
          routeCrashBoundaryVisible,
          routeCrashRecoveredLibraryVisible,
          routeCrashRecoveryHash,
          routeCrashShellVisible,
          searchClearButtonRestoresResults,
          searchDataPathOk,
          searchEmptyActionRestoresResults,
          searchEmptyStateVisible,
          searchEscapeClearsQuery,
          searchResultVisible,
          settingsBackupExportBusyVisible,
          settingsBackupExportAriaBusyVisible,
          settingsBackupExportEphemeralDataExcluded,
          settingsBackupExportFailureVisible,
          settingsBackupExportRecencyVisible,
          settingsBackupExportSecretsSanitized,
          settingsBackupExportSuccessVisible,
          settingsBackupImportAiJobsPortable,
          settingsBackupImportEphemeralDataExcluded,
          settingsBackupImportIgnoredOnlyExplained,
          settingsBackupImportAttachmentIdCollisionRemapped,
          settingsBackupImportAttachmentDeactivated,
          settingsBackupImportBusyVisible,
          settingsBackupImportCancelPreserved,
          settingsBackupImportConfirmVisible,
          settingsBackupImportFailureBusyVisible,
          settingsBackupImportFailureDidNotPersist,
          settingsBackupImportFailureRetryVisible,
          settingsBackupImportFailureVisible,
          settingsBackupImportLibraryScoped,
          settingsBackupImportPersisted,
          settingsBackupImportRejectsFutureVersionVisible,
          settingsBackupImportRejectsInvalidVisible,
          settingsBackupImportReattachAnnotationRestored,
          settingsBackupImportRuntimeSkipExplained,
          settingsBackupImportSearchIndexed,
          settingsBackupImportSettingsSanitized,
          settingsBackupImportStableIdMerged,
          settingsBackupImportSuccessVisible,
          settingsAiTestFailureBusyVisible,
          settingsAiTestFailureConfigSaved,
          settingsAiTestFailureRetryVisible,
          settingsAiTestFailureVisible,
          settingsAiSaveFailureDidNotPersist,
          settingsAiSaveFailurePreserved,
          settingsAiSaveFailureVisible,
          settingsInlineSecretMigrationFailurePreserved,
          settingsInlineSecretMigrationRetrySanitized,
          settingsInlineSecretMigrationVisible,
          settingsAiUrlCredentialsRejected,
          settingsAiUrlInvalidDidNotPersist,
          settingsAiUrlInvalidVisible,
          settingsAiUrlNormalized,
          settingsTranslateSaveFailureDidNotPersist,
          settingsTranslateSaveFailurePreserved,
          settingsTranslateSaveFailureVisible,
          settingsTranslateProviderValidationDidNotPersist,
          settingsTranslateProviderValidationVisible,
          settingsSyncRunFailureBusyVisible,
          settingsSyncRunFailureConfigPreserved,
          settingsSyncRunActionableFailureVisible,
          settingsSyncRunFailureRetryVisible,
          settingsSyncRunFailureVisible,
          settingsSyncRunQuotaGuidanceVisible,
          settingsSyncUrlCredentialsRejected,
          settingsSyncUrlInvalidDidNotPersist,
          settingsSyncUrlInvalidVisible,
          settingsSyncUrlNormalized,
          settingsSyncSaveFailureDidNotPersist,
          settingsSyncSaveFailurePreserved,
          settingsSyncSaveFailureVisible,
          settingsBusySaveAriaVisible,
          settingsBusyNavigationCancelPreserved,
          settingsBusyNavigationConfirmVisible,
          settingsBusySaveControlsDisabled,
          settingsAiLoadRetryAttempts,
          settingsAiLoadRetryRecoveryDetail,
          settingsAiLoadRetryRecoveryVisible,
          settingsInitialLoadCompleted,
          settingsSyncLoadRetryAttempts,
          settingsSyncLoadRetryRecoveryDetail,
          settingsSyncLoadRetryRecoveryVisible,
          settingsTargetTranslateSectionVisible,
          settingsTranslateLoadRetryAttempts,
          settingsTranslateLoadRetryRecoveryDetail,
          settingsTranslateLoadRetryRecoveryVisible,
          settingsTranslationCacheClearBusyVisible,
          settingsTranslationCacheClearCancelled,
          settingsTranslationCacheClearConfirmVisible,
          settingsTranslationCacheClearPersisted,
          settingsTranslationCacheClearSuccessVisible,
          sentinelAddCompositionIgnored,
          sentinelAddBusyVisible,
          sentinelDeleteFailureBusyVisible,
          sentinelDeleteFailureDidNotPersist,
          sentinelDeleteFailurePreserved,
          sentinelDeleteFailureVisible,
          sentinelDeleteUndoFailureBusyVisible,
          sentinelDeleteUndoFailureDidNotPersist,
          sentinelDeleteUndoFailurePreserved,
          sentinelDeleteUndoFailureVisible,
          sentinelDeleteUndoBusyVisible,
          sentinelDeleteUndoRestored,
          sentinelDeleteUndoVisible,
          sentinelDeletedDoiRestored,
          sentinelDeletedDoiRestoredCount,
          sentinelDuplicateDoiBlocked,
          sentinelDuplicateDoiCount,
          sentinelDuplicateDoiMessageVisible,
          sentinelLastErrorVisible,
          sentinelTaskCheckBusyVisible,
          sentinelManualFailureRecorded,
          sentinelManualFailureVisible,
          sentinelFilterEmptyActionRestoresResults,
          sentinelLoadRetryAttempts,
          sentinelLoadRetryRecoveryDetail,
          sentinelLoadRetryRecoveryVisible,
          sentinelRefreshRacePreserved,
          seededWorkCount: typeof seededWorkCount === "number" ? seededWorkCount : Number(seededWorkCount),
          snippetCardCopyAriaBusyVisible,
          snippetCardCopyBusyVisible,
          snippetCardCopyCitationAriaBusyVisible,
          snippetCardCopyCitationBusyVisible,
          snippetDeleteAriaBusyVisible,
          snippetDeleteBusyVisible,
          snippetDeleteFailureBusyVisible,
          snippetDeleteFailureDidNotPersist,
          snippetDeleteFailurePreserved,
          snippetDeleteFailureVisible,
          snippetDeleteSuccessVisible,
          snippetDeleteUndoFailureBusyVisible,
          snippetDeleteUndoFailureDidNotPersist,
          snippetDeleteUndoFailurePreserved,
          snippetDeleteUndoFailureVisible,
          snippetDeleteUndoBusyVisible,
          snippetDeleteUndoRecovered,
          snippetDeleteUndoVisible,
          snippetEmptyLatestReaderHash,
          snippetEmptyLatestReaderOpened,
          snippetEmptyLatestReaderVisible,
          snippetFilterEmptyActionRestoresResults,
          snippetLoadRetryAttempts,
          snippetLoadRetryRecoveryDetail,
          snippetLoadRetryRecoveryVisible,
          snippetDirtyCopyBlocked,
          snippetDirtyCopyClipboardPreserved,
          snippetDirtyCopyMessageVisible,
          snippetEditorClosedAfterShortcut,
          snippetEscapeCompositionIgnored,
          snippetRefreshRacePreserved,
          snippetSavedNote,
          snippetSaveCompositionIgnored,
          snippetSaveFailureDidNotPersist,
          snippetSaveFailurePreserved,
          snippetSaveFailureVisible,
          snippetShortcutEventPrevented,
          snippetShortcutSaveVisible,
          snippetVisibleCopyAriaBusyVisible,
          snippetVisibleCopyBusyVisible,
          snippetVisibleCopySuccessVisible,
          themeFallbackApplied,
          themeStoredInvalid,
          title: document.title,
        };
      })();
    `;

    setTimeout(() => {
      win.webContents
        .executeJavaScript(script, true)
        .then(async (renderer: SmokeRendererResult) => {
          const secretsFile = await inspectSecretsFile();
          const checks: SmokeCheck[] = [
            {
              name: "document-title",
              pass: renderer.title === "AuraScholar",
              detail: renderer.title,
            },
            {
              name: "local-storage-startup-fallback",
              pass:
                renderer.themeFallbackApplied &&
                renderer.themeStoredInvalid &&
                renderer.aiSettingsFallbackVisible,
              detail: `theme=${renderer.themeFallbackApplied}; storedInvalid=${renderer.themeStoredInvalid}; ai=${renderer.aiSettingsFallbackVisible}`,
            },
            {
              name: "app-shell-ai-settings-cta",
              pass:
                renderer.appShellAiSettingsCtaVisible &&
                renderer.appShellAiSettingsCtaNavigates &&
                renderer.appShellAiSettingsCtaTargetsSection &&
                renderer.appShellAiSettingsPreservesModelOnlyDraft &&
                renderer.appShellAiModelWithoutSecretRequiresConfig,
              detail: `visible=${renderer.appShellAiSettingsCtaVisible}; navigated=${renderer.appShellAiSettingsCtaNavigates}; targeted=${renderer.appShellAiSettingsCtaTargetsSection}; preservesDraft=${renderer.appShellAiSettingsPreservesModelOnlyDraft}; modelOnlyRequiresConfig=${renderer.appShellAiModelWithoutSecretRequiresConfig}`,
            },
            {
              name: "library-route",
              pass: renderer.hash.includes("/library") && renderer.heading === "文献库",
              detail: `${renderer.hash} / ${renderer.heading}`,
            },
            { name: "preload-bridge", pass: renderer.hasAuraBridge },
            {
              name: "citation-bridge-http-guard",
              pass:
                renderer.citationBridgePingOk &&
                renderer.citationBridgeUnauthRejected &&
                renderer.citationBridgeMethodGuard,
              detail: `ping=${renderer.citationBridgePingOk}; unauth=${renderer.citationBridgeUnauthRejected}; method=${renderer.citationBridgeMethodGuard}`,
            },
            {
              name: "platform-secrets-file-hardened",
              pass:
                secretsFile.exists &&
                secretsFile.privateMode &&
                secretsFile.plaintextAbsent &&
                secretsFile.encryptedEncoding,
              detail:
                `exists=${secretsFile.exists}; mode=${secretsFile.mode}; private=${secretsFile.privateMode}; plaintextAbsent=${secretsFile.plaintextAbsent}; encryptedEncoding=${secretsFile.encryptedEncoding}` +
                (secretsFile.error ? `; error=${summarize(secretsFile.error, 120)}` : ""),
            },
            {
              name: "platform-secrets-concurrent-write",
              pass: renderer.platformSecretsConcurrentWritesPreserved,
              detail: `preserved=${renderer.platformSecretsConcurrentWritesPreserved}`,
            },
            {
              name: "platform-http-url-guard",
              pass: renderer.platformHttpUnsafeRejected,
            },
            {
              name: "research-browser-url-guard",
              pass: renderer.researchUnsafeUrlRejected,
            },
            {
              name: "db-ipc",
              pass:
                renderer.dbError === null &&
                typeof renderer.initialWorkCount === "number" &&
                Number.isFinite(renderer.initialWorkCount),
              detail: renderer.dbError ?? String(renderer.initialWorkCount),
            },
            {
              name: "desktop-runtime-copy",
              pass: renderer.bodyText.includes("桌面运行时") && !renderer.browserPreviewWarning,
              detail: summarize(renderer.bodyText),
            },
            {
              name: "external-link-scheme-guard",
              pass: renderer.externalUnsafeRejected && renderer.externalCredentialsRejected,
              detail: `scheme=${renderer.externalUnsafeRejected}; credentials=${renderer.externalCredentialsRejected}`,
            },
            {
              name: "main-window-external-navigation-guard",
              pass: renderer.externalNavigationBlocked,
            },
            {
              name: "app-shell-canvas-stats-race-preserved",
              pass: renderer.appShellCanvasStatsRacePreserved,
            },
            {
              name: "citation-graph-cached-keyboard-and-import-feedback",
              pass:
                renderer.graphCachedVisible &&
                renderer.graphNodeKeyboardSelectable &&
                renderer.graphImportBusyVisible &&
                renderer.graphImportFailureFeedbackVisible &&
                renderer.graphImportSuccessVisible &&
                renderer.graphImportSuccessStatsUpdated &&
                renderer.graphLoadRacePreserved &&
                renderer.graphDeepLinkParamSyncVisible &&
                renderer.graphUnexpectedBuildMisses.length === 0,
              detail: `cached=${renderer.graphCachedVisible}; keyboard=${renderer.graphNodeKeyboardSelectable}; busy=${renderer.graphImportBusyVisible}; failure=${renderer.graphImportFailureFeedbackVisible}; success=${renderer.graphImportSuccessVisible}; stats=${renderer.graphImportSuccessStatsUpdated}; race=${renderer.graphLoadRacePreserved}; deeplink=${renderer.graphDeepLinkParamSyncVisible}; misses=${renderer.graphUnexpectedBuildMisses.join(",") || "0"}`,
            },
            {
              name: "citation-graph-empty-latest-cta",
              pass: renderer.graphEmptyLatestCtaVisible && renderer.graphEmptyLatestCtaOpened,
              detail: `visible=${renderer.graphEmptyLatestCtaVisible}; opened=${renderer.graphEmptyLatestCtaOpened}; hash=${renderer.graphEmptyLatestCtaHash}`,
            },
            {
              name: "citation-graph-retry-recovery",
              pass: renderer.graphRetryRecoveryVisible,
            },
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
              pass:
                renderer.libraryCitationContextVisible && renderer.libraryContextualWorkflowsHidden,
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
              pass:
                renderer.libraryTrashRestoreBusyVisible &&
                renderer.libraryTrashRestoreSuccessVisible,
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
              pass:
                renderer.libraryTagDeleteUndoBusyVisible && renderer.libraryTagDeleteUndoRecovered,
              detail: `busy=${renderer.libraryTagDeleteUndoBusyVisible}; restored=${renderer.libraryTagDeleteUndoRecovered}`,
            },
            { name: "quick-open-dialog", pass: renderer.commandDialogOpen },
            {
              name: "command-palette-shortcut-toggle",
              pass: renderer.commandShortcutToggleOpens && renderer.commandShortcutToggleCloses,
              detail: `opens=${renderer.commandShortcutToggleOpens}; closes=${renderer.commandShortcutToggleCloses}`,
            },
            {
              name: "command-palette-platform-shortcut",
              pass: renderer.commandNonPlatformShortcutIgnored,
            },
            {
              name: "command-palette-keyboard-scroll",
              pass: renderer.commandKeyboardNavigationKeepsActiveVisible,
            },
            {
              name: "command-palette-empty-recovery",
              pass: renderer.commandEmptyActionRestoresResults,
            },
            {
              name: "command-palette-focus-restore",
              pass: renderer.commandCloseRestoresFocus,
            },
            {
              name: "command-palette-ime-enter-guard",
              pass: renderer.commandCompositionIgnored,
            },
            {
              name: "modal-focus-trap-ime-escape-guard",
              pass: renderer.commandCompositionEscapeIgnored,
            },
            {
              name: "command-palette-targeted-settings-action",
              pass:
                renderer.commandTargetedSettingsActionVisible &&
                renderer.commandTargetedSettingsActionTargetsSection,
              detail: `visible=${renderer.commandTargetedSettingsActionVisible}; targeted=${renderer.commandTargetedSettingsActionTargetsSection}`,
            },
            {
              name: "platform-shortcut-labels",
              pass:
                renderer.commandShortcutLabel ===
                  (process.platform === "darwin" ? "⌘K" : "Ctrl K") &&
                renderer.librarySearchShortcutLabel ===
                  (process.platform === "darwin" ? "⌘ F" : "Ctrl F"),
              detail: `command=${renderer.commandShortcutLabel}; find=${renderer.librarySearchShortcutLabel}`,
            },
            {
              name: "library-search-shortcut",
              pass:
                renderer.librarySearchShortcutFocused &&
                renderer.librarySearchNonPlatformShortcutIgnored,
            },
            {
              name: "quick-add-ime-enter-guard",
              pass: renderer.quickAddCompositionIgnored,
            },
            {
              name: "quick-import-confirm-commit-feedback",
              pass:
                renderer.quickImportConfirmDialogVisible &&
                renderer.quickImportConfirmCommitBusyVisible &&
                renderer.quickImportConfirmCommitPersisted,
              detail: `dialog=${renderer.quickImportConfirmDialogVisible}; busy=${renderer.quickImportConfirmCommitBusyVisible}; persisted=${renderer.quickImportConfirmCommitPersisted}`,
            },
            {
              name: "metadata-invalid-year-validation",
              pass:
                renderer.metadataInvalidYearBlocked &&
                renderer.metadataInvalidYearErrorVisible &&
                renderer.metadataInvalidYearPreserved,
              detail: `blocked=${renderer.metadataInvalidYearBlocked}; error=${renderer.metadataInvalidYearErrorVisible}; preserved=${renderer.metadataInvalidYearPreserved}`,
            },
            {
              name: "metadata-discard-cancel-preserves-draft",
              pass: renderer.metadataDiscardCancelPreserved,
            },
            {
              name: "metadata-save-failure-preserves-draft",
              pass:
                renderer.metadataSaveFailureVisible &&
                renderer.metadataSaveFailurePreserved &&
                renderer.metadataSaveFailureDidNotPersist,
              detail: `visible=${renderer.metadataSaveFailureVisible}; preserved=${renderer.metadataSaveFailurePreserved}; notPersisted=${renderer.metadataSaveFailureDidNotPersist}`,
            },
            {
              name: "metadata-save-busy-feedback",
              pass: renderer.metadataSaveBusyVisible && renderer.metadataSavePersisted,
              detail: `busy=${renderer.metadataSaveBusyVisible}; persisted=${renderer.metadataSavePersisted}`,
            },
            {
              name: "page-enter-ime-guards",
              pass:
                renderer.discoverySearchCompositionIgnored &&
                renderer.graphInputCompositionIgnored &&
                renderer.sentinelAddCompositionIgnored,
              detail: `discovery=${renderer.discoverySearchCompositionIgnored}; graph=${renderer.graphInputCompositionIgnored}; sentinel=${renderer.sentinelAddCompositionIgnored}`,
            },
            {
              name: "sentinel-duplicate-doi-guard",
              pass: renderer.sentinelDuplicateDoiBlocked,
              detail: `message=${renderer.sentinelDuplicateDoiMessageVisible}; count=${renderer.sentinelDuplicateDoiCount}`,
            },
            {
              name: "sentinel-add-busy-feedback",
              pass: renderer.sentinelAddBusyVisible,
              detail: `busy=${renderer.sentinelAddBusyVisible}`,
            },
            {
              name: "sentinel-deleted-doi-restore",
              pass: renderer.sentinelDeletedDoiRestored,
              detail: `count=${renderer.sentinelDeletedDoiRestoredCount}`,
            },
            {
              name: "sentinel-delete-failure-recovers",
              pass:
                renderer.sentinelDeleteFailureVisible &&
                renderer.sentinelDeleteFailureBusyVisible &&
                renderer.sentinelDeleteFailurePreserved &&
                renderer.sentinelDeleteFailureDidNotPersist,
              detail: `visible=${renderer.sentinelDeleteFailureVisible}; busy=${renderer.sentinelDeleteFailureBusyVisible}; preserved=${renderer.sentinelDeleteFailurePreserved}; notPersisted=${renderer.sentinelDeleteFailureDidNotPersist}`,
            },
            {
              name: "sentinel-delete-undo-failure-recovers",
              pass:
                renderer.sentinelDeleteUndoFailureVisible &&
                renderer.sentinelDeleteUndoFailureBusyVisible &&
                renderer.sentinelDeleteUndoFailurePreserved &&
                renderer.sentinelDeleteUndoFailureDidNotPersist,
              detail: `visible=${renderer.sentinelDeleteUndoFailureVisible}; busy=${renderer.sentinelDeleteUndoFailureBusyVisible}; preserved=${renderer.sentinelDeleteUndoFailurePreserved}; notPersisted=${renderer.sentinelDeleteUndoFailureDidNotPersist}`,
            },
            {
              name: "sentinel-delete-undo-recovery",
              pass:
                renderer.sentinelDeleteUndoVisible &&
                renderer.sentinelDeleteUndoBusyVisible &&
                renderer.sentinelDeleteUndoRestored,
              detail: `visible=${renderer.sentinelDeleteUndoVisible}; busy=${renderer.sentinelDeleteUndoBusyVisible}; restored=${renderer.sentinelDeleteUndoRestored}`,
            },
            {
              name: "sentinel-last-error-visible",
              pass: renderer.sentinelLastErrorVisible,
            },
            {
              name: "sentinel-manual-failure-recorded",
              pass:
                renderer.sentinelTaskCheckBusyVisible &&
                renderer.sentinelManualFailureVisible &&
                renderer.sentinelManualFailureRecorded,
              detail: `busy=${renderer.sentinelTaskCheckBusyVisible}; visible=${renderer.sentinelManualFailureVisible}; recorded=${renderer.sentinelManualFailureRecorded}`,
            },
            {
              name: "sentinel-load-retry-recovery",
              pass:
                renderer.sentinelLoadRetryRecoveryVisible &&
                renderer.sentinelLoadRetryAttempts === 2,
              detail: renderer.sentinelLoadRetryRecoveryDetail,
            },
            {
              name: "sentinel-refresh-race-preserved",
              pass: renderer.sentinelRefreshRacePreserved,
            },
            {
              name: "sentinel-filter-empty-recovery",
              pass: renderer.sentinelFilterEmptyActionRestoresResults,
            },
            {
              name: "canvas-legacy-flashcards-redirect",
              pass: renderer.canvasLegacyFlashcardsRedirected,
              detail: renderer.canvasLegacyRedirectHash,
            },
            {
              name: "canvas-persisted-node-reload",
              pass:
                renderer.canvasPersistedNodeReloaded &&
                typeof renderer.canvasPersistedNodeCount === "number" &&
                renderer.canvasPersistedNodeCount >= 2,
              detail: `reloaded=${renderer.canvasPersistedNodeReloaded}; count=${renderer.canvasPersistedNodeCount}`,
            },
            {
              name: "canvas-split-reader-workflow",
              pass:
                renderer.canvasSplitReaderOpened &&
                renderer.canvasSplitReaderKeptContext &&
                renderer.canvasSplitReaderExcerptLinked &&
                renderer.canvasSplitReaderClosed &&
                renderer.canvasSplitReaderCleanupSucceeded,
              detail: `opened=${renderer.canvasSplitReaderOpened}; context=${renderer.canvasSplitReaderKeptContext}; linked=${renderer.canvasSplitReaderExcerptLinked}; closed=${renderer.canvasSplitReaderClosed}; cleanup=${renderer.canvasSplitReaderCleanupSucceeded}`,
            },
            {
              name: "canvas-node-context-toolbox-workflow",
              pass:
                renderer.canvasNodeContextMenuVisible &&
                renderer.canvasToolboxDetailsEditPersisted &&
                renderer.canvasSplitReaderCleanupSucceeded,
              detail: `menu=${renderer.canvasNodeContextMenuVisible}; edit=${renderer.canvasToolboxDetailsEditPersisted}; delete=${renderer.canvasSplitReaderCleanupSucceeded}`,
            },
            {
              name: "canvas-semantic-quick-link-workflow",
              pass:
                renderer.canvasSemanticQuickLinkCandidateVisible &&
                renderer.canvasSemanticQuickLinkDeferred &&
                renderer.canvasSemanticQuickLinkShortcutHandled &&
                renderer.canvasSemanticQuickLinkPersisted &&
                renderer.canvasSemanticQuickLinkCleanupSucceeded,
              detail: `candidate=${renderer.canvasSemanticQuickLinkCandidateVisible}; deferred=${renderer.canvasSemanticQuickLinkDeferred}; shortcut=${renderer.canvasSemanticQuickLinkShortcutHandled}; persisted=${renderer.canvasSemanticQuickLinkPersisted}; cleanup=${renderer.canvasSemanticQuickLinkCleanupSucceeded}`,
            },
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
              pass:
                renderer.snippetLoadRetryRecoveryVisible && renderer.snippetLoadRetryAttempts === 2,
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
              pass:
                renderer.snippetEmptyLatestReaderVisible && renderer.snippetEmptyLatestReaderOpened,
              detail: `visible=${renderer.snippetEmptyLatestReaderVisible}; opened=${renderer.snippetEmptyLatestReaderOpened}; hash=${renderer.snippetEmptyLatestReaderHash}`,
            },
            {
              name: "quick-import-drop",
              pass: renderer.quickDropImportPreviewVisible && renderer.quickDropImportCount === 1,
              detail: `preview=${renderer.quickDropImportPreviewVisible}; count=${renderer.quickDropImportCount}`,
            },
            {
              name: "quick-import-drop-confirm-feedback",
              pass:
                renderer.quickDropImportConfirmBusyVisible &&
                renderer.quickDropImportConfirmSuccessVisible &&
                renderer.quickDropImportConfirmPersisted &&
                renderer.quickDropImportConfirmPmidPersisted,
              detail: `busy=${renderer.quickDropImportConfirmBusyVisible}; success=${renderer.quickDropImportConfirmSuccessVisible}; persisted=${renderer.quickDropImportConfirmPersisted}; pmid=${renderer.quickDropImportConfirmPmidPersisted}`,
            },
            {
              name: "quick-import-reference-failure-rolls-back",
              pass:
                renderer.quickDropImportFailureVisible &&
                renderer.quickDropImportFailureBusyVisible &&
                renderer.quickDropImportFailurePreserved &&
                renderer.quickDropImportFailureDidNotPersist,
              detail: `visible=${renderer.quickDropImportFailureVisible}; busy=${renderer.quickDropImportFailureBusyVisible}; preserved=${renderer.quickDropImportFailurePreserved}; notPersisted=${renderer.quickDropImportFailureDidNotPersist}`,
            },
            {
              name: "library-keyboard-navigation",
              pass:
                renderer.libraryKeyboardNavigationVisible &&
                Boolean(renderer.libraryKeyboardOpenedId) &&
                renderer.libraryKeyboardOpenHash.includes(
                  `/reader?work=${encodeURIComponent(renderer.libraryKeyboardOpenedId)}`,
                ),
              detail: `${renderer.libraryKeyboardNavigationDetail}; hash=${renderer.libraryKeyboardOpenHash}; id=${renderer.libraryKeyboardOpenedId}; moved=${renderer.libraryKeyboardNavigationVisible}`,
            },
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
                renderer.readerAnnotationDeleteBusyVisible &&
                renderer.readerAnnotationDeleteSuccessVisible,
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
                renderer.readerTranslationStartBusyVisible &&
                renderer.readerTranslationStartErrorVisible,
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
              pass:
                renderer.readerLoadRetryRecoveryVisible && renderer.readerLoadRetryAttempts === 2,
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
                renderer.discoverySiteActionConfirmVisible &&
                renderer.discoverySiteActionConfirmCancelled,
              detail: `visible=${renderer.discoverySiteActionConfirmVisible}; cancelled=${renderer.discoverySiteActionConfirmCancelled}`,
            },
            {
              name: "discovery-proxy-config-save-state",
              pass:
                renderer.discoveryProxyConfigSaved &&
                renderer.discoveryProxyConfigSaveAriaBusyVisible,
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
                renderer.discoveryEzproxyConfigSaved &&
                renderer.discoveryEzproxyConfigSaveAriaBusyVisible,
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
                renderer.discoverySiteRemoveUndoBusyVisible &&
                renderer.discoverySiteRemoveUndoRecovered,
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
                renderer.discoverySiteCredentialsRejected &&
                renderer.discoverySiteCredentialDidNotPersist,
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
              pass:
                renderer.discoveryImportBusyVisible &&
                renderer.discoveryImportFulltextFallbackVisible,
              detail: renderer.discoveryTrustSignalsDetail,
            },
            {
              name: "settings-busy-navigation-guard",
              pass:
                renderer.settingsBusyNavigationConfirmVisible &&
                renderer.settingsBusyNavigationCancelPreserved &&
                renderer.settingsBusySaveControlsDisabled &&
                renderer.settingsBusySaveAriaVisible,
              detail: `visible=${renderer.settingsBusyNavigationConfirmVisible}; preserved=${renderer.settingsBusyNavigationCancelPreserved}; disabled=${renderer.settingsBusySaveControlsDisabled}; aria=${renderer.settingsBusySaveAriaVisible}`,
            },
            {
              name: "settings-initial-load-completed",
              pass: renderer.settingsInitialLoadCompleted,
            },
            {
              name: "settings-inline-secret-migration-failure-preserves-old-key",
              pass:
                renderer.settingsInlineSecretMigrationVisible &&
                renderer.settingsInlineSecretMigrationFailurePreserved &&
                renderer.settingsInlineSecretMigrationRetrySanitized,
              detail: `visible=${renderer.settingsInlineSecretMigrationVisible}; preserved=${renderer.settingsInlineSecretMigrationFailurePreserved}; sanitized=${renderer.settingsInlineSecretMigrationRetrySanitized}`,
            },
            {
              name: "settings-ai-save-failure-preserves-input",
              pass:
                renderer.settingsAiSaveFailureVisible &&
                renderer.settingsAiSaveFailurePreserved &&
                renderer.settingsAiSaveFailureDidNotPersist,
              detail: `visible=${renderer.settingsAiSaveFailureVisible}; preserved=${renderer.settingsAiSaveFailurePreserved}; notPersisted=${renderer.settingsAiSaveFailureDidNotPersist}`,
            },
            {
              name: "settings-ai-test-failure-keeps-saved-config",
              pass:
                renderer.settingsAiTestFailureVisible &&
                renderer.settingsAiTestFailureBusyVisible &&
                renderer.settingsAiTestFailureRetryVisible &&
                renderer.settingsAiTestFailureConfigSaved,
              detail: `visible=${renderer.settingsAiTestFailureVisible}; busy=${renderer.settingsAiTestFailureBusyVisible}; retry=${renderer.settingsAiTestFailureRetryVisible}; saved=${renderer.settingsAiTestFailureConfigSaved}`,
            },
            {
              name: "settings-ai-url-validation",
              pass:
                renderer.settingsAiUrlInvalidVisible &&
                renderer.settingsAiUrlCredentialsRejected &&
                renderer.settingsAiUrlInvalidDidNotPersist &&
                renderer.settingsAiUrlNormalized,
              detail: `invalid=${renderer.settingsAiUrlInvalidVisible}; credentials=${renderer.settingsAiUrlCredentialsRejected}; notPersisted=${renderer.settingsAiUrlInvalidDidNotPersist}; normalized=${renderer.settingsAiUrlNormalized}`,
            },
            {
              name: "settings-translate-save-failure-preserves-input",
              pass:
                renderer.settingsTranslateSaveFailureVisible &&
                renderer.settingsTranslateSaveFailurePreserved &&
                renderer.settingsTranslateSaveFailureDidNotPersist,
              detail: `visible=${renderer.settingsTranslateSaveFailureVisible}; preserved=${renderer.settingsTranslateSaveFailurePreserved}; notPersisted=${renderer.settingsTranslateSaveFailureDidNotPersist}`,
            },
            {
              name: "settings-translate-provider-validation",
              pass:
                renderer.settingsTranslateProviderValidationVisible &&
                renderer.settingsTranslateProviderValidationDidNotPersist,
              detail: `visible=${renderer.settingsTranslateProviderValidationVisible}; notPersisted=${renderer.settingsTranslateProviderValidationDidNotPersist}`,
            },
            {
              name: "settings-sync-save-failure-preserves-input",
              pass:
                renderer.settingsSyncSaveFailureVisible &&
                renderer.settingsSyncSaveFailurePreserved &&
                renderer.settingsSyncSaveFailureDidNotPersist,
              detail: `visible=${renderer.settingsSyncSaveFailureVisible}; preserved=${renderer.settingsSyncSaveFailurePreserved}; notPersisted=${renderer.settingsSyncSaveFailureDidNotPersist}`,
            },
            {
              name: "settings-sync-run-failure-preserves-config",
              pass:
                renderer.settingsSyncRunFailureVisible &&
                renderer.settingsSyncRunActionableFailureVisible &&
                renderer.settingsSyncRunFailureBusyVisible &&
                renderer.settingsSyncRunFailureRetryVisible &&
                renderer.settingsSyncRunFailureConfigPreserved,
              detail: `visible=${renderer.settingsSyncRunFailureVisible}; actionable=${renderer.settingsSyncRunActionableFailureVisible}; busy=${renderer.settingsSyncRunFailureBusyVisible}; retry=${renderer.settingsSyncRunFailureRetryVisible}; config=${renderer.settingsSyncRunFailureConfigPreserved}`,
            },
            {
              name: "settings-sync-webdav-quota-guidance",
              pass: renderer.settingsSyncRunQuotaGuidanceVisible,
            },
            {
              name: "settings-sync-url-validation",
              pass:
                renderer.settingsSyncUrlInvalidVisible &&
                renderer.settingsSyncUrlCredentialsRejected &&
                renderer.settingsSyncUrlInvalidDidNotPersist &&
                renderer.settingsSyncUrlNormalized,
              detail: `invalid=${renderer.settingsSyncUrlInvalidVisible}; credentials=${renderer.settingsSyncUrlCredentialsRejected}; notPersisted=${renderer.settingsSyncUrlInvalidDidNotPersist}; normalized=${renderer.settingsSyncUrlNormalized}`,
            },
            {
              name: "settings-ai-load-retry-recovery",
              pass:
                renderer.settingsAiLoadRetryRecoveryVisible &&
                renderer.settingsAiLoadRetryAttempts === 2,
              detail: renderer.settingsAiLoadRetryRecoveryDetail,
            },
            {
              name: "settings-translate-load-retry-recovery",
              pass:
                renderer.settingsTranslateLoadRetryRecoveryVisible &&
                renderer.settingsTranslateLoadRetryAttempts === 2,
              detail: renderer.settingsTranslateLoadRetryRecoveryDetail,
            },
            {
              name: "settings-sync-load-retry-recovery",
              pass:
                renderer.settingsSyncLoadRetryRecoveryVisible &&
                renderer.settingsSyncLoadRetryAttempts === 2,
              detail: renderer.settingsSyncLoadRetryRecoveryDetail,
            },
            {
              name: "settings-target-section-highlight",
              pass: renderer.settingsTargetTranslateSectionVisible,
            },
            {
              name: "settings-backup-export-feedback",
              pass:
                renderer.settingsBackupExportBusyVisible &&
                renderer.settingsBackupExportAriaBusyVisible &&
                renderer.settingsBackupExportSuccessVisible &&
                renderer.settingsBackupExportFailureVisible &&
                renderer.settingsBackupExportRecencyVisible &&
                renderer.settingsBackupExportSecretsSanitized &&
                renderer.settingsBackupExportEphemeralDataExcluded,
              detail: `busy=${renderer.settingsBackupExportBusyVisible}; aria=${renderer.settingsBackupExportAriaBusyVisible}; success=${renderer.settingsBackupExportSuccessVisible}; failure=${renderer.settingsBackupExportFailureVisible}; recency=${renderer.settingsBackupExportRecencyVisible}; secretsSanitized=${renderer.settingsBackupExportSecretsSanitized}; ephemeralExcluded=${renderer.settingsBackupExportEphemeralDataExcluded}`,
            },
            {
              name: "settings-backup-import-feedback",
              pass:
                renderer.settingsBackupImportConfirmVisible &&
                renderer.settingsBackupImportCancelPreserved &&
                renderer.settingsBackupImportBusyVisible &&
                renderer.settingsBackupImportAttachmentDeactivated &&
                renderer.settingsBackupImportAttachmentIdCollisionRemapped &&
                renderer.settingsBackupImportReattachAnnotationRestored &&
                renderer.settingsBackupImportSearchIndexed &&
                renderer.settingsBackupImportSettingsSanitized &&
                renderer.settingsBackupImportLibraryScoped &&
                renderer.settingsBackupImportAiJobsPortable &&
                renderer.settingsBackupImportEphemeralDataExcluded &&
                renderer.settingsBackupImportIgnoredOnlyExplained &&
                renderer.settingsBackupImportStableIdMerged &&
                renderer.settingsBackupImportSuccessVisible &&
                renderer.settingsBackupImportPersisted &&
                renderer.settingsBackupImportRejectsInvalidVisible &&
                renderer.settingsBackupImportRejectsFutureVersionVisible &&
                renderer.settingsBackupImportRuntimeSkipExplained,
              detail: `confirm=${renderer.settingsBackupImportConfirmVisible}; cancel=${renderer.settingsBackupImportCancelPreserved}; busy=${renderer.settingsBackupImportBusyVisible}; attachmentInactive=${renderer.settingsBackupImportAttachmentDeactivated}; attachmentIdRemapped=${renderer.settingsBackupImportAttachmentIdCollisionRemapped}; reattachAnnotations=${renderer.settingsBackupImportReattachAnnotationRestored}; searchIndexed=${renderer.settingsBackupImportSearchIndexed}; settingsSanitized=${renderer.settingsBackupImportSettingsSanitized}; libraryScoped=${renderer.settingsBackupImportLibraryScoped}; aiJobsPortable=${renderer.settingsBackupImportAiJobsPortable}; ephemeralExcluded=${renderer.settingsBackupImportEphemeralDataExcluded}; ignoredOnly=${renderer.settingsBackupImportIgnoredOnlyExplained}; runtimeSkip=${renderer.settingsBackupImportRuntimeSkipExplained}; stableMerge=${renderer.settingsBackupImportStableIdMerged}; success=${renderer.settingsBackupImportSuccessVisible}; persisted=${renderer.settingsBackupImportPersisted}; rejectsInvalid=${renderer.settingsBackupImportRejectsInvalidVisible}; rejectsFuture=${renderer.settingsBackupImportRejectsFutureVersionVisible}`,
            },
            {
              name: "settings-backup-import-failure-rolls-back",
              pass:
                renderer.settingsBackupImportFailureVisible &&
                renderer.settingsBackupImportFailureBusyVisible &&
                renderer.settingsBackupImportFailureDidNotPersist &&
                renderer.settingsBackupImportFailureRetryVisible,
              detail: `visible=${renderer.settingsBackupImportFailureVisible}; busy=${renderer.settingsBackupImportFailureBusyVisible}; notPersisted=${renderer.settingsBackupImportFailureDidNotPersist}; retry=${renderer.settingsBackupImportFailureRetryVisible}`,
            },
            {
              name: "settings-translation-cache-clear-confirm",
              pass:
                renderer.settingsTranslationCacheClearConfirmVisible &&
                renderer.settingsTranslationCacheClearCancelled &&
                renderer.settingsTranslationCacheClearBusyVisible &&
                renderer.settingsTranslationCacheClearSuccessVisible &&
                renderer.settingsTranslationCacheClearPersisted,
              detail: `visible=${renderer.settingsTranslationCacheClearConfirmVisible}; cancelled=${renderer.settingsTranslationCacheClearCancelled}; busy=${renderer.settingsTranslationCacheClearBusyVisible}; success=${renderer.settingsTranslationCacheClearSuccessVisible}; persisted=${renderer.settingsTranslationCacheClearPersisted}`,
            },
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
          const failed = checks.filter((check) => !check.pass);
          const ok = failed.length === 0 && consoleErrors.length === 0;
          finish(
            {
              ok,
              checks,
              failed,
              consoleErrors,
              consoleWarnings,
              renderer: {
                hash: renderer.hash,
                heading: renderer.heading,
                title: renderer.title,
                workCount: renderer.seededWorkCount ?? renderer.initialWorkCount,
              },
            },
            ok ? 0 : 1,
          );
        })
        .catch((error: unknown) => {
          finish(
            {
              ok: false,
              reason: "execute-javascript-failed",
              error: error instanceof Error ? error.message : String(error),
              consoleErrors,
              consoleWarnings,
            },
            1,
          );
        });
    }, 250);
  });
}
