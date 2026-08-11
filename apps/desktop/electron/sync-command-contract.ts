import type { SyncResult } from "@aurascholar/sync";

/**
 * Renderer-safe view of the configured WebDAV target. Credentials deliberately
 * never cross this command boundary on reads.
 */
export interface SyncSettingsSnapshot {
  baseUrl: string;
  hasPassword: boolean;
  username: string;
}

/** First-run handoff for the former renderer-owned localStorage setting. */
export interface AdoptLegacySyncSettingsCommandInput {
  baseUrl: string;
  inlinePassword?: string;
  username: string;
}

/**
 * Omitting password preserves an already saved secret. A supplied password is
 * always a replacement; clearing the configuration is intentionally a
 * separate future command rather than an ambiguous empty-string write.
 */
export interface SaveSyncSettingsCommandInput {
  baseUrl: string;
  password?: string;
  username: string;
}

export type EmptySyncCommandInput = Record<string, never>;

/**
 * Main-owned sync commands. This map is kept independent until it is merged
 * into the central DataCommandMap, so the runner can be tested without
 * extending the renderer IPC allowlist prematurely.
 */
export interface SyncDataCommandMap {
  "sync.adoptLegacySettings": {
    input: AdoptLegacySyncSettingsCommandInput;
    output: SyncSettingsSnapshot;
  };
  "sync.getSettings": {
    input: EmptySyncCommandInput;
    output: SyncSettingsSnapshot | null;
  };
  "sync.run": {
    input: EmptySyncCommandInput;
    output: SyncResult;
  };
  "sync.saveSettings": {
    input: SaveSyncSettingsCommandInput;
    output: SyncSettingsSnapshot;
  };
}

export type SyncCommandName = keyof SyncDataCommandMap;

export type SyncCommandInput<K extends SyncCommandName> = SyncDataCommandMap[K]["input"];

export type SyncCommandOutput<K extends SyncCommandName> = SyncDataCommandMap[K]["output"];

export type SyncCommandRequest = {
  [K in SyncCommandName]: {
    input: SyncCommandInput<K>;
    name: K;
  };
}[SyncCommandName];
