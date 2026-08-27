import type {
  DiscoverySiteAddCommandInput,
  DiscoverySiteCommandSite,
  DiscoverySiteEmptyCommandInput,
  DiscoverySiteRemoveCommandInput,
  DiscoverySiteRestoreCommandInput,
  DiscoverySiteSetHiddenCommandInput,
  DiscoverySiteSetProxyCommandInput,
} from "../data-command-contract";
import { isRecord, requireRecordId } from "./data-command-runtime";

export const DISCOVERY_SITE_ID_PREFIX = "custom:";
export const MAX_DISCOVERY_SITE_NAME_LENGTH = 512;
export const MAX_DISCOVERY_SITE_ROWS = 1_000;
export const MAX_DISCOVERY_SITE_SORT_ORDER = 1_000_000_000;
export const MAX_DISCOVERY_SITE_URL_LENGTH = 8_192;
export const MAX_EZPROXY_PREFIX_LENGTH = 8_192;
export const MAX_PERSISTED_SETTING_JSON_LENGTH = 16_384;
export const MAX_PROXY_ADDRESS_LENGTH = 2_048;

export interface DiscoverySiteRow {
  id: unknown;
  name: unknown;
  home_url: unknown;
  search_url: unknown;
  builtin: unknown;
  hidden: unknown;
  sort_order: unknown;
  use_proxy: unknown;
}

export interface DiscoverySiteMaxOrderRow {
  max_sort_order: unknown;
}

export interface DiscoverySiteSettingRow {
  key: unknown;
  value_json: unknown;
}

export interface ParsedDiscoverySiteSettingsInput {
  proxyAddress?: string;
  ezproxyPrefix?: string;
}

export function parseEmptyDiscoverySiteInput(
  value: unknown,
  commandName: "discoverySite.getSettings" | "discoverySite.listSites",
): DiscoverySiteEmptyCommandInput {
  return requireExactDiscoverySiteInput(value, commandName, []) as DiscoverySiteEmptyCommandInput;
}

export function parseAddDiscoverySiteInput(value: unknown): DiscoverySiteAddCommandInput {
  const input = requireExactDiscoverySiteInput(
    value,
    "discoverySite.addSite",
    ["name", "homeUrl"],
    ["searchUrl"],
  );
  const searchUrl = optionalHttpUrl(input, "searchUrl", "检索 URL");
  return {
    homeUrl: normalizeHttpUrl(input.homeUrl, "主页 URL"),
    name: requireDiscoverySiteName(input.name),
    ...(searchUrl === undefined ? {} : { searchUrl }),
  };
}

export function parseSetDiscoverySiteProxyInput(value: unknown): DiscoverySiteSetProxyCommandInput {
  const input = requireExactDiscoverySiteInput(value, "discoverySite.setSiteProxy", [
    "siteId",
    "useProxy",
  ]);
  if (typeof input.useProxy !== "boolean") {
    throw new Error("Site proxy setting is invalid");
  }
  return { siteId: requireRecordId(input.siteId, "Site id"), useProxy: input.useProxy };
}

export function parseSetDiscoverySiteHiddenInput(
  value: unknown,
): DiscoverySiteSetHiddenCommandInput {
  const input = requireExactDiscoverySiteInput(value, "discoverySite.setSiteHidden", [
    "siteId",
    "hidden",
  ]);
  if (typeof input.hidden !== "boolean") {
    throw new Error("Site hidden setting is invalid");
  }
  return { hidden: input.hidden, siteId: requireRecordId(input.siteId, "Site id") };
}

export function parseRemoveDiscoverySiteInput(value: unknown): DiscoverySiteRemoveCommandInput {
  const input = requireExactDiscoverySiteInput(value, "discoverySite.removeSite", ["siteId"]);
  return { siteId: requireRecordId(input.siteId, "Site id") };
}

