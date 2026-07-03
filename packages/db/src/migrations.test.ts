import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "./database";
import { runMigrations, MIGRATIONS } from "./migrations";

let db: Database;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
});

async function tableExists(name: string): Promise<boolean> {
  const rows = await db.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [name],
  );
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await db.query<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

async function indexExists(name: string): Promise<boolean> {
  const rows = await db.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
    [name],
  );
  return rows.length > 0;
}

describe("migrations", () => {
  it("records the latest version", async () => {
    const max = await db.queryScalar(`SELECT MAX(version) FROM _migrations`);
    expect(Number(max)).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version);
  });

  it("creates the snippets and translation_cache tables", async () => {
    expect(await tableExists("snippets")).toBe(true);
    expect(await tableExists("translation_cache")).toBe(true);
  });

  it("creates discovery_sites and seeds the built-in academic sites", async () => {
    expect(await tableExists("discovery_sites")).toBe(true);
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM discovery_sites WHERE builtin = 1 ORDER BY sort_order`,
    );
    // First five come from v7; v8 appends more after them (ordered by sort_order).
    expect(rows.slice(0, 5).map((r) => r.id)).toEqual([
      "builtin:google-scholar",
      "builtin:web-of-science",
      "builtin:scopus",
      "builtin:pubmed",
      "builtin:cnki",
    ]);
    expect(rows.map((r) => r.id)).toContain("builtin:ieee-xplore");
    expect(rows.map((r) => r.id)).toContain("builtin:dblp");
    // All built-ins have a non-empty home URL.
    const sites = await db.query<{ home_url: string }>(
      `SELECT home_url FROM discovery_sites WHERE builtin = 1`,
    );
    expect(sites.every((s) => s.home_url.startsWith("http"))).toBe(true);
  });

  it("is idempotent (re-running applies nothing new)", async () => {
    await runMigrations(db); // second run
    const count = await db.queryScalar(`SELECT COUNT(*) FROM _migrations`);
    expect(Number(count)).toBe(MIGRATIONS.length);
  });

  it("translation_cache enforces a primary key on cache_key", async () => {
    const now = Date.now();
    await db.run(
      `INSERT OR REPLACE INTO translation_cache (cache_key, engine, target_lang, result, created_at) VALUES (?,?,?,?,?)`,
      ["k1", "llm", "zh", "你好", now],
    );
    await db.run(
      `INSERT OR REPLACE INTO translation_cache (cache_key, engine, target_lang, result, created_at) VALUES (?,?,?,?,?)`,
      ["k1", "llm", "zh", "你好(更新)", now],
    );
    const rows = await db.query<{ result: string }>(
      `SELECT result FROM translation_cache WHERE cache_key = ?`,
      ["k1"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toBe("你好(更新)");
  });

  it("creates the saved_searches table", async () => {
    expect(await tableExists("saved_searches")).toBe(true);
    expect(await columnExists("saved_searches", "seen_ids_json")).toBe(true);
    expect(await columnExists("saved_searches", "new_count")).toBe(true);
    expect(await columnExists("saved_searches", "next_run_at")).toBe(true);
    expect(await columnExists("saved_searches", "last_error")).toBe(true);
  });

  it("tracks the latest sentinel polling error", async () => {
    expect(await columnExists("sentinel_tasks", "last_error")).toBe(true);
  });

  it("creates local-first cloud/sync foundation tables", async () => {
    expect(await tableExists("libraries")).toBe(true);
    expect(await tableExists("sync_row_clocks")).toBe(true);
    expect(await tableExists("blob_sync_state")).toBe(true);
    expect(await tableExists("derived_artifacts")).toBe(true);

    expect(await columnExists("settings", "scope")).toBe(true);
    expect(await columnExists("sync_log", "library_id")).toBe(true);
    expect(await columnExists("sync_log", "values_json")).toBe(true);
    expect(await columnExists("sync_state", "library_id")).toBe(true);
  });

  it("indexes stable academic identifiers used by import dedup", async () => {
    expect(await indexExists("works_arxiv_idx")).toBe(true);
    expect(await indexExists("works_openalex_idx")).toBe(true);
    expect(await indexExists("works_s2_idx")).toBe(true);
    expect(await indexExists("works_pmid_idx")).toBe(true);
  });
});
