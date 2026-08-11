import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeTranslationCacheOutputContract(
  dependencies: DataCommandDependencies,
): void {
  void dependencies.execute?.("translationCache.get", async () => ({ result: null }));
  // @ts-expect-error translationCache.get must return its cache-result envelope.
  void dependencies.execute?.("translationCache.get", async () => ({ cached: null }));
  void dependencies.transaction("translationCache.put", async () => ({ stored: true }));
  // @ts-expect-error translationCache.put must confirm the store result.
  void dependencies.transaction("translationCache.put", async () => ({ stored: false }));
  void dependencies.transaction("translationCache.clear", async () => ({ deleted: 0 }));
  // @ts-expect-error translationCache.clear must return its actual deletion count.
  void dependencies.transaction("translationCache.clear", async () => ({ cleared: 0 }));
}

void assertCompileTimeTranslationCacheOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Translation cache command architecture", () => {
  it("keeps the global runtime cache behind strict typed main-process commands", () => {
    const gateway = source("src/services/translate.ts");
    const commands = source("electron/main/translation-cache-commands.ts");
    const contract = source("electron/translation-cache-command-contract.ts");
    const commandNames = ["translationCache.get", "translationCache.put", "translationCache.clear"];

    for (const commandName of commandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
      expect(contract).toContain(`"${commandName}"`);
    }
    expect(gateway).not.toContain("getDb");
    expect(gateway).not.toContain("aura-db");
    expect(gateway).not.toContain("window.aura.db");
    expect(gateway).not.toMatch(/\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/);
    expect(commands).toContain("requireExactTranslationCacheInput");
    expect(commands).toContain("safeHistoricalTranslationCacheResult");
    expect(commands).toContain("MAX_TRANSLATION_CACHE_OUTPUT_BYTES");
    expect(commands).toContain("Date.now()");
    expect(commands).toContain("dependencies.execute");
    expect(commands).toContain("dependencies.transaction");
    expect(commands).not.toContain("requireLocalLibraryId");
    expect(commands).not.toContain("assertActiveLocalLibrary");
  });
});
