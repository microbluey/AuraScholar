import type { Database } from "@aurascholar/db";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { describe, expect, it } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import {
  AI_API_KEY_SECRET_KEY,
  AI_SETTINGS_DATABASE_KEY,
  MainAiSettingsStore,
  type MainAiSecretStore,
  type MainAiSettingsStoreDependencies,
} from "./ai-settings-store";

class MemorySecrets implements MainAiSecretStore {
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
  dependencies: MainAiSettingsStoreDependencies;
  secrets: MemorySecrets;
  store: MainAiSettingsStore;
}

async function createContext(): Promise<TestContext> {
  const database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  const coordinator = new DatabaseCoordinator(database);
  const secrets = new MemorySecrets();
  const dependencies: MainAiSettingsStoreDependencies = {
    secrets,
    withDatabase: (operation) => coordinator.execute(operation),
    withDatabaseTransaction: (commandName, operation) =>
      coordinator.transaction(commandName, operation),
  };
  return {
    database,
    dependencies,
    secrets,
    store: new MainAiSettingsStore(dependencies),
  };
}

describe("main AI settings store", () => {
  it("stores only a canonical target and never returns the API key", async () => {
    const { database, secrets, store } = await createContext();

    await expect(
      store.save({
        apiKey: "  key-for-main-only-provider  ",
        baseUrl: " https://ai.example.test/v1/// ",
        kind: "openai-compatible",
        model: " test-model ",
      }),
    ).resolves.toEqual({
      baseUrl: "https://ai.example.test/v1",
      hasApiKey: true,
      kind: "openai-compatible",
      model: "test-model",
    });

    await expect(store.getSnapshot()).resolves.toEqual({
      baseUrl: "https://ai.example.test/v1",
      hasApiKey: true,
      kind: "openai-compatible",
      model: "test-model",
    });
    await expect(store.requireSettings()).resolves.toEqual({
      apiKey: "key-for-main-only-provider",
      baseUrl: "https://ai.example.test/v1",
      kind: "openai-compatible",
      model: "test-model",
    });
    expect(secrets.values.get(AI_API_KEY_SECRET_KEY)).toBe("key-for-main-only-provider");

    const rows = await database.query<{ value_json: string }>(
      "SELECT value_json FROM settings WHERE key = ?",
      [AI_SETTINGS_DATABASE_KEY],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.value_json ?? "{}")).toEqual({
      apiKeyBound: true,
      baseUrl: "https://ai.example.test/v1",
      kind: "openai-compatible",
      model: "test-model",
      version: 2,
    });
    expect(rows[0]?.value_json).not.toContain("key-for-main-only-provider");
  });

  it("preserves a bound key only for an unchanged canonical target", async () => {
    const { secrets, store } = await createContext();
    await store.save({
      apiKey: "kept-key",
      baseUrl: "https://ai.example.test/original",
      kind: "openai-compatible",
      model: "model-a",
    });

    await expect(
      store.save({
        baseUrl: "https://ai.example.test/original///",
        kind: "openai-compatible",
        model: "model-a",
      }),
    ).resolves.toMatchObject({ hasApiKey: true });
    await expect(
      store.save({
        baseUrl: "https://attacker.example/redirect",
        kind: "openai-compatible",
        model: "model-a",
      }),
    ).rejects.toThrow("重新填写 API Key");

    expect(secrets.values.get(AI_API_KEY_SECRET_KEY)).toBe("kept-key");
    await expect(store.requireSettings()).resolves.toMatchObject({
      apiKey: "kept-key",
      baseUrl: "https://ai.example.test/original",
    });
  });

  it("does not bind an old named secret to legacy renderer config without an inline key", async () => {
    const { secrets, store } = await createContext();
    secrets.values.set(AI_API_KEY_SECRET_KEY, "old-unbound-key");

    await expect(
      store.adoptLegacy({
        baseUrl: "https://renderer-controlled.example/v1",
        kind: "openai-compatible",
        model: "legacy-model",
      }),
    ).resolves.toEqual({
      baseUrl: "https://renderer-controlled.example/v1",
      hasApiKey: false,
      kind: "openai-compatible",
      model: "legacy-model",
    });
    await expect(store.requireSettings()).rejects.toThrow("请先在设置页配置 AI 服务");
    expect(secrets.values.get(AI_API_KEY_SECRET_KEY)).toBe("old-unbound-key");

    await expect(
      store.save({
        apiKey: "explicit-rebind-key",
        baseUrl: "https://renderer-controlled.example/v1",
        kind: "openai-compatible",
        model: "legacy-model",
      }),
    ).resolves.toMatchObject({ hasApiKey: true });
    await expect(store.requireSettings()).resolves.toMatchObject({
      apiKey: "explicit-rebind-key",
    });
  });

  it("uses an inline legacy key only with the same submitted legacy target", async () => {
    const { secrets, store } = await createContext();
    secrets.values.set(AI_API_KEY_SECRET_KEY, "old-unbound-key");

    await expect(
      store.adoptLegacy({
        baseUrl: "https://legacy.example/v1///",
        inlineApiKey: " legacy-inline-key ",
        kind: "openai-compatible",
        model: "legacy-model",
      }),
    ).resolves.toEqual({
      baseUrl: "https://legacy.example/v1",
      hasApiKey: true,
      kind: "openai-compatible",
      model: "legacy-model",
    });
    await expect(store.requireSettings()).resolves.toMatchObject({
      apiKey: "legacy-inline-key",
      baseUrl: "https://legacy.example/v1",
    });
    expect(secrets.values.get(AI_API_KEY_SECRET_KEY)).toBe("legacy-inline-key");

    await expect(
      store.adoptLegacy({
        baseUrl: "https://attacker.example",
        inlineApiKey: "attacker-key",
        kind: "openai-compatible",
        model: "attacker-model",
      }),
    ).resolves.toEqual({
      baseUrl: "https://legacy.example/v1",
      hasApiKey: true,
      kind: "openai-compatible",
      model: "legacy-model",
    });
    expect(secrets.values.get(AI_API_KEY_SECRET_KEY)).toBe("legacy-inline-key");
  });

  it("restores a replacement key if durable config persistence fails", async () => {
    const { dependencies, secrets, store } = await createContext();
    await store.save({
      apiKey: "old-key",
      baseUrl: "https://ai.example.test/old",
      kind: "openai-compatible",
      model: "old-model",
    });
    const failure = new Error("database write failed");
    const failingStore = new MainAiSettingsStore({
      ...dependencies,
      withDatabaseTransaction: async () => {
        throw failure;
      },
    });

    await expect(
      failingStore.save({
        apiKey: "new-key",
        baseUrl: "https://ai.example.test/new",
        kind: "openai-compatible",
        model: "new-model",
      }),
    ).rejects.toBe(failure);
    expect(secrets.values.get(AI_API_KEY_SECRET_KEY)).toBe("old-key");
  });
});
