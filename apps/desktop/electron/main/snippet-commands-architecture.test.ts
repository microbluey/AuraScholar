import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeSnippetOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("snippet.listAll", async () => ({ snippets: [] }));
  // @ts-expect-error snippet.listAll must return its snippets envelope.
  void dependencies.execute?.("snippet.listAll", async () => ({ rows: [] }));
  void dependencies.transaction("snippet.create", async () => ({ snippetId: "snippet-id" }));
  // @ts-expect-error snippet.create must return the created snippet id.
  void dependencies.transaction("snippet.create", async () => ({ updated: 1 }));
  void dependencies.transaction("snippet.updateNote", async () => ({ updated: 1 }));
  // @ts-expect-error snippet.updateNote must return its mutation envelope.
  void dependencies.transaction("snippet.updateNote", async () => ({ updated: 0 }));
}

void assertCompileTimeSnippetOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Snippet command architecture", () => {
  it("keeps snippet reads and mutations behind a scoped typed main-process boundary", () => {
    const gateway = source("src/services/snippets.ts");
    const commands = source("electron/main/snippet-commands.ts");
    const contract = source("electron/snippet-command-contract.ts");
    const commandNames = [
      "snippet.create",
      "snippet.delete",
      "snippet.listAll",
      "snippet.restore",
      "snippet.updateNote",
    ];

    for (const commandName of commandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
      expect(contract).toContain(`"${commandName}"`);
    }
    for (const rendererSource of [gateway]) {
      expect(rendererSource).not.toContain("getLibraryDb");
      expect(rendererSource).not.toContain("aura-db");
      expect(rendererSource).not.toContain("SnippetsRepo");
      expect(rendererSource).not.toContain("window.aura.db");
      expect(rendererSource).not.toMatch(
        /\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/,
      );
    }
    expect(commands).toContain("requireLocalLibraryId");
    expect(commands).toContain("assertActiveLocalLibrary");
    expect(commands).toContain("new SnippetsRepo");
    expect(commands).toContain("MAX_SNIPPET_ROWS + 1");
    expect(commands).toContain("MAX_SNIPPET_OUTPUT_BYTES");
    expect(commands).toContain("requireExactSnippetInput");
  });
});
