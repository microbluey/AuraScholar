import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Knowledge command scope architecture", () => {
  it("gets the active Library through the typed scope command before calling knowledge commands", () => {
    const indexStats = source("src/services/knowledge-index-stats.ts");
    const search = source("src/services/knowledge-search.ts");
    const navigation = source("src/services/knowledge-search-navigation.ts");
    const semanticIndex = source("src/services/knowledge-semantic-index.ts");
    const renderers = [indexStats, search, semanticIndex];

    for (const rendererSource of renderers) {
      expect(rendererSource).toContain('from "./library-command-scope"');
      expect(rendererSource).toContain("getActiveLibraryCommandScopeToken");
      expect(rendererSource).not.toContain("getLibraryDb");
      expect(rendererSource).not.toContain("aura-db");
      expect(rendererSource).not.toContain("window.aura.db");
      expect(rendererSource).not.toMatch(
        /\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/,
      );
    }

    // Reader revision resolution is a separate legacy document command and
    // still carries its own Library id contract until that boundary migrates.
    expect(navigation).toContain("getActiveLibraryCommandScope");
    expect(navigation).not.toContain("getLibraryDb");

    expect(indexStats).toContain('data.command("knowledge.getContentStats"');
    expect(search).toContain('data.command("knowledge.searchContent"');
    expect(navigation).toContain('data.command("document.resolveRevision"');
    expect(semanticIndex).toContain('data.command("knowledge.buildSemanticIndex"');
    expect(semanticIndex).toContain('data.command("knowledge.getSemanticIndexStatus"');
  });
});
