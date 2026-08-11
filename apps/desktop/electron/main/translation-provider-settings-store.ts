import type { Database } from "@aurascholar/db";
import type { TranslateEngine } from "@aurascholar/translate";
import type {
  AdoptLegacyTranslationProviderSettingsCommandInput,
  SaveTranslationProviderSettingsCommandInput,
  TranslationProviderSettingsSnapshot,
} from "../translation-provider-command-contract";
import {
  normalizeMainTranslationProviderTarget,
  requireTranslationApiKey,
  type NormalizedTranslationProviderTarget,
} from "./translation-provider-command-input";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import { deleteMainSecret, getMainSecret, setMainSecret } from "./platform";

export const TRANSLATION_BAIDU_SECRET_KEY = "secret:translate:baidu";
export const TRANSLATION_DEEPL_SECRET_KEY = "secret:translate:deepl";
export const TRANSLATION_PROVIDER_SETTINGS_DATABASE_KEY = "local.translation.provider.v1";

interface StoredTranslationProviderSettings extends NormalizedTranslationProviderTarget {
  baidu: {
    appid: string;
    keyBound: boolean;
  };
  deepl: {
    baseUrl?: string;
    keyBound: boolean;
  };
  version: 1;
}

export interface MainTranslationProviderSettings extends NormalizedTranslationProviderTarget {
  baidu: {
    apiKey: string;
    appid: string;
  };
  deepl: {
    apiKey: string;
    baseUrl?: string;
  };
}

export interface MainTranslationProviderSecretStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface MainTranslationProviderSettingsStoreDependencies {
  secrets: MainTranslationProviderSecretStore;
  withDatabase<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  withDatabaseTransaction<T>(
    commandName: string,
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T>;
}

interface ProviderCredentialPlan {
  baidu: CredentialPlan;
  deepl: CredentialPlan;
}

interface CredentialPlan {
  bound: boolean;
  replacement?: string;
}

/**
 * Main-only owner for every translation provider endpoint, account id, and
 * credential binding. An old named secret alone is intentionally insufficient
 * to run a provider: it must be bound by this store to the durable target.
 */
export class MainTranslationProviderSettingsStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: MainTranslationProviderSettingsStoreDependencies) {}

  async getSnapshot(): Promise<TranslationProviderSettingsSnapshot | null> {
    const stored = await this.readStoredSettings();
    return stored ? this.toSnapshot(stored) : null;
  }

  /**
   * Uses only a durable main-owned configuration. The default LLM settings are
   * safe without a local settings row because AI itself validates its own
   * main-owned provider configuration.
   */
  async requireSettings(): Promise<MainTranslationProviderSettings> {
    const stored = (await this.readStoredSettings()) ?? defaultStoredSettings();
    const target = normalizeMainTranslationProviderTarget(stored);
    switch (target.engine) {
      case "llm":
        return {
          ...target,
          baidu: { apiKey: "", appid: target.baidu.appid },
          deepl: { apiKey: "", ...target.deepl },
        };
      case "deepl": {
        const apiKey = await this.readBoundCredential(
          TRANSLATION_DEEPL_SECRET_KEY,
          stored.deepl.keyBound,
          "DeepL API key",
        );
        if (!apiKey) throw new Error("请先在设置页填写 DeepL API Key，或切换为大模型翻译。");
        return {
          ...target,
          baidu: { apiKey: "", appid: target.baidu.appid },
          deepl: { apiKey, ...target.deepl },
        };
      }
      case "baidu": {
        const apiKey = await this.readBoundCredential(
          TRANSLATION_BAIDU_SECRET_KEY,
          stored.baidu.keyBound,
          "Baidu API key",
        );
        if (!target.baidu.appid || !apiKey) {
          throw new Error("请先在设置页填写百度翻译 APPID 和密钥，或切换为大模型翻译。");
        }
        return {
          ...target,
          baidu: { apiKey, appid: target.baidu.appid },
          deepl: { apiKey: "", ...target.deepl },
        };
      }
    }
  }

  save(
    input: SaveTranslationProviderSettingsCommandInput,
  ): Promise<TranslationProviderSettingsSnapshot> {
    return this.mutate(() =>
      this.saveInternal(input, {
        allowMissingActiveCredential: false,
        permitBoundCredentialReuse: true,
      }),
    );
  }

  /**
   * Migrates the old renderer record at most once. A pre-existing named secret
   * is deliberately never considered a reusable credential here; only a key
   * explicitly present in the legacy record can establish a new binding.
   */
  adoptLegacy(
    input: AdoptLegacyTranslationProviderSettingsCommandInput,
  ): Promise<TranslationProviderSettingsSnapshot> {
    return this.mutate(async () => {
      const existing = await this.readStoredSettings();
      if (existing) return this.toSnapshot(existing);
      return this.saveInternal(input, {
        allowMissingActiveCredential: true,
        permitBoundCredentialReuse: false,
      });
    });
  }

  private async saveInternal(
    input: SaveTranslationProviderSettingsCommandInput,
    options: { allowMissingActiveCredential: boolean; permitBoundCredentialReuse: boolean },
  ): Promise<TranslationProviderSettingsSnapshot> {
    const baiduTarget = { appid: input.baidu.appid };
    const deeplTarget = { baseUrl: input.deepl.baseUrl };
    const baiduApiKey = normalizeOptionalApiKey(input.baidu.apiKey, "Baidu API key");
    const deeplApiKey = normalizeOptionalApiKey(input.deepl.apiKey, "DeepL API key");
    const normalizedInput = {
      ...input,
      baidu: {
        ...baiduTarget,
        ...(baiduApiKey ? { apiKey: baiduApiKey } : {}),
      },
      deepl: {
        ...deeplTarget,
        ...(deeplApiKey ? { apiKey: deeplApiKey } : {}),
      },
    };
    const previous = await this.readStoredSettings();
    const target = normalizeMainTranslationProviderTarget({
      baidu: { appid: normalizedInput.baidu.appid ?? "" },
      deepl: normalizedInput.deepl.baseUrl ? { baseUrl: normalizedInput.deepl.baseUrl } : {},
      engine: normalizedInput.engine,
      targetLang: normalizedInput.targetLang,
    });
    const credentials = await this.planCredentials(previous, target, normalizedInput, options);
    const next: StoredTranslationProviderSettings = {
      ...target,
      baidu: { appid: target.baidu.appid, keyBound: credentials.baidu.bound },
      deepl: { ...target.deepl, keyBound: credentials.deepl.bound },
      version: 1,
    };
    if (!options.allowMissingActiveCredential) assertEngineCredentialAvailable(next, credentials);

    const updates = [
      { key: TRANSLATION_DEEPL_SECRET_KEY, replacement: credentials.deepl.replacement },
      { key: TRANSLATION_BAIDU_SECRET_KEY, replacement: credentials.baidu.replacement },
    ].filter((update): update is { key: string; replacement: string } =>
      Boolean(update.replacement),
    );
    const previousSecrets = await Promise.all(
      updates.map(async (update) => ({
        ...update,
        previous: await this.dependencies.secrets.get(update.key),
      })),
    );
    const applied: Array<{ key: string; previous: string | null }> = [];
    try {
      for (const update of previousSecrets) {
        await this.dependencies.secrets.set(update.key, update.replacement);
        applied.push({ key: update.key, previous: update.previous });
      }
      await this.writeStoredSettings(next);
    } catch (error) {
      await restoreSecrets(this.dependencies.secrets, applied, error);
      throw error;
    }
    return this.toSnapshot(next);
  }

  private async planCredentials(
    previous: StoredTranslationProviderSettings | null,
    target: NormalizedTranslationProviderTarget,
    input: SaveTranslationProviderSettingsCommandInput,
    options: { allowMissingActiveCredential: boolean; permitBoundCredentialReuse: boolean },
  ): Promise<ProviderCredentialPlan> {
    const [previousDeepLKey, previousBaiduKey] = await Promise.all([
      previous
        ? this.readBoundCredential(
            TRANSLATION_DEEPL_SECRET_KEY,
            options.permitBoundCredentialReuse && previous.deepl.keyBound,
            "DeepL API key",
          )
        : null,
      previous
        ? this.readBoundCredential(
            TRANSLATION_BAIDU_SECRET_KEY,
            options.permitBoundCredentialReuse && previous.baidu.keyBound,
            "Baidu API key",
          )
        : null,
    ]);
    return {
      deepl: planCredential({
        input: input.deepl.apiKey,
        previousCredential: previousDeepLKey,
        reusableTarget: Boolean(previous) && sameDeepLTarget(previous!.deepl, target.deepl),
      }),
      baidu: planCredential({
        input: input.baidu.apiKey,
        previousCredential: previousBaiduKey,
        reusableTarget: Boolean(previous) && previous!.baidu.appid === target.baidu.appid,
      }),
    };
  }

  private async readStoredSettings(): Promise<StoredTranslationProviderSettings | null> {
    return this.dependencies.withDatabase(async (database) => {
      const rows = await database.query<{ value_json: string | null }>(
        "SELECT value_json FROM settings WHERE key = ? LIMIT 1",
        [TRANSLATION_PROVIDER_SETTINGS_DATABASE_KEY],
      );
      return parseStoredSettings(rows[0]?.value_json);
    });
  }

  private async writeStoredSettings(settings: StoredTranslationProviderSettings): Promise<void> {
    await this.dependencies.withDatabaseTransaction(
      "translation.saveSettings",
      async (database) => {
        await database.run(
          `INSERT INTO settings (key, value_json, scope, updated_at)
         VALUES (?, ?, 'local', ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           scope = 'local',
           updated_at = excluded.updated_at`,
          [TRANSLATION_PROVIDER_SETTINGS_DATABASE_KEY, JSON.stringify(settings), Date.now()],
        );
      },
    );
  }

  private async readBoundCredential(
    key: string,
    bound: boolean,
    label: string,
  ): Promise<string | null> {
    if (!bound) return null;
    try {
      const value = await this.dependencies.secrets.get(key);
      return value ? requireTranslationApiKey(value, label) : null;
    } catch {
      return null;
    }
  }

  private async toSnapshot(
    settings: StoredTranslationProviderSettings,
  ): Promise<TranslationProviderSettingsSnapshot> {
    const [deeplApiKey, baiduApiKey] = await Promise.all([
      this.readBoundCredential(
        TRANSLATION_DEEPL_SECRET_KEY,
        settings.deepl.keyBound,
        "DeepL API key",
      ),
      this.readBoundCredential(
        TRANSLATION_BAIDU_SECRET_KEY,
        settings.baidu.keyBound,
        "Baidu API key",
      ),
    ]);
    return {
      baidu: { appid: settings.baidu.appid, hasApiKey: Boolean(baiduApiKey) },
      deepl: {
        ...(settings.deepl.baseUrl ? { baseUrl: settings.deepl.baseUrl } : {}),
        hasApiKey: Boolean(deeplApiKey),
      },
      engine: settings.engine,
      targetLang: settings.targetLang,
    };
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation);
    this.mutationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export const mainTranslationProviderSettingsStore = new MainTranslationProviderSettingsStore({
  secrets: {
    delete: deleteMainSecret,
    get: getMainSecret,
    set: setMainSecret,
  },
  withDatabase: withMainDatabase,
  withDatabaseTransaction: withMainDatabaseTransaction,
});

