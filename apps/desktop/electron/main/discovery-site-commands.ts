import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import { newId } from "@aurascholar/db/ids";
import type {
  DataCommandOutput,
  DataCommandRequest,
  DiscoverySiteAddCommandInput,
  DiscoverySiteAddCommandResult,
  DiscoverySiteCommandSite,
  DiscoverySiteGetSettingsCommandResult,
  DiscoverySiteRemoveCommandInput,
  DiscoverySiteRestoreCommandInput,
  DiscoverySiteSetHiddenCommandInput,
  DiscoverySiteSetProxyCommandInput,
  DiscoverySiteSettings,
} from "../data-command-contract";
import {
  DISCOVERY_SITE_ID_PREFIX,
  MAX_DISCOVERY_SITE_ROWS,
  MAX_DISCOVERY_SITE_SORT_ORDER,
  matchesDiscoverySiteSnapshot,
  parseAddDiscoverySiteInput,
  parseDiscoverySiteSettingsInput,
  parseEmptyDiscoverySiteInput,
  parseRemoveDiscoverySiteInput,
  parseRestoreDiscoverySiteInput,
  parseSetDiscoverySiteHiddenInput,
  parseSetDiscoverySiteProxyInput,
  persistedDiscoverySite,
  requireDiscoverySiteSortOrder,
  safeNormalizeEzproxyPrefix,
  safeNormalizeProxyAddress,
  type DiscoverySiteMaxOrderRow,
  type DiscoverySiteRow,
  type DiscoverySiteSettingRow,
  type ParsedDiscoverySiteSettingsInput,
} from "./discovery-site-command-input";
import { type DataCommandDependencies } from "./data-command-runtime";

const MAX_DISCOVERY_SITE_OUTPUT_BYTES = 8 * 1024 * 1024;
const RESEARCH_EZPROXY_KEY = "research.ezproxy";
const RESEARCH_PROXY_KEY = "research.proxy";

type DiscoverySiteReadCommandName = "discoverySite.getSettings" | "discoverySite.listSites";
type DiscoverySiteMutationCommandName =
  | "discoverySite.addSite"
  | "discoverySite.removeSite"
  | "discoverySite.restoreSite"
  | "discoverySite.setSettings"
  | "discoverySite.setSiteHidden"
  | "discoverySite.setSiteProxy";
type DiscoverySiteCommandName = DiscoverySiteReadCommandName | DiscoverySiteMutationCommandName;

export type DiscoverySiteCommandRequest = Extract<
  DataCommandRequest,
  { name: DiscoverySiteCommandName }
>;

/**
 * Site cards and research connection preferences are application-global. They
 * intentionally run without deriving a per-collection ownership scope.
 */
export async function executeDiscoverySiteCommand(
  request: DiscoverySiteCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<DiscoverySiteCommandName>> {
  switch (request.name) {
    case "discoverySite.listSites": {
      parseEmptyDiscoverySiteInput(request.input, request.name);
      return executeDiscoverySiteQuery(dependencies, request.name, listDiscoverySites);
    }
    case "discoverySite.getSettings": {
      parseEmptyDiscoverySiteInput(request.input, request.name);
      return executeDiscoverySiteQuery(dependencies, request.name, getDiscoverySiteSettings);
    }
    case "discoverySite.addSite": {
      const input = parseAddDiscoverySiteInput(request.input);
      return executeDiscoverySiteMutation(dependencies, request.name, (database) =>
        addDiscoverySite(database, input),
      );
    }
    case "discoverySite.setSiteProxy": {
      const input = parseSetDiscoverySiteProxyInput(request.input);
      return executeDiscoverySiteMutation(dependencies, request.name, (database) =>
        setDiscoverySiteProxy(database, input),
      );
    }
    case "discoverySite.setSiteHidden": {
      const input = parseSetDiscoverySiteHiddenInput(request.input);
      return executeDiscoverySiteMutation(dependencies, request.name, (database) =>
        setDiscoverySiteHidden(database, input),
      );
    }
    case "discoverySite.removeSite": {
      const input = parseRemoveDiscoverySiteInput(request.input);
      return executeDiscoverySiteMutation(dependencies, request.name, (database) =>
        removeDiscoverySite(database, input),
      );
    }
    case "discoverySite.restoreSite": {
      const input = parseRestoreDiscoverySiteInput(request.input);
      return executeDiscoverySiteMutation(dependencies, request.name, (database) =>
        restoreDiscoverySite(database, input),
      );
    }
    case "discoverySite.setSettings": {
      const input = parseDiscoverySiteSettingsInput(request.input);
      return executeDiscoverySiteMutation(dependencies, request.name, (database) =>
        setDiscoverySiteSettings(database, input),
      );
    }
  }
}

function executeDiscoverySiteQuery<K extends DiscoverySiteReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function executeDiscoverySiteMutation<K extends DiscoverySiteMutationCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  return dependencies.transaction(commandName, operation);
}

