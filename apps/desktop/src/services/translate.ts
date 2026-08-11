// Renderer-safe translation facade. Provider configuration, API keys, and
// network egress are main-owned; this module only handles settings DTOs,
// main-command cancellation, and the existing application-global cache.
import {
  md5,
  type TranslateEngine,
  type TranslateInput,
  type TranslateOptions,
  type TranslateResult,
  type Translator,
} from "@aurascholar/translate";
import type {
  SaveTranslationProviderSettingsCommandInput,
  TranslateWithConfiguredProviderCommandInput,
  TranslationProviderSettingsSnapshot,
} from "../../electron/translation-provider-command-contract";
import { isStorageRecord, readLocalStorageJson, tryRemoveLocalStorageItem } from "../storage";

const LEGACY_SETTINGS_KEY = "translate-settings";

const DEFAULT_CONFIG: TranslationProviderSettingsSnapshot = {
  baidu: { appid: "", hasApiKey: false },
  deepl: { hasApiKey: false },
  engine: "llm",
  targetLang: "zh",
};

/** Main-owned, key-free configuration view for Reader and Settings UI. */
export type TranslateConfig = TranslationProviderSettingsSnapshot;

/** Renderer may submit a replacement key, but can never read a stored one. */
export interface TranslateSettingsInput {
  baidu?: {
    apiKey?: string;
    appid?: string;
  };
  deepl?: {
    apiKey?: string;
    baseUrl?: string;
  };
  engine: TranslateEngine;
  targetLang: string;
}

/** Main owns app-global cache persistence; callers retain only cache behavior. */
export interface TranslationCacheDataSource {
  clear: () => Promise<number>;
  get: (cacheKey: string) => Promise<string | null>;
  put: (cacheKey: string, engine: string, targetLang: string, result: string) => Promise<void>;
}

const defaultTranslationCacheDataSource: TranslationCacheDataSource = {
  async clear() {
    return (await window.aura.data.command("translationCache.clear", {})).deleted;
  },
  async get(cacheKey) {
    return (await window.aura.data.command("translationCache.get", { cacheKey })).result;
  },
  async put(cacheKey, engine, targetLang, result) {
    await window.aura.data.command("translationCache.put", {
      cacheKey,
      engine,
      result,
      targetLang,
    });
  },
};

/**
 * Wraps a Translator with the main-owned SQLite cache. Full-page / full-text
 * translation re-runs over the same chunks costs real BYOK tokens; caching by
 * (provider target, target language, source hash) makes re-opening a page
 * instant and free. Empty results are never cached.
 */
class CachingTranslator implements Translator {
  readonly id: string;

  constructor(
    private readonly inner: Translator,
    private readonly cache: TranslationCacheDataSource,
    private readonly cacheScope = inner.id,
    private readonly configuredTargetLang?: string,
  ) {
    this.id = inner.id;
  }

  async translate(input: TranslateInput, opts?: TranslateOptions): Promise<TranslateResult> {
    if (opts?.signal?.aborted) throw abortError();
    const text = input.text.trim();
    if (!text) return { text: "", engine: this.id };
    const targetLang = this.configuredTargetLang ?? input.targetLang;
    const key = md5(`${this.cacheScope}\0${targetLang}\0${text}`);

    const cached = await this.cache.get(key).catch(() => null);
    if (opts?.signal?.aborted) throw abortError();
    if (cached) return { text: cached, engine: `${this.id} (缓存)` };

    const result = await this.inner.translate({ ...input, targetLang }, opts);
    if (opts?.signal?.aborted) throw abortError();
    if (result.text.trim()) {
      await this.cache.put(key, this.id, targetLang, result.text).catch(() => {});
    }
    return result;
  }
}

/** Testable cache wrapper that keeps cache failures out of translation flow. */
export function createCachingTranslator(
  inner: Translator,
  cache: TranslationCacheDataSource = defaultTranslationCacheDataSource,
): Translator {
  return new CachingTranslator(inner, cache);
}

/**
 * Reads the main-owned configuration. A valid old localStorage record is
 * handed off once, then removed only after main accepts it. A legacy record
 * without an inline key remains intentionally unconfigured: main never binds
 * its old named secret to a renderer-supplied endpoint.
 */
export async function loadTranslateConfig(): Promise<TranslateConfig> {
  const legacy = readLegacyTranslateSettings();
  if (legacy) {
    const snapshot = await window.aura.data.command("translation.adoptLegacySettings", legacy);
    tryRemoveLocalStorageItem(LEGACY_SETTINGS_KEY);
    return snapshot;
  }
  return (await window.aura.data.command("translation.getSettings", {})) ?? DEFAULT_CONFIG;
}

/**
 * Saves non-secret target data in main and optionally replaces the current
 * provider key. Omitting a key preserves it only for the same bound target;
 * changing an endpoint or Baidu APPID requires a new key in main.
 */
