// Desktop sync wiring: renderer settings and WebDAV orchestration around the
// DOM-free SQLite storage adapter shared with Electron main.
import {
  HlcClock,
  LibraryScopedSyncProvider,
  SyncEngine,
  WebDavProvider,
  type SyncResult,
} from "@aurascholar/sync";
import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState, type LocalFirstState } from "@aurascholar/db/local-first";
import { getDb } from "./aura-db";
import { auraHttp } from "./aura-platform";
import { SECRET_KEYS, getSecret, migrateInlineSecret, withSecretTransaction } from "./secrets";
import {
  isStorageRecord,
  readLocalStorageJson,
  tryWriteLocalStorageJson,
  writeLocalStorageJson,
} from "../storage";
import {
  exportLibraryBackupJsonFromDatabase,
  previewLibraryBackupJson as previewLibraryBackupJsonCore,
  type LibraryBackupImportSummary,
  type LibraryBackupPreview,
} from "../shared/library-backup";
import { SqliteSyncStorage } from "../shared/sqlite-sync-storage";

export { SqliteSyncStorage } from "../shared/sqlite-sync-storage";
export type { SqliteSyncStorageOptions } from "../shared/sqlite-sync-storage";
export type {
  LibraryBackupImportSummary,
  LibraryBackupPreview,
  LibraryBackupTableImportSummary,
  LibraryBackupTablePreview,
} from "../shared/library-backup";

export interface SyncSettings {
  baseUrl: string;
  username: string;
  password: string;
}

const SETTINGS_KEY = "sync-settings";

export async function loadSyncSettings(): Promise<SyncSettings | null> {
  const parsed = readLocalStorageJson<unknown>(SETTINGS_KEY, null);
  if (!isStorageRecord(parsed)) return null;

  const baseUrl =
    typeof parsed.baseUrl === "string" ? normalizeStoredSyncBaseUrl(parsed.baseUrl) : null;
  if (!baseUrl) return null;
  const username = typeof parsed.username === "string" ? parsed.username.trim() : "";
  const inlinePassword = typeof parsed.password === "string" ? parsed.password : "";

  // Migrate any inline plaintext password into the secret store.
  const migrated = await migrateInlineSecret(SECRET_KEYS.syncPassword, inlinePassword);
  if (inlinePassword && migrated.persisted) {
    tryWriteLocalStorageJson(SETTINGS_KEY, { baseUrl, username, password: "" });
  }
  const password = migrated.value || (await getSecret(SECRET_KEYS.syncPassword));
  return { baseUrl, username, password };
}

export async function saveSyncSettings(s: SyncSettings): Promise<void> {
  const normalized = normalizeSyncSettingsForStorage(s);
  const { password, ...config } = normalized;
  await withSecretTransaction([{ key: SECRET_KEYS.syncPassword, value: password }], () => {
    writeLocalStorageJson(SETTINGS_KEY, { ...config, password: "" });
  });
}

export async function getSyncIdentity(): Promise<LocalFirstState> {
  const db = await getDb();
  const deviceId = await window.aura.deviceId();
  return ensureLocalFirstState(db, {
    deviceId,
    deviceName: navigator.userAgent.includes("Mac") ? "Mac" : "Desktop",
    platform: navigator.platform || "desktop",
  });
}

function syncProviderScope(settings: SyncSettings): string {
  // Progress cursors are per remote target; passwords are intentionally excluded.
  const input = `${normalizeSyncBaseUrlForState(settings.baseUrl)}\n${settings.username.trim()}`;
  return `webdav-${hashScope(input, 0x811c9dc5)}${hashScope(input, 0x9e3779b9)}`;
}

function normalizeSyncBaseUrlForState(value: string): string {
  return normalizeSyncBaseUrlForStorage(value);
}

function normalizeSyncSettingsForStorage(settings: SyncSettings): SyncSettings {
  const baseUrl = normalizeSyncBaseUrlForStorage(settings.baseUrl);
  const username = settings.username.trim();
  if (!username || !settings.password.trim()) {
    throw new Error("请填写用户名和密码 / 应用密码。");
  }
  return { baseUrl, password: settings.password, username };
}

function normalizeStoredSyncBaseUrl(value: string): string | null {
  try {
    return normalizeSyncBaseUrlForStorage(value);
  } catch {
    return null;
  }
}

function normalizeSyncBaseUrlForStorage(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("请填写 WebDAV 地址。");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("WebDAV 地址格式不正确，请使用完整的 http:// 或 https:// 地址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("WebDAV 地址仅支持 http:// 或 https://。");
  }
  if (url.username || url.password) {
    throw new Error("WebDAV 地址不要包含用户名或密码，请填写在下方账号字段中。");
  }
  if (url.search || url.hash) {
    throw new Error("WebDAV 地址请填写目录地址，不要包含查询参数或 # 片段。");
  }
  return url.toString().replace(/\/+$/, "");
}

function hashScope(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

export async function runSync(): Promise<SyncResult> {
  const settings = await loadSyncSettings();
  if (!settings) throw new Error("请先配置 WebDAV 同步(地址、用户名、密码)");
  const db = await getDb();
  const { deviceId, libraryId } = await getSyncIdentity();
  const providerScope = syncProviderScope(settings);
  // The same normalized WebDAV target is one logical remote Library. Local
  // database Library ids intentionally remain device-local and are mapped at
  // the storage boundary instead of being used as a cross-device namespace.
  const transportLibraryId = `remote:${providerScope}`;
  const remoteProvider = new WebDavProvider({
    http: auraHttp,
    baseUrl: settings.baseUrl,
    username: settings.username,
    password: settings.password,
  });
  await remoteProvider.ping();
  const provider = new LibraryScopedSyncProvider(remoteProvider, transportLibraryId, {
    legacyReadFallback: true,
  });
  const engine = new SyncEngine(
    provider,
    new SqliteSyncStorage(db, deviceId, libraryId, providerScope, transportLibraryId, {
      applyRemoteSegment: (segment) =>
        window.aura.data.command("sync.applyRemoteSegment", {
          libraryId,
          providerScope,
          segment,
        }),
    }),
    deviceId,
    new HlcClock(deviceId),
  );
  const result = await engine.sync();
  await provider.markBootstrapComplete();
  return result;
}

/** User-data JSON export. Secrets and PDF/blob files are intentionally excluded. */
export async function exportLibraryJson(): Promise<Blob> {
  const db = await getDb();
  const { libraryId } = await getSyncIdentity();
  return exportLibraryJsonFromDatabase(db, libraryId);
}

/** Testable, explicit-scope renderer boundary for exporting one logical Library. */
export async function exportLibraryJsonFromDatabase(
  db: Database,
  libraryId: string,
): Promise<Blob> {
  const text = await exportLibraryBackupJsonFromDatabase(db, libraryId);
  return new Blob([text], { type: "application/json" });
}

export function previewLibraryBackupJson(text: string): LibraryBackupPreview {
  return previewLibraryBackupJsonCore(text);
}

export async function importLibraryBackupJson(text: string): Promise<LibraryBackupImportSummary> {
  const { libraryId } = await getSyncIdentity();
  return window.aura.data.command("library.importBackup", {
    backupText: text,
    libraryId,
  });
}
