// Discovery sites: the academic websites shown as cards on the discovery page.
// Built-in sites are seeded by migration v7; users can add custom ones and hide
// built-ins. Login/cookies are NOT here — they live in each site's Electron
// session partition (see electron/main/research-browser.ts), cleared via
// clearSiteData().
import { newId } from "@aurascholar/db/ids";
import { getDb } from "./tauri-db";

export interface DiscoverySite {
  id: string;
  name: string;
  homeUrl: string;
  searchUrl?: string;
  builtin: boolean;
  hidden: boolean;
  sortOrder: number;
  useProxy: boolean;
}

export interface AddSiteResult {
  created: boolean;
  status: "created" | "existing" | "restored";
  site: DiscoverySite;
}

interface SiteRow {
  id: string;
  name: string;
  home_url: string;
  search_url: string | null;
  builtin: number;
  hidden: number;
  sort_order: number;
  use_proxy: number;
}

function isTauri(): boolean {
  return "aura" in window;
}

function fromRow(row: SiteRow): DiscoverySite {
  return {
    id: row.id,
    name: row.name,
    homeUrl: row.home_url,
    searchUrl: row.search_url ?? undefined,
    builtin: row.builtin === 1,
    hidden: row.hidden === 1,
    sortOrder: row.sort_order,
    useProxy: row.use_proxy === 1,
  };
}

function normalizeHttpUrl(input: string, label: string): string {
  const raw = input.trim();
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${label} 不是有效 URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} 只支持 http/https`);
  }
  return parsed.toString();
}

function isHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeProxyAddress(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
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
  return parsed.toString();
}

function normalizeEzproxyPrefix(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  const probe = encodeURIComponent("https://example.com/article");
  const candidate = raw.includes("{url}") ? raw.replace("{url}", probe) : `${raw}${probe}`;
  if (!isHttpUrl(candidate)) {
    throw new Error("图书馆前缀必须能组成 http/https URL");
  }
  return raw;
}

/** All sites, in display order. Includes hidden ones (filter in the UI). */
export async function listSites(): Promise<DiscoverySite[]> {
  if (!isTauri()) return [];
  const db = await getDb();
  const rows = await db.query<SiteRow>(
    `SELECT id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy
     FROM discovery_sites ORDER BY sort_order, name`,
  );
  return rows.map(fromRow);
}

export async function addSite(input: {
  name: string;
  homeUrl: string;
  searchUrl?: string;
}): Promise<AddSiteResult> {
  const db = await getDb();
  const now = Date.now();
  const id = `custom:${newId()}`;
  const name = input.name.trim();
  if (!name) throw new Error("站点名称不能为空");
  const homeUrl = normalizeHttpUrl(input.homeUrl, "主页 URL");
  const searchUrl = input.searchUrl?.trim()
    ? normalizeHttpUrl(input.searchUrl, "检索 URL")
    : undefined;
  const maxOrder = Number(
    (await db.queryScalar(`SELECT COALESCE(MAX(sort_order), 0) FROM discovery_sites`)) ?? 0,
  );
  const sortOrder = maxOrder + 10;
  const changes = await db.run(
    `INSERT INTO discovery_sites (id, name, home_url, search_url, builtin, hidden, sort_order, created_at, updated_at)
     SELECT ?, ?, ?, ?, 0, 0, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM discovery_sites WHERE home_url = ?)`,
    [id, name, homeUrl, searchUrl ?? null, sortOrder, now, now, homeUrl],
  );
  if (changes === 0) {
    const existing = await db.query<SiteRow>(
      `SELECT id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy
       FROM discovery_sites WHERE home_url = ? LIMIT 1`,
      [homeUrl],
    );
    if (existing[0]) {
      if (existing[0].hidden === 1) {
        await db.run(`UPDATE discovery_sites SET hidden = 0, updated_at = ? WHERE id = ?`, [
          now,
          existing[0].id,
        ]);
        return { created: false, status: "restored", site: fromRow({ ...existing[0], hidden: 0 }) };
      }
      return { created: false, status: "existing", site: fromRow(existing[0]) };
    }
    throw new Error("添加站点失败,请稍后重试");
  }
  return {
    created: true,
    status: "created",
    site: {
      id,
      name,
      homeUrl,
      searchUrl,
      builtin: false,
      hidden: false,
      sortOrder,
      useProxy: false,
    },
  };
}

/** Toggle whether a site's embedded browser routes through the configured proxy. */
export async function setSiteProxy(id: string, useProxy: boolean): Promise<void> {
  const db = await getDb();
  await db.run(`UPDATE discovery_sites SET use_proxy = ?, updated_at = ? WHERE id = ?`, [
    useProxy ? 1 : 0,
    Date.now(),
    id,
  ]);
}

/** Global proxy address (e.g. "http://127.0.0.1:7890"), stored in settings. */
export async function getProxyAddress(): Promise<string> {
  if (!isTauri()) return "";
  const db = await getDb();
  const rows = await db.query<{ value_json: string }>(
    `SELECT value_json FROM settings WHERE key = 'research.proxy'`,
  );
  if (!rows[0]) return "";
  try {
    return JSON.parse(rows[0].value_json) as string;
  } catch {
    return "";
  }
}

export async function setProxyAddress(address: string): Promise<void> {
  const db = await getDb();
  const normalized = normalizeProxyAddress(address);
  await db.run(
    `INSERT INTO settings (key, value_json) VALUES ('research.proxy', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    [JSON.stringify(normalized)],
  );
}

