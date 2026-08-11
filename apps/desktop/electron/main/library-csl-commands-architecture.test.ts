import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeLibraryCslOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("library.getCslItems", async () => ({ items: [] }));
  // @ts-expect-error library.getCslItems must return its exact CSL envelope.
  void dependencies.execute?.("library.getCslItems", async () => ({ works: [] }));
}

void assertCompileTimeLibraryCslOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Library CSL command architecture", () => {
  it("keeps bibliography reads behind a strict local-Library typed command", () => {
    const contract = source("electron/library-read-command-contract.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const envelope = source("electron/main/data-command-envelope.ts");
    const facade = source("src/services/cite.ts");
    const handler = source("electron/main/library-csl-commands.ts");

    expect(contract).toContain('"library.getCslItems"');
    expect(dispatcher).toContain('case "library.getCslItems":');
    expect(envelope).toContain('"library.getCslItems",');
    expect(facade).toContain('data.command("library.getCslItems"');
    expect(facade).not.toContain("getLibraryDb");
    expect(facade).not.toContain("aura-db");
    expect(facade).not.toContain("window.aura.db");
    expect(facade).not.toMatch(/\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/);

    expect(handler).toContain("requireLocalLibraryId");
    expect(handler).toContain("assertActiveLocalLibrary");
    expect(handler).toContain("toCslItem");
    expect(handler).toContain("MAX_CSL_ITEM_WORK_IDS = 500");
    expect(handler).toContain("MAX_CSL_ITEMS_OUTPUT_BYTES = 8 * 1024 * 1024");
    expect(handler).toContain('Buffer.byteLength(serialized, "utf8")');
    expect(handler).toContain("requireBoundedCslItemsOutput");
    expect(handler).toContain("parseLibraryGetCslItemsInput");
  });
});