export function parseRestoreDiscoverySiteInput(value: unknown): DiscoverySiteRestoreCommandInput {
  const input = requireExactDiscoverySiteInput(
    value,
    "discoverySite.restoreSite",
    ["id", "name", "homeUrl", "sortOrder", "useProxy"],
    ["searchUrl"],
  );
  if (typeof input.useProxy !== "boolean") {
    throw new Error("Restored site proxy setting is invalid");
  }
  const searchUrl = optionalHttpUrl(input, "searchUrl", "检索 URL");
  return {
    homeUrl: normalizeHttpUrl(input.homeUrl, "主页 URL"),
    id: requireCustomDiscoverySiteId(input.id),
    name: requireDiscoverySiteName(input.name),
    ...(searchUrl === undefined ? {} : { searchUrl }),
    sortOrder: requireDiscoverySiteSortOrder(input.sortOrder),
    useProxy: input.useProxy,
  };
}

export function parseDiscoverySiteSettingsInput(value: unknown): ParsedDiscoverySiteSettingsInput {
  const input = requireExactDiscoverySiteInput(
    value,
    "discoverySite.setSettings",
    [],
    ["proxyAddress", "ezproxyPrefix"],
  );
  const hasProxyAddress = Object.hasOwn(input, "proxyAddress");
  const hasEzproxyPrefix = Object.hasOwn(input, "ezproxyPrefix");
  if (!hasProxyAddress && !hasEzproxyPrefix) {
    throw new Error("At least one research setting is required");
  }
  return {
    ...(hasProxyAddress ? { proxyAddress: normalizeProxyAddress(input.proxyAddress) } : {}),
    ...(hasEzproxyPrefix ? { ezproxyPrefix: normalizeEzproxyPrefix(input.ezproxyPrefix) } : {}),
  };
}

export function persistedDiscoverySite(row: DiscoverySiteRow): DiscoverySiteCommandSite | null {
  try {
    if (
      typeof row.id !== "string" ||
      (row.builtin !== 0 && row.builtin !== 1) ||
      (row.hidden !== 0 && row.hidden !== 1) ||
      (row.use_proxy !== 0 && row.use_proxy !== 1)
    ) {
      return null;
    }
    const searchUrl =
      row.search_url === null ? undefined : normalizePersistedHttpUrl(row.search_url, "检索 URL");
    return {
      builtin: row.builtin === 1,
      hidden: row.hidden === 1,
      homeUrl: normalizePersistedHttpUrl(row.home_url, "主页 URL"),
      id: requireRecordId(row.id, "Site id"),
      name: requireDiscoverySiteName(row.name),
      ...(searchUrl === undefined ? {} : { searchUrl }),
      sortOrder: requireDiscoverySiteSortOrder(row.sort_order),
      useProxy: row.use_proxy === 1,
    };
  } catch {
    return null;
  }
}

export function matchesDiscoverySiteSnapshot(
  existing: DiscoverySiteCommandSite,
  snapshot: DiscoverySiteRestoreCommandInput,
): boolean {
  return (
    existing.id === snapshot.id &&
    existing.name === snapshot.name &&
    existing.homeUrl === snapshot.homeUrl &&
    existing.searchUrl === snapshot.searchUrl &&
    existing.sortOrder === snapshot.sortOrder &&
    existing.useProxy === snapshot.useProxy
  );
}

export function requireDiscoverySiteSortOrder(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_DISCOVERY_SITE_SORT_ORDER
  ) {
    throw new Error("Site sort order is invalid");
  }
  return value as number;
}

export function safeNormalizeProxyAddress(valueJson: unknown): string {
  try {
    return normalizeProxyAddress(parsePersistedSettingString(valueJson));
  } catch {
    return "";
  }
}

export function safeNormalizeEzproxyPrefix(valueJson: unknown): string {
  try {
    return normalizeEzproxyPrefix(parsePersistedSettingString(valueJson));
  } catch {
    return "";
  }
}