/**
 * Library EZproxy prefix (the campus off-campus-access entrypoint), stored in
 * settings. Paste either a login-style prefix ending in `url=` (we append the
 * encoded target) or any string containing `{url}` (we substitute). Lets a
 * subscribed journal carry the school's identity without needing the campus IP.
 */
export async function getEzproxyPrefix(): Promise<string> {
  if (!isTauri()) return "";
  const db = await getDb();
  const rows = await db.query<{ value_json: string }>(
    `SELECT value_json FROM settings WHERE key = 'research.ezproxy'`,
  );
  if (!rows[0]) return "";
  try {
    return JSON.parse(rows[0].value_json) as string;
  } catch {
    return "";
  }
}

export async function setEzproxyPrefix(prefix: string): Promise<void> {
  const db = await getDb();
  const normalized = normalizeEzproxyPrefix(prefix);
  await db.run(
    `INSERT INTO settings (key, value_json) VALUES ('research.ezproxy', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
    [JSON.stringify(normalized)],
  );
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
  if (!isHttpUrl(url)) return null;
  const rewritten = p.includes("{url}")
    ? p.replace("{url}", encodeURIComponent(url))
    : `${p}${encodeURIComponent(url)}`;
  return isHttpUrl(rewritten) ? rewritten : null;
}

/** Remove a custom site. Built-in sites are hidden instead (see setHidden). */
export async function removeSite(id: string): Promise<void> {
  const db = await getDb();
  await db.run(`DELETE FROM discovery_sites WHERE id = ? AND builtin = 0`, [id]);
}

export async function setHidden(id: string, hidden: boolean): Promise<void> {
  const db = await getDb();
  await db.run(`UPDATE discovery_sites SET hidden = ?, updated_at = ? WHERE id = ?`, [
    hidden ? 1 : 0,
    Date.now(),
    id,
  ]);
}

/** Clear a site's stored cookies/cache (its Electron session partition). */
export async function clearSiteData(site: DiscoverySite): Promise<void> {
  if (!isTauri()) return;
  await window.aura.research.clearSiteData(site.id);
}

/** Which of the given sites already hold local data (cookies present). */
export async function sitesWithData(ids: string[]): Promise<Set<string>> {
  if (!isTauri() || ids.length === 0) return new Set();
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