function defaultStoredSettings(): StoredTranslationProviderSettings {
  return {
    baidu: { appid: "", keyBound: false },
    deepl: { keyBound: false },
    engine: "llm",
    targetLang: "zh",
    version: 1,
  };
}

function planCredential({
  input,
  previousCredential,
  reusableTarget,
}: {
  input: string | undefined;
  previousCredential: string | null;
  reusableTarget: boolean;
}): CredentialPlan {
  if (input) return { bound: true, replacement: input };
  if (reusableTarget && previousCredential) return { bound: true };
  return { bound: false };
}

function normalizeOptionalApiKey(value: string | undefined, label: string): string | undefined {
  if (value === undefined || !value.trim()) return undefined;
  return requireTranslationApiKey(value, label);
}

function assertEngineCredentialAvailable(
  settings: StoredTranslationProviderSettings,
  credentials: ProviderCredentialPlan,
): void {
  switch (settings.engine) {
    case "llm":
      return;
    case "deepl":
      if (!credentials.deepl.bound) {
        throw new Error("请填写 DeepL API Key，或切换为大模型翻译。");
      }
      return;
    case "baidu":
      if (!settings.baidu.appid || !credentials.baidu.bound) {
        throw new Error("请填写百度翻译 APPID 和密钥，或切换为大模型翻译。");
      }
  }
}

function sameDeepLTarget(
  a: StoredTranslationProviderSettings["deepl"],
  b: NormalizedTranslationProviderTarget["deepl"],
): boolean {
  return (a.baseUrl ?? "") === (b.baseUrl ?? "");
}

function parseStoredSettings(
  value: string | null | undefined,
): StoredTranslationProviderSettings | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    if (!isRecord(parsed.deepl) || !isRecord(parsed.baidu)) return null;
    if (typeof parsed.deepl.keyBound !== "boolean" || typeof parsed.baidu.keyBound !== "boolean") {
      return null;
    }
    const target = normalizeMainTranslationProviderTarget({
      baidu: { appid: typeof parsed.baidu.appid === "string" ? parsed.baidu.appid : "" },
      deepl: typeof parsed.deepl.baseUrl === "string" ? { baseUrl: parsed.deepl.baseUrl } : {},
      engine: parsed.engine as TranslateEngine,
      targetLang: typeof parsed.targetLang === "string" ? parsed.targetLang : "",
    });
    return {
      ...target,
      baidu: { appid: target.baidu.appid, keyBound: parsed.baidu.keyBound },
      deepl: { ...target.deepl, keyBound: parsed.deepl.keyBound },
      version: 1,
    };
  } catch {
    return null;
  }
}

async function restoreSecrets(
  secrets: MainTranslationProviderSecretStore,
  applied: Array<{ key: string; previous: string | null }>,
  cause: unknown,
): Promise<void> {
  const rollbackErrors: unknown[] = [];
  for (const update of applied.reverse()) {
    try {
      if (update.previous === null) await secrets.delete(update.key);
      else await secrets.set(update.key, update.previous);
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError(
      [cause, ...rollbackErrors],
      "Translation settings save failed and credential rollback also failed",
      { cause: rollbackErrors[0] },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
