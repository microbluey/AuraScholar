import { Buffer } from "node:buffer";
import type { TranslateEngine } from "@aurascholar/translate";
import type {
  AdoptLegacyTranslationProviderSettingsCommandInput,
  CancelTranslationProviderRequestCommandInput,
  EmptyTranslationProviderCommandInput,
  SaveTranslationProviderSettingsCommandInput,
  TranslateWithConfiguredProviderCommandInput,
  TranslationProviderCommandName,
} from "../translation-provider-command-contract";

export const MAX_TRANSLATION_API_KEY_BYTES = 64 * 1024;
export const MAX_TRANSLATION_API_KEY_LENGTH = 16 * 1024;
export const MAX_TRANSLATION_APPID_LENGTH = 4 * 1024;
export const MAX_TRANSLATION_DOMAIN_BYTES = 16 * 1024;
export const MAX_TRANSLATION_DOMAIN_LENGTH = 4 * 1024;
export const MAX_TRANSLATION_ENDPOINT_LENGTH = 2_048;
export const MAX_TRANSLATION_REQUEST_ID_LENGTH = 128;
export const MAX_TRANSLATION_SOURCE_LANGUAGE_LENGTH = 64;
export const MAX_TRANSLATION_TARGET_LANGUAGE_LENGTH = 64;
export const MAX_TRANSLATION_TEXT_BYTES = 1024 * 1024;
export const MAX_TRANSLATION_TEXT_LENGTH = 256 * 1024;

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface NormalizedTranslationProviderTarget {
  baidu: { appid: string };
  deepl: { baseUrl?: string };
  engine: TranslateEngine;
  targetLang: string;
}

export function parseTranslationProviderGetSettingsInput(
  value: unknown,
): EmptyTranslationProviderCommandInput {
  return parseExactEmptyInput(value, "translation.getSettings");
}

export function parseTranslationProviderSaveSettingsInput(
  value: unknown,
): SaveTranslationProviderSettingsCommandInput {
  return parseProviderSettingsInput(value, "translation.saveSettings");
}

export function parseTranslationProviderAdoptLegacySettingsInput(
  value: unknown,
): AdoptLegacyTranslationProviderSettingsCommandInput {
  return parseProviderSettingsInput(value, "translation.adoptLegacySettings");
}

export function parseTranslationProviderTranslateInput(
  value: unknown,
): TranslateWithConfiguredProviderCommandInput {
  const input = requireExactRecord(value, "translation.translate", [
    "domain",
    "requestId",
    "sourceLang",
    "text",
  ]);
  const domain = optionalBoundedText(
    input.domain,
    "Translation domain",
    MAX_TRANSLATION_DOMAIN_LENGTH,
    MAX_TRANSLATION_DOMAIN_BYTES,
  );
  const sourceLang = optionalLanguageCode(
    input.sourceLang,
    "Translation source language",
    MAX_TRANSLATION_SOURCE_LANGUAGE_LENGTH,
    MAX_TRANSLATION_SOURCE_LANGUAGE_LENGTH * 4,
  );
  return {
    ...(domain ? { domain } : {}),
    requestId: requireRequestId(input.requestId),
    ...(sourceLang ? { sourceLang } : {}),
    text: requireBoundedText(
      input.text,
      "Translation text",
      MAX_TRANSLATION_TEXT_LENGTH,
      MAX_TRANSLATION_TEXT_BYTES,
      true,
    ),
  };
}

export function parseTranslationProviderCancelInput(
  value: unknown,
): CancelTranslationProviderRequestCommandInput {
  const input = requireExactRecord(value, "translation.cancel", ["requestId"]);
  return { requestId: requireRequestId(input.requestId) };
}

/** Revalidates persisted non-secret state before it can configure a provider. */
export function normalizeMainTranslationProviderTarget(
  value: NormalizedTranslationProviderTarget,
): NormalizedTranslationProviderTarget {
  const engine = requireTranslateEngine(value.engine);
  const targetLang = requireLanguageCode(
    value.targetLang,
    "Translation target language",
    MAX_TRANSLATION_TARGET_LANGUAGE_LENGTH,
    MAX_TRANSLATION_TARGET_LANGUAGE_LENGTH * 4,
  );
  const normalizedDeepLBaseUrl = normalizeDeepLBaseUrl(value.deepl?.baseUrl);
  const deepl = { ...(normalizedDeepLBaseUrl ? { baseUrl: normalizedDeepLBaseUrl } : {}) };
  const baidu = { appid: optionalBaiduAppid(value.baidu?.appid) ?? "" };
  return { baidu, deepl, engine, targetLang };
}

export function requireTranslationApiKey(value: unknown, label: string): string {
  const key = requireBoundedText(
    value,
    label,
    MAX_TRANSLATION_API_KEY_LENGTH,
    MAX_TRANSLATION_API_KEY_BYTES,
    true,
  );
  assertNoControlCharacters(key, label);
  return key;
}

function parseProviderSettingsInput<
  T extends
    | SaveTranslationProviderSettingsCommandInput
    | AdoptLegacyTranslationProviderSettingsCommandInput,
