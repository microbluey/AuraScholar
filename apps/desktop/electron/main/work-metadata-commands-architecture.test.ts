import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeWorkMetadataOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("library.getWorkMetadata", async () => ({ metadata: null }));
  // @ts-expect-error library.getWorkMetadata must return its metadata envelope.
  void dependencies.execute?.("library.getWorkMetadata", async () => ({ work: null }));
  void dependencies.execute?.("library.updateWorkMetadata", async () => ({ updated: 1 }));
  // @ts-expect-error library.updateWorkMetadata must return the exact mutation result.
  void dependencies.execute?.("library.updateWorkMetadata", async () => ({ updated: 0 }));
}

void assertCompileTimeWorkMetadataOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Work metadata command architecture", () => {
  it("keeps editor metadata behind a strict, local-library typed main-process boundary", () => {
    const gateway = source("src/services/metadata.ts");
    const commands = source("electron/main/work-metadata-commands.ts");
    const contract = source("electron/work-metadata-command-contract.ts");
    const commandNames = ["library.getWorkMetadata", "library.updateWorkMetadata"];

    for (const commandName of commandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
      expect(contract).toContain(`"${commandName}"`);
    }
    expect(gateway).not.toContain("getLibraryDb");
    expect(gateway).not.toContain("aura-db");
    expect(gateway).not.toContain("WorksRepo");
    expect(gateway).not.toContain("window.aura.db");
    expect(gateway).not.toMatch(/\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/);
    expect(commands).toContain("requireLocalLibraryId");
    expect(commands).toContain("assertActiveLocalLibrary");
    expect(commands).toContain("new WorksRepo");
    expect(commands).toContain("requireExactWorkMetadataInput");
    expect(commands).toContain("MAX_WORK_METADATA_OUTPUT_BYTES");
    expect(commands).toContain("metadataWorkRow");
    expect(commands).toContain("executeWorkMetadataCommandLease");
    expect(commands).not.toMatch(/\bdependencies\.transaction\s*\(/);
  });
});
