import type {
  CitationBridgeSmoke,
  SmokeCheck,
  SmokeRendererResult,
  SecretsFileSmoke,
} from "../contracts";
import { summarize } from "./summarize";

export function buildBaseSmokeChecks(
  renderer: SmokeRendererResult,
  secretsFile: SecretsFileSmoke,
  citationBridge: CitationBridgeSmoke,
): SmokeCheck[] {
  return [
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
      pass: citationBridge.pingOk && citationBridge.unauthRejected && citationBridge.methodGuard,
      detail: `ping=${citationBridge.pingOk}; unauth=${citationBridge.unauthRejected}; method=${citationBridge.methodGuard}`,
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
      name: "platform-secrets-renderer-isolated",
      pass: renderer.platformSecretsRendererIsolated,
      detail: `isolated=${renderer.platformSecretsRendererIsolated}`,
    },
    {
      name: "platform-generic-http-renderer-isolated",
      pass: renderer.platformGenericHttpRendererIsolated,
      detail: `isolated=${renderer.platformGenericHttpRendererIsolated}`,
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
      name: "main-window-external-navigation-guard",
      pass: renderer.externalNavigationBlocked,
    },
    {
      name: "app-shell-canvas-stats-race-preserved",
      pass: renderer.appShellCanvasStatsRacePreserved,
    },
  ];
}
