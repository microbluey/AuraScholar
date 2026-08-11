// Renderer-safe sync and backup gateway. WebDAV credentials, HTTP transport,
// SQLite storage, remote segment validation, and Library scope all stay in
// Electron main; this module only invokes typed commands and handles one-time
// migration of the former localStorage setting.
import type { SyncResult } from "@aurascholar/sync";
import { isStorageRecord, readLocalStorageJson, tryRemoveLocalStorageItem } from "../storage";
import {
  previewLibraryBackupJson as previewLibraryBackupJsonCore,
  type LibraryBackupImportSummary,
  type LibraryBackupPreview,
} from "../shared/library-backup";

export type {
  LibraryBackupImportSummary,
  LibraryBackupPreview,
  LibraryBackupTableImportSummary,
  LibraryBackupTablePreview,
} from "../shared/library-backup";

export interface SyncSettings {
  baseUrl: string;
  password?: string;
  username: string;
}

export interface SyncSettingsSnapshot {
  baseUrl: string;
  hasPassword: boolean;
  username: string;
}

const LEGACY_SETTINGS_KEY = "sync-settings";

/**
 * Reads main-owned settings, first handing off a valid legacy renderer setting.
 * The old localStorage value is removed only after `adoptLegacySettings`
 * resolves, so a failed migration remains recoverable on the next launch.
 */
export async function loadSyncSettings(): Promise<SyncSettingsSnapshot | null> {
  const legacy = readLegacySyncSettings();
  if (legacy) {
    const snapshot = await window.aura.data.command("sync.adoptLegacySettings", legacy);
    tryRemoveLocalStorageItem(LEGACY_SETTINGS_KEY);
    return snapshot;
  }
  return window.aura.data.command("sync.getSettings", {});
}

/** Password is write-only; omitting it deliberately preserves the main secret. */
export function saveSyncSettings(settings: SyncSettings): Promise<SyncSettingsSnapshot> {
  const password = settings.password?.trim();
  return window.aura.data.command("sync.saveSettings", {
    baseUrl: settings.baseUrl,
    ...(password ? { password } : {}),
    username: settings.username,
  });
}

/** Runs with a strict empty input; main resolves settings, credentials, and scope. */
export function runSync(): Promise<SyncResult> {
  return window.aura.data.command("sync.run", {});
}

/** User-data JSON export. Secrets and PDF/blob files are intentionally excluded. */
export async function exportLibraryJson(): Promise<Blob> {
  const { backupText } = await window.aura.data.command("library.exportBackup", {});
  return new Blob([backupText], { type: "application/json" });
}

export function previewLibraryBackupJson(text: string): LibraryBackupPreview {
  return previewLibraryBackupJsonCore(text);
}

export function importLibraryBackupJson(text: string): Promise<LibraryBackupImportSummary> {
  return window.aura.data.command("library.importBackup", { backupText: text });
}

function readLegacySyncSettings(): {
  baseUrl: string;
  inlinePassword?: string;
  username: string;
} | null {
  const parsed = readLocalStorageJson<unknown>(LEGACY_SETTINGS_KEY, null);
  if (!isStorageRecord(parsed)) return null;
  if (typeof parsed.baseUrl !== "string" || typeof parsed.username !== "string") return null;
  const baseUrl = normalizeLegacySyncBaseUrl(parsed.baseUrl);
  const username = parsed.username.trim();
  if (!baseUrl || !username) return null;
  const inlinePassword = typeof parsed.password === "string" ? parsed.password.trim() : "";
  return inlinePassword ? { baseUrl, inlinePassword, username } : { baseUrl, username };
}

/** Invalid legacy values stay untouched and are not allowed to block settings load. */
function normalizeLegacySyncBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
