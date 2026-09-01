import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("main-process data command core architecture", () => {
  it("keeps durable data commands on a typed allowlist", () => {
    const aiContract = source("electron/ai-command-contract.ts");
    const contract = source("electron/data-command-contract.ts");
    const citationGraphContract = source("electron/citation-graph-command-contract.ts");
    const savedSearchContract = source("electron/saved-search-command-contract.ts");
    const sentinelReadContract = source("electron/sentinel-read-command-contract.ts");
    const syncContract = source("electron/sync-command-contract.ts");
    const dispatcher = source("electron/main/data-commands.ts");

    expect(aiContract).toContain('"ai.getFlashcardTarget"');
    expect(aiContract).toContain('"ai.commitFlashcardGeneration"');
    expect(aiContract).toContain('"ai.recordFlashcardFailure"');
    expect(dispatcher).toContain("executeAiCommand");
    expect(contract).toContain('"library.importBackup"');
    expect(contract).toContain('"library.mergeWorks"');
    expect(contract).toContain('"library.purgeDeletedWorks"');
    expect(citationGraphContract).toContain('"citationGraph.getCached"');
    expect(citationGraphContract).toContain('"citationGraph.putCached"');
    expect(citationGraphContract).toContain('"citationGraph.getActiveLibraryDois"');
    expect(savedSearchContract).toContain('"savedSearch.get"');
    expect(savedSearchContract).toContain('"savedSearch.getScope"');
    expect(savedSearchContract).toContain('"savedSearch.list"');
    expect(savedSearchContract).toContain('"savedSearch.listDue"');
    expect(sentinelReadContract).toContain('"sentinel.getPageSnapshot"');
    expect(sentinelReadContract).toContain('"sentinel.getDuePollSnapshot"');
    expect(sentinelReadContract).toContain('"sentinel.getEventEvidence"');
    expect(sentinelReadContract).toContain('"sentinel.getTaskPollSnapshot"');
    expect(syncContract).toContain('"sync.adoptLegacySettings"');
    expect(syncContract).toContain('"sync.getSettings"');
    expect(syncContract).toContain('"sync.run"');
    expect(syncContract).toContain('"sync.saveSettings"');
    expect(contract).not.toContain('"sync.applyRemoteSegment"');
    expect(dispatcher).not.toContain('"sync.applyRemoteSegment"');
    expect(contract).not.toMatch(/\b(sql|statements)\s*[?:]/i);
    expect(dispatcher).toContain("assertActiveLocalLibrary");
    expect(dispatcher).toContain("withMainDatabaseTransaction");
  });

  it("binds main-process transaction outputs to the command contract", () => {
    const runtime = source("electron/main/data-command-runtime.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const tagCommands = source("electron/main/library-tag-commands.ts");
    const collectionCommands = source("electron/main/library-collection-commands.ts");
    const savedSearchCommands = source("electron/main/saved-search-commands.ts");
    const sentinelCommands = source("electron/main/sentinel-commands.ts");
    const sentinelReadCommands = source("electron/main/sentinel-read-commands.ts");
    const projectCommands = source("electron/main/research-project-commands.ts");
    const evidenceCommands = source("electron/main/evidence-commands.ts");
    const evidenceInboxCommands = source("electron/main/evidence-inbox-commands.ts");
    const knowledgeCommands = source("electron/main/knowledge-commands.ts");
    const libraryPageCommands = source("electron/main/library-page-commands.ts");
    const libraryShellCommands = source("electron/main/library-shell-commands.ts");
    const readerCommands = source("electron/main/reader-commands.ts");
    const savedSearchContract = source("electron/saved-search-command-contract.ts");
    const canvasPageCommands = source("electron/main/canvas-page-commands.ts");
    const canvasWorkspaceCommands = source("electron/main/canvas-workspace-commands.ts");
    const citationGraphCommands = source("electron/main/citation-graph-commands.ts");
    const citationGraphScope = source("electron/main/library-scope-token.ts");

    expect(runtime).toContain("DataCommandOutput<NoInfer<K>>");
    expect(dispatcher).not.toContain("): Promise<unknown>");
    expect(tagCommands).not.toContain("): Promise<unknown>");
    expect(collectionCommands).not.toContain("): Promise<unknown>");
    expect(savedSearchCommands).not.toContain("): Promise<unknown>");
    expect(sentinelCommands).not.toContain("): Promise<unknown>");
    expect(sentinelReadCommands).not.toContain("): Promise<unknown>");
    expect(projectCommands).not.toContain("): Promise<unknown>");
    expect(evidenceCommands).not.toContain("): Promise<unknown>");
    expect(evidenceInboxCommands).not.toContain("): Promise<unknown>");
    expect(knowledgeCommands).not.toContain("): Promise<unknown>");
    expect(libraryPageCommands).not.toContain("): Promise<unknown>");
    expect(libraryShellCommands).not.toContain("): Promise<unknown>");
    expect(readerCommands).not.toContain("): Promise<unknown>");
    expect(canvasPageCommands).not.toContain("): Promise<unknown>");
    expect(canvasWorkspaceCommands).not.toContain("): Promise<unknown>");
    expect(citationGraphCommands).not.toContain("): Promise<unknown>");
    expect(savedSearchContract).toContain("SavedSearchDataCommandMap");
    expect(canvasPageCommands).toContain("LIMIT ?");
    expect(canvasPageCommands).toContain("MAX_CANVAS_CITATION_RELATIONS + 1");
    expect(canvasPageCommands).toContain("INSERT OR IGNORE INTO citations");
    expect(canvasPageCommands).toContain("citing.library_id = ?");
    expect(canvasPageCommands).toContain("cited.library_id = ?");
    expect(canvasPageCommands).toContain("executeCanvasPageMutation");
    expect(canvasWorkspaceCommands).toContain("new CanvasRepo");
    expect(canvasWorkspaceCommands).toContain("executeCanvasWorkspaceMutation");
    expect(citationGraphCommands).toContain("assertActiveLibraryScopeToken");
    expect(citationGraphScope).toContain("assertActiveLocalLibrary");
    expect(citationGraphCommands).toContain("executeCitationGraphCacheMutation");
    expect(sentinelReadCommands).toContain("requireLocalLibraryId");
    expect(sentinelReadCommands).toContain("assertActiveLocalLibrary");
    expect(sentinelReadCommands).toContain("describeSafeError");
    expect(sentinelReadCommands).toContain("MAX_SENTINEL_PAGE_EVENTS + 1");
  });

  it("routes every raw database IPC method through the connection coordinator", () => {
    const mainDatabase = source("electron/main/db.ts");
    const handlerSection = mainDatabase.slice(mainDatabase.indexOf("registerSmokeDbHandlers"));

    expect(handlerSection.match(/getMainDatabaseCoordinator\(\)/g)).toHaveLength(4);
    expect(handlerSection).not.toContain("getMainDb()).");
  });
});
