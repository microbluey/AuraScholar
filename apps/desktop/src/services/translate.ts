// Translation service for the desktop app: BYOK-style config in localStorage
// (mirrors ai.ts; keychain migration tracked for before v0.2), and a helper
// that resolves the configured engine into a Translator. The LLM engine reuses
// the AI provider, so the default path needs no extra setup.
import {
  makeTranslator,
  md5,
  type TranslateConfig,
  type TranslateInput,
  type TranslateOptions,
  type TranslateResult,
  type Translator,
} from "@aurascholar/translate";
import { auraHttp } from "./aura-platform";
import { getDb } from "./aura-db";
import { describeSafeError, toSafeError } from "./sensitive-text";
import { SECRET_KEYS, getSecret, migrateInlineSecret, withSecretTransaction } from "./secrets";
import {
  isStorageRecord,
  readLocalStorageJson,
  tryWriteLocalStorageJson,
  writeLocalStorageJson,
} from "../storage";

const SETTINGS_KEY = "translate-settings";

/**
 * Wraps a Translator with a SQLite-backed cache. Full-page / full-text
 * translation re-runs over the same chunks costs real BYOK tokens; caching by
 * (engine, targetLang, source-hash) makes re-opening a page instant and free.
 * Empty results are never cached (so transient failures don't stick).
 */
class CachingTranslator implements Translator {
  readonly id: string;
  constructor(private readonly inner: Translator) {
    this.id = inner.id;
  }

  async translate(input: TranslateInput, opts?: TranslateOptions): Promise<TranslateResult> {
    const text = input.text.trim();
    if (!text) return { text: "", engine: this.id };
    const key = md5(`${this.id}\0${input.targetLang}\0${text}`);

    const cached = await readCache(key).catch(() => null);
    if (cached) return { text: cached, engine: `${this.id} (缓存)` };

    let result: TranslateResult;
    try {
      result = await this.inner.translate(input, opts);
    } catch (error) {
      throw toSafeError(error);
    }
    if (result.text.trim()) {
      await writeCache(key, this.id, input.targetLang, result.text).catch(() => {});
    }
    return result;
  }
}

async function readCache(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.query<{ result: string }>(
    `SELECT result FROM translation_cache WHERE cache_key = ?`,
    [key],
  );
  return rows[0]?.result ?? null;
}

async function writeCache(
  key: string,
  engine: string,
  targetLang: string,
  result: string,
): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT OR REPLACE INTO translation_cache (cache_key, engine, target_lang, result, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [key, engine, targetLang, result, Date.now()],
  );
}

const DEFAULT_CONFIG: TranslateConfig = {
  engine: "llm",
  targetLang: "zh",
};

function normalizeTranslateConfig(value: unknown): TranslateConfig {
  if (!isStorageRecord(value)) return DEFAULT_CONFIG;
  const engine =
    value.engine === "deepl" || value.engine === "baidu" || value.engine === "llm"
      ? value.engine
      : DEFAULT_CONFIG.engine;
  const targetLang = typeof value.targetLang === "string" && value.targetLang.trim()
    ? value.targetLang.trim()
    : DEFAULT_CONFIG.targetLang;
  const deepl = isStorageRecord(value.deepl)
    ? {
        apiKey: typeof value.deepl.apiKey === "string" ? value.deepl.apiKey.trim() : "",
        baseUrl:
          typeof value.deepl.baseUrl === "string"
            ? normalizeStoredDeepLBaseUrl(value.deepl.baseUrl)
            : undefined,
      }
    : undefined;
  const baidu = isStorageRecord(value.baidu)
    ? {
        appid: typeof value.baidu.appid === "string" ? value.baidu.appid.trim() : "",
        key: typeof value.baidu.key === "string" ? value.baidu.key.trim() : "",
      }
    : undefined;
  return { engine, targetLang, deepl, baidu };
}

