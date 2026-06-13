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

describe("migrations", () => {
  it("records the latest version", async () => {
    const max = await db.queryScalar(`SELECT MAX(version) FROM _migrations`);
    expect(Number(max)).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version);
  });

  it("creates the snippets and translation_cache tables", async () => {
    expect(await tableExists("snippets")).toBe(true);
    expect(await tableExists("translation_cache")).toBe(true);
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
});
