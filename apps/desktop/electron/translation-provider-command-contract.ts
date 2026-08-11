import type { TranslateEngine } from "@aurascholar/translate";

/**
 * Renderer-safe view of the configured translation provider. API keys never
 * cross this boundary on reads; `hasApiKey` only describes whether a
 * main-bound credential is usable for the matching provider target.
 */
export interface TranslationProviderSettingsSnapshot {
  baidu: {
    appid: string;
    hasApiKey: boolean;
  };
  deepl: {
    baseUrl?: string;
    hasApiKey: boolean;
  };
  engine: TranslateEngine;
  targetLang: string;
}

/** A key is accepted only while replacing/saving its own provider settings. */
export interface SaveTranslationProviderSettingsCommandInput {
  baidu: {
    /** Omit to preserve the currently bound key for an unchanged APPID. */
    apiKey?: string;
    appid?: string;
  };
  deepl: {
    /** Omit to preserve the currently bound key for an unchanged endpoint. */
    apiKey?: string;
    baseUrl?: string;
  };
  engine: TranslateEngine;
  targetLang: string;
}

/**
 * One-time handoff for the old renderer-owned localStorage record. Existing
 * named secrets are deliberately not adopted without an inline key: they were
 * not bound to a durable main-owned endpoint and must not be reusable by a
 * compromised renderer to target an arbitrary endpoint.
 */
export type AdoptLegacyTranslationProviderSettingsCommandInput =
  SaveTranslationProviderSettingsCommandInput;

export type EmptyTranslationProviderCommandInput = Record<string, never>;

/** A translation operation intentionally carries no engine, endpoint, or key. */
export interface TranslateWithConfiguredProviderCommandInput {
  domain?: string;
  requestId: string;
  sourceLang?: string;
  text: string;
}

/** Cancels only a currently-owned translation request id. */
export interface CancelTranslationProviderRequestCommandInput {
  requestId: string;
}

export interface CancelTranslationProviderRequestCommandResult {
  cancelled: boolean;
}

export interface TranslateWithConfiguredProviderCommandResult {
  detectedSourceLang?: string;
  engine: string;
  text: string;
}

/**
 * Narrow, main-owned translation provider commands. This map intentionally
 * lives outside the central command map until the dispatcher wires it in.
 */
export interface TranslationProviderDataCommandMap {
  "translation.adoptLegacySettings": {
    input: AdoptLegacyTranslationProviderSettingsCommandInput;
    output: TranslationProviderSettingsSnapshot;
  };
  "translation.cancel": {
    input: CancelTranslationProviderRequestCommandInput;
    output: CancelTranslationProviderRequestCommandResult;
  };
  "translation.getSettings": {
    input: EmptyTranslationProviderCommandInput;
    output: TranslationProviderSettingsSnapshot | null;
  };
  "translation.saveSettings": {
    input: SaveTranslationProviderSettingsCommandInput;
    output: TranslationProviderSettingsSnapshot;
  };
  "translation.translate": {
    input: TranslateWithConfiguredProviderCommandInput;
    output: TranslateWithConfiguredProviderCommandResult;
  };
}

export type TranslationProviderCommandName = keyof TranslationProviderDataCommandMap;

export type TranslationProviderCommandInput<K extends TranslationProviderCommandName> =
  TranslationProviderDataCommandMap[K]["input"];

export type TranslationProviderCommandOutput<K extends TranslationProviderCommandName> =
  TranslationProviderDataCommandMap[K]["output"];

export type TranslationProviderCommandRequest = {
  [K in TranslationProviderCommandName]: {
    input: TranslationProviderCommandInput<K>;
    name: K;
  };
}[TranslationProviderCommandName];
