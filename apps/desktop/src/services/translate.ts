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
import { SECRET_KEYS, getSecret, migrateInlineSecret, setSecret } from "./secrets";
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

    const result = await this.inner.translate(input, opts);
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
        apiKey: typeof value.deepl.apiKey === "string" ? value.deepl.apiKey : "",
        baseUrl: typeof value.deepl.baseUrl === "string" ? value.deepl.baseUrl : undefined,
      }
    : undefined;
  const baidu = isStorageRecord(value.baidu)
    ? {
        appid: typeof value.baidu.appid === "string" ? value.baidu.appid : "",
        key: typeof value.baidu.key === "string" ? value.baidu.key : "",
      }
    : undefined;
  return { engine, targetLang, deepl, baidu };
}

export async function loadTranslateConfig(): Promise<TranslateConfig> {
  const parsed = normalizeTranslateConfig(readLocalStorageJson<unknown>(SETTINGS_KEY, null));

  // Migrate any inline plaintext keys out of localStorage into the secret store.
  const deeplKey = await migrateInlineSecret(SECRET_KEYS.translateDeepl, parsed.deepl?.apiKey);
  const baiduKey = await migrateInlineSecret(SECRET_KEYS.translateBaidu, parsed.baidu?.key);
  if (parsed.deepl?.apiKey || parsed.baidu?.key) {
    const sanitized: TranslateConfig = {
      ...parsed,
      deepl: parsed.deepl ? { ...parsed.deepl, apiKey: "" } : undefined,
      baidu: parsed.baidu ? { ...parsed.baidu, key: "" } : undefined,
    };
    tryWriteLocalStorageJson(SETTINGS_KEY, sanitized);
  }

  // Rehydrate keys from the secret store onto the returned config.
  const deepl = parsed.deepl
    ? { ...parsed.deepl, apiKey: deeplKey || (await getSecret(SECRET_KEYS.translateDeepl)) }
    : undefined;
  const baidu = parsed.baidu
    ? { ...parsed.baidu, key: baiduKey || (await getSecret(SECRET_KEYS.translateBaidu)) }
    : undefined;
  return { ...parsed, deepl, baidu };
}

export async function saveTranslateConfig(config: TranslateConfig): Promise<void> {
  // Strip the secret fields before persisting non-secret config to localStorage.
  const sanitized: TranslateConfig = {
    ...config,
    deepl: config.deepl ? { ...config.deepl, apiKey: "" } : undefined,
    baidu: config.baidu ? { ...config.baidu, key: "" } : undefined,
  };
  writeLocalStorageJson(SETTINGS_KEY, sanitized);
  await setSecret(SECRET_KEYS.translateDeepl, config.deepl?.apiKey ?? "");
  await setSecret(SECRET_KEYS.translateBaidu, config.baidu?.key ?? "");
}

/** Resolves the active translator (cache-wrapped), or an error the UI surfaces. */
export async function resolveTranslator(): Promise<{ translator: Translator } | { error: string }> {
  const config = await loadTranslateConfig();
  const provider =
    config.engine === "llm" ? await import("./ai").then(({ makeProvider }) => makeProvider()) : null;
  const result = makeTranslator(config, { http: auraHttp, provider });
  if ("error" in result) return result;
  return { translator: new CachingTranslator(result.translator) };
}

/** Clears all cached translations. Returns how many rows were removed. */
export async function clearTranslationCache(): Promise<number> {
  const db = await getDb();
  const before = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM translation_cache`);
  await db.run(`DELETE FROM translation_cache`);
  return before[0]?.n ?? 0;
}
