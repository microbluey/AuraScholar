import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildSettingsSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
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
        renderer.settingsAiLoadRetryRecoveryVisible && renderer.settingsAiLoadRetryAttempts === 2,
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
  ];
}