export async function loadTranslateConfig(): Promise<TranslateConfig> {
  const parsed = normalizeTranslateConfig(readLocalStorageJson<unknown>(SETTINGS_KEY, null));

  // Migrate any inline plaintext keys out of localStorage into the secret store.
  const deeplMigration = await migrateInlineSecret(SECRET_KEYS.translateDeepl, parsed.deepl?.apiKey);
  const baiduMigration = await migrateInlineSecret(SECRET_KEYS.translateBaidu, parsed.baidu?.key);
  if (
    (parsed.deepl?.apiKey && deeplMigration.persisted) ||
    (parsed.baidu?.key && baiduMigration.persisted)
  ) {
    const sanitized: TranslateConfig = {
      ...parsed,
      deepl: parsed.deepl
        ? { ...parsed.deepl, apiKey: deeplMigration.persisted ? "" : parsed.deepl.apiKey }
        : undefined,
      baidu: parsed.baidu
        ? { ...parsed.baidu, key: baiduMigration.persisted ? "" : parsed.baidu.key }
        : undefined,
    };
    tryWriteLocalStorageJson(SETTINGS_KEY, sanitized);
  }

  // Rehydrate keys from the secret store onto the returned config.
  const deepl = parsed.deepl
    ? { ...parsed.deepl, apiKey: deeplMigration.value || (await getSecret(SECRET_KEYS.translateDeepl)) }
    : undefined;
  const baidu = parsed.baidu
    ? { ...parsed.baidu, key: baiduMigration.value || (await getSecret(SECRET_KEYS.translateBaidu)) }
    : undefined;
  return { ...parsed, deepl, baidu };
}

export async function saveTranslateConfig(config: TranslateConfig): Promise<void> {
  const normalized = normalizeTranslateConfigForStorage(config);
  // Strip the secret fields before persisting non-secret config to localStorage.
  const sanitized: TranslateConfig = {
    ...normalized,
    deepl: normalized.deepl ? { ...normalized.deepl, apiKey: "" } : undefined,
    baidu: normalized.baidu ? { ...normalized.baidu, key: "" } : undefined,
  };
  await withSecretTransaction(
    [
      { key: SECRET_KEYS.translateDeepl, value: normalized.deepl?.apiKey ?? "" },
      { key: SECRET_KEYS.translateBaidu, value: normalized.baidu?.key ?? "" },
    ],
    () => {
      writeLocalStorageJson(SETTINGS_KEY, sanitized);
    },
  );
}

function normalizeTranslateConfigForStorage(config: TranslateConfig): TranslateConfig {
  const engine =
    config.engine === "deepl" || config.engine === "baidu" || config.engine === "llm"
      ? config.engine
      : DEFAULT_CONFIG.engine;
  const targetLang = config.targetLang.trim() || DEFAULT_CONFIG.targetLang;
  const deepl = config.deepl
    ? {
        apiKey: config.deepl.apiKey.trim(),
        baseUrl: normalizeDeepLBaseUrlForStorage(config.deepl.baseUrl),
      }
    : undefined;
  const baidu = config.baidu
    ? {
        appid: config.baidu.appid.trim(),
        key: config.baidu.key.trim(),
      }
    : undefined;
  if (engine === "deepl" && !deepl?.apiKey) {
    throw new Error("请填写 DeepL API Key，或切换为大模型翻译。");
  }
  if (engine === "baidu" && (!baidu?.appid || !baidu?.key)) {
    throw new Error("请填写百度翻译 APPID 和密钥，或切换为大模型翻译。");
  }
  return { baidu, deepl, engine, targetLang };
}

function normalizeStoredDeepLBaseUrl(value: string): string | undefined {
  try {
    return normalizeDeepLBaseUrlForStorage(value);
  } catch {
    return undefined;
  }
}

function normalizeDeepLBaseUrlForStorage(value?: string): string | undefined {
  const raw = value?.trim() ?? "";
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DeepL API 地址格式不正确，请使用完整的 http:// 或 https:// 地址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
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

/** Resolves the active translator (cache-wrapped), or an error the UI surfaces. */
export async function resolveTranslator(): Promise<{ translator: Translator } | { error: string }> {
  const config = await loadTranslateConfig();
  const provider =
    config.engine === "llm" ? await import("./ai").then(({ makeProvider }) => makeProvider()) : null;
  const result = makeTranslator(config, { http: auraHttp, provider });
  if ("error" in result) return { error: describeSafeError(result.error) };
  return { translator: new CachingTranslator(result.translator) };
}

/** Clears all cached translations. Returns how many rows were removed. */
export async function clearTranslationCache(): Promise<number> {
  const db = await getDb();
  const before = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM translation_cache`);
  await db.run(`DELETE FROM translation_cache`);
  return before[0]?.n ?? 0;
}
