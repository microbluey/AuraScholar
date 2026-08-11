import { type Database } from "@aurascholar/db";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
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

describe("Translation cache data commands", () => {
  it("rejects malformed and scope-injected input before obtaining a database lease", async () => {
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
    const jsonExpandedResult = "\u0000".repeat(700_000);
    const invalidRequests = [
      { input: {}, name: "translationCache.get" },
      {
        input: { cacheKey: "cache-1", libraryId: "library:foreign" },
        name: "translationCache.get",
      },
      { input: { cacheKey: " " }, name: "translationCache.get" },
      {
        input: { cacheKey: "cache-1", engine: "llm", result: "译文" },
        name: "translationCache.put",
      },
      {
        input: {
          cacheKey: "cache-1",
          createdAt: 1,
          engine: "llm",
          result: "译文",
          targetLang: "zh",
        },
        name: "translationCache.put",
      },
      {
        input: {
          cacheKey: "cache-1",
          engine: "llm",
          libraryId: "library:foreign",
          result: "译文",
          targetLang: "zh",
        },
        name: "translationCache.put",
      },
      {
        input: {
          cacheKey: "cache-1",
          engine: "llm",
          result: " ",
          targetLang: "zh",
        },
        name: "translationCache.put",
      },
      {
        input: {
          cacheKey: "cache-1",
          engine: "llm",
          result: jsonExpandedResult,
          targetLang: "zh",
        },
        name: "translationCache.put",
      },
      { input: { libraryId: "library:foreign" }, name: "translationCache.clear" },
      { input: { extra: true }, name: "translationCache.clear" },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("stores and reads app-global entries without resolving a local Library", async () => {
    await database.run(`UPDATE libraries SET deleted_at = 1`);
    const before = Date.now();

    await expect(
      command("translationCache.put", {
        cacheKey: "translation-cache:global",
        engine: "llm",
        result: "全局缓存译文",
        targetLang: "zh",
      }),
    ).resolves.toEqual({ stored: true });
    await expect(
      command("translationCache.get", { cacheKey: "translation-cache:global" }),
    ).resolves.toEqual({ result: "全局缓存译文" });

    const rows = await database.query<{
      cache_key: string;
      created_at: number;
      engine: string;
      result: string;
      target_lang: string;
    }>(`SELECT cache_key, engine, target_lang, result, created_at FROM translation_cache`);
    expect(rows).toEqual([
      expect.objectContaining({
        cache_key: "translation-cache:global",
        engine: "llm",
        result: "全局缓存译文",
        target_lang: "zh",
      }),
    ]);
    expect(rows[0]?.created_at).toBeGreaterThanOrEqual(before);
  });

  it("uses execute for reads and transactions for writes and clear", async () => {
    const coordinator = new DatabaseCoordinator(database);
    let executeCalls = 0;
    let transactionCalls = 0;
    dependencies = {
      execute: (_commandName, operation) => {
        executeCalls += 1;
        return coordinator.execute(operation);
      },
      transaction: (commandName, operation) => {
        transactionCalls += 1;
        return coordinator.transaction(commandName, operation);
      },
    };

    await command("translationCache.put", {
      cacheKey: "translation-cache:leases",
      engine: "llm",
      result: "缓存",
      targetLang: "zh",
    });
    await command("translationCache.get", { cacheKey: "translation-cache:leases" });
    await command("translationCache.clear", {});

    expect(executeCalls).toBe(1);
    expect(transactionCalls).toBe(2);
  });

  it("replaces cache keys and returns the actual number deleted", async () => {
    await command("translationCache.put", {
      cacheKey: "translation-cache:replace",
      engine: "llm",
      result: "初版",
      targetLang: "zh",
    });
    await command("translationCache.put", {
      cacheKey: "translation-cache:replace",
      engine: "deepl",
      result: "更新版",
      targetLang: "en",
    });
    await command("translationCache.put", {
      cacheKey: "translation-cache:other",
      engine: "llm",
      result: "另一条",
      targetLang: "zh",
    });

    await expect(
      command("translationCache.get", { cacheKey: "translation-cache:replace" }),
    ).resolves.toEqual({ result: "更新版" });
    await expect(command("translationCache.clear", {})).resolves.toEqual({ deleted: 2 });
    await expect(command("translationCache.clear", {})).resolves.toEqual({ deleted: 0 });
  });

  it("treats malformed and oversized historical cache rows as safe misses", async () => {
    await database.run(
      `INSERT INTO translation_cache (cache_key, engine, target_lang, result, created_at)
       VALUES ('translation-cache:binary', 'legacy', 'zh', CAST(x'0102' AS BLOB), 1)`,
    );
    await database.run(
      `INSERT INTO translation_cache (cache_key, engine, target_lang, result, created_at)
       VALUES (?, 'legacy', 'zh', ?, 1)`,
      ["translation-cache:oversized", "x".repeat(4 * 1024 * 1024 + 1)],
    );
    await database.run(
      `INSERT INTO translation_cache (cache_key, engine, target_lang, result, created_at)
       VALUES (?, 'legacy', 'zh', ?, 1)`,
      ["translation-cache:json-expanded", "\u0000".repeat(700_000)],
    );

    await expect(
      command("translationCache.get", { cacheKey: "translation-cache:binary" }),
    ).resolves.toEqual({
      result: null,
    });
    await expect(
      command("translationCache.get", { cacheKey: "translation-cache:oversized" }),
    ).resolves.toEqual({ result: null });
    await expect(
      command("translationCache.get", { cacheKey: "translation-cache:json-expanded" }),
    ).resolves.toEqual({ result: null });
    await expect(
      database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM translation_cache`),
    ).resolves.toEqual([{ count: 3 }]);
  });
});
