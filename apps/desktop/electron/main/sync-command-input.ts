import type {
  AdoptLegacySyncSettingsCommandInput,
  EmptySyncCommandInput,
  SaveSyncSettingsCommandInput,
  SyncCommandName,
} from "../sync-command-contract";

export const MAX_SYNC_PASSWORD_LENGTH = 4_096;
export const MAX_SYNC_URL_LENGTH = 2_048;
export const MAX_SYNC_USERNAME_LENGTH = 512;

export interface MainSyncSettings {
  baseUrl: string;
  password: string;
  username: string;
}

export interface NormalizedSyncTarget {
  baseUrl: string;
  username: string;
}

export function parseSyncGetSettingsInput(value: unknown): EmptySyncCommandInput {
  return parseExactEmptyInput(value, "sync.getSettings");
}

export function parseSyncRunInput(value: unknown): EmptySyncCommandInput {
  return parseExactEmptyInput(value, "sync.run");
}

export function parseSyncSaveSettingsInput(value: unknown): SaveSyncSettingsCommandInput {
  const record = requireExactRecord(value, "sync.saveSettings", [
    "baseUrl",
    "password",
    "username",
  ]);
  const target = parseSyncTarget(record);
  const password = optionalPassword(record.password, "Sync password");
  return password === undefined ? target : { ...target, password };
}

export function parseAdoptLegacySyncSettingsInput(
  value: unknown,
): AdoptLegacySyncSettingsCommandInput {
  const record = requireExactRecord(value, "sync.adoptLegacySettings", [
    "baseUrl",
    "inlinePassword",
    "username",
  ]);
  const target = parseSyncTarget(record);
  const inlinePassword = optionalLegacyPassword(record.inlinePassword);
  return inlinePassword === undefined ? target : { ...target, inlinePassword };
}

/** Revalidates trusted main settings before they are used to create a provider. */
export function normalizeMainSyncSettings(value: MainSyncSettings): MainSyncSettings {
  const target = normalizeSyncTarget(value.baseUrl, value.username);
  const password = requiredPassword(value.password, "Sync password");
  return { ...target, password };
}

/** Stable v1 WebDAV state scope; changing this would fork existing remote cursors. */
export function syncProviderScope(target: NormalizedSyncTarget): string {
  const input = `${target.baseUrl}\n${target.username}`;
  return `webdav-${hashScope(input, 0x811c9dc5)}${hashScope(input, 0x9e3779b9)}`;
}

export function normalizeSyncTarget(
  baseUrlValue: unknown,
  usernameValue: unknown,
): NormalizedSyncTarget {
  const baseUrl = normalizeSyncBaseUrl(baseUrlValue);
  const username = requiredBoundedString(usernameValue, "Sync username", MAX_SYNC_USERNAME_LENGTH);
  return { baseUrl, username };
}

function parseExactEmptyInput(value: unknown, commandName: SyncCommandName): EmptySyncCommandInput {
  requireExactRecord(value, commandName, []);
  return {};
}

function parseSyncTarget(record: Record<string, unknown>): NormalizedSyncTarget {
  return normalizeSyncTarget(record.baseUrl, record.username);
}

function normalizeSyncBaseUrl(value: unknown): string {
  const raw = requiredBoundedString(value, "WebDAV URL", MAX_SYNC_URL_LENGTH);
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

function optionalPassword(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredPassword(value, label);
}

function optionalLegacyPassword(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Legacy sync password is required");
  return value.trim() ? requiredPassword(value, "Legacy sync password") : undefined;
}

function requiredPassword(value: unknown, label: string): string {
  const password = requiredBoundedString(value, label, MAX_SYNC_PASSWORD_LENGTH);
  return password;
}

function requiredBoundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label} is too long`);
  }
  return trimmed;
}

function requireExactRecord(
  value: unknown,
  commandName: SyncCommandName,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashScope(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}
