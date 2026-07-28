import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildGraphSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
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
  ];
}
