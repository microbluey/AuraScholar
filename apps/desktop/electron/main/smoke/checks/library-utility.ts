import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildLibraryUtilitySmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
    {
      name: "library-search-shortcut",
      pass:
        renderer.librarySearchShortcutFocused && renderer.librarySearchNonPlatformShortcutIgnored,
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
  ];
}
