import type { TranslateEngine } from "@aurascholar/translate";
import type { AiProviderKind } from "../../services/ai";

export interface AiSettingsSnapshot {
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  /** Main confirms a credential is bound, but never returns its value. */
  hasApiKey: boolean;
  /** Ephemeral editor-only replacement value; always blank after a reload/save. */
  apiKey: string;
}

export interface TranslateSettingsSnapshot {
  engine: TranslateEngine;
  targetLang: string;
  /** Main confirms a key is bound, but never returns its value. */
  hasBaiduApiKey: boolean;
  hasDeepLApiKey: boolean;
  /** Non-secret endpoint retained to preserve a main-bound DeepL target. */
  deeplBaseUrl: string;
  /** Ephemeral editor-only replacement values, blank after reload/save. */
  deeplKey: string;
  baiduAppid: string;
  baiduKey: string;
}

export interface SyncSettingsSnapshot {
  baseUrl: string;
  hasPassword: boolean;
  username: string;
  password: string;
}

export interface BackupSafetyDisplay {
  detail: string;
  secondaryDetail: string;
  tone: "muted" | "ready" | "warning";
  value: string;
}

export type SettingsUrlValidation = { ok: true; value: string } | { message: string; ok: false };
export type SettingsTargetSection = "ai" | "translate" | "sync";
export type SettingsSection = "appearance" | "local-model" | SettingsTargetSection;

export type SettingsSmokeFailureKey =
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_READ__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_TEST__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_READ__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_SAVE__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_READ__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_SAVE__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__";