export function saveTranslateConfig(
  config: TranslateSettingsInput,
): Promise<TranslationProviderSettingsSnapshot> {
  const baiduApiKey = trimOptional(config.baidu?.apiKey);
  const baiduAppid = trimOptional(config.baidu?.appid);
  const deeplApiKey = trimOptional(config.deepl?.apiKey);
  const deeplBaseUrl = trimOptional(config.deepl?.baseUrl);
  const input: SaveTranslationProviderSettingsCommandInput = {
    baidu: {
      ...(baiduApiKey ? { apiKey: baiduApiKey } : {}),
      ...(baiduAppid ? { appid: baiduAppid } : {}),
    },
    deepl: {
      ...(deeplApiKey ? { apiKey: deeplApiKey } : {}),
      ...(deeplBaseUrl ? { baseUrl: deeplBaseUrl } : {}),
    },
    engine: config.engine,
    targetLang: config.targetLang,
  };
  return window.aura.data.command("translation.saveSettings", input);
}

/** Resolves the active main-owned translator (cache-wrapped), or a UI error. */
export async function resolveTranslator(): Promise<{ translator: Translator } | { error: string }> {
  const config = await loadTranslateConfig();
  if (config.engine === "deepl" && !config.deepl.hasApiKey) {
    return { error: "请先在设置页填写 DeepL API Key，或切换为大模型翻译。" };
  }
  if (config.engine === "baidu" && (!config.baidu.appid || !config.baidu.hasApiKey)) {
    return { error: "请先在设置页填写百度翻译 APPID 和密钥，或切换为大模型翻译。" };
  }
  const provider = new MainProcessTranslator(config);
  return {
    translator: new CachingTranslator(
      provider,
      defaultTranslationCacheDataSource,
      translationCacheScope(config),
      config.targetLang,
    ),
  };
}

/** Clears all cached translations. Returns how many rows were removed. */
export async function clearTranslationCache(): Promise<number> {
  return defaultTranslationCacheDataSource.clear();
}

class MainProcessTranslator implements Translator {
  readonly id: string;

  constructor(config: TranslateConfig) {
    this.id = config.engine;
  }

  async translate(input: TranslateInput, opts?: TranslateOptions): Promise<TranslateResult> {
    const result = await invokeConfiguredTranslation(
      {
        ...(opts?.domain?.trim() ? { domain: opts.domain.trim() } : {}),
        ...(input.sourceLang?.trim() ? { sourceLang: input.sourceLang.trim() } : {}),
        text: input.text,
      },
      opts?.signal,
    );
    return result;
  }
}

async function invokeConfiguredTranslation(
  input: Omit<TranslateWithConfiguredProviderCommandInput, "requestId">,
  signal?: AbortSignal,
): Promise<TranslateResult> {
  if (signal?.aborted) throw abortError();
  const requestId = newTranslationRequestId();
  let cancellationRequested = false;
  const cancel = () => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    // The original invocation remains authoritative for the user-visible
    // error/result; main may already have finished its provider request.
    void window.aura.data.command("translation.cancel", { requestId }).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await window.aura.data.command("translation.translate", { ...input, requestId });
    if (signal?.aborted) throw abortError();
    return result;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

function translationCacheScope(config: TranslateConfig): string {
  return `main:${md5(
    JSON.stringify({
      baiduAppid: config.baidu.appid,
      deeplBaseUrl: config.deepl.baseUrl ?? "",
      engine: config.engine,
      targetLang: config.targetLang,
    }),
  )}`;
}

function readLegacyTranslateSettings(): SaveTranslationProviderSettingsCommandInput | null {
  const parsed = readLocalStorageJson<unknown>(LEGACY_SETTINGS_KEY, null);
  if (!isStorageRecord(parsed)) return null;
  const engine: TranslateEngine =
    parsed.engine === "deepl" || parsed.engine === "baidu" || parsed.engine === "llm"
      ? parsed.engine
      : "llm";
  const targetLang =
    typeof parsed.targetLang === "string" && parsed.targetLang.trim()
      ? parsed.targetLang.trim()
      : "zh";
  const deepl = isStorageRecord(parsed.deepl) ? parsed.deepl : {};
  const baidu = isStorageRecord(parsed.baidu) ? parsed.baidu : {};
  const baiduApiKey = trimUnknown(baidu.key);
  const baiduAppid = trimUnknown(baidu.appid);
  const deeplApiKey = trimUnknown(deepl.apiKey);
  const deeplBaseUrl = trimUnknown(deepl.baseUrl);
  return {
    baidu: {
      ...(baiduApiKey ? { apiKey: baiduApiKey } : {}),
      ...(baiduAppid ? { appid: baiduAppid } : {}),
    },
    deepl: {
      ...(deeplApiKey ? { apiKey: deeplApiKey } : {}),
      ...(deeplBaseUrl ? { baseUrl: deeplBaseUrl } : {}),
    },
    engine,
    targetLang,
  };
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function trimUnknown(value: unknown): string | undefined {
  return typeof value === "string" ? trimOptional(value) : undefined;
}

function newTranslationRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `translation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortError(): Error {
  const error = new Error("Translation request cancelled");
  error.name = "AbortError";
  return error;
}
