import { smokeFixtures } from "./fragments/fixtures";
import { smokeHelpers } from "./fragments/helpers";
import { smokeShellBootstrap } from "./fragments/shell-bootstrap";
import { smokeSharedState } from "./fragments/shared-state";
import { smokePlatform } from "./fragments/platform";
import { smokeLibrarySeedStart } from "./fragments/library-seed-start";
import { smokeLibrarySeedWorks } from "./fragments/library-seed-works";
import { smokeLibrarySeedRelations } from "./fragments/library-seed-relations";
import { smokeLibrarySeedAssets } from "./fragments/library-seed-assets";
import { smokeLibrarySeedBackground } from "./fragments/library-seed-background";
import { smokeLibrarySeedSitesGraph } from "./fragments/library-seed-sites-graph";
import { smokeLibraryBase } from "./fragments/library-base";
import { smokeLibraryBulkTrash } from "./fragments/library-bulk-trash";
import { smokeLibraryFilterRecovery } from "./fragments/library-filter-recovery";
import { smokeLibraryStatusStar } from "./fragments/library-status-star";
import { smokeLibraryCommandPalette } from "./fragments/library-command-palette";
import { smokeLibraryBulkOperations } from "./fragments/library-bulk-operations";
import { smokeLibraryCollections } from "./fragments/library-collections";
import { smokeLibraryTags } from "./fragments/library-tags";
import { smokeLibraryImportMetadata } from "./fragments/library-import-metadata";
import { smokeLibraryKeyboard } from "./fragments/library-keyboard";
import { smokeCanvas } from "./fragments/canvas";
import { smokeSnippets } from "./fragments/snippets";
import { smokeReaderAnnotations } from "./fragments/reader-annotations";
import { smokeReaderTranslation } from "./fragments/reader-translation";
import { smokeReaderRecovery } from "./fragments/reader-recovery";
import { smokeDiscoveryImport } from "./fragments/discovery-import";
import { smokeDiscoverySites } from "./fragments/discovery-sites";
import { smokeDiscoverySavedSearches } from "./fragments/discovery-saved-searches";
import { smokeDiscoveryResults } from "./fragments/discovery-results";
import { smokeSettingsAiTranslate } from "./fragments/settings-ai-translate";
import { smokeSettingsSync } from "./fragments/settings-sync";
import { smokeSettingsAi } from "./fragments/settings-ai";
import { smokeSettingsBackupExport } from "./fragments/settings-backup-export";
import { smokeSettingsBackupPayload } from "./fragments/settings-backup-payload";
import { smokeSettingsBackupFailure } from "./fragments/settings-backup-failure";
import { smokeSettingsBackupSuccess } from "./fragments/settings-backup-success";
import { smokeSettingsBackupValidation } from "./fragments/settings-backup-validation";
import { smokeSettingsCache } from "./fragments/settings-cache";
import { smokeSentinel } from "./fragments/sentinel";
import { smokeGraph } from "./fragments/graph";
import { smokeHomepage } from "./fragments/homepage";
import { smokeResult } from "./fragments/result";

const rendererSmokeFragments = [
  smokeFixtures,
  String.raw`        if (!window.aura?.db) {
          throw new Error("Smoke raw database bridge is unavailable.");
        }
`,
  smokeHelpers,
  smokeShellBootstrap,
  smokeSharedState,
  smokePlatform,
  String.raw`smokeProgress("library");`,
  smokeLibrarySeedStart,
  smokeLibrarySeedWorks,
  smokeLibrarySeedRelations,
  smokeLibrarySeedAssets,
  smokeLibrarySeedBackground,
  smokeLibrarySeedSitesGraph,
  smokeLibraryBase,
  smokeLibraryBulkTrash,
  smokeLibraryFilterRecovery,
  smokeLibraryStatusStar,
  smokeLibraryCommandPalette,
  smokeLibraryBulkOperations,
  smokeLibraryCollections,
  smokeLibraryTags,
  smokeLibraryImportMetadata,
  smokeLibraryKeyboard,
  String.raw`smokeProgress("canvas");`,
  smokeCanvas,
  String.raw`smokeProgress("snippets");`,
  smokeSnippets,
  String.raw`smokeProgress("reader");`,
  smokeReaderAnnotations,
  smokeReaderTranslation,
  smokeReaderRecovery,
  String.raw`smokeProgress("discovery");`,
  smokeDiscoveryImport,
  smokeDiscoverySites,
  smokeDiscoverySavedSearches,
  smokeDiscoveryResults,
  String.raw`smokeProgress("settings");`,
  smokeSettingsAiTranslate,
  smokeSettingsSync,
  smokeSettingsAi,
  smokeSettingsBackupExport,
  smokeSettingsBackupPayload,
  smokeSettingsBackupFailure,
  smokeSettingsBackupSuccess,
  smokeSettingsBackupValidation,
  smokeSettingsCache,
  String.raw`smokeProgress("sentinel");`,
  smokeSentinel,
  String.raw`smokeProgress("graph");`,
  smokeGraph,
  String.raw`smokeProgress("homepage");`,
  smokeHomepage,
  String.raw`smokeProgress("complete");`,
  smokeResult,
];

export function buildRendererSmokeScript(): string {
  return rendererSmokeFragments.join("");
}
