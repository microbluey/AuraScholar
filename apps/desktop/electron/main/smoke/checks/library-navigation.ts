import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildLibraryNavigationSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
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
  ];
}
