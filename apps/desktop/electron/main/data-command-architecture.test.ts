import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeDataCommandOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.transaction("library.createCollection", async () => ({
    collectionId: "collection-id",
  }));
  // @ts-expect-error createCollection must return its declared collection result.
  void dependencies.transaction("library.createCollection", async () => ({
    updated: 1,
  }));
}

void assertCompileTimeDataCommandOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("main-process data command architecture", () => {
  it("keeps Library work mutations behind the typed service gateway", () => {
    const libraryPage = source("src/pages/LibraryPage.tsx");
    const gateway = source("src/services/library-work-actions.ts");
    const commandNames = [
      "library.mergeWorks",
      "library.purgeDeletedWorks",
      "library.restoreWorks",
      "library.setWorkReadingStatus",
      "library.setWorkStarred",
      "library.trashWorks",
    ];

    for (const commandName of commandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
    }
    expect(libraryPage).not.toContain("data.command(");
    expect(libraryPage).not.toContain("getLibraryDb");
    expect(libraryPage).not.toContain("WorksRepo");
    expect(libraryPage).not.toContain(".mergeInto(");
    expect(libraryPage).not.toContain(".purgeDeleted(");
    expect(libraryPage).not.toContain(".purgeDeletedMany(");
  });

  it("keeps Library page reads behind a scoped data service", () => {
    const libraryPage = source("src/pages/LibraryPage.tsx");
    const dataService = source("src/services/library-page-data.ts");

    expect(libraryPage).toContain("loadLibraryPageData");
    expect(libraryPage).toContain("loadLibraryWorkRuntimeMeta");
    expect(libraryPage).not.toContain("getLibraryDb");
    expect(libraryPage).not.toContain(".query<");
    expect(libraryPage).not.toContain("citationCountsForWorks");
    expect(dataService).toContain("getLibraryDb");
    expect(dataService).toContain("citationCountsForWorks");
  });

  it("keeps App Shell reads behind a scoped data service", () => {
    const appShell = source("src/App.tsx");
    const dataService = source("src/services/app-shell-data.ts");

    expect(appShell).toContain("loadLibraryShellStats");
    expect(appShell).not.toContain("getLibraryDb");
    expect(appShell).not.toContain("services/aura-db");
    expect(appShell).not.toMatch(
      /\b(?:db|database)\s*\.\s*(?:query|queryScalar|run|exec|prepare)\b/,
    );
    expect(appShell).not.toContain("window.aura.db");
    expect(appShell).not.toContain("@aurascholar/db/repos/");
    expect(appShell).not.toMatch(/\bnew\s+(?:[A-Za-z_$][\w$]*\.)?[A-Za-z_$][\w$]*Repo\s*\(/);
    expect(dataService).toContain("getLibraryDb");
    expect(dataService).toContain("libraryId");
  });

  it("keeps migrated backup and sync transactions out of renderer SQL IPC", () => {
    const syncService = source("src/services/sync.ts");
    const sharedBackup = source("src/shared/library-backup.ts");

    expect(syncService).toContain('data.command("library.importBackup"');
    expect(syncService).toContain('data.command("sync.applyRemoteSegment"');
    for (const rendererSource of [syncService, sharedBackup]) {
      expect(rendererSource).not.toMatch(
        /\.exec\(\s*["'`](?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
      );
    }
  });

  it("keeps Library organization writes behind the typed service gateway", () => {
    const libraryPage = source("src/pages/LibraryPage.tsx");
    const gateway = source("src/services/library-organization.ts");
    const commandNames = [
      "library.addTagToWorks",
      "library.createCollection",
      "library.createTag",
      "library.deleteCollection",
      "library.deleteTag",
      "library.moveCollection",
      "library.renameCollection",
      "library.renameTag",
      "library.restoreCollection",
      "library.restoreTag",
      "library.setTagColor",
      "library.setWorksCollection",
    ];

    expect(libraryPage).not.toContain("CollectionsRepo");
    expect(libraryPage).not.toContain("TagsRepo");
    expect(libraryPage).not.toContain("@aurascholar/db/repos/collections");
    expect(libraryPage).not.toContain("@aurascholar/db/repos/tags");
    for (const commandName of commandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
    }
  });

  it("keeps Sentinel mutations behind the typed service and main-process command boundary", () => {
    const sentinelPage = source("src/pages/SentinelPage.tsx");
    const gateway = source("src/services/sentinel-page-data.ts");
    const pollingService = source("src/services/sentinel.ts");
    const commands = source("electron/main/sentinel-commands.ts");
    const pageCommandNames = [
      "sentinel.createOrRestore",
      "sentinel.delete",
      "sentinel.restore",
      "sentinel.setStatus",
    ];

    for (const commandName of pageCommandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
    }
    for (const commandName of ["sentinel.linkWork", "sentinel.recordCheck"]) {
      expect(pollingService).toContain(`data.command("${commandName}"`);
    }
    expect(sentinelPage).not.toContain("data.command(");
    expect(sentinelPage).not.toContain("getLibraryDb");
    expect(sentinelPage).not.toContain("SentinelRepo");
    expect(commands).toContain("assertActiveLocalLibrary");
    expect(commands).toContain("new SentinelRepo");
  });

  it("keeps Saved Search writes behind typed, network-free main-process commands", () => {
    const discoveryPage = source("src/pages/DiscoveryPage.tsx");
    const gateway = source("src/services/saved-searches.ts");
    const commands = source("electron/main/saved-search-commands.ts");
    const commandNames = [
      "savedSearch.clearNew",
      "savedSearch.create",
      "savedSearch.delete",
      "savedSearch.recordError",
      "savedSearch.recordRun",
      "savedSearch.restore",
    ];

    for (const commandName of commandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
    }
    expect(discoveryPage).not.toContain("data.command(");
    expect(discoveryPage).not.toContain("SavedSearchesRepo");
    expect(commands).toContain("assertActiveLocalLibrary");
    expect(commands).toContain("commitRunIfCurrent");
    expect(commands).toContain("recordErrorIfCurrent");
    expect(commands).not.toContain("searchDiscoveryDetailed");
    expect(commands).not.toContain("auraHttp");
    expect(commands).not.toMatch(/\bfetch\s*\(/);
  });

  it("keeps Saved Search UI workflows inside the Discovery feature controller", () => {
    const discoveryPage = source("src/pages/DiscoveryPage.tsx");
    const controller = source("src/features/discovery/discovery-saved-search-controller.ts");
    const hook = source("src/features/discovery/useDiscoverySavedSearchController.ts");
    const workflowFunctions = [
      "clearSavedSearchBadge",
      "createSavedSearch",
      "deleteSavedSearch",
      "listSavedSearches",
      "restoreSavedSearch",
      "runSavedSearch",
    ];
    const smokeFlags = [
      "__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_DELETE_SEARCH__",
      "__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SEARCH__",
      "__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SAVE_SEARCH__",
    ];
    const controllerWorkflows = ["check", "open", "refresh", "remove", "save", "undoDelete"];
    const updateEvent = "aurascholar:saved-searches-updated";

    expect(discoveryPage).toContain("useDiscoverySavedSearchController");
    expect(hook).toContain("createDiscoverySavedSearchController");
    expect(controller).toContain("class DiscoverySavedSearchController");
    for (const workflow of controllerWorkflows) {
      expect(controller).toMatch(new RegExp(`\\basync\\s+${workflow}\\s*\\(`));
    }
    for (const workflowFunction of workflowFunctions) {
      expect(discoveryPage).not.toMatch(new RegExp(`\\b${workflowFunction}\\b`));
      expect(hook).toMatch(new RegExp(`\\b${workflowFunction}\\b`));
    }
    for (const smokeFlag of smokeFlags) {
      expect(discoveryPage).not.toContain(smokeFlag);
      expect(hook).toContain(smokeFlag);
    }
    expect(discoveryPage).not.toContain(updateEvent);
    expect(hook).toContain(updateEvent);
  });

  it("keeps Canvas and Citation Graph reads behind scoped data services", () => {
    const canvasPage = source("src/pages/SpatialCanvasPage.tsx");
    const canvasGateway = source("src/services/canvas-page-data.ts");
    const citationGraph = source("src/components/CitationGraphView.tsx");
    const citationGateway = source("src/services/citation-graph-page-data.ts");
    const router = source("src/main.tsx");
    const libraryBackup = source("src/shared/library-backup.ts");
    const syncStorage = source("src/shared/sqlite-sync-storage.ts");

    for (const renderer of [canvasPage, citationGraph]) {
      expect(renderer).not.toContain("getLibraryDb");
      expect(renderer).not.toContain("services/aura-db");
      expect(renderer).not.toMatch(/\.\s*(?:query|run|exec|queryScalar)\s*(?:<[^;{}]*>)?\s*\(/);
      expect(renderer).not.toMatch(/\bnew\s+[A-Za-z_$][\w$]*Repo\s*\(/);
    }
    expect(canvasPage).toContain("loadCanvasAnnotationIngressSource");
    expect(canvasPage).toContain("loadCanvasActiveWork");
    expect(canvasGateway).toContain("getLibraryDb");
    expect(canvasGateway).toContain("libraryId");
    expect(citationGraph).toContain("loadCitationGraphPageSnapshot");
    expect(citationGateway).toContain("getLibraryDb");
    expect(citationGateway).toContain("libraryId");

    expect(existsSync(resolve(process.cwd(), "src/pages/FlashcardsPage.tsx"))).toBe(false);
    expect(router).toContain('{ path: "flashcards", element: <Navigate to="/canvas" replace /> }');
    for (const legacyTable of ["flashcards", "flashcard_srs", "flashcard_reviews"]) {
      expect(libraryBackup).toContain(`"${legacyTable}"`);
    }
    expect(syncStorage).toContain("flashcards: [");
    expect(syncStorage).toContain('table === "annotations" || table === "flashcards"');
  });

  it("keeps Library collection workflows inside the feature controller", () => {
    const appShell = source("src/App.tsx");
    const libraryPage = source("src/pages/LibraryPage.tsx");
    const controller = source("src/features/library/useLibraryCollectionController.ts");
    const collectionMutations = [
      "createLibraryCollection",
      "deleteLibraryCollection",
      "moveLibraryCollection",
      "renameLibraryCollection",
      "restoreLibraryCollection",
    ];
    const collectionSmokeFlags = [
      "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__",
      "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__",
      "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__",
      "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__",
    ];

    for (const mutation of collectionMutations) {
      expect(libraryPage).not.toContain(mutation);
      expect(controller).toContain(mutation);
      expect(controller).toMatch(new RegExp(`\\b${mutation}\\s*\\(`));
    }
    for (const smokeFlag of collectionSmokeFlags) {
      expect(libraryPage).not.toContain(smokeFlag);
      expect(controller).toContain(smokeFlag);
    }
    expect(appShell).toContain("LIBRARY_COLLECTION_EVENTS");
    for (const eventName of [
      "aurascholar:create-collection",
      "aurascholar:delete-collection",
      "aurascholar:manage-collections",
      "aurascholar:move-collection",
      "aurascholar:rename-collection",
    ]) {
      expect(appShell).not.toContain(`"${eventName}"`);
    }
  });

  it("keeps durable data commands on a typed allowlist", () => {
    const contract = source("electron/data-command-contract.ts");
    const dispatcher = source("electron/main/data-commands.ts");

    expect(contract).toContain('"library.importBackup"');
    expect(contract).toContain('"library.mergeWorks"');
    expect(contract).toContain('"library.purgeDeletedWorks"');
    expect(contract).toContain('"sync.applyRemoteSegment"');
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

    expect(runtime).toContain("DataCommandOutput<NoInfer<K>>");
    expect(dispatcher).not.toContain("): Promise<unknown>");
    expect(tagCommands).not.toContain("): Promise<unknown>");
    expect(collectionCommands).not.toContain("): Promise<unknown>");
    expect(savedSearchCommands).not.toContain("): Promise<unknown>");
    expect(sentinelCommands).not.toContain("): Promise<unknown>");
  });

  it("routes every raw database IPC method through the connection coordinator", () => {
    const mainDatabase = source("electron/main/db.ts");
    const handlerSection = mainDatabase.slice(mainDatabase.indexOf("registerDbHandlers"));

    expect(handlerSection.match(/getMainDatabaseCoordinator\(\)/g)).toHaveLength(4);
    expect(handlerSection).not.toContain("getMainDb()).");
  });

  it("keeps the typed command contract, runtime dispatcher, and main registration in lockstep", () => {
    const contract = source("electron/data-command-contract.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const main = source("electron/main.ts");

    const contractNames = [...contract.matchAll(/^\s*"([^"]+)":\s*\{/gm)]
      .map((match) => match[1])
      .sort();
    const dispatchedNames = [...dispatcher.matchAll(/^\s*case "([^"]+)":/gm)]
      .map((match) => match[1])
      .sort();

    expect(dispatchedNames).toEqual(contractNames);
    for (const commandName of contractNames) {
      expect(dispatcher).toContain(`value.name !== "${commandName}"`);
    }
    expect(main.match(/registerDataCommandHandlers\(\);/g)).toHaveLength(1);
  });
});
