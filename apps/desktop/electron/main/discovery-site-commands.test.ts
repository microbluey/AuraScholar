import type { Database } from "@aurascholar/db";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
  DiscoverySiteRestoreCommandInput,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand } from "./data-commands";
import type { DataCommandDependencies } from "./data-command-runtime";

let database: Database;
let dependencies: DataCommandDependencies;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

function snapshot(
  overrides: Partial<DiscoverySiteRestoreCommandInput> = {},
): DiscoverySiteRestoreCommandInput {
  return {
    homeUrl: "https://restore.example.edu/",
    id: "custom:restore-snapshot",
    name: "Restore snapshot",
    searchUrl: "https://restore.example.edu/search?q=",
    sortOrder: 900,
    useProxy: true,
    ...overrides,
  };
}

describe("Discovery site data commands", () => {
  it("works without an active local Library and patches only supplied global settings", async () => {
    await database.run(`UPDATE libraries SET deleted_at = 1`);
    await expect(
      database.query<{ id: string }>(`SELECT id FROM libraries WHERE deleted_at IS NULL`),
    ).resolves.toEqual([]);
    await database.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES ('research.proxy', '"http://old.example.edu:8080"', 'remote', 1)`,
    );

    expect((await command("discoverySite.listSites", {})).sites).toContainEqual(
      expect.objectContaining({ id: "builtin:google-scholar" }),
    );
    await expect(command("discoverySite.getSettings", {})).resolves.toEqual({
      settings: { ezproxyPrefix: "", proxyAddress: "http://old.example.edu:8080/" },
    });

    const added = await command("discoverySite.addSite", {
      homeUrl: "global.example.edu",
      name: "Global settings site",
      searchUrl: "https://global.example.edu/search?q=",
    });
    expect(added).toMatchObject({ created: true, status: "created" });
    expect(added.site.id).toMatch(/^custom:/);
    await expect(
      command("discoverySite.setSiteProxy", { siteId: added.site.id, useProxy: true }),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      command("discoverySite.setSiteHidden", { hidden: true, siteId: added.site.id }),
    ).resolves.toEqual({ updated: 1 });

    await expect(
      command("discoverySite.setSettings", { proxyAddress: "socks5://127.0.0.1:7890" }),
    ).resolves.toEqual({
      settings: { ezproxyPrefix: "", proxyAddress: "socks5://127.0.0.1:7890" },
    });
    await expect(
      command("discoverySite.setSettings", {
        ezproxyPrefix: "https://proxy.example.edu/login?url=",
      }),
    ).resolves.toEqual({
      settings: {
        ezproxyPrefix: "https://proxy.example.edu/login?url=",
        proxyAddress: "socks5://127.0.0.1:7890",
      },
    });
    await expect(
      database.query<{ key: string; scope: string; value_json: string }>(
        `SELECT key, scope, value_json FROM settings
         WHERE key IN ('research.proxy', 'research.ezproxy') ORDER BY key`,
      ),
    ).resolves.toEqual([
      {
        key: "research.ezproxy",
        scope: "local",
        value_json: '"https://proxy.example.edu/login?url="',
      },
      { key: "research.proxy", scope: "local", value_json: '"socks5://127.0.0.1:7890"' },
    ]);

    await expect(command("discoverySite.removeSite", { siteId: added.site.id })).resolves.toEqual({
      updated: 1,
    });
    await expect(
      command("discoverySite.restoreSite", {
        homeUrl: added.site.homeUrl,
        id: added.site.id,
        name: added.site.name,
        ...(added.site.searchUrl === undefined ? {} : { searchUrl: added.site.searchUrl }),
        sortOrder: added.site.sortOrder,
        useProxy: added.site.useProxy,
      }),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      database.query<{ builtin: number; hidden: number }>(
        `SELECT builtin, hidden FROM discovery_sites WHERE id = ?`,
        [added.site.id],
      ),
    ).resolves.toEqual([{ builtin: 0, hidden: 0 }]);
  });

  it("rejects injected, malformed, credentialed, and non-custom input before leasing the database", async () => {
    let executeCalls = 0;
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const validSnapshot = snapshot();
    const requests = [
      { input: { libraryId: "foreign" }, name: "discoverySite.listSites" },
      { input: { libraryId: "foreign" }, name: "discoverySite.getSettings" },
      {
        input: { homeUrl: "https://example.edu", libraryId: "foreign", name: "Example" },
        name: "discoverySite.addSite",
      },
      {
        input: { libraryId: "foreign", siteId: "custom:one", useProxy: true },
        name: "discoverySite.setSiteProxy",
      },
      {
        input: { hidden: true, libraryId: "foreign", siteId: "custom:one" },
        name: "discoverySite.setSiteHidden",
      },
      {
        input: { libraryId: "foreign", siteId: "custom:one" },
        name: "discoverySite.removeSite",
      },
      {
        input: { ...validSnapshot, libraryId: "foreign" },
        name: "discoverySite.restoreSite",
      },
      {
        input: { libraryId: "foreign", proxyAddress: "http://127.0.0.1:7890" },
        name: "discoverySite.setSettings",
      },
      {
        input: { ...validSnapshot, builtin: false },
        name: "discoverySite.restoreSite",
      },
      {
        input: { ...validSnapshot, id: "builtin:google-scholar" },
        name: "discoverySite.restoreSite",
      },
      {
        input: { ...validSnapshot, id: "site:not-custom" },
        name: "discoverySite.restoreSite",
      },
      { input: {}, name: "discoverySite.setSettings" },
      {
        input: { homeUrl: "https://user:password@example.edu", name: "Credentialed" },
        name: "discoverySite.addSite",
      },
      {
        input: { homeUrl: "ftp://example.edu", name: "Unsupported scheme" },
        name: "discoverySite.addSite",
      },
      {
        input: { proxyAddress: "socks5://user:password@127.0.0.1:7890" },
        name: "discoverySite.setSettings",
      },
      {
        input: { ezproxyPrefix: "ftp://proxy.example.edu/?url=" },
        name: "discoverySite.setSettings",
      },
    ];

    for (const request of requests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("restores only matching custom snapshots and never overwrites built-in rows", async () => {
    const matching = snapshot({ id: "custom:matching", sortOrder: 910 });
    await database.run(
      `INSERT INTO discovery_sites
       (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?, 1, 1)`,
      [
        matching.id,
        matching.name,
        matching.homeUrl,
        matching.searchUrl ?? null,
        matching.sortOrder,
        matching.useProxy ? 1 : 0,
      ],
    );
    await expect(command("discoverySite.restoreSite", matching)).resolves.toEqual({ updated: 1 });
    await expect(
      database.query<{ builtin: number; hidden: number }>(
        `SELECT builtin, hidden FROM discovery_sites WHERE id = ?`,
        [matching.id],
      ),
    ).resolves.toEqual([{ builtin: 0, hidden: 0 }]);
    await expect(
      command("discoverySite.restoreSite", { ...matching, name: "Changed snapshot" }),
    ).rejects.toThrow("does not match");

    const forgedBuiltin = snapshot({ id: "custom:forged-builtin", sortOrder: 920 });
    await database.run(
      `INSERT INTO discovery_sites
       (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?, 1, 1)`,
      [
        forgedBuiltin.id,
        forgedBuiltin.name,
        forgedBuiltin.homeUrl,
        forgedBuiltin.searchUrl ?? null,
        forgedBuiltin.sortOrder,
        forgedBuiltin.useProxy ? 1 : 0,
      ],
    );
    await expect(command("discoverySite.restoreSite", forgedBuiltin)).rejects.toThrow(
      "existing built-in",
    );
    await expect(
      database.query<{ builtin: number; hidden: number }>(
        `SELECT builtin, hidden FROM discovery_sites WHERE id = ?`,
        [forgedBuiltin.id],
      ),
    ).resolves.toEqual([{ builtin: 1, hidden: 1 }]);
    await expect(
      command("discoverySite.restoreSite", {
        ...snapshot({ id: "custom:conflicting-home" }),
        homeUrl: "https://scholar.google.com/",
      }),
    ).rejects.toThrow("home URL already exists");
    await expect(
      command("discoverySite.removeSite", { siteId: "builtin:google-scholar" }),
    ).rejects.toThrow("内置站点");
  });

  it("fails closed for malformed persisted settings and unsafe historical site rows", async () => {
    await database.run(
      `INSERT OR REPLACE INTO settings (key, value_json, scope, updated_at) VALUES
       ('research.proxy', '"https://user:password@proxy.example.edu"', 'local', 1),
       ('research.ezproxy', '{not-json', 'local', 1)`,
    );
    await database.run(
      `INSERT INTO discovery_sites
       (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at)
       VALUES
       ('custom:legacy-credential', 'Credentialed legacy', 'https://user:password@legacy.example.edu/', NULL, 0, 0, 800, 0, 1, 1),
       ('custom:legacy-scheme', 'Scheme legacy', 'javascript:alert(1)', NULL, 0, 0, 810, 0, 1, 1),
       ('custom:stable-b', 'Stable', 'https://stable-b.example.edu/', NULL, 0, 0, 820, 0, 1, 1),
       ('custom:stable-a', 'Stable', 'https://stable-a.example.edu/', NULL, 0, 0, 820, 0, 1, 1)`,
    );

    await expect(command("discoverySite.getSettings", {})).resolves.toEqual({
      settings: { ezproxyPrefix: "", proxyAddress: "" },
    });
    const listed = await command("discoverySite.listSites", {});
    expect(listed.sites.map((site) => site.id)).not.toContain("custom:legacy-credential");
    expect(listed.sites.map((site) => site.id)).not.toContain("custom:legacy-scheme");
    expect(
      listed.sites.filter((site) => site.id.startsWith("custom:stable")).map((site) => site.id),
    ).toEqual(["custom:stable-a", "custom:stable-b"]);
  });

  it("bounds site row counts and serialized site output", async () => {
    await database.run(
      `WITH RECURSIVE rows(n) AS (
         SELECT 1
         UNION ALL
         SELECT n + 1 FROM rows WHERE n < 1001
       )
       INSERT INTO discovery_sites
         (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at)
       SELECT 'custom:count:' || n, 'Count bounded', 'https://count.example.edu/' || n,
              NULL, 0, 0, n + 1000, 0, n, n
       FROM rows`,
    );
    await expect(command("discoverySite.listSites", {})).rejects.toThrow(
      "Discovery sites are limited to 1000",
    );

    await database.run(`DELETE FROM discovery_sites`);
    const largeUrl = `https://payload.example.edu/${"x".repeat(8_100)}`;
    await database.run(
      `WITH RECURSIVE rows(n) AS (
         SELECT 1
         UNION ALL
         SELECT n + 1 FROM rows WHERE n < 1000
       )
       INSERT INTO discovery_sites
         (id, name, home_url, search_url, builtin, hidden, sort_order, use_proxy, created_at, updated_at)
       SELECT 'custom:payload:' || n, 'Payload bounded', ?, ?, 0, 0, n, 0, n, n
       FROM rows`,
      [largeUrl, largeUrl],
    );
    await expect(command("discoverySite.listSites", {})).rejects.toThrow(
      "Discovery site output is limited to 8388608 bytes",
    );
  });
});
