import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeLibraryPageOutput(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("library.getPage", async () => ({
    browseSummary: {
      availableSources: [],
      availableSourcesTruncated: false,
      availableTags: [],
      availableTagsTruncated: false,
      baseTotal: 0,
      notedTotal: 0,
      readingTotal: 0,
      starredTotal: 0,
      unreadTotal: 0,
      withPdfTotal: 0,
      withoutPdfTotal: 0,
    },
    collections: [],
    limit: 30,
    offset: 0,
    total: 0,
    trashCount: 0,
    workMeta: {},
    works: [],
  }));
  void dependencies.execute?.("library.getWorkInspectorDetail", async () => ({ detail: null }));
}

void assertCompileTimeLibraryPageOutput;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Library page payload boundary", () => {
  it("uses a narrow database projection and bounds the IPC envelope", () => {
    const contract = source("electron/library-page-command-contract.ts");
    const commands = source("electron/main/library-page-commands.ts");
    const inspectorCommands = source("electron/main/library-inspector-detail-commands.ts");
    const pageQuery = source("../../packages/db/src/work-page.ts");
    const selectedDetail = source("src/features/library/useSelectedWorkDetail.ts");

    expect(contract).toContain("WorkPageWork");
    expect(contract).not.toContain("WorkWithAuthors");
    expect(commands).toContain("MAX_LIBRARY_PAGE_OUTPUT_BYTES = 8 * 1024 * 1024");
    expect(commands).toContain("requireBoundedLibraryPageOutput");
    expect(commands).toContain('Buffer.byteLength(serialized, "utf8")');
    expect(pageQuery).toContain("MAX_WORK_PAGE_AUTHORS = 5");
    expect(pageQuery).toContain("MAX_WORK_PAGE_BROWSE_FACET_VALUES = 500");
    expect(pageQuery).toContain("length(CAST(tag.name AS BLOB))");
    expect(pageQuery).toContain("ranked_authors");
    expect(pageQuery).not.toMatch(/SELECT\s+w\.\*/);
    expect(pageQuery).not.toContain("WorkWithAuthors");
    expect(commands).toContain("MAX_LIBRARY_PAGE_COLLECTIONS = 500");
    expect(commands).toContain("MAX_LIBRARY_PAGE_WORK_TAGS = 4");
    expect(commands).toContain("ranked_tags");
    expect(inspectorCommands).toContain("MAX_LIBRARY_INSPECTOR_DETAIL_OUTPUT_BYTES = 256 * 1024");
    expect(inspectorCommands).not.toMatch(/SELECT\s+\*/);
    expect(selectedDetail).toContain("loadLibraryWorkInspectorDetail");
    expect(selectedDetail).not.toContain("loadWorkMetadata");
    expect(selectedDetail).toContain("retains only the latest queued");
  });
});
