import type { Database } from "@aurascholar/db";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { describe, expect, it } from "vitest";
import type { SaveTranslationProviderSettingsCommandInput } from "../translation-provider-command-contract";
import {
  MainTranslationProviderSettingsStore,
  TRANSLATION_BAIDU_SECRET_KEY,
  TRANSLATION_DEEPL_SECRET_KEY,
  TRANSLATION_PROVIDER_SETTINGS_DATABASE_KEY,
  type MainTranslationProviderSecretStore,
  type MainTranslationProviderSettingsStoreDependencies,
} from "./translation-provider-settings-store";

class MemorySecrets implements MainTranslationProviderSecretStore {
  readonly values = new Map<string, string>();

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

interface TestContext {
  database: Database;
  dependencies: MainTranslationProviderSettingsStoreDependencies;
  secrets: MemorySecrets;
  store: MainTranslationProviderSettingsStore;
}

async function createContext(): Promise<TestContext> {
  const database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  const secrets = new MemorySecrets();
  const dependencies: MainTranslationProviderSettingsStoreDependencies = {
    secrets,
    withDatabase: async (operation) => operation(database),
    withDatabaseTransaction: async (_commandName, operation) => operation(database),
  };
  return {
    database,
    dependencies,
    secrets,
    store: new MainTranslationProviderSettingsStore(dependencies),
  };
}

function saveInput(
  overrides: Partial<SaveTranslationProviderSettingsCommandInput> = {},
): SaveTranslationProviderSettingsCommandInput {
  return {
    baidu: {},
    deepl: {},
    engine: "llm",
    targetLang: "zh",
    ...overrides,
  };
}

describe("main translation provider settings store", () => {
  it("stores only normalized non-secret targets and returns a key-free snapshot", async () => {
    const { database, secrets, store } = await createContext();

    await expect(
      store.save(
        saveInput({
          deepl: {
            apiKey: " deepl-secret ",
            baseUrl: "https://api.deepl.example/custom///",
          },
          engine: "deepl",
        }),
      ),
    ).resolves.toEqual({
      baidu: { appid: "", hasApiKey: false },
      deepl: { baseUrl: "https://api.deepl.example/custom", hasApiKey: true },
      engine: "deepl",
      targetLang: "zh",
    });
    expect(secrets.values.get(TRANSLATION_DEEPL_SECRET_KEY)).toBe("deepl-secret");

    const rows = await database.query<{ value_json: string }>(
      "SELECT value_json FROM settings WHERE key = ?",
      [TRANSLATION_PROVIDER_SETTINGS_DATABASE_KEY],
    );
    expect(rows).toEqual([
      {
        value_json: JSON.stringify({
          baidu: { appid: "", keyBound: false },
          deepl: { baseUrl: "https://api.deepl.example/custom", keyBound: true },
          engine: "deepl",
          targetLang: "zh",
          version: 1,
        }),
      },
    ]);
    expect(rows[0]?.value_json).not.toContain("deepl-secret");
    expect(await store.requireSettings()).toEqual({
      baidu: { apiKey: "", appid: "" },
      deepl: { apiKey: "deepl-secret", baseUrl: "https://api.deepl.example/custom" },
      engine: "deepl",
      targetLang: "zh",
    });
  });

  it("preserves a bound key only for the same normalized provider target", async () => {
    const { secrets, store } = await createContext();
    await store.save(
      saveInput({
        deepl: { apiKey: "kept-key", baseUrl: "https://api.deepl.example/original" },
        engine: "deepl",
      }),
    );

    await expect(
      store.save(
        saveInput({
          deepl: { baseUrl: "https://api.deepl.example/original///" },
          engine: "deepl",
        }),
      ),
    ).resolves.toMatchObject({ deepl: { hasApiKey: true } });
    expect(secrets.values.get(TRANSLATION_DEEPL_SECRET_KEY)).toBe("kept-key");

    await expect(
      store.save(
        saveInput({
          deepl: { baseUrl: "https://attacker.example/redirect" },
          engine: "deepl",
        }),
      ),
    ).rejects.toThrow("请填写 DeepL API Key");
    expect(secrets.values.get(TRANSLATION_DEEPL_SECRET_KEY)).toBe("kept-key");
    await expect(store.requireSettings()).resolves.toMatchObject({
      deepl: { apiKey: "kept-key", baseUrl: "https://api.deepl.example/original" },
      engine: "deepl",
    });
  });

  it("requires a replacement key before a changed Baidu account can use the provider", async () => {
    const { secrets, store } = await createContext();
    await store.save(
      saveInput({
        baidu: { apiKey: "baidu-secret", appid: "original-app" },
        engine: "baidu",
      }),
    );

    await expect(
      store.save(
        saveInput({
          baidu: { appid: " original-app " },
          engine: "baidu",
        }),
      ),
    ).resolves.toMatchObject({ baidu: { appid: "original-app", hasApiKey: true } });
    expect(secrets.values.get(TRANSLATION_BAIDU_SECRET_KEY)).toBe("baidu-secret");

    await expect(
      store.save(
        saveInput({
          baidu: { appid: "attacker-app" },
          engine: "baidu",
        }),
      ),
    ).rejects.toThrow("请填写百度翻译 APPID 和密钥");
    expect(secrets.values.get(TRANSLATION_BAIDU_SECRET_KEY)).toBe("baidu-secret");
    await expect(store.requireSettings()).resolves.toMatchObject({
      baidu: { apiKey: "baidu-secret", appid: "original-app" },
      engine: "baidu",
    });
  });

  it("fails closed for an old unbound named secret during legacy endpoint adoption", async () => {
    const { database, secrets, store } = await createContext();
    secrets.values.set(TRANSLATION_DEEPL_SECRET_KEY, "r3-named-secret");

    await expect(
      store.adoptLegacy(
        saveInput({
          deepl: { baseUrl: "https://attacker.example/redirect" },
          engine: "deepl",
        }),
      ),
    ).resolves.toEqual({
      baidu: { appid: "", hasApiKey: false },
      deepl: { baseUrl: "https://attacker.example/redirect", hasApiKey: false },
      engine: "deepl",
      targetLang: "zh",
    });
    expect(secrets.values.get(TRANSLATION_DEEPL_SECRET_KEY)).toBe("r3-named-secret");
    await expect(store.requireSettings()).rejects.toThrow("请先在设置页填写 DeepL API Key");

    const rows = await database.query<{ value_json: string }>(
      "SELECT value_json FROM settings WHERE key = ?",
      [TRANSLATION_PROVIDER_SETTINGS_DATABASE_KEY],
    );
    expect(rows[0]?.value_json).not.toContain("r3-named-secret");
    expect(rows[0]?.value_json).toContain('"keyBound":false');
  });

  it("binds an explicitly inline legacy key instead of reusing an old named secret", async () => {
    const { secrets, store } = await createContext();
    secrets.values.set(TRANSLATION_DEEPL_SECRET_KEY, "unbound-old-key");

    await store.adoptLegacy(
      saveInput({
        deepl: { apiKey: "inline-legacy-key", baseUrl: "https://api.deepl.example/legacy" },
        engine: "deepl",
      }),
    );
    await expect(store.requireSettings()).resolves.toMatchObject({
      deepl: { apiKey: "inline-legacy-key", baseUrl: "https://api.deepl.example/legacy" },
    });
    expect(secrets.values.get(TRANSLATION_DEEPL_SECRET_KEY)).toBe("inline-legacy-key");
  });

  it("restores a replaced key when durable target persistence fails", async () => {
    const { dependencies, secrets, store } = await createContext();
    await store.save(
      saveInput({
        deepl: { apiKey: "old-key", baseUrl: "https://api.deepl.example/old" },
        engine: "deepl",
      }),
    );
    const failure = new Error("database write failed");
    const failingStore = new MainTranslationProviderSettingsStore({
      ...dependencies,
      withDatabaseTransaction: async () => {
        throw failure;
      },
    });

    await expect(
      failingStore.save(
        saveInput({
          deepl: { apiKey: "new-key", baseUrl: "https://api.deepl.example/new" },
          engine: "deepl",
        }),
      ),
    ).rejects.toBe(failure);
    expect(secrets.values.get(TRANSLATION_DEEPL_SECRET_KEY)).toBe("old-key");
    await expect(store.requireSettings()).resolves.toMatchObject({
      deepl: { apiKey: "old-key", baseUrl: "https://api.deepl.example/old" },
    });
  });
});