function requireExactDiscoverySiteInput(
  value: unknown,
  commandName: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  const allowedFields = [...requiredFields, ...optionalFields];
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowedFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function optionalHttpUrl(
  input: Record<string, unknown>,
  field: string,
  label: string,
): string | undefined {
  if (!Object.hasOwn(input, field)) return undefined;
  if (typeof input[field] !== "string") {
    throw new Error(`${label} 必须是文本`);
  }
  return input[field].trim() ? normalizeHttpUrl(input[field], label) : undefined;
}

function normalizePersistedHttpUrl(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > MAX_DISCOVERY_SITE_URL_LENGTH) {
    throw new Error(`${label} 不是有效 URL`);
  }
  return parseHttpUrl(value, label).toString();
}

function normalizeHttpUrl(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 必须是文本`);
  const raw = value.trim();
  if (!raw || raw.length > MAX_DISCOVERY_SITE_URL_LENGTH) {
    throw new Error(`${label} 不是有效 URL`);
  }
  const candidate = /^https?:\/\//i.test(raw)
    ? raw
    : /^[a-z][a-z0-9+.-]*:/i.test(raw)
      ? raw
      : `https://${raw}`;
  return parseHttpUrl(candidate, label).toString();
}

function parseHttpUrl(input: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`${label} 不是有效 URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} 只支持 http/https`);
  }
  if (!parsed.hostname) throw new Error(`${label} 缺少主机名`);
  assertNoUrlCredentials(parsed, label);
  return parsed;
}

export function normalizeProxyAddress(value: unknown): string {
  if (typeof value !== "string") throw new Error("代理地址必须是文本");
  const raw = value.trim();
  if (!raw) return "";
  if (raw.length > MAX_PROXY_ADDRESS_LENGTH) throw new Error("代理地址过长");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("代理地址不是有效 URL");
  }
  if (!["http:", "https:", "socks4:", "socks5:"].includes(parsed.protocol)) {
    throw new Error("代理地址只支持 http/https/socks4/socks5");
  }
  if (!parsed.hostname) throw new Error("代理地址缺少主机名");
  assertNoUrlCredentials(parsed, "代理地址");
  return parsed.toString();
}

function normalizeEzproxyPrefix(value: unknown): string {
  if (typeof value !== "string") throw new Error("图书馆前缀必须是文本");
  const raw = value.trim();
  if (!raw) return "";
  if (raw.length > MAX_EZPROXY_PREFIX_LENGTH) throw new Error("图书馆前缀过长");
  const probe = encodeURIComponent("https://example.com/article");
  const candidate = raw.includes("{url}") ? raw.replace("{url}", probe) : `${raw}${probe}`;
  parseHttpUrl(candidate, "图书馆前缀");
  return raw;
}

function parsePersistedSettingString(valueJson: unknown): string {
  if (typeof valueJson !== "string" || valueJson.length > MAX_PERSISTED_SETTING_JSON_LENGTH) {
    return "";
  }
  try {
    const value: unknown = JSON.parse(valueJson);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function requireDiscoverySiteName(value: unknown): string {
  if (typeof value !== "string") throw new Error("站点名称必须是文本");
  const name = value.trim();
  if (!name) throw new Error("站点名称不能为空");
  if (name.length > MAX_DISCOVERY_SITE_NAME_LENGTH) throw new Error("站点名称过长");
  return name;
}

function requireCustomDiscoverySiteId(value: unknown): string {
  const id = requireRecordId(value, "Site id");
  if (!id.startsWith(DISCOVERY_SITE_ID_PREFIX) || id.length === DISCOVERY_SITE_ID_PREFIX.length) {
    throw new Error("Only custom site snapshots can be restored");
  }
  return id;
}

function assertNoUrlCredentials(url: URL, label: string): void {
  if (url.username || url.password) {
    const separator = /[a-z]$/i.test(label) ? " 中" : "中";
    throw new Error(`${label}${separator}不能包含用户名或密码`);
  }
}
