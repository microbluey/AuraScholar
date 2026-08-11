import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeReferenceImportOutputContract(
  dependencies: DataCommandDependencies,
): void {
  void dependencies.transaction("library.importReferences", async () => ({
    deduped: 0,
    imported: 1,
    total: 1,
  }));
  // @ts-expect-error library.importReferences must return the import summary.
  void dependencies.transaction("library.importReferences", async () => ({ imported: 1 }));
}

void assertCompileTimeReferenceImportOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Reference import command architecture", () => {
  it("keeps renderer preview pure and sends raw exports through a bounded, local-Library main command", () => {
    const gateway = source("src/services/import-refs.ts");
    const shared = source("src/shared/reference-import.ts");
    const contract = source("electron/reference-import-command-contract.ts");
    const handler = source("electron/main/reference-import-commands.ts");
    const input = source("electron/main/reference-import-command-input.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const envelope = source("electron/main/data-command-envelope.ts");
    const commandName = "library.importReferences";

    for (const sourceText of [gateway, contract, dispatcher, envelope]) {
      expect(sourceText).toContain(commandName);
    }
    expect(gateway).toContain(`data.command("${commandName}"`);
    expect(gateway).toContain("parseImportableReferences");
    expect(gateway).not.toContain("getLibraryDb");
    expect(gateway).not.toContain("aura-db");
    expect(gateway).not.toContain("WorksRepo");
    expect(gateway).not.toContain("window.aura.db");
    expect(gateway).not.toContain("dispatchEvent");
    expect(gateway).not.toMatch(/\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/);

    expect(shared).toContain("parseReferences");
    expect(shared).toContain("referenceItemsToWorkInputs");
    expect(shared).not.toContain("getLibraryDb");
    expect(shared).not.toContain("WorksRepo");
    expect(shared).not.toContain("window.aura");

    expect(contract).not.toContain("libraryId");
    expect(contract).not.toContain("WorkInput");
    expect(handler).toContain("parseReferenceImport");
    expect(handler).toContain("validateReferenceImportPayload");
    expect(handler).toContain("requireLocalLibraryId");
    expect(handler).toContain("assertActiveLocalLibrary");
    expect(handler).toContain("dependencies.transaction");
    expect(handler).toContain("new WorksRepo");
    expect(handler).toContain("upsertMany");
    expect(handler.indexOf("parseReferenceImport(")).toBeLessThan(
      handler.indexOf("dependencies.transaction("),
    );
    expect(input).toContain("MAX_REFERENCE_IMPORT_INPUT_BYTES");
    expect(input).toContain("MAX_REFERENCE_IMPORT_ITEMS");
    expect(input).toContain("MAX_REFERENCE_IMPORT_CSL_ITEM_BYTES");
    expect(input).toContain("MAX_REFERENCE_IMPORT_AUTHORS_PER_ITEM");
  });
});
