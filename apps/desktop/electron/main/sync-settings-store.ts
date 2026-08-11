import type { Database } from "@aurascholar/db";
import type {
  AdoptLegacySyncSettingsCommandInput,
  SaveSyncSettingsCommandInput,
  SyncSettingsSnapshot,
} from "../sync-command-contract";
import {
  normalizeMainSyncSettings,
  normalizeSyncTarget,
  type MainSyncSettings,
  type NormalizedSyncTarget,
} from "./sync-command-input";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import { deleteMainSecret, getMainSecret, setMainSecret } from "./platform";

export const SYNC_PASSWORD_SECRET_KEY = "secret:sync:password";
export const SYNC_SETTINGS_DATABASE_KEY = "local.sync.webdav.v1";

interface StoredSyncTarget extends NormalizedSyncTarget {
  version: 1;
}

export interface MainSyncSecretStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface MainSyncSettingsStoreDependencies {
  secrets: MainSyncSecretStore;
  withDatabase<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  withDatabaseTransaction<T>(
    commandName: string,
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T>;
}

/**
 * Main-only configuration owner. URL and username live in local SQLite state;
 * the password stays in the existing encrypted secret store and is never part
 * of a renderer-facing read DTO.
 */
export class MainSyncSettingsStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: MainSyncSettingsStoreDependencies) {}

  async getSnapshot(): Promise<SyncSettingsSnapshot | null> {
    const [target, password] = await Promise.all([this.readTarget(), this.readPassword()]);
    return target ? toSnapshot(target, password) : null;
  }

  async requireSettings(): Promise<MainSyncSettings> {
    const [target, password] = await Promise.all([this.readTarget(), this.readPassword()]);
    if (!target || !password) {
      throw new Error("请先配置 WebDAV 同步(地址、用户名、密码)");
    }
    return normalizeMainSyncSettings({ ...target, password });
  }

  save(input: SaveSyncSettingsCommandInput): Promise<SyncSettingsSnapshot> {
    return this.mutate(async () => {
      const target = normalizeSyncTarget(input.baseUrl, input.username);
      const previousTarget = await this.readTarget();
      const previousPassword = await this.readPassword();
      if (
        input.password === undefined &&
        (!previousPassword || !previousTarget || !sameSyncTarget(previousTarget, target))
      ) {
        throw new Error("更改 WebDAV 地址或用户名时，请重新填写密码 / 应用密码。");
      }
      const candidatePassword = input.password ?? previousPassword;
      if (!candidatePassword) {
        throw new Error("请填写用户名和密码 / 应用密码。");
      }
      // The command parser already normalizes this, but keep the storage
      // boundary safe for direct main-process callers and future migrations.
      const nextPassword = normalizeMainSyncSettings({
        ...target,
        password: candidatePassword,
      }).password;
      const replacedPassword = input.password !== undefined;
      if (replacedPassword) {
        await this.dependencies.secrets.set(SYNC_PASSWORD_SECRET_KEY, nextPassword);
      }
      try {
        await this.writeTarget(target);
      } catch (error) {
        if (replacedPassword)
          await restorePassword(this.dependencies.secrets, previousPassword, error);
        throw error;
      }
      return toSnapshot(target, nextPassword);
    });
  }

  adoptLegacy(input: AdoptLegacySyncSettingsCommandInput): Promise<SyncSettingsSnapshot> {
    return this.mutate(async () => {
      const existingTarget = await this.readTarget();
      const existingPassword = await this.readPassword();
      const target = normalizeSyncTarget(input.baseUrl, input.username);
      const inlinePassword = input.inlinePassword?.trim() || undefined;
      if (existingTarget) {
        if (existingPassword || !inlinePassword) {
          return toSnapshot(existingTarget, existingPassword);
        }
        const password = normalizeMainSyncSettings({
          ...existingTarget,
          password: inlinePassword,
        }).password;
        await this.dependencies.secrets.set(SYNC_PASSWORD_SECRET_KEY, password);
        return toSnapshot(existingTarget, password);
      }

      const password = inlinePassword
        ? normalizeMainSyncSettings({ ...target, password: inlinePassword }).password
        : null;
      const replacedSecret = Boolean(existingPassword || password);
      if (password) {
        await this.dependencies.secrets.set(SYNC_PASSWORD_SECRET_KEY, password);
      } else if (existingPassword) {
        await this.dependencies.secrets.delete(SYNC_PASSWORD_SECRET_KEY);
      }
      try {
        await this.writeTarget(target);
      } catch (error) {
        if (replacedSecret)
          await restorePassword(this.dependencies.secrets, existingPassword, error);
        throw error;
      }
      return toSnapshot(target, password);
    });
  }

  private async readTarget(): Promise<NormalizedSyncTarget | null> {
    return this.dependencies.withDatabase(async (database) => {
      const rows = await database.query<{ value_json: string | null }>(
        "SELECT value_json FROM settings WHERE key = ? LIMIT 1",
        [SYNC_SETTINGS_DATABASE_KEY],
      );
      return parseStoredTarget(rows[0]?.value_json);
    });
  }

  private async writeTarget(target: NormalizedSyncTarget): Promise<void> {
    const stored: StoredSyncTarget = { ...target, version: 1 };
    await this.dependencies.withDatabaseTransaction("sync.saveSettings", async (database) => {
      await database.run(
        `INSERT INTO settings (key, value_json, scope, updated_at)
         VALUES (?, ?, 'local', ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           scope = 'local',
           updated_at = excluded.updated_at`,
        [SYNC_SETTINGS_DATABASE_KEY, JSON.stringify(stored), Date.now()],
      );
    });
  }

  private async readPassword(): Promise<string | null> {
    const value = await this.dependencies.secrets.get(SYNC_PASSWORD_SECRET_KEY);
    return value?.trim() || null;
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

export const mainSyncSettingsStore = new MainSyncSettingsStore({
  secrets: {
    delete: deleteMainSecret,
    get: getMainSecret,
    set: setMainSecret,
  },
  withDatabase: withMainDatabase,
  withDatabaseTransaction: withMainDatabaseTransaction,
});

function parseStoredTarget(value: string | null | undefined): NormalizedSyncTarget | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    return normalizeSyncTarget(parsed.baseUrl, parsed.username);
  } catch {
    return null;
  }
}

function toSnapshot(target: NormalizedSyncTarget, password: string | null): SyncSettingsSnapshot {
  return { ...target, hasPassword: Boolean(password) };
}

function sameSyncTarget(a: NormalizedSyncTarget, b: NormalizedSyncTarget): boolean {
  return a.baseUrl === b.baseUrl && a.username === b.username;
}

async function restorePassword(
  secrets: MainSyncSecretStore,
  previous: string | null,
  cause: unknown,
): Promise<void> {
  try {
    if (previous) await secrets.set(SYNC_PASSWORD_SECRET_KEY, previous);
    else await secrets.delete(SYNC_PASSWORD_SECRET_KEY);
  } catch (rollbackError) {
    throw new AggregateError(
      [cause, rollbackError],
      "Sync settings save failed and the password rollback also failed",
      { cause: rollbackError },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
