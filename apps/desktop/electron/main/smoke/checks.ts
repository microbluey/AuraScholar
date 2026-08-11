import type {
  CitationBridgeSmoke,
  SecretsFileSmoke,
  SmokeCheck,
  SmokeRendererResult,
} from "./contracts";
import { buildBaseSmokeChecks } from "./checks/base";
import { buildGraphSmokeChecks } from "./checks/graph";
import { buildLibraryCoreSmokeChecks } from "./checks/library-core";
import { buildCommandSmokeChecks } from "./checks/commands";
import { buildLibraryUtilitySmokeChecks } from "./checks/library-utility";
import { buildSentinelSmokeChecks } from "./checks/sentinel";
import { buildCanvasSmokeChecks } from "./checks/canvas";
import { buildSnippetSmokeChecks } from "./checks/snippets";
import { buildLibraryNavigationSmokeChecks } from "./checks/library-navigation";
import { buildReaderSmokeChecks } from "./checks/reader";
import { buildDiscoverySmokeChecks } from "./checks/discovery";
import { buildSettingsSmokeChecks } from "./checks/settings";
import { buildHomepageSmokeChecks } from "./checks/homepage";

export function buildSmokeChecks(
  renderer: SmokeRendererResult,
  secretsFile: SecretsFileSmoke,
  citationBridge: CitationBridgeSmoke,
): SmokeCheck[] {
  return [
    ...buildBaseSmokeChecks(renderer, secretsFile, citationBridge),
    ...buildGraphSmokeChecks(renderer),
    ...buildLibraryCoreSmokeChecks(renderer),
    ...buildCommandSmokeChecks(renderer),
    ...buildLibraryUtilitySmokeChecks(renderer),
    ...buildSentinelSmokeChecks(renderer),
    ...buildCanvasSmokeChecks(renderer),
    ...buildSnippetSmokeChecks(renderer),
    ...buildLibraryNavigationSmokeChecks(renderer),
    ...buildReaderSmokeChecks(renderer),
    ...buildDiscoverySmokeChecks(renderer),
    ...buildSettingsSmokeChecks(renderer),
    ...buildHomepageSmokeChecks(renderer),
  ];
}
