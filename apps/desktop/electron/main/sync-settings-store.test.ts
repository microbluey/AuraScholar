import type { Database } from "@aurascholar/db";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { describe, expect, it } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import {
  MainSyncSettingsStore,
  SYNC_PASSWORD_SECRET_KEY,
  SYNC_SETTINGS_DATABASE_KEY,
  type MainSyncSecretStore,
  type MainSyncSettingsStoreDependencies,
} from "./sync-settings-store";

class MemorySecrets implements MainSyncSecretStore {
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
  dependencies: MainSyncSettingsStoreDependencies;
  secrets: MemorySecrets;
  store: MainSyncSettingsStore;
}

async function createContext(): Promise<TestContext> {
  const database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  const coordinator = new DatabaseCoordinator(database);
  const secrets = new MemorySecrets();
  const dependencies: MainSyncSettingsStoreDependencies = {
    secrets,
    withDatabase: (operation) => coordinator.execute(operation),
    withDatabaseTransaction: (commandName, operation) =>
      coordinator.transaction(commandName, operation),
  };
  return {
    database,
    dependencies,
    secrets,
    store: new MainSyncSettingsStore(dependencies),
  };
}

describe("main sync settings store", () => {
  it("stores only the normalized target in SQLite and never returns the password", async () => {
    const { database, secrets, store } = await createContext();

    await expect(
      store.save({
        baseUrl: " https://dav.example.test/library/// ",
        password: " app-password ",
        username: " alice ",
      }),
    ).resolves.toEqual({
      baseUrl: "https://dav.example.test/library",
      hasPassword: true,
      username: "alice",
    });

    await expect(store.getSnapshot()).resolves.toEqual({
      baseUrl: "https://dav.example.test/library",
      hasPassword: true,
      username: "alice",
    });
    await expect(store.requireSettings()).resolves.toEqual({
      baseUrl: "https://dav.example.test/library",
      password: "app-password",
      username: "alice",
    });
    expect(secrets.values.get(SYNC_PASSWORD_SECRET_KEY)).toBe("app-password");

    const rows = await database.query<{ value_json: string }>(
      "SELECT value_json FROM settings WHERE key = ?",
      [SYNC_SETTINGS_DATABASE_KEY],
    );
    expect(rows).toEqual([
      {
        value_json: JSON.stringify({
          baseUrl: "https://dav.example.test/library",
          username: "alice",
          version: 1,
        }),
      },
    ]);
    expect(rows[0]?.value_json).not.toContain("password");
  });

  it("preserves a stored password when an unchanged target save intentionally omits it", async () => {
    const { secrets, store } = await createContext();
    await store.save({
      baseUrl: "https://dav.example.test/same",
      password: "kept-secret",
      username: "alice",
    });

    await expect(
      store.save({ baseUrl: "https://dav.example.test/same///", username: "alice" }),
    ).resolves.toEqual({
      baseUrl: "https://dav.example.test/same",
      hasPassword: true,
      username: "alice",
    });
    await expect(store.requireSettings()).resolves.toEqual({
      baseUrl: "https://dav.example.test/same",
      password: "kept-secret",
      username: "alice",
    });
    expect(secrets.values.get(SYNC_PASSWORD_SECRET_KEY)).toBe("kept-secret");
  });

  it("requires a replacement password before a changed target can reuse a saved secret", async () => {
    const { secrets, store } = await createContext();
    await store.save({
      baseUrl: "https://dav.example.test/original",
      password: "original-secret",
      username: "alice",
    });

    await expect(
      store.save({ baseUrl: "https://attacker.example/redirect", username: "alice" }),
    ).rejects.toThrow("更改 WebDAV 地址或用户名时，请重新填写密码 / 应用密码。");
    expect(secrets.values.get(SYNC_PASSWORD_SECRET_KEY)).toBe("original-secret");
    await expect(store.requireSettings()).resolves.toEqual({
      baseUrl: "https://dav.example.test/original",
      password: "original-secret",
      username: "alice",
    });

    await expect(
      store.save({
        baseUrl: "https://dav.example.test/replacement",
        password: "replacement-secret",
        username: "alice",
      }),
    ).resolves.toEqual({
      baseUrl: "https://dav.example.test/replacement",
      hasPassword: true,
      username: "alice",
    });
  });

  it("restores the previous password when durable target persistence fails", async () => {
    const { dependencies, secrets, store } = await createContext();
    await store.save({
      baseUrl: "https://dav.example.test/old",
      password: "old-secret",
      username: "alice",
    });

    const failure = new Error("database write failed");
    const failingStore = new MainSyncSettingsStore({
      ...dependencies,
      withDatabaseTransaction: async () => {
        throw failure;
      },
    });

    await expect(
      failingStore.save({
        baseUrl: "https://dav.example.test/new",
        password: "new-secret",
        username: "alice",
      }),
    ).rejects.toBe(failure);
    expect(secrets.values.get(SYNC_PASSWORD_SECRET_KEY)).toBe("old-secret");
    await expect(store.requireSettings()).resolves.toEqual({
      baseUrl: "https://dav.example.test/old",
      password: "old-secret",
      username: "alice",
    });
  });

  it("uses an inline legacy password explicitly instead of binding an unscoped old secret", async () => {
    const { secrets, store } = await createContext();
    secrets.values.set(SYNC_PASSWORD_SECRET_KEY, "already-main-owned");

    await expect(
      store.adoptLegacy({
        baseUrl: "https://dav.example.test/legacy///",
        inlinePassword: "renderer-password",
        username: "alice",
      }),
    ).resolves.toEqual({
      baseUrl: "https://dav.example.test/legacy",
      hasPassword: true,
      username: "alice",
    });
    await expect(store.requireSettings()).resolves.toEqual({
      baseUrl: "https://dav.example.test/legacy",
      password: "renderer-password",
      username: "alice",
    });
    expect(secrets.values.get(SYNC_PASSWORD_SECRET_KEY)).toBe("renderer-password");

    await expect(
      store.adoptLegacy({
        baseUrl: "https://dav.example.test/changed",
        inlinePassword: "different-password",
        username: "other",
      }),
    ).resolves.toEqual({
      baseUrl: "https://dav.example.test/legacy",
      hasPassword: true,
      username: "alice",
    });
  });

  it("does not bind an unscoped legacy generic secret when no inline password is available", async () => {
    const { secrets, store } = await createContext();
    secrets.values.set(SYNC_PASSWORD_SECRET_KEY, "old-unbound-secret");

    await expect(
      store.adoptLegacy({
        baseUrl: "https://dav.example.test/legacy",
        username: "alice",
      }),
    ).resolves.toEqual({
      baseUrl: "https://dav.example.test/legacy",
      hasPassword: false,
      username: "alice",
    });
    expect(secrets.values.get(SYNC_PASSWORD_SECRET_KEY)).toBeUndefined();
    await expect(store.requireSettings()).rejects.toThrow("请先配置 WebDAV 同步");
  });

  it("completes an interrupted legacy handoff when a target exists but its secret does not", async () => {
    const { database, secrets, store } = await createContext();
    await database.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES (?, ?, 'local', 1)`,
      [
        SYNC_SETTINGS_DATABASE_KEY,
        JSON.stringify({
          baseUrl: "https://dav.example.test/already-persisted",
          username: "alice",
          version: 1,
        }),
      ],
    );

    await expect(
      store.adoptLegacy({
        baseUrl: "https://dav.example.test/legacy-input",
        inlinePassword: " recovered-password ",
        username: "ignored",
      }),
    ).resolves.toEqual({
      baseUrl: "https://dav.example.test/already-persisted",
      hasPassword: true,
      username: "alice",
    });
    expect(secrets.values.get(SYNC_PASSWORD_SECRET_KEY)).toBe("recovered-password");
    await expect(store.requireSettings()).resolves.toEqual({
      baseUrl: "https://dav.example.test/already-persisted",
      password: "recovered-password",
      username: "alice",
    });
  });

  it("serializes concurrent edits so a password-less save observes the preceding secret", async () => {
    const { secrets, store } = await createContext();
    const first = store.save({
      baseUrl: "https://dav.example.test/first",
      password: "serialized-secret",
      username: "alice",
    });
    const second = store.save({
      baseUrl: "https://dav.example.test/first///",
      username: "alice",
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        baseUrl: "https://dav.example.test/first",
        hasPassword: true,
        username: "alice",
      },
      {
        baseUrl: "https://dav.example.test/first",
        hasPassword: true,
        username: "alice",
      },
    ]);
    expect(secrets.values.get(SYNC_PASSWORD_SECRET_KEY)).toBe("serialized-secret");
    await expect(store.requireSettings()).resolves.toMatchObject({
      baseUrl: "https://dav.example.test/first",
      password: "serialized-secret",
    });
  });
});
