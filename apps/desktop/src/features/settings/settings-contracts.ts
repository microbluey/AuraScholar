import type { TranslateEngine } from "@aurascholar/translate";
import type { AiProviderKind } from "../../services/ai";

export interface AiSettingsSnapshot {
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface TranslateSettingsSnapshot {
  engine: TranslateEngine;
  targetLang: string;
  deeplKey: string;
  baiduAppid: string;
  baiduKey: string;
}

export interface SyncSettingsSnapshot {
  baseUrl: string;
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
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_SAVE__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_TEST__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_READ__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_SAVE__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_READ__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_SAVE__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__";