>(value: unknown, commandName: "translation.saveSettings" | "translation.adoptLegacySettings"): T {
  const input = requireExactRecord(value, commandName, ["baidu", "deepl", "engine", "targetLang"]);
  const deeplInput = requireExactRecord(input.deepl, `${commandName} DeepL`, ["apiKey", "baseUrl"]);
  const baiduInput = requireExactRecord(input.baidu, `${commandName} Baidu`, ["apiKey", "appid"]);
  const normalizedDeepLBaseUrl = normalizeDeepLBaseUrl(deeplInput.baseUrl);
  const normalized = normalizeMainTranslationProviderTarget({
    baidu: { appid: optionalBaiduAppid(baiduInput.appid) ?? "" },
    deepl: { ...(normalizedDeepLBaseUrl ? { baseUrl: normalizedDeepLBaseUrl } : {}) },
    engine: requireTranslateEngine(input.engine),
    targetLang: requireLanguageCode(
      input.targetLang,
      "Translation target language",
      MAX_TRANSLATION_TARGET_LANGUAGE_LENGTH,
      MAX_TRANSLATION_TARGET_LANGUAGE_LENGTH * 4,
    ),
  });
  const deeplApiKey = optionalApiKey(deeplInput.apiKey, "DeepL API key");
  const baiduApiKey = optionalApiKey(baiduInput.apiKey, "Baidu API key");
  return {
    baidu: {
      ...(baiduApiKey ? { apiKey: baiduApiKey } : {}),
      ...(normalized.baidu.appid ? { appid: normalized.baidu.appid } : {}),
    },
    deepl: {
      ...(deeplApiKey ? { apiKey: deeplApiKey } : {}),
      ...(normalized.deepl.baseUrl ? { baseUrl: normalized.deepl.baseUrl } : {}),
    },
    engine: normalized.engine,
    targetLang: normalized.targetLang,
  } as T;
}

function parseExactEmptyInput(
  value: unknown,
  commandName: TranslationProviderCommandName,
): EmptyTranslationProviderCommandInput {
  requireExactRecord(value, commandName, []);
  return {};
}

function requireTranslateEngine(value: unknown): TranslateEngine {
  if (value === "llm" || value === "deepl" || value === "baidu") return value;
  throw new Error("Translation engine is invalid");
}

function optionalBaiduAppid(value: unknown): string | undefined {
  const appid = optionalBoundedText(
    value,
    "Baidu translation APPID",
    MAX_TRANSLATION_APPID_LENGTH,
    MAX_TRANSLATION_APPID_LENGTH * 4,
  );
  if (appid) assertNoControlCharacters(appid, "Baidu translation APPID");
  return appid;
}

function requireLanguageCode(
  value: unknown,
  label: string,
  maximumLength: number,
  maximumBytes: number,
): string {
  const normalized = requireBoundedText(value, label, maximumLength, maximumBytes, true);
  assertNoControlCharacters(normalized, label);
  return normalized;
}

function optionalLanguageCode(
  value: unknown,
  label: string,
  maximumLength: number,
  maximumBytes: number,
): string | undefined {
  const normalized = optionalBoundedText(value, label, maximumLength, maximumBytes);
  if (normalized) assertNoControlCharacters(normalized, label);
  return normalized;
}

function optionalApiKey(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  return requireTranslationApiKey(value, label);
}

function normalizeDeepLBaseUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const raw = requireBoundedText(
    value,
    "DeepL API URL",
    MAX_TRANSLATION_ENDPOINT_LENGTH,
    MAX_TRANSLATION_ENDPOINT_LENGTH * 4,
    false,
  );
  if (!raw) return undefined;
  assertNoControlCharacters(raw, "DeepL API URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DeepL API 地址格式不正确，请使用完整的 http:// 或 https:// 地址。");
  }
  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    throw new Error("DeepL API 地址仅支持 http:// 或 https://。");
  }
  if (url.username || url.password) {
    throw new Error("DeepL API 地址不要包含密钥或账号，请填写在 API Key 字段中。");
  }
  if (url.search || url.hash) {
    throw new Error("DeepL API 地址请填写接口根地址，不要包含查询参数或 # 片段。");
  }
  return url.toString().replace(/\/+$/, "");
}

function requireRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !REQUEST_ID_RE.test(value) ||
    value.length > MAX_TRANSLATION_REQUEST_ID_LENGTH
  ) {
    throw new Error("Translation request id is invalid");
  }
  return value;
}

function optionalBoundedText(
  value: unknown,
  label: string,
  maximumLength: number,
  maximumBytes: number,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = requireBoundedText(value, label, maximumLength, maximumBytes, false);
  return normalized || undefined;
}

function requireBoundedText(
  value: unknown,
  label: string,
  maximumLength: number,
  maximumBytes: number,
  requireNonEmpty: boolean,
): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  if (value.length > maximumLength || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error(`${label} is too long`);
  }
  const normalized = value.trim();
  if (requireNonEmpty && !normalized) throw new Error(`${label} is required`);
  return normalized;
}

function assertNoControlCharacters(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      throw new Error(`${label} contains control characters`);
    }
  }
}

function requireExactRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label} input`);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new Error(`Invalid ${label} input`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
