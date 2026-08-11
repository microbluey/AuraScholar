// Discovery sites: the academic websites shown as cards on the discovery page.
// Built-in sites are seeded by migration v7; users can add custom ones and hide
// built-ins. Login/cookies are NOT here — they live in each site's Electron
// session partition (see electron/main/research-browser.ts), cleared via
// clearSiteData(). Durable site and settings data stays in the main process.
import type {
  DiscoverySiteAddCommandResult,
  DiscoverySiteCommandSite,
  DiscoverySiteDataCommandMap,
  DiscoverySiteRestoreCommandInput,
} from "../../electron/data-command-contract";
import { isDesktopRuntime } from "./aura-platform";
import { toSafeError } from "./sensitive-text";

export type DiscoverySite = DiscoverySiteCommandSite;
export type AddSiteResult = DiscoverySiteAddCommandResult;

type DiscoverySiteCommandName = keyof DiscoverySiteDataCommandMap;

const ELECTRON_DATA_COMMAND_ERROR_PREFIX = "Error invoking remote method 'data:command': ";

/**
 * Electron prefixes rejected ipcRenderer.invoke() errors with transport
 * wording. Preserve the main command's user-facing, already-safe validation
 * detail so the Discovery page can present the same feedback as before this
 * data boundary moved to the main process.
 */
async function commandDiscoverySite<K extends DiscoverySiteCommandName>(
  name: K,
  input: DiscoverySiteDataCommandMap[K]["input"],
): Promise<DiscoverySiteDataCommandMap[K]["output"]> {
  try {
    return await window.aura.data.command(name, input);
  } catch (error) {
    throw normalizeDiscoverySiteCommandError(error);
  }
}

function normalizeDiscoverySiteCommandError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.startsWith(ELECTRON_DATA_COMMAND_ERROR_PREFIX)) return toSafeError(error);
  const mainMessage = message
    .slice(ELECTRON_DATA_COMMAND_ERROR_PREFIX.length)
    .replace(/^Error:\s*/, "");
  return toSafeError(mainMessage);
}

/** All sites, in display order. Includes hidden ones (filter in the UI). */
export async function listSites(): Promise<DiscoverySite[]> {
  if (!isDesktopRuntime()) return [];
  return (await commandDiscoverySite("discoverySite.listSites", {})).sites;
}

export async function addSite(input: {
  name: string;
  homeUrl: string;
  searchUrl?: string;
}): Promise<AddSiteResult> {
  return commandDiscoverySite("discoverySite.addSite", {
    homeUrl: input.homeUrl,
    name: input.name,
    ...(input.searchUrl?.trim() ? { searchUrl: input.searchUrl } : {}),
  });
}

/** Toggle whether a site's embedded browser routes through the configured proxy. */
export async function setSiteProxy(id: string, useProxy: boolean): Promise<void> {
  await commandDiscoverySite("discoverySite.setSiteProxy", { siteId: id, useProxy });
}

/** Global proxy address (e.g. "http://127.0.0.1:7890"). */
export async function getProxyAddress(): Promise<string> {
  if (!isDesktopRuntime()) return "";
  return (await commandDiscoverySite("discoverySite.getSettings", {})).settings.proxyAddress;
}

export async function setProxyAddress(address: string): Promise<void> {
  await commandDiscoverySite("discoverySite.setSettings", { proxyAddress: address });
}

/**
 * Library EZproxy prefix (the campus off-campus-access entrypoint). Paste
 * either a login-style prefix ending in `url=` (we append the encoded target)
 * or any string containing `{url}` (we substitute).
 */
export async function getEzproxyPrefix(): Promise<string> {
  if (!isDesktopRuntime()) return "";
  return (await commandDiscoverySite("discoverySite.getSettings", {})).settings.ezproxyPrefix;
}

export async function setEzproxyPrefix(prefix: string): Promise<void> {
  await commandDiscoverySite("discoverySite.setSettings", { ezproxyPrefix: prefix });
}

/**
 * Rewrite a target URL through the EZproxy prefix. Returns null if no prefix.
 * - `{url}` placeholder → substituted with the encoded target.
 * - otherwise the encoded target is appended (works for login-style prefixes
 *   like `https://login.ezproxy.lib.school.edu/login?url=`).
 */
export function ezproxyRewrite(prefix: string, url: string): string | null {
  const p = prefix.trim();
  if (!p) return null;
  if (!isSafeHttpUrl(url)) return null;
  const rewritten = p.includes("{url}")
    ? p.replace("{url}", encodeURIComponent(url))
    : `${p}${encodeURIComponent(url)}`;
  return isSafeHttpUrl(rewritten) ? rewritten : null;
}

/** Remove a custom site. Built-in sites are hidden instead (see setHidden). */
export async function removeSite(id: string): Promise<void> {
  await commandDiscoverySite("discoverySite.removeSite", { siteId: id });
}

export async function restoreSite(site: DiscoverySite): Promise<void> {
  const input: DiscoverySiteRestoreCommandInput = {
    homeUrl: site.homeUrl,
    id: site.id,
    name: site.name,
    ...(site.searchUrl === undefined ? {} : { searchUrl: site.searchUrl }),
    sortOrder: site.sortOrder,
    useProxy: site.useProxy,
  };
  await commandDiscoverySite("discoverySite.restoreSite", input);
}

export async function setHidden(id: string, hidden: boolean): Promise<void> {
  await commandDiscoverySite("discoverySite.setSiteHidden", { hidden, siteId: id });
}

/** Clear a site's stored cookies/cache (its Electron session partition). */
export async function clearSiteData(site: DiscoverySite): Promise<void> {
  if (!isDesktopRuntime()) return;
  await window.aura.research.clearSiteData(site.id);
}

/** Which of the given sites already hold local data (cookies present). */
export async function sitesWithData(ids: string[]): Promise<Set<string>> {
  if (!isDesktopRuntime() || ids.length === 0) return new Set();
  try {
    return new Set(await window.aura.research.siteData(ids));
  } catch {
    return new Set();
  }
}

/** Build the URL to open for a site given the current query. */
export function siteUrl(site: DiscoverySite, query: string): string {
  const q = query.trim();
  return q && site.searchUrl ? `${site.searchUrl}${encodeURIComponent(q)}` : site.homeUrl;
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
  assertNoUrlCredentials(parsed, label);
  return parsed;
}

function assertNoUrlCredentials(url: URL, label: string): void {
  if (url.username || url.password) {
    const separator = /[a-z]$/i.test(label) ? " 中" : "中";
    throw new Error(`${label}${separator}不能包含用户名或密码`);
  }
}

function isSafeHttpUrl(input: string): boolean {
  try {
    parseHttpUrl(input, "URL");
    return true;
  } catch {
    return false;
  }
}