async function listDiscoverySites(database: Database): Promise<{
  sites: DiscoverySiteCommandSite[];
}> {
  const rows = await database.query<DiscoverySiteRow>(
    `SELECT id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy
     FROM discovery_sites
     ORDER BY sort_order, name, id
     LIMIT ?`,
    [MAX_DISCOVERY_SITE_ROWS + 1],
  );
  if (rows.length > MAX_DISCOVERY_SITE_ROWS) {
    throw new Error(`Discovery sites are limited to ${MAX_DISCOVERY_SITE_ROWS}`);
  }
  const sites = rows.flatMap((row) => {
    const site = persistedDiscoverySite(row);
    return site ? [site] : [];
  });
  return requireBoundedDiscoverySiteOutput({ sites });
}

async function addDiscoverySite(
  database: Database,
  input: DiscoverySiteAddCommandInput,
): Promise<DiscoverySiteAddCommandResult> {
  const now = Date.now();
  const maxOrderRows = await database.query<DiscoverySiteMaxOrderRow>(
    `SELECT COALESCE(MAX(sort_order), 0) AS max_sort_order FROM discovery_sites`,
  );
  const maxOrder = requireDiscoverySiteSortOrder(maxOrderRows[0]?.max_sort_order ?? 0);
  if (maxOrder > MAX_DISCOVERY_SITE_SORT_ORDER - 10) {
    throw new Error("Discovery site order is exhausted");
  }
  const id = `${DISCOVERY_SITE_ID_PREFIX}${newId()}`;
  const sortOrder = maxOrder + 10;
  const changed = await database.run(
    `INSERT INTO discovery_sites
       (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at)
     SELECT ?, ?, ?, ?, 0, 0, ?, 0, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM discovery_sites WHERE home_url = ?)`,
    [id, input.name, input.homeUrl, input.searchUrl ?? null, sortOrder, now, now, input.homeUrl],
  );
  if (changed === 1) {
    return requireBoundedDiscoverySiteOutput({
      created: true,
      status: "created",
      site: {
        builtin: false,
        hidden: false,
        homeUrl: input.homeUrl,
        id,
        name: input.name,
        ...(input.searchUrl === undefined ? {} : { searchUrl: input.searchUrl }),
        sortOrder,
        useProxy: false,
      },
    });
  }

  const rows = await database.query<DiscoverySiteRow>(
    `SELECT id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy
     FROM discovery_sites
     WHERE home_url = ?
     ORDER BY sort_order, name, id
     LIMIT 1`,
    [input.homeUrl],
  );
  const existing = rows[0] ? persistedDiscoverySite(rows[0]) : null;
  if (!existing) {
    throw new Error("添加站点失败,请稍后重试");
  }
  if (existing.hidden) {
    const restored = await database.run(
      `UPDATE discovery_sites SET hidden = 0, updated_at = ? WHERE id = ? AND hidden = 1`,
      [now, existing.id],
    );
    if (restored !== 1) {
      throw new Error(`站点不存在或已被移除:${existing.id}`);
    }
    return requireBoundedDiscoverySiteOutput({
      created: false,
      status: "restored",
      site: { ...existing, hidden: false },
    });
  }
  return requireBoundedDiscoverySiteOutput({ created: false, status: "existing", site: existing });
}

async function setDiscoverySiteProxy(
  database: Database,
  input: DiscoverySiteSetProxyCommandInput,
): Promise<{ updated: 1 }> {
  const changed = await database.run(
    `UPDATE discovery_sites SET use_proxy = ?, updated_at = ? WHERE id = ?`,
    [input.useProxy ? 1 : 0, Date.now(), input.siteId],
  );
  assertDiscoverySiteChanged(changed, `站点不存在或已被移除:${input.siteId}`);
  return { updated: 1 };
}

async function setDiscoverySiteHidden(
  database: Database,
  input: DiscoverySiteSetHiddenCommandInput,
): Promise<{ updated: 1 }> {
  const changed = await database.run(
    `UPDATE discovery_sites SET hidden = ?, updated_at = ? WHERE id = ?`,
    [input.hidden ? 1 : 0, Date.now(), input.siteId],
  );
  assertDiscoverySiteChanged(changed, `站点不存在或已被移除:${input.siteId}`);
  return { updated: 1 };
}

