import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeLibraryListOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("library.listWorks", async () => ({ works: [] }));
  // @ts-expect-error library.listWorks must return its DTO envelope.
  void dependencies.execute?.("library.listWorks", async () => ({ works: [{ id: "work-id" }] }));
  void dependencies.execute?.("library.searchWorksByMetadata", async () => ({ works: [] }));
  // @ts-expect-error metadata search results include active tag names.
  void dependencies.execute?.("library.searchWorksByMetadata", async () => ({
    works: [
      {
        abstract: null,
        authorNames: [],
        createdAt: 0,
        doi: null,
        id: "work-id",
        readingStatus: "unread",
        starred: false,
        title: "Work",
        venueName: null,
        year: null,
      },
    ],
  }));
}

void assertCompileTimeLibraryListOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Library list command architecture", () => {
  it("keeps lightweight Library list reads behind typed scoped commands", () => {
    const contract = source("electron/library-read-command-contract.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const envelope = source("electron/main/data-command-envelope.ts");
    const facade = source("src/services/library-list.ts");
    const handler = source("electron/main/library-list-commands.ts");
    const pages = [
      source("src/pages/GraphPage.tsx"),
      source("src/pages/HomepagePage.tsx"),
      source("src/pages/SnippetsPage.tsx"),
      source("src/pages/SpatialCanvasPage.tsx"),
    ];

    for (const commandName of ["library.listWorks", "library.searchWorksByMetadata"]) {
      expect(contract).toContain(`"${commandName}"`);
      expect(dispatcher).toContain(`case "${commandName}":`);
      expect(envelope).toContain(`"${commandName}",`);
      expect(facade).toContain(`data.command("${commandName}"`);
    }
    expect(facade).not.toContain("getLibraryDb");
    expect(facade).not.toContain("aura-db");
    expect(facade).not.toContain("window.aura.db");
    expect(facade).not.toMatch(/\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/);

    for (const page of pages) {
      expect(page).not.toContain("getLibraryDb");
      expect(page).not.toContain("aura-db");
    }
    expect(handler).toContain("requireLocalLibraryId");
    expect(handler).toContain("assertActiveLocalLibrary");
    expect(handler).toContain("listDatabaseWorks");
    expect(handler).toContain("searchDatabaseWorksByMetadata");
    expect(handler).toContain("MAX_LIBRARY_LIST_LIMIT = 500");
    expect(handler).toContain("MAX_LIBRARY_LIST_OUTPUT_BYTES = 8 * 1024 * 1024");
    expect(handler).toContain("MAX_METADATA_SEARCH_LIMIT = 100");
    expect(handler).toContain('Buffer.byteLength(serialized, "utf8")');
    expect(handler).toContain("requireBoundedLibraryListOutput");
    expect(handler).toContain("requireLibraryListInput");
  });
});
