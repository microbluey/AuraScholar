// Smoke-test harness (E2E in-app checks), main-process side. Loaded ONLY when
// AURASCHOLAR_SMOKE=1 via a dynamic import in main.ts, so it stays out of the
// normal startup path and ships as a separate lazy chunk.
// Driven by scripts/smoke-electron.mjs, which parses the JSON result line.
import { app, type BrowserWindow } from "electron";

const SMOKE_MODE = process.env.AURASCHOLAR_SMOKE === "1";
const SMOKE_RESULT_PREFIX = "AURASCHOLAR_SMOKE_RESULT ";

interface SmokeRendererResult {
  aiSettingsFallbackVisible: boolean;
  bodyText: string;
  browserPreviewWarning: boolean;
  commandCompositionEscapeIgnored: boolean;
  commandCompositionIgnored: boolean;
  commandDialogOpen: boolean;
  commandShortcutLabel: string;
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
  discoveryDuplicateSavedSearchBlocked: boolean;
  discoveryDuplicateSavedSearchCount: number | null;
  discoveryDuplicateSavedSearchMessageVisible: boolean;
  discoverySavedSearchDeleteBusyVisible: boolean;
  discoverySavedSearchDeleteConfirmVisible: boolean;
  discoverySavedSearchDeleted: boolean;
  discoverySavedSearchDeletePersisted: boolean;
  discoveryEzproxyConfigSaveAriaBusyVisible: boolean;
  discoveryEzproxyConfigSaveBusyVisible: boolean;
  discoveryEzproxyConfigSaved: boolean;
  discoveryEzproxyConfigValue: string | null;
  discoveryFulltextCueVisible: boolean;
  discoveryImportBusyVisible: boolean;
  discoveryImportFulltextFallbackVisible: boolean;
  discoverySearchAriaBusyVisible: boolean;
  discoverySearchBusyVisible: boolean;
  discoveryTrustSignalsDetail: string;
  discoverySearchProgressLiveVisible: boolean;
  discoverySavedSearchManualCheckBusyVisible: boolean;
  discoverySavedSearchManualCheckCompleted: boolean;
  discoverySavedSearchHomeOpenBusyVisible: boolean;
  discoverySavedSearchHomeOpenClearedNewCount: boolean;
  discoverySavedSearchHomeOpenNavigated: boolean;
  discoverySavedSearchLastErrorVisible: boolean;
  discoveryTrustSignalsVisible: boolean;
  discoveryProxyConfigSaveAriaBusyVisible: boolean;
  discoveryProxyConfigSaveBusyVisible: boolean;
  discoveryProxyConfigSaved: boolean;
  discoveryProxyConfigValue: string | null;
  discoverySearchCompositionIgnored: boolean;
  discoverySiteProxyToggleBusyVisible: boolean;
  discoverySiteProxyToggled: boolean;
  discoverySiteProxyValue: number | null;
  discoverySiteHideActionBusyVisible: boolean;
  discoverySiteHideActionConfirmed: boolean;
  discoverySiteHideActionHiddenValue: number | null;
  discoverySiteRemoveActionBusyVisible: boolean;
  discoverySiteRemoveActionCount: number | null;
  discoverySiteRemoveActionDeleted: boolean;
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
  dbError: string | null;
  emptyStateVisible: boolean;
  externalUnsafeRejected: boolean;
  flashcardCardSpaceReveals: boolean;
  flashcardFocusedButtonSpacePreservesReveal: boolean;
  flashcardRatingBusyVisible: boolean;
  flashcardRatingCompleted: boolean;
  flashcardRatingPersisted: boolean;
  graphCachedVisible: boolean;
  graphInputCompositionIgnored: boolean;
  graphImportBusyVisible: boolean;
  graphImportFailureFeedbackVisible: boolean;
  graphNodeKeyboardSelectable: boolean;
  hash: string;
  hasAuraBridge: boolean;
  heading: string;
  homepageClearSelectedCancelPreserved: boolean;
  homepageClearSelectedConfirmVisible: boolean;
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
  homepageSafeLinkRelHardened: boolean;
  initialWorkCount: number | null;
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
  libraryCollectionDeleteBusyVisible: boolean;
  libraryCollectionDeletePersisted: boolean;
  libraryCollectionDeleteSuccessVisible: boolean;
  libraryKeyboardNavigationVisible: boolean;
  libraryKeyboardOpenHash: string;
  libraryKeyboardOpenedId: string;
  libraryPdfUploadBusyVisible: boolean;
  libraryPdfUploadPersisted: boolean;
  libraryPdfUploadSuccessVisible: boolean;
  libraryMergeBusyVisible: boolean;
  libraryMergePersisted: boolean;
  libraryMergeSuccessVisible: boolean;
  libraryMoveToCollectionBusyVisible: boolean;
  libraryMoveToCollectionPersisted: boolean;
  libraryMoveToCollectionSuccessVisible: boolean;
  libraryTagDeleteBusyVisible: boolean;
  libraryTagDeletePersisted: boolean;
  libraryTagDeleteSuccessVisible: boolean;
  libraryTrashRestoreBusyVisible: boolean;
  libraryTrashRestoreSuccessVisible: boolean;
  metadataInvalidYearBlocked: boolean;
  metadataInvalidYearErrorVisible: boolean;
  metadataInvalidYearPreserved: boolean;
  metadataSaveBusyVisible: boolean;
  metadataSavePersisted: boolean;
  libraryPdfAttachmentVisible: boolean;
  librarySentinelCreateBusyVisible: boolean;
  librarySentinelExistingLinked: boolean;
  librarySentinelExistingLinkedCount: number | null;
  librarySentinelExistingLinkedMessageVisible: boolean;
  libraryReadingStatusBusyVisible: boolean;
  libraryReadingStatusPersisted: boolean;
  libraryReadingStatusSuccessVisible: boolean;
  libraryStarBusyVisible: boolean;
  libraryStarPersisted: boolean;
  libraryStarSuccessVisible: boolean;
  quickAddCompositionIgnored: boolean;
  quickImportConfirmCommitBusyVisible: boolean;
  quickImportConfirmDialogVisible: boolean;
  quickImportConfirmCommitPersisted: boolean;
  librarySearchShortcutLabel: string;
  librarySearchShortcutFocused: boolean;
  populatedStateVisible: boolean;
  quickDropImportConfirmBusyVisible: boolean;
  quickDropImportConfirmPersisted: boolean;
  quickDropImportConfirmPmidPersisted: boolean;
  quickDropImportConfirmSuccessVisible: boolean;
  quickDropImportCount: number | null;
  quickDropImportPreviewVisible: boolean;
  readingStatus: string | null;
  readerBrokenAttachmentCount: number | null;
  readerBrokenBlobRecoveryVisible: boolean;
  readerBrokenBlobVisible: boolean;
  readerBrokenHash: string;
  readerAnnotationDeleteBusyVisible: boolean;
  readerAnnotationDeleteCancelPreserved: boolean;
  readerAnnotationDeleteConfirmVisible: boolean;
  readerAnnotationDeleteSuccessVisible: boolean;
  readerCommentDirtyExportBlocked: boolean;
  readerCommentDirtyExportDownloadPrevented: boolean;
  readerCommentDirtyExportMessageVisible: boolean;
  readerCommentDraftCancelPreserved: boolean;
  readerCommentDraftConfirmVisible: boolean;
  readerCommentDraftDiscarded: boolean;
  readerCommentSaveBusyVisible: boolean;
  readerCommentSavePersisted: boolean;
  readerCommentShortcutCompositionIgnored: boolean;
  readerCanvasVisible: boolean;
  readerCorruptAttachmentCount: number | null;
  readerCorruptPdfRecoveryVisible: boolean;
  readerCorruptPdfVisible: boolean;
  readerCorruptHash: string;
  readerDigestGenerateBusyVisible: boolean;
  readerDigestGenerateErrorVisible: boolean;
  readerErrorVisible: boolean;
  readerHash: string;
  readerMissingHash: string;
  readerMissingPdfAttachBusyVisible: boolean;
  readerMissingPdfRecoveryVisible: boolean;
  readerMissingPdfVisible: boolean;
  readerPageBadgeVisible: boolean;
  readerRecoveredAttachmentCount: number | null;
  readerRecoveredPdfVisible: boolean;
  readerSnippetSaveBusyVisible: boolean;
  readerSnippetSavePersisted: boolean;
  readerTitleVisible: boolean;
  readerTranslationClipboardMatches: boolean;
  readerTranslationCopyBusyVisible: boolean;
  readerTranslationCopyFeedbackVisible: boolean;
  readerTranslationCopyStatusText: string;
  readerTranslationStartBusyVisible: boolean;
  readerTranslationStartErrorVisible: boolean;
  routeCrashBoundaryVisible: boolean;
  routeCrashRecoveredLibraryVisible: boolean;
  routeCrashRecoveryHash: string;
  routeCrashShellVisible: boolean;
  searchDataPathOk: boolean;
  searchEmptyStateVisible: boolean;
  searchResultVisible: boolean;
  settingsBackupExportBusyVisible: boolean;
  settingsBackupExportAriaBusyVisible: boolean;
  settingsBackupExportFailureVisible: boolean;
  settingsBackupExportSuccessVisible: boolean;
  settingsBusySaveAriaVisible: boolean;
  settingsBusyNavigationCancelPreserved: boolean;
  settingsBusyNavigationConfirmVisible: boolean;
  settingsBusySaveControlsDisabled: boolean;
  settingsInitialLoadCompleted: boolean;
  settingsTranslationCacheClearBusyVisible: boolean;
  settingsTranslationCacheClearCancelled: boolean;
  settingsTranslationCacheClearConfirmVisible: boolean;
  settingsTranslationCacheClearPersisted: boolean;
  settingsTranslationCacheClearSuccessVisible: boolean;
  sentinelAddCompositionIgnored: boolean;
  sentinelAddBusyVisible: boolean;
  sentinelDeletedDoiRestored: boolean;
  sentinelDeletedDoiRestoredCount: number | null;
  sentinelDuplicateDoiBlocked: boolean;
  sentinelDuplicateDoiCount: number | null;
  sentinelDuplicateDoiMessageVisible: boolean;
  sentinelLastErrorVisible: boolean;
  sentinelTaskCheckBusyVisible: boolean;
  sentinelManualFailureRecorded: boolean;
  sentinelManualFailureVisible: boolean;
  seededWorkCount: number | null;
  snippetCardCopyAriaBusyVisible: boolean;
  snippetCardCopyBusyVisible: boolean;
  snippetCardCopyCitationAriaBusyVisible: boolean;
  snippetCardCopyCitationBusyVisible: boolean;
  snippetDeleteAriaBusyVisible: boolean;
  snippetDeleteBusyVisible: boolean;
  snippetDeleteSuccessVisible: boolean;
  snippetDirtyCopyBlocked: boolean;
  snippetDirtyCopyClipboardPreserved: boolean;
  snippetDirtyCopyMessageVisible: boolean;
  snippetEditorClosedAfterShortcut: boolean;
  snippetEscapeCompositionIgnored: boolean;
  snippetSavedNote: string | null;
  snippetSaveCompositionIgnored: boolean;
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

function summarize(value: string, limit = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function emitSmokeResult(result: unknown, code: 0 | 1): void {
  console.log(`${SMOKE_RESULT_PREFIX}${JSON.stringify(result)}`);
  setTimeout(() => app.exit(code), 50);
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
  }, 45_000);

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
        const COLLECTION_MANAGER_SMOKE = {
          id: "smoke-collection-manager-action",
          name: "Smoke Collection Manager Action"
        };
        const MOVE_COLLECTION_SMOKE = {
          id: "smoke-collection-move-target",
          name: "Smoke Move Target"
        };
        const BULK_TAG_SMOKE = {
          name: "Smoke Bulk Tag"
        };
        const MERGE_SMOKE = {
          primaryId: "smoke-work-merge-primary",
          primaryTitle: "Smoke Merge Primary Paper",
          primaryDoi: "10.4242/aurascholar.merge-primary",
          duplicateId: "smoke-work-merge-duplicate",
          duplicateTitle: "Smoke Merge Duplicate Paper",
          duplicateDoi: "10.4242/aurascholar.merge-duplicate"
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
        const TRASH_ACTION_SMOKE = {
          author: "Barbara Liskov",
          doi: "10.4242/aurascholar.trash-action",
          title: "Recoverable Library Asset Actions",
          venue: "Journal of Safe Library Operations",
          workId: "smoke-work-trash-action",
          authorId: "smoke-author-barbara"
        };
        const GRAPH_SMOKE = {
          centerDoi: "10.4242/aurascholar.graph-smoke",
          centerTitle: "Smoke Graph Center Paper",
          referenceDoi: " ",
          referenceTitle: "Smoke Graph Reference Node",
        };
        const FLASHCARD_SMOKE = {
          id: "smoke-flashcard-keyboard",
          front: "Smoke flashcard keyboard front",
          back: "Smoke flashcard keyboard back"
        };
        const SNIPPET_SMOKE = {
          id: "smoke-snippet-keyboard",
          quote: "Smoke snippet quote for keyboard editing",
          noteDraft: "Smoke snippet note saved by keyboard shortcut"
        };
        const SAVED_SEARCH_SMOKE = {
          id: "smoke-saved-search-duplicate",
          query: "Composition Discovery Search"
        };
        const SAVED_SEARCH_MANUAL_SMOKE = {
          id: "smoke-saved-search-manual-check",
          query: "Smoke Manual Saved Search Check"
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
        const DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-duplicate-site",
          name: "Smoke Duplicate Site",
          homeUrl: "https://smoke-site.example/",
          searchUrl: "https://smoke-site.example/search?q="
        };
        const REMOVABLE_DISCOVERY_SITE_SMOKE = {
          id: "custom:smoke-removable-site",
          name: "Smoke Removable Site",
          homeUrl: "https://removable-smoke-site.example/",
          searchUrl: "https://removable-smoke-site.example/search?q="
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
        const DISCOVERY_EZPROXY_CONFIG_SMOKE =
          "https://login.ezproxy.example.edu/login?url=";
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

        let initialWorkCount = null;
        let readingStatus = null;
        let commandCompositionEscapeIgnored = false;
        let commandCompositionIgnored = false;
        let detailVisible = false;
        let discoverySearchCompositionIgnored = false;
        let externalUnsafeRejected = false;
        let flashcardCardSpaceReveals = false;
        let flashcardFocusedButtonSpacePreservesReveal = false;
        let flashcardRatingBusyVisible = false;
        let flashcardRatingCompleted = false;
        let flashcardRatingPersisted = false;
        let graphCachedVisible = false;
        let graphInputCompositionIgnored = false;
        let graphImportBusyVisible = false;
        let graphImportFailureFeedbackVisible = false;
        let graphNodeKeyboardSelectable = false;
        let homepageClearSelectedCancelPreserved = false;
        let homepageClearSelectedConfirmVisible = false;
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
        let homepageSafeLinkRelHardened = false;
        let commandShortcutLabel = "";
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
        let discoveryDuplicateSavedSearchBlocked = false;
        let discoveryDuplicateSavedSearchCount = null;
        let discoveryDuplicateSavedSearchMessageVisible = false;
        let discoverySavedSearchDeleteBusyVisible = false;
        let discoverySavedSearchDeleteConfirmVisible = false;
        let discoverySavedSearchDeleted = false;
        let discoverySavedSearchDeletePersisted = false;
        let discoveryEzproxyConfigSaveAriaBusyVisible = false;
        let discoveryEzproxyConfigSaveBusyVisible = false;
        let discoveryEzproxyConfigSaved = false;
        let discoveryEzproxyConfigValue = null;
        let discoveryFulltextCueVisible = false;
        let discoveryImportBusyVisible = false;
        let discoveryImportFulltextFallbackVisible = false;
        let discoverySearchAriaBusyVisible = false;
        let discoverySearchBusyVisible = false;
        let discoveryTrustSignalsDetail = "";
        let discoverySearchProgressLiveVisible = false;
        let discoverySavedSearchManualCheckBusyVisible = false;
        let discoverySavedSearchManualCheckCompleted = false;
        let discoverySavedSearchHomeOpenBusyVisible = false;
        let discoverySavedSearchHomeOpenClearedNewCount = false;
        let discoverySavedSearchHomeOpenNavigated = false;
        let discoverySavedSearchLastErrorVisible = false;
        let discoveryTrustSignalsVisible = false;
        let discoveryProxyConfigSaveAriaBusyVisible = false;
        let discoveryProxyConfigSaveBusyVisible = false;
        let discoveryProxyConfigSaved = false;
        let discoveryProxyConfigValue = null;
        let discoverySiteProxyToggleBusyVisible = false;
        let discoverySiteProxyToggled = false;
        let discoverySiteProxyValue = null;
        let discoverySiteHideActionBusyVisible = false;
        let discoverySiteHideActionConfirmed = false;
        let discoverySiteHideActionHiddenValue = null;
        let discoverySiteRemoveActionBusyVisible = false;
        let discoverySiteRemoveActionCount = null;
        let discoverySiteRemoveActionDeleted = false;
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
        let libraryBulkTagBusyVisible = false;
        let libraryBulkTagPersisted = false;
        let libraryBulkTagSuccessVisible = false;
        let libraryReadingStatusBusyVisible = false;
        let libraryReadingStatusPersisted = false;
        let libraryReadingStatusSuccessVisible = false;
        let libraryStarBusyVisible = false;
        let libraryStarPersisted = false;
        let libraryStarSuccessVisible = false;
        let libraryCitationCopyBusyVisible = false;
        let libraryCitationCopyFailureVisible = false;
        let libraryCitationCopySuccessVisible = false;
        let libraryCitationExportBusyVisible = false;
        let libraryCitationExportFailureVisible = false;
        let libraryCitationExportPmidVisible = false;
        let libraryCitationExportSuccessVisible = false;
        let libraryCollectionDeleteBusyVisible = false;
        let libraryCollectionDeletePersisted = false;
        let libraryCollectionDeleteSuccessVisible = false;
        let libraryBodyText = "";
        let libraryHash = "";
        let libraryHeading = "";
        let libraryKeyboardNavigationVisible = false;
        let libraryKeyboardOpenHash = "";
        let libraryKeyboardOpenedId = "";
        let libraryPdfUploadBusyVisible = false;
        let libraryPdfUploadPersisted = false;
        let libraryPdfUploadSuccessVisible = false;
        let libraryMergeBusyVisible = false;
        let libraryMergePersisted = false;
        let libraryMergeSuccessVisible = false;
        let libraryMoveToCollectionBusyVisible = false;
        let libraryMoveToCollectionPersisted = false;
        let libraryMoveToCollectionSuccessVisible = false;
        let libraryTagDeleteBusyVisible = false;
        let libraryTagDeletePersisted = false;
        let libraryTagDeleteSuccessVisible = false;
        let libraryTrashRestoreBusyVisible = false;
        let libraryTrashRestoreSuccessVisible = false;
        let metadataInvalidYearBlocked = false;
        let metadataInvalidYearErrorVisible = false;
        let metadataInvalidYearPreserved = false;
        let metadataSaveBusyVisible = false;
        let metadataSavePersisted = false;
        let librarySentinelCreateBusyVisible = false;
        let librarySentinelExistingLinked = false;
        let librarySentinelExistingLinkedCount = null;
        let librarySentinelExistingLinkedMessageVisible = false;
        let quickAddCompositionIgnored = false;
        let quickImportConfirmCommitBusyVisible = false;
        let quickImportConfirmDialogVisible = false;
        let quickImportConfirmCommitPersisted = false;
        let librarySearchShortcutLabel = "";
        let librarySearchShortcutFocused = false;
        let populatedStateVisible = false;
        let quickDropImportConfirmBusyVisible = false;
        let quickDropImportConfirmPersisted = false;
        let quickDropImportConfirmPmidPersisted = false;
        let quickDropImportConfirmSuccessVisible = false;
        let quickDropImportCount = null;
        let quickDropImportPreviewVisible = false;
        let readerBrokenAttachmentCount = null;
        let readerBrokenBlobRecoveryVisible = false;
        let readerBrokenBlobVisible = false;
        let readerBrokenHash = "";
        let readerAnnotationDeleteBusyVisible = false;
        let readerAnnotationDeleteCancelPreserved = false;
        let readerAnnotationDeleteConfirmVisible = false;
        let readerAnnotationDeleteSuccessVisible = false;
        let readerCommentDirtyExportBlocked = false;
        let readerCommentDirtyExportDownloadPrevented = false;
        let readerCommentDirtyExportMessageVisible = false;
        let readerCommentDraftCancelPreserved = false;
        let readerCommentDraftConfirmVisible = false;
        let readerCommentDraftDiscarded = false;
        let readerCommentSaveBusyVisible = false;
        let readerCommentSavePersisted = false;
        let readerCommentShortcutCompositionIgnored = false;
        let readerCanvasVisible = false;
        let readerCorruptAttachmentCount = null;
        let readerCorruptPdfRecoveryVisible = false;
        let readerCorruptPdfVisible = false;
        let readerCorruptHash = "";
        let readerDigestGenerateBusyVisible = false;
        let readerDigestGenerateErrorVisible = false;
        let readerErrorVisible = false;
        let readerHash = "";
        let readerMissingHash = "";
        let readerMissingPdfAttachBusyVisible = false;
        let readerMissingPdfRecoveryVisible = false;
        let readerMissingPdfVisible = false;
        let readerPageBadgeVisible = false;
        let readerRecoveredAttachmentCount = null;
        let readerRecoveredPdfVisible = false;
        let readerSnippetSaveBusyVisible = false;
        let readerSnippetSavePersisted = false;
        let readerTitleVisible = false;
        let readerTranslationClipboardMatches = false;
        let readerTranslationCopyBusyVisible = false;
        let readerTranslationCopyFeedbackVisible = false;
        let readerTranslationCopyStatusText = "";
        let readerTranslationStartBusyVisible = false;
        let readerTranslationStartErrorVisible = false;
        let routeCrashBoundaryVisible = false;
        let routeCrashRecoveredLibraryVisible = false;
        let routeCrashRecoveryHash = "";
        let routeCrashShellVisible = false;
        let searchDataPathOk = false;
        let searchEmptyStateVisible = false;
        let searchResultVisible = false;
        let settingsBackupExportBusyVisible = false;
        let settingsBackupExportAriaBusyVisible = false;
        let settingsBackupExportFailureVisible = false;
        let settingsBackupExportSuccessVisible = false;
        let settingsBusySaveAriaVisible = false;
        let settingsBusyNavigationCancelPreserved = false;
        let settingsBusyNavigationConfirmVisible = false;
        let settingsBusySaveControlsDisabled = false;
        let settingsInitialLoadCompleted = false;
        let settingsTranslationCacheClearBusyVisible = false;
        let settingsTranslationCacheClearCancelled = false;
        let settingsTranslationCacheClearConfirmVisible = false;
        let settingsTranslationCacheClearPersisted = false;
        let settingsTranslationCacheClearSuccessVisible = false;
        let sentinelAddCompositionIgnored = false;
        let sentinelAddBusyVisible = false;
        let sentinelDeletedDoiRestored = false;
        let sentinelDeletedDoiRestoredCount = null;
        let sentinelDuplicateDoiBlocked = false;
        let sentinelDuplicateDoiCount = null;
        let sentinelDuplicateDoiMessageVisible = false;
        let sentinelLastErrorVisible = false;
        let sentinelTaskCheckBusyVisible = false;
        let sentinelManualFailureRecorded = false;
        let sentinelManualFailureVisible = false;
        let seededWorkCount = null;
        let snippetCardCopyAriaBusyVisible = false;
        let snippetCardCopyBusyVisible = false;
        let snippetCardCopyCitationAriaBusyVisible = false;
        let snippetCardCopyCitationBusyVisible = false;
        let snippetDeleteAriaBusyVisible = false;
        let snippetDeleteBusyVisible = false;
        let snippetDeleteSuccessVisible = false;
        let snippetDirtyCopyBlocked = false;
        let snippetDirtyCopyClipboardPreserved = false;
        let snippetDirtyCopyMessageVisible = false;
        let snippetEditorClosedAfterShortcut = false;
        let snippetEscapeCompositionIgnored = false;
        let snippetSavedNote = null;
        let snippetSaveCompositionIgnored = false;
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
          await window.aura?.openExternal?.("javascript:alert('aurascholar-smoke')");
        } catch {
          externalUnsafeRejected = true;
        }

        if (Number(initialWorkCount) === 0) {
          await waitFor(() => bodyIncludes("把第一篇论文放进工作台"), 8_000);
        }
        const emptyStateVisible = bodyIncludes("把第一篇论文放进工作台");

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
                now - 1,
                now - 1
              ]
            );
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
              "UPDATE works SET deleted_at = ?, updated_at = ? WHERE id = ?",
              [now - 2_000, now - 4, TRASH_ACTION_SMOKE.workId]
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
              [TRASH_ACTION_SMOKE.authorId, TRASH_ACTION_SMOKE.author, now, now]
            );
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
              [TRASH_ACTION_SMOKE.workId, TRASH_ACTION_SMOKE.authorId, 0, TRASH_ACTION_SMOKE.author, "author"]
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
              "INSERT OR IGNORE INTO work_tags (work_id, tag_id) VALUES (?, ?)",
              [SAMPLE.workId, SAMPLE.tagId]
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
              "INSERT OR IGNORE INTO flashcards (id, work_id, front_md, back_md, card_type, source, ai_model, generation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                FLASHCARD_SMOKE.id,
                SAMPLE.workId,
                FLASHCARD_SMOKE.front,
                FLASHCARD_SMOKE.back,
                "qa",
                "smoke",
                null,
                null,
                now,
                now
              ]
            );
            await window.aura.db.run(
              "INSERT OR REPLACE INTO flashcard_srs (flashcard_id, due_at, stability, difficulty, reps, lapses, state, last_review_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              [FLASHCARD_SMOKE.id, now - 1_000, 0, 0, 0, 0, 0, null]
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
                    }
                  ],
                  edges: [{ source: "WsmokeGraphCenter", target: "WsmokeGraphReference" }],
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
              bodyIncludes("PDF 预览") &&
              bodyIncludes("aurascholar-smoke.pdf") &&
              bodyIncludes("1 个可读"),
            8_000
          );
          libraryPdfAttachmentVisible =
            bodyIncludes("PDF 预览") &&
            bodyIncludes("aurascholar-smoke.pdf") &&
            bodyIncludes("1 个可读") &&
            bodyIncludes("进入阅读器");

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
            setInputValue(searchInput, "");
            await waitFor(() => rowText().includes(SAMPLE.title), 3_000);
          } else {
            searchEmptyStateVisible = true;
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
            const panel = Array.from(document.querySelectorAll(".library-automation")).find((item) =>
              item.textContent?.includes("入库与处理")
            );
            return (
              Array.from(panel?.querySelectorAll("button") ?? []).find((button) => {
                const label = button.textContent?.replace(/\s+/g, " ").trim();
                return label === "上传 PDF" || label === "上传中..." || label === "添加 PDF";
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
                libraryUploadButton()?.textContent?.includes("添加 PDF"),
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
                Boolean(libraryUploadButton()?.textContent?.includes("添加 PDF")));
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

          const trashTab = Array.from(document.querySelectorAll(".library-tab")).find((button) =>
            button.textContent?.includes("回收站")
          );
          trashTab?.click();
          await waitFor(
            () =>
              document.querySelector('input[placeholder="搜索回收站"]') &&
              bodyIncludes(TRASH_ACTION_SMOKE.title),
            3_000
          );
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
            const allTab = Array.from(document.querySelectorAll(".library-tab")).find((button) =>
              button.textContent?.includes("全部")
            );
            allTab?.click();
          }
          await waitFor(() => rowText().includes(SAMPLE.title), 3_000);

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
            libraryStarButton.click();
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

          clickRowByTitle(SAMPLE.title);
          await waitFor(
            () =>
              (document.querySelector(".library-detail--selected h2")?.textContent ?? "").includes(SAMPLE.title),
            2_000
          );
          const libraryCreateSentinelButton = await waitFor(
            () => {
              const panel = Array.from(document.querySelectorAll(".library-automation")).find((item) =>
                item.textContent?.includes("哨兵状态")
              );
              return (
                Array.from(panel?.querySelectorAll("button") ?? []).find(
                  (button) => button.textContent?.replace(/\s+/g, " ").trim() === "开始监控"
                ) ?? null
              );
            },
            3_000
          );
          libraryCreateSentinelButton?.click();
          librarySentinelCreateBusyVisible = Boolean(
            await waitFor(() => {
              const panel = Array.from(document.querySelectorAll(".library-automation")).find((item) =>
                item.textContent?.includes("哨兵状态")
              );
              const busyButton = Array.from(panel?.querySelectorAll("button") ?? []).find(
                (button) => button.getAttribute("aria-busy") === "true"
              );
              return busyButton?.disabled &&
                busyButton.textContent?.includes("加入中") &&
                bodyIncludes("正在加入检索哨兵:《" + SAMPLE.title + "》")
                ? busyButton
                : null;
            }, 1_000)
          );
          await waitFor(
            () => bodyIncludes("这篇文献已经在哨兵列表中"),
            3_000
          );
          const librarySentinelRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM sentinel_tasks WHERE doi = ? AND deleted_at IS NULL",
            [SAMPLE.doi]
          );
          const librarySentinelLinkedRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM sentinel_tasks WHERE doi = ? AND work_id = ? AND deleted_at IS NULL",
            [SAMPLE.doi, SAMPLE.workId]
          );
          librarySentinelExistingLinkedCount = Number(librarySentinelRows[0]?.n ?? 0);
          librarySentinelExistingLinkedMessageVisible = bodyIncludes("这篇文献已经在哨兵列表中");
          librarySentinelExistingLinked =
            librarySentinelExistingLinkedMessageVisible &&
            librarySentinelExistingLinkedCount === 1 &&
            Number(librarySentinelLinkedRows[0]?.n ?? 0) === 1;
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll(".library-automation")).some(
                (item) =>
                  item.textContent?.includes("哨兵状态") &&
                  Array.from(item.querySelectorAll("button")).some(
                    (button) => button.textContent?.replace(/\s+/g, " ").trim() === "开始监控"
                  )
              ),
            3_000
          );
        }

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
        commandShortcutLabel = text(".app-command-trigger kbd");
        librarySearchShortcutLabel = text(".library-inline-search .au-kbd");

        findButton("快速打开")?.click();
        await waitFor(() => document.querySelector('[role="dialog"]'), 2_000);
        const commandDialogOpen = Boolean(
          document.querySelector('[role="dialog"]')?.textContent?.includes("全局命令")
        );
        const commandSearch = document.querySelector('input[aria-label="搜索命令"]');
        if (commandSearch) {
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

        const librarySearchInput = document.querySelector('input[placeholder="在结果中搜索"]');
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "f",
            metaKey: true
          })
        );
        await waitFor(() => document.activeElement === librarySearchInput, 1_000);
        librarySearchShortcutFocused =
          Boolean(librarySearchInput) && document.activeElement === librarySearchInput;
        librarySearchInput?.blur();

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

        findExactButton("管理分组")?.click();
        const collectionManagerDialog = await waitFor(() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
            item.textContent?.includes("管理分组")
          );
          return dialog?.textContent?.includes(COLLECTION_MANAGER_SMOKE.name) ? dialog : null;
        }, 3_000);
        if (collectionManagerDialog) {
          const collectionManagerRow = Array.from(
            collectionManagerDialog.querySelectorAll(".library-collection-manager__row")
          ).find((row) => row.textContent?.includes(COLLECTION_MANAGER_SMOKE.name));
          const collectionDeleteButton = Array.from(
            collectionManagerRow?.querySelectorAll("button") ?? []
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
                (item) => item.textContent?.includes("管理分组")
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
              item.textContent?.includes("管理分组")
            );
            return manager?.textContent?.includes(
              "已删除文件夹「" + COLLECTION_MANAGER_SMOKE.name + "」"
            )
              ? manager
              : null;
          }, 3_000);
          libraryCollectionDeleteSuccessVisible = Boolean(collectionDeleteSuccessDialog);
          const collectionDeleteRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM collections WHERE id = ? AND deleted_at IS NOT NULL",
            [COLLECTION_MANAGER_SMOKE.id]
          );
          libraryCollectionDeletePersisted = Number(collectionDeleteRows[0]?.n ?? 0) === 1;
          const closeButton = collectionDeleteSuccessDialog?.querySelector(
            'button[aria-label="关闭"]'
          );
          closeButton?.click();
          await waitFor(
            () =>
              !Array.from(document.querySelectorAll('[role="dialog"]')).some((item) =>
                item.textContent?.includes("管理分组")
              ),
            1_000
          );
        }

        findExactButton("管理标签")?.click();
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
          const tagDeleteButton = Array.from(tagManagerRow?.querySelectorAll("button") ?? []).find(
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
            "SELECT COUNT(*) AS n FROM tags WHERE id = ? AND deleted_at IS NOT NULL",
            [TAG_MANAGER_SMOKE.id]
          );
          libraryTagDeletePersisted = Number(tagDeleteRows[0]?.n ?? 0) === 1;
          const closeButton = tagDeleteSuccessDialog?.querySelector('button[aria-label="关闭"]');
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
        const metadataEditButton = Array.from(document.querySelectorAll("button")).find(
          (button) =>
            button.textContent?.replace(/\s+/g, " ").trim() === "编辑 ›" &&
            Boolean(button.closest(".library-automation")?.textContent?.includes("书目信息"))
        );
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
          const metadataSavedLabel = "smoke-metadata-saved";
          if (labelInput) {
            setInputValue(labelInput, metadataSavedLabel);
            await waitFor(() => labelInput.value === metadataSavedLabel, 1_000);
          }
          const validSaveMetadataButton = Array.from(metadataDialog.querySelectorAll("button")).find(
            (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存"
          );
          validSaveMetadataButton?.click();
          await waitFor(
            () =>
              metadataDialog.getAttribute("aria-busy") === "true" &&
              validSaveMetadataButton?.disabled &&
              validSaveMetadataButton.getAttribute("aria-busy") === "true" &&
              validSaveMetadataButton.textContent?.includes("保存中") &&
              metadataDialog.querySelector('button[aria-label="关闭"]')?.disabled &&
              Boolean(labelInput?.disabled),
            1_000
          );
          metadataSaveBusyVisible =
            metadataDialog.getAttribute("aria-busy") === "true" &&
            Boolean(validSaveMetadataButton?.disabled) &&
            validSaveMetadataButton?.getAttribute("aria-busy") === "true" &&
            Boolean(validSaveMetadataButton?.textContent?.includes("保存中")) &&
            Boolean(metadataDialog.querySelector('button[aria-label="关闭"]')?.disabled) &&
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

        const keyboardStartRow = document.querySelector(
          '[data-library-row-id="' + SAMPLE.workId + '"]'
        );
        if (keyboardStartRow) {
          const startIndex = Number(keyboardStartRow.getAttribute("data-library-row-index") ?? "0");
          const nextRow = document.querySelector(
            '[data-library-row-index="' + (startIndex + 1) + '"]'
          );
          const nextId = nextRow?.getAttribute("data-library-row-id") ?? "";
          const nextTitle =
            nextRow?.querySelector(".library-table__paper strong")?.textContent?.trim() ?? "";
          keyboardStartRow.focus();
          keyboardStartRow.dispatchEvent(
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
        }

        location.hash = "#/flashcards";
        await waitFor(
          () =>
            location.hash.includes("/flashcards") &&
            bodyIncludes("闪卡复习") &&
            bodyIncludes(FLASHCARD_SMOKE.front),
          5_000
        );
        const flashcard = document.querySelector(".study-card");
        if (flashcard) {
          flashcard.focus?.();
          flashcard.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              code: "Space",
              key: " "
            })
          );
          await waitFor(
            () =>
              bodyIncludes(FLASHCARD_SMOKE.back) &&
              Boolean(document.querySelector(".study-rating button")),
            1_500
          );
          flashcardCardSpaceReveals =
            bodyIncludes(FLASHCARD_SMOKE.back) &&
            Boolean(document.querySelector(".study-rating button"));
          const firstRatingButton = document.querySelector(".study-rating button");
          firstRatingButton?.focus?.();
          firstRatingButton?.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              code: "Space",
              key: " "
            })
          );
          await wait(150);
          flashcardFocusedButtonSpacePreservesReveal =
            flashcardCardSpaceReveals &&
            bodyIncludes(FLASHCARD_SMOKE.back) &&
            Boolean(document.querySelector(".study-rating button"));
          const goodRatingButton = Array.from(document.querySelectorAll(".study-rating button")).find(
            (button) => button.textContent?.includes("记得")
          );
          goodRatingButton?.click();
          await waitFor(
            () =>
              goodRatingButton?.disabled &&
              goodRatingButton.getAttribute("aria-busy") === "true" &&
              goodRatingButton.textContent?.includes("记录中") &&
              goodRatingButton.textContent?.includes("正在推进队列"),
            1_000
          );
          flashcardRatingBusyVisible =
            Boolean(goodRatingButton?.disabled) &&
            goodRatingButton?.getAttribute("aria-busy") === "true" &&
            Boolean(goodRatingButton?.textContent?.includes("记录中")) &&
            Boolean(goodRatingButton?.textContent?.includes("正在推进队列"));
          await waitFor(
            () =>
              bodyIncludes("已记录：正常推进") &&
              bodyIncludes("本轮复习完成") &&
              !bodyIncludes(FLASHCARD_SMOKE.front),
            3_000
          );
          const flashcardReviewRows = await window.aura.db.query(
            "SELECT COUNT(*) AS n FROM flashcard_reviews WHERE flashcard_id = ?",
            [FLASHCARD_SMOKE.id]
          );
          flashcardRatingPersisted = Number(flashcardReviewRows[0]?.n ?? 0) >= 1;
          flashcardRatingCompleted =
            bodyIncludes("已记录：正常推进") &&
            bodyIncludes("本轮复习完成") &&
            !bodyIncludes(FLASHCARD_SMOKE.front);
        }

        location.hash = "#/snippets";
        await waitFor(
          () =>
            location.hash.includes("/snippets") &&
            bodyIncludes("写作素材") &&
            bodyIncludes(SNIPPET_SMOKE.quote),
          5_000
        );
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

          const snippetDeleteButton = snippetActionButton("删除");
          snippetDeleteButton?.click();
          const deleteSnippetDialog = await waitFor(() => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) =>
              item.textContent?.includes("删除写作素材？")
            );
            return dialog ?? null;
          }, 1_000);
          const confirmSnippetDeleteButton = Array.from(
            deleteSnippetDialog?.querySelectorAll("button") ?? []
          ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除素材");
          confirmSnippetDeleteButton?.click();
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
        }

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
            const snippetSaveButton = await waitFor(
              () =>
                Array.from(document.querySelectorAll(".au-reader__selection-toolbar button")).find(
                  (button) => button.getAttribute("title")?.includes("写作素材")
                ),
              2_000
            );
            snippetSaveButton?.click();
            readerSnippetSaveBusyVisible = Boolean(
              await waitFor(() => {
                const busyButton = Array.from(
                  document.querySelectorAll(".au-reader__selection-toolbar button")
                ).find((button) => button.getAttribute("aria-busy") === "true");
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

        const annotationDeleteButtonForBusy = document.querySelector(".au-annsidebar__action");
        annotationDeleteButtonForBusy?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        const annotationDeleteBusyDialog = await waitFor(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog?.textContent?.includes("删除这条批注？") ? dialog : null;
        }, 3_000);
        const confirmAnnotationDeleteButton = Array.from(
          annotationDeleteBusyDialog?.querySelectorAll("button") ?? []
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "删除批注");
        confirmAnnotationDeleteButton?.click();
        readerAnnotationDeleteBusyVisible = Boolean(
          await waitFor(() => {
            const item = document.querySelector(".au-annsidebar__item");
            const deleteButton = document.querySelector(".au-annsidebar__action");
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

        const translateTab = Array.from(document.querySelectorAll(".reader-tabs button")).find(
          (button) => button.textContent?.includes("译文")
        );
        translateTab?.click();
        await waitFor(() => Boolean(document.querySelector(".reader-translate-panel")), 2_000);
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
          readerTranslationStartBusyVisible && bodyIncludes("请先在设置页配置 AI 服务");
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
                button.textContent?.includes("复制全部译文")
              )
            ),
          2_000
        );
        const copyTranslationButton = Array.from(document.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("复制全部译文")
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

        const digestTab = Array.from(document.querySelectorAll(".reader-tabs button")).find((button) =>
          button.textContent?.includes("重点")
        );
        digestTab?.click();
        await waitFor(
          () =>
            Boolean(document.querySelector(".reader-digest-panel")) &&
            bodyIncludes(FLASHCARD_SMOKE.front) &&
            Boolean(
              Array.from(document.querySelectorAll(".reader-digest-panel button")).find((button) =>
                button.textContent?.includes("重新提取")
              )
            ),
          2_000
        );
        const regenerateDigestButton = Array.from(
          document.querySelectorAll(".reader-digest-panel button")
        ).find((button) => button.textContent?.includes("重新提取"));
        regenerateDigestButton?.click();
        readerDigestGenerateBusyVisible = Boolean(
          await waitFor(() => {
            const panel = document.querySelector(".reader-digest-panel");
            const busyButton = Array.from(panel?.querySelectorAll("button") ?? []).find(
              (button) => button.getAttribute("aria-busy") === "true" && button.disabled
            );
            return panel?.getAttribute("aria-busy") === "true" &&
              busyButton?.textContent?.includes("提取中") &&
              panel.textContent?.includes("正在重新提取重点")
              ? busyButton
              : null;
          }, 1_000)
        );
        await waitFor(() => bodyIncludes("请先在设置页配置 AI 服务"), 3_000);
        readerDigestGenerateErrorVisible =
          readerDigestGenerateBusyVisible && bodyIncludes("请先在设置页配置 AI 服务");

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
          bodyIncludes("打开本地 PDF") &&
          bodyIncludes("去找全文") &&
          bodyIncludes("回文献库定位");

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
                busyButton.textContent?.includes("打开中")
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
          bodyIncludes("打开本地 PDF") &&
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
          bodyIncludes("打开本地 PDF") &&
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
        const homeSavedSearchButton = Array.from(
          document.querySelectorAll(".discovery-saved-strip button")
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
        removeSiteButton?.click();
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
            removeSiteButton?.disabled &&
            removeSiteButton.getAttribute("aria-busy") === "true" &&
            removeSiteButton.textContent?.includes("删除中"),
          1_000
        );
        discoverySiteRemoveActionBusyVisible = Boolean(
          removeSiteButton?.disabled &&
            removeSiteButton.getAttribute("aria-busy") === "true" &&
            removeSiteButton.textContent?.includes("删除中")
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
        const saveDuplicateSearchButton = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.replace(/\s+/g, " ").trim() === "保存为订阅"
        );
        saveDuplicateSearchButton?.click();
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
        }

        const savedSearchDeleteSub = Array.from(document.querySelectorAll(".discovery-sub")).find((item) =>
          item.textContent?.includes(SAVED_SEARCH_ERROR_SMOKE.query)
        );
        const savedSearchDeleteButton = Array.from(savedSearchDeleteSub?.querySelectorAll("button") ?? []).find(
          (button) => button.getAttribute("title")?.includes("删除订阅")
        );
        savedSearchDeleteButton?.click();
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
        const apiKeyInput = aiInputs[2];
        settingsInitialLoadCompleted =
          Boolean(apiKeyInput) &&
          !apiKeyInput.disabled &&
          !bodyIncludes("正在读取 AI 配置") &&
          !bodyIncludes("正在读取翻译配置") &&
          !bodyIncludes("正在读取同步配置");
        if (apiKeyInput) {
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

        const backupExportButton = () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => {
              const label = button.textContent?.replace(/\s+/g, " ").trim();
              return label === "导出整库备份" || label === "导出中...";
            }
          );
        const originalBackupAnchorClick = HTMLAnchorElement.prototype.click;
        let backupDownloadCount = 0;
        let backupDownloadName = "";
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
        } finally {
          HTMLAnchorElement.prototype.click = originalBackupAnchorClick;
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

        location.hash = "#/sentinel";
        await waitFor(
          () =>
            location.hash.includes("/sentinel") &&
            bodyIncludes("检索哨兵") &&
            Boolean(document.querySelector(".sentinel-mode-tabs")),
          4_000
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
          bodyIncludes("参考文献") &&
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

        location.hash = "#/homepage";
        await waitFor(
          () =>
            location.hash.includes("/homepage") &&
            bodyIncludes("学术主页") &&
            bodyIncludes("展示成果"),
          4_000
        );
        await waitFor(() => !bodyIncludes("正在读取文献库..."), 5_000);
        const homepageInputByLabel = (label) =>
          Array.from(document.querySelectorAll(".homepage-field")).find((field) =>
            field.textContent?.includes(label)
          )?.querySelector("input, textarea");
        const homepagePreviewSource = () => {
          const frame = document.querySelector('iframe[title="主页实时预览"]');
          return (
            frame?.getAttribute("srcdoc") ||
            frame?.srcdoc ||
            frame?.contentDocument?.documentElement?.outerHTML ||
            ""
          );
        };
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
          aiSettingsFallbackVisible,
          bodyText: libraryBodyText,
          browserPreviewWarning: libraryBodyText.includes("浏览器预览无法读取本地文献库"),
          commandCompositionEscapeIgnored,
          commandCompositionIgnored,
          commandDialogOpen,
          commandShortcutLabel,
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
          discoveryDuplicateSavedSearchBlocked,
          discoveryDuplicateSavedSearchCount:
            typeof discoveryDuplicateSavedSearchCount === "number"
              ? discoveryDuplicateSavedSearchCount
              : Number(discoveryDuplicateSavedSearchCount),
          discoveryDuplicateSavedSearchMessageVisible,
          discoverySavedSearchDeleteBusyVisible,
          discoverySavedSearchDeleteConfirmVisible,
          discoverySavedSearchDeleted,
          discoverySavedSearchDeletePersisted,
          discoveryEzproxyConfigSaveAriaBusyVisible,
          discoveryEzproxyConfigSaveBusyVisible,
          discoveryEzproxyConfigSaved,
          discoveryEzproxyConfigValue,
          discoveryFulltextCueVisible,
          discoveryImportBusyVisible,
          discoveryImportFulltextFallbackVisible,
          discoverySearchAriaBusyVisible,
          discoverySearchBusyVisible,
          discoveryTrustSignalsDetail,
          discoverySearchProgressLiveVisible,
          discoveryProxyConfigSaveAriaBusyVisible,
          discoveryProxyConfigSaveBusyVisible,
          discoveryProxyConfigSaved,
          discoveryProxyConfigValue,
          discoverySavedSearchManualCheckBusyVisible,
          discoverySavedSearchManualCheckCompleted,
          discoverySavedSearchHomeOpenBusyVisible,
          discoverySavedSearchHomeOpenClearedNewCount,
          discoverySavedSearchHomeOpenNavigated,
          discoverySavedSearchLastErrorVisible,
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
          discoverySiteRemoveActionBusyVisible,
          discoverySiteRemoveActionCount:
            typeof discoverySiteRemoveActionCount === "number"
              ? discoverySiteRemoveActionCount
              : Number(discoverySiteRemoveActionCount),
          discoverySiteRemoveActionDeleted,
          discoveryReferenceImportCommitBusyVisible,
          discoveryReferenceImportCommitPersisted,
          discoveryReferenceImportCommitSuccessVisible,
          discoveryReferenceImportCancelPreserved,
          discoveryReferenceImportConfirmVisible,
          discoveryReferenceImportRejectsEmptyPersisted,
          discoveryReferenceImportRejectsEmptyVisible,
          discoveryReferenceImportRichFormatsPersisted,
          discoverySiteActionConfirmCancelled,
          discoverySiteActionConfirmVisible,
          dbError,
          emptyStateVisible,
          externalUnsafeRejected,
          flashcardCardSpaceReveals,
          flashcardFocusedButtonSpacePreservesReveal,
          flashcardRatingBusyVisible,
          flashcardRatingCompleted,
          flashcardRatingPersisted,
          graphCachedVisible,
          graphInputCompositionIgnored,
          graphImportBusyVisible,
          graphImportFailureFeedbackVisible,
          graphNodeKeyboardSelectable,
          hash: libraryHash,
          hasAuraBridge: Boolean(window.aura?.db && window.aura?.research && window.aura?.deviceId),
          heading: libraryHeading,
          homepageClearSelectedCancelPreserved,
          homepageClearSelectedConfirmVisible,
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
          homepageSafeLinkRelHardened,
          initialWorkCount: typeof initialWorkCount === "number" ? initialWorkCount : Number(initialWorkCount),
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
          libraryCollectionDeleteBusyVisible,
          libraryCollectionDeletePersisted,
          libraryCollectionDeleteSuccessVisible,
          libraryKeyboardNavigationVisible,
          libraryKeyboardOpenHash,
          libraryKeyboardOpenedId,
          libraryPdfUploadBusyVisible,
          libraryPdfUploadPersisted,
          libraryPdfUploadSuccessVisible,
          libraryMergeBusyVisible,
          libraryMergePersisted,
          libraryMergeSuccessVisible,
          libraryMoveToCollectionBusyVisible,
          libraryMoveToCollectionPersisted,
          libraryMoveToCollectionSuccessVisible,
          libraryTagDeleteBusyVisible,
          libraryTagDeletePersisted,
          libraryTagDeleteSuccessVisible,
          libraryTrashRestoreBusyVisible,
          libraryTrashRestoreSuccessVisible,
          metadataInvalidYearBlocked,
          metadataInvalidYearErrorVisible,
          metadataInvalidYearPreserved,
          metadataSaveBusyVisible,
          metadataSavePersisted,
          libraryPdfAttachmentVisible,
          librarySentinelCreateBusyVisible,
          librarySentinelExistingLinked,
          librarySentinelExistingLinkedCount,
          librarySentinelExistingLinkedMessageVisible,
          libraryReadingStatusBusyVisible,
          libraryReadingStatusPersisted,
          libraryReadingStatusSuccessVisible,
          libraryStarBusyVisible,
          libraryStarPersisted,
          libraryStarSuccessVisible,
          quickAddCompositionIgnored,
          quickImportConfirmCommitBusyVisible,
          quickImportConfirmDialogVisible,
          quickImportConfirmCommitPersisted,
          librarySearchShortcutLabel,
          librarySearchShortcutFocused,
          populatedStateVisible,
          quickDropImportConfirmBusyVisible,
          quickDropImportConfirmPersisted,
          quickDropImportConfirmPmidPersisted,
          quickDropImportConfirmSuccessVisible,
          quickDropImportCount,
          quickDropImportPreviewVisible,
          readingStatus,
          readerBrokenAttachmentCount,
          readerBrokenBlobRecoveryVisible,
          readerBrokenBlobVisible,
          readerBrokenHash,
          readerAnnotationDeleteBusyVisible,
          readerAnnotationDeleteCancelPreserved,
          readerAnnotationDeleteConfirmVisible,
          readerAnnotationDeleteSuccessVisible,
          readerCommentDirtyExportBlocked,
          readerCommentDirtyExportDownloadPrevented,
          readerCommentDirtyExportMessageVisible,
          readerCommentDraftCancelPreserved,
          readerCommentDraftConfirmVisible,
          readerCommentDraftDiscarded,
          readerCommentSaveBusyVisible,
          readerCommentSavePersisted,
          readerCommentShortcutCompositionIgnored,
          readerCanvasVisible,
          readerCorruptAttachmentCount,
          readerCorruptPdfRecoveryVisible,
          readerCorruptPdfVisible,
          readerCorruptHash,
          readerDigestGenerateBusyVisible,
          readerDigestGenerateErrorVisible,
          readerErrorVisible,
          readerHash,
          readerMissingHash,
          readerMissingPdfAttachBusyVisible,
          readerMissingPdfRecoveryVisible,
          readerMissingPdfVisible,
          readerPageBadgeVisible,
          readerRecoveredAttachmentCount,
          readerRecoveredPdfVisible,
          readerSnippetSaveBusyVisible,
          readerSnippetSavePersisted,
          readerTitleVisible,
          readerTranslationClipboardMatches,
          readerTranslationCopyBusyVisible,
          readerTranslationCopyFeedbackVisible,
          readerTranslationCopyStatusText,
          readerTranslationStartBusyVisible,
          readerTranslationStartErrorVisible,
          routeCrashBoundaryVisible,
          routeCrashRecoveredLibraryVisible,
          routeCrashRecoveryHash,
          routeCrashShellVisible,
          searchDataPathOk,
          searchEmptyStateVisible,
          searchResultVisible,
          settingsBackupExportBusyVisible,
          settingsBackupExportAriaBusyVisible,
          settingsBackupExportFailureVisible,
          settingsBackupExportSuccessVisible,
          settingsBusySaveAriaVisible,
          settingsBusyNavigationCancelPreserved,
          settingsBusyNavigationConfirmVisible,
          settingsBusySaveControlsDisabled,
          settingsInitialLoadCompleted,
          settingsTranslationCacheClearBusyVisible,
          settingsTranslationCacheClearCancelled,
          settingsTranslationCacheClearConfirmVisible,
          settingsTranslationCacheClearPersisted,
          settingsTranslationCacheClearSuccessVisible,
          sentinelAddCompositionIgnored,
          sentinelAddBusyVisible,
          sentinelDeletedDoiRestored,
          sentinelDeletedDoiRestoredCount,
          sentinelDuplicateDoiBlocked,
          sentinelDuplicateDoiCount,
          sentinelDuplicateDoiMessageVisible,
          sentinelLastErrorVisible,
          sentinelTaskCheckBusyVisible,
          sentinelManualFailureRecorded,
          sentinelManualFailureVisible,
          seededWorkCount: typeof seededWorkCount === "number" ? seededWorkCount : Number(seededWorkCount),
          snippetCardCopyAriaBusyVisible,
          snippetCardCopyBusyVisible,
          snippetCardCopyCitationAriaBusyVisible,
          snippetCardCopyCitationBusyVisible,
          snippetDeleteAriaBusyVisible,
          snippetDeleteBusyVisible,
          snippetDeleteSuccessVisible,
          snippetDirtyCopyBlocked,
          snippetDirtyCopyClipboardPreserved,
          snippetDirtyCopyMessageVisible,
          snippetEditorClosedAfterShortcut,
          snippetEscapeCompositionIgnored,
          snippetSavedNote,
          snippetSaveCompositionIgnored,
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
        .then((renderer: SmokeRendererResult) => {
          const checks: SmokeCheck[] = [
            { name: "document-title", pass: renderer.title === "AuraScholar", detail: renderer.title },
            {
              name: "local-storage-startup-fallback",
              pass:
                renderer.themeFallbackApplied &&
                renderer.themeStoredInvalid &&
                renderer.aiSettingsFallbackVisible,
              detail: `theme=${renderer.themeFallbackApplied}; storedInvalid=${renderer.themeStoredInvalid}; ai=${renderer.aiSettingsFallbackVisible}`,
            },
            {
              name: "library-route",
              pass: renderer.hash.includes("/library") && renderer.heading === "文献库",
              detail: `${renderer.hash} / ${renderer.heading}`,
            },
            { name: "preload-bridge", pass: renderer.hasAuraBridge },
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
              pass: renderer.externalUnsafeRejected,
            },
            {
              name: "citation-graph-cached-keyboard-and-import-feedback",
              pass:
                renderer.graphCachedVisible &&
                renderer.graphNodeKeyboardSelectable &&
                renderer.graphImportBusyVisible &&
                renderer.graphImportFailureFeedbackVisible,
              detail: `cached=${renderer.graphCachedVisible}; keyboard=${renderer.graphNodeKeyboardSelectable}; busy=${renderer.graphImportBusyVisible}; feedback=${renderer.graphImportFailureFeedbackVisible}`,
            },
            {
              name: "library-empty-state",
              pass: renderer.emptyStateVisible,
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
              name: "library-search",
              pass: renderer.searchDataPathOk && renderer.searchResultVisible,
              detail: `data=${renderer.searchDataPathOk}; result=${renderer.searchResultVisible}; empty=${renderer.searchEmptyStateVisible}`,
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
              name: "library-star-action-feedback",
              pass:
                renderer.libraryStarBusyVisible &&
                renderer.libraryStarSuccessVisible &&
                renderer.libraryStarPersisted,
              detail: `busy=${renderer.libraryStarBusyVisible}; success=${renderer.libraryStarSuccessVisible}; persisted=${renderer.libraryStarPersisted}`,
            },
            {
              name: "library-sentinel-existing-link",
              pass:
                renderer.librarySentinelCreateBusyVisible &&
                renderer.librarySentinelExistingLinked,
              detail: `busy=${renderer.librarySentinelCreateBusyVisible}; message=${renderer.librarySentinelExistingLinkedMessageVisible}; count=${renderer.librarySentinelExistingLinkedCount}`,
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
              name: "library-merge-works-feedback",
              pass:
                renderer.libraryMergeBusyVisible &&
                renderer.libraryMergeSuccessVisible &&
                renderer.libraryMergePersisted,
              detail: `busy=${renderer.libraryMergeBusyVisible}; success=${renderer.libraryMergeSuccessVisible}; persisted=${renderer.libraryMergePersisted}`,
            },
            {
              name: "library-trash-restore-feedback",
              pass:
                renderer.libraryTrashRestoreBusyVisible &&
                renderer.libraryTrashRestoreSuccessVisible,
              detail: `busy=${renderer.libraryTrashRestoreBusyVisible}; success=${renderer.libraryTrashRestoreSuccessVisible}`,
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
              name: "library-collection-manager-delete-feedback",
              pass:
                renderer.libraryCollectionDeleteBusyVisible &&
                renderer.libraryCollectionDeleteSuccessVisible &&
                renderer.libraryCollectionDeletePersisted,
              detail: `busy=${renderer.libraryCollectionDeleteBusyVisible}; success=${renderer.libraryCollectionDeleteSuccessVisible}; persisted=${renderer.libraryCollectionDeletePersisted}`,
            },
            {
              name: "library-tag-manager-delete-feedback",
              pass:
                renderer.libraryTagDeleteBusyVisible &&
                renderer.libraryTagDeleteSuccessVisible &&
                renderer.libraryTagDeletePersisted,
              detail: `busy=${renderer.libraryTagDeleteBusyVisible}; success=${renderer.libraryTagDeleteSuccessVisible}; persisted=${renderer.libraryTagDeletePersisted}`,
            },
            { name: "quick-open-dialog", pass: renderer.commandDialogOpen },
            {
              name: "command-palette-ime-enter-guard",
              pass: renderer.commandCompositionIgnored,
            },
            {
              name: "modal-focus-trap-ime-escape-guard",
              pass: renderer.commandCompositionEscapeIgnored,
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
              pass: renderer.librarySearchShortcutFocused,
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
              name: "flashcard-space-shortcut-target-guard",
              pass:
                renderer.flashcardCardSpaceReveals &&
                renderer.flashcardFocusedButtonSpacePreservesReveal,
              detail: `card=${renderer.flashcardCardSpaceReveals}; button=${renderer.flashcardFocusedButtonSpacePreservesReveal}`,
            },
            {
              name: "flashcard-rating-feedback",
              pass:
                renderer.flashcardRatingBusyVisible &&
                renderer.flashcardRatingCompleted &&
                renderer.flashcardRatingPersisted,
              detail: `busy=${renderer.flashcardRatingBusyVisible}; completed=${renderer.flashcardRatingCompleted}; persisted=${renderer.flashcardRatingPersisted}`,
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
              name: "library-keyboard-navigation",
              pass:
                renderer.libraryKeyboardNavigationVisible &&
                Boolean(renderer.libraryKeyboardOpenedId) &&
                renderer.libraryKeyboardOpenHash.includes(
                  `/reader?work=${encodeURIComponent(renderer.libraryKeyboardOpenedId)}`,
                ),
              detail: `${renderer.libraryKeyboardOpenHash}; id=${renderer.libraryKeyboardOpenedId}; moved=${renderer.libraryKeyboardNavigationVisible}`,
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
              name: "reader-snippet-save-feedback",
              pass:
                renderer.readerSnippetSaveBusyVisible &&
                renderer.readerSnippetSavePersisted,
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
              pass:
                renderer.readerCommentSaveBusyVisible &&
                renderer.readerCommentSavePersisted,
              detail: `busy=${renderer.readerCommentSaveBusyVisible}; persisted=${renderer.readerCommentSavePersisted}`,
            },
            {
              name: "reader-annotation-delete-busy-feedback",
              pass:
                renderer.readerAnnotationDeleteBusyVisible &&
                renderer.readerAnnotationDeleteSuccessVisible,
              detail: `busy=${renderer.readerAnnotationDeleteBusyVisible}; success=${renderer.readerAnnotationDeleteSuccessVisible}`,
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
              name: "reader-translation-start-feedback",
              pass:
                renderer.readerTranslationStartBusyVisible &&
                renderer.readerTranslationStartErrorVisible,
              detail: `busy=${renderer.readerTranslationStartBusyVisible}; error=${renderer.readerTranslationStartErrorVisible}`,
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
              name: "reader-digest-generate-feedback",
              pass:
                renderer.readerDigestGenerateBusyVisible &&
                renderer.readerDigestGenerateErrorVisible,
              detail: `busy=${renderer.readerDigestGenerateBusyVisible}; error=${renderer.readerDigestGenerateErrorVisible}`,
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
              name: "reader-missing-pdf-attach",
              pass:
                renderer.readerMissingPdfAttachBusyVisible &&
                renderer.readerRecoveredPdfVisible &&
                renderer.readerRecoveredAttachmentCount !== null &&
                renderer.readerRecoveredAttachmentCount >= 1,
              detail: `busy=${renderer.readerMissingPdfAttachBusyVisible}; visible=${renderer.readerRecoveredPdfVisible}; attachments=${renderer.readerRecoveredAttachmentCount}`,
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
              name: "discovery-ezproxy-config-save-state",
              pass:
                renderer.discoveryEzproxyConfigSaved &&
                renderer.discoveryEzproxyConfigSaveAriaBusyVisible,
              detail: `busy=${renderer.discoveryEzproxyConfigSaveBusyVisible}; aria=${renderer.discoveryEzproxyConfigSaveAriaBusyVisible}; value=${renderer.discoveryEzproxyConfigValue}`,
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
              name: "discovery-site-remove-action-state",
              pass: renderer.discoverySiteRemoveActionDeleted,
              detail: `busy=${renderer.discoverySiteRemoveActionBusyVisible}; count=${renderer.discoverySiteRemoveActionCount}`,
            },
            {
              name: "discovery-duplicate-site-guard",
              pass: renderer.discoveryDuplicateSiteBlocked,
              detail: `busy=${renderer.discoveryDuplicateSiteAddBusyVisible}; message=${renderer.discoveryDuplicateSiteMessageVisible}; count=${renderer.discoveryDuplicateSiteCount}`,
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
              name: "discovery-duplicate-saved-search-guard",
              pass: renderer.discoveryDuplicateSavedSearchBlocked,
              detail: `message=${renderer.discoveryDuplicateSavedSearchMessageVisible}; count=${renderer.discoveryDuplicateSavedSearchCount}`,
            },
            {
              name: "discovery-saved-search-delete-feedback",
              pass: renderer.discoverySavedSearchDeleted,
              detail: `confirm=${renderer.discoverySavedSearchDeleteConfirmVisible}; busy=${renderer.discoverySavedSearchDeleteBusyVisible}; persisted=${renderer.discoverySavedSearchDeletePersisted}`,
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
                renderer.discoverySavedSearchHomeOpenClearedNewCount,
              detail: `busy=${renderer.discoverySavedSearchHomeOpenBusyVisible}; navigated=${renderer.discoverySavedSearchHomeOpenNavigated}; cleared=${renderer.discoverySavedSearchHomeOpenClearedNewCount}`,
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
              name: "settings-backup-export-feedback",
              pass:
                renderer.settingsBackupExportBusyVisible &&
                renderer.settingsBackupExportAriaBusyVisible &&
                renderer.settingsBackupExportSuccessVisible &&
                renderer.settingsBackupExportFailureVisible,
              detail: `busy=${renderer.settingsBackupExportBusyVisible}; aria=${renderer.settingsBackupExportAriaBusyVisible}; success=${renderer.settingsBackupExportSuccessVisible}; failure=${renderer.settingsBackupExportFailureVisible}`,
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
              pass:
                renderer.homepageExternalLinkSafetyOk &&
                renderer.homepageSafeLinkRelHardened,
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