async function removeDiscoverySite(
  database: Database,
  input: DiscoverySiteRemoveCommandInput,
): Promise<{ updated: 1 }> {
  const changed = await database.run(`DELETE FROM discovery_sites WHERE id = ? AND builtin = 0`, [
    input.siteId,
  ]);
  assertDiscoverySiteChanged(changed, `站点不存在、已被删除或为内置站点:${input.siteId}`);
  return { updated: 1 };
}

async function restoreDiscoverySite(
  database: Database,
  input: DiscoverySiteRestoreCommandInput,
): Promise<{ updated: 1 }> {
  const existingRows = await database.query<DiscoverySiteRow>(
    `SELECT id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy
     FROM discovery_sites WHERE id = ? LIMIT 1`,
    [input.id],
  );
  const existingRow = existingRows[0];
  if (existingRow) {
    const existing = persistedDiscoverySite(existingRow);
    if (!existing || existing.builtin) {
      throw new Error("Cannot restore over an existing built-in or invalid site");
    }
    if (!matchesDiscoverySiteSnapshot(existing, input)) {
      throw new Error("Restored site does not match the existing custom site");
    }
    const changed = await database.run(
      `UPDATE discovery_sites
       SET builtin = 0, hidden = 0, updated_at = ?
       WHERE id = ? AND builtin = 0`,
      [Date.now(), input.id],
    );
    assertDiscoverySiteChanged(changed, `站点不存在或已被移除:${input.id}`);
    return { updated: 1 };
  }

  const conflictingHomeRows = await database.query<{ id: unknown }>(
    `SELECT id FROM discovery_sites WHERE home_url = ? LIMIT 1`,
    [input.homeUrl],
  );
  if (conflictingHomeRows.length > 0) {
    throw new Error("A site with this home URL already exists");
  }

  const now = Date.now();
  const changed = await database.run(
    `INSERT INTO discovery_sites
       (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    [
      input.id,
      input.name,
      input.homeUrl,
      input.searchUrl ?? null,
      input.sortOrder,
      input.useProxy ? 1 : 0,
      now,
      now,
    ],
  );
  assertDiscoverySiteChanged(changed, "恢复站点失败,请稍后重试");
  return { updated: 1 };
}

async function getDiscoverySiteSettings(
  database: Database,
): Promise<DiscoverySiteGetSettingsCommandResult> {
  const rows = await database.query<DiscoverySiteSettingRow>(
    `SELECT key, value_json FROM settings WHERE key IN (?, ?)`,
    [RESEARCH_PROXY_KEY, RESEARCH_EZPROXY_KEY],
  );
  const values = new Map<string, unknown>();
  for (const row of rows) {
    if (
      (row.key === RESEARCH_PROXY_KEY || row.key === RESEARCH_EZPROXY_KEY) &&
      !values.has(row.key)
    ) {
      values.set(row.key, row.value_json);
    }
  }
  const settings: DiscoverySiteSettings = {
    ezproxyPrefix: safeNormalizeEzproxyPrefix(values.get(RESEARCH_EZPROXY_KEY)),
    proxyAddress: safeNormalizeProxyAddress(values.get(RESEARCH_PROXY_KEY)),
  };
  return requireBoundedDiscoverySiteOutput({ settings });
}

async function setDiscoverySiteSettings(
  database: Database,
  input: ParsedDiscoverySiteSettingsInput,
): Promise<DiscoverySiteGetSettingsCommandResult> {
  const updatedAt = Date.now();
  if (input.proxyAddress !== undefined) {
    await database.run(
      `INSERT INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         scope = excluded.scope,
         updated_at = excluded.updated_at`,
      [RESEARCH_PROXY_KEY, JSON.stringify(input.proxyAddress), updatedAt],
    );
  }
  if (input.ezproxyPrefix !== undefined) {
    await database.run(
      `INSERT INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         scope = excluded.scope,
         updated_at = excluded.updated_at`,
      [RESEARCH_EZPROXY_KEY, JSON.stringify(input.ezproxyPrefix), updatedAt],
    );
  }
  return getDiscoverySiteSettings(database);
}

function assertDiscoverySiteChanged(changes: number, message: string): void {
  if (changes !== 1) throw new Error(message);
}

function requireBoundedDiscoverySiteOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Discovery site output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_DISCOVERY_SITE_OUTPUT_BYTES) {
    throw new Error(`Discovery site output is limited to ${MAX_DISCOVERY_SITE_OUTPUT_BYTES} bytes`);
  }
  return output;
}
