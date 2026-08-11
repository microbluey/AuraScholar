import type { DataCommandOutput, DataCommandRequest } from "../data-command-contract";
import {
  parseAdoptLegacySyncSettingsInput,
  parseSyncGetSettingsInput,
  parseSyncRunInput,
  parseSyncSaveSettingsInput,
} from "./sync-command-input";
import { mainSyncRunner, type MainSyncRunner } from "./sync-runner";
import { mainSyncSettingsStore, type MainSyncSettingsStore } from "./sync-settings-store";

type SyncCommandName =
  | "sync.adoptLegacySettings"
  | "sync.getSettings"
  | "sync.run"
  | "sync.saveSettings";

export type SyncCommandRequest = Extract<DataCommandRequest, { name: SyncCommandName }>;

export interface SyncCommandDependencies {
  runner: Pick<MainSyncRunner, "run">;
  settings: Pick<MainSyncSettingsStore, "adoptLegacy" | "getSnapshot" | "requireSettings" | "save">;
}

const defaultDependencies: SyncCommandDependencies = {
  runner: mainSyncRunner,
  settings: mainSyncSettingsStore,
};

/**
 * Narrow main-process owner for the WebDAV settings and full sync workflow.
 * The renderer may submit a replacement password to save, but never receives
 * one back and never supplies a remote target or segment to `sync.run`.
 */
export async function executeSyncCommand(
  request: SyncCommandRequest,
  dependencies: SyncCommandDependencies = defaultDependencies,
): Promise<DataCommandOutput<SyncCommandName>> {
  switch (request.name) {
    case "sync.getSettings": {
      parseSyncGetSettingsInput(request.input);
      return dependencies.settings.getSnapshot();
    }
    case "sync.saveSettings": {
      const input = parseSyncSaveSettingsInput(request.input);
      return dependencies.settings.save(input);
    }
    case "sync.adoptLegacySettings": {
      const input = parseAdoptLegacySyncSettingsInput(request.input);
      return dependencies.settings.adoptLegacy(input);
    }
    case "sync.run": {
      parseSyncRunInput(request.input);
      const settings = await dependencies.settings.requireSettings();
      return dependencies.runner.run(settings);
    }
  }
}
