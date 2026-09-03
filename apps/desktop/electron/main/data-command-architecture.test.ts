import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeDataCommandOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("ai.getFlashcardTarget", async () => ({ active: true }));
  // @ts-expect-error ai.getFlashcardTarget must return its active-target envelope.
  void dependencies.execute?.("ai.getFlashcardTarget", async () => ({ recorded: true }));
  void dependencies.execute?.("ai.commitFlashcardGeneration", async () => ({ created: 6 }));
  // @ts-expect-error ai.commitFlashcardGeneration must return its created-card count.
  void dependencies.execute?.("ai.commitFlashcardGeneration", async () => ({ active: true }));
  void dependencies.execute?.("ai.recordFlashcardFailure", async () => ({ recorded: true }));
  // @ts-expect-error ai.recordFlashcardFailure must return its error-record outcome.
  void dependencies.execute?.("ai.recordFlashcardFailure", async () => ({ created: 1 }));
  void dependencies.execute?.("knowledge.getContentStats", async () => ({
    stats: {
      totalContentUnits: 0,
      readyContentUnits: 0,
      contextOnlyContentUnits: 0,
      sourceCounts: { pdf: 0, annotation: 0, evidence: 0 },
      languageCoverage: { zh: 0, en: 0, other: 0, missing: 0 },
    },
    scope: { libraryId: "library-id", scopeToken: "scope-token" },
  }));
  // @ts-expect-error knowledge.getContentStats must return its declared result envelope.
  void dependencies.execute?.("knowledge.getContentStats", async () => ({ stats: [] }));
  void dependencies.execute?.("knowledge.searchContent", async () => ({
    results: [],
    retrieval: { mode: "fulltext", semanticStatus: "not-configured" },
    scope: { libraryId: "library-id", scopeToken: "scope-token" },
  }));
  // @ts-expect-error knowledge.searchContent must return its declared result envelope.
  void dependencies.execute?.("knowledge.searchContent", async () => ({ results: 1 }));
  void dependencies.execute?.("project.get", async () => ({ project: null }));
  // @ts-expect-error project.get must return its declared Project result.
  void dependencies.execute?.("project.get", async () => ({ updated: 1 }));
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
  // @ts-expect-error library.getPage must return its declared page DTO.
  void dependencies.execute?.("library.getPage", async () => ({ works: [] }));
  void dependencies.execute?.("library.getWorkInspectorDetail", async () => ({ detail: null }));
  // @ts-expect-error library.getWorkInspectorDetail must return its detail envelope.
  void dependencies.execute?.("library.getWorkInspectorDetail", async () => ({ work: null }));
  void dependencies.execute?.("library.getScope", async () => ({
    libraryId: "library-id",
    scopeToken: "scope-token",
  }));
  // @ts-expect-error library.getScope must return the local Library id.
  void dependencies.execute?.("library.getScope", async () => ({}));
  void dependencies.execute?.("library.getShellStats", async () => ({
    annotations: 0,
    canvasNodes: 0,
    collections: [],
    snippets: 0,
    total: 0,
    trash: 0,
  }));
  // @ts-expect-error library.getShellStats must return its complete snapshot.
  void dependencies.execute?.("library.getShellStats", async () => ({ total: 0 }));
  void dependencies.execute?.("library.listTags", async () => ({ tags: [] }));
  // @ts-expect-error library.listTags must return its result envelope.
  void dependencies.execute?.("library.listTags", async () => ({ tags: [{ id: "tag-id" }] }));
  void dependencies.execute?.("reader.getWorkPdfCandidates", async () => ({
    pdfAttachments: [],
    work: null,
  }));
  // @ts-expect-error reader.getWorkPdfCandidates must preserve its full result envelope.
  void dependencies.execute?.("reader.getWorkPdfCandidates", async () => ({ work: null }));
  void dependencies.execute?.("reader.getAttachment", async () => ({ attachment: null }));
  // @ts-expect-error reader.getAttachment must return its attachment envelope.
  void dependencies.execute?.("reader.getAttachment", async () => ({
    attachmentId: "attachment-id",
  }));
  void dependencies.execute?.("reader.readAttachmentPdf", async () => ({
    data: new Uint8Array(),
  }));
  // @ts-expect-error reader.readAttachmentPdf must return its byte envelope.
  void dependencies.execute?.("reader.readAttachmentPdf", async () => ({ data: "bytes" }));
  void dependencies.execute?.("reader.listAnnotations", async () => ({ annotations: [] }));
  // @ts-expect-error reader.listAnnotations must return its annotations envelope.
  void dependencies.execute?.("reader.listAnnotations", async () => ({ annotations: null }));
  void dependencies.transaction("reader.createAnnotation", async () => ({
    annotationId: "annotation-id",
  }));
  // @ts-expect-error reader.createAnnotation must return its created annotation id.
  void dependencies.transaction("reader.createAnnotation", async () => ({ updated: 1 }));
  void dependencies.transaction("reader.deleteAnnotation", async () => ({ updated: 1 }));
  // @ts-expect-error reader.deleteAnnotation must return its mutation envelope.
  void dependencies.transaction("reader.deleteAnnotation", async () => ({ deleted: true }));
  void dependencies.transaction("reader.restoreAnnotation", async () => ({ updated: 1 }));
  // @ts-expect-error reader.restoreAnnotation must return its mutation envelope.
  void dependencies.transaction("reader.restoreAnnotation", async () => ({ restored: true }));
  void dependencies.transaction("reader.updateAnnotationContent", async () => ({ updated: 1 }));
  // @ts-expect-error reader.updateAnnotationContent must return its mutation envelope.
  void dependencies.transaction("reader.updateAnnotationContent", async () => ({
    contentMd: "updated",
  }));
  void dependencies.transaction("reader.markWorkReadingStarted", async () => ({ started: true }));
  // @ts-expect-error reader.markWorkReadingStarted must return its conditional outcome.
  void dependencies.transaction("reader.markWorkReadingStarted", async () => ({ updated: 1 }));
  void dependencies.transaction("library.restoreAnnotationsForAttachment", async () => ({
    restoredAnnotationCount: 0,
  }));
  // @ts-expect-error annotation recovery must return its restored count.
  void dependencies.transaction("library.restoreAnnotationsForAttachment", async () => ({
    updated: 1,
  }));
  void dependencies.execute?.("canvas.getActiveWork", async () => ({ work: null }));
  // @ts-expect-error canvas.getActiveWork must return its work envelope.
  void dependencies.execute?.("canvas.getActiveWork", async () => ({ source: null }));
  void dependencies.execute?.("canvas.getAnnotationIngressSource", async () => ({ source: null }));
  // @ts-expect-error canvas.getAnnotationIngressSource must return its source envelope.
  void dependencies.execute?.("canvas.getAnnotationIngressSource", async () => ({ work: null }));
  void dependencies.execute?.("canvas.getCitationRelations", async () => ({
    relations: [],
    scope: { libraryId: "library-id", scopeToken: "scope-token" },
  }));
  // @ts-expect-error canvas.getCitationRelations must return its relation envelope.
  void dependencies.execute?.("canvas.getCitationRelations", async () => ({ persisted: 0 }));
  void dependencies.transaction("canvas.persistCitationRelations", async () => ({
    persisted: 0,
    provider: "openalex",
    scope: { libraryId: "library-id", scopeToken: "scope-token" },
  }));
  // @ts-expect-error canvas.persistCitationRelations must return its persisted count.
  void dependencies.transaction("canvas.persistCitationRelations", async () => ({ relations: [] }));
  void dependencies.execute?.("canvas.loadWorkspace", async () => ({ workspace: null }));
  // @ts-expect-error canvas.loadWorkspace must return its workspace envelope.
  void dependencies.execute?.("canvas.loadWorkspace", async () => ({ workspaceId: "canvas-id" }));
  void dependencies.transaction("canvas.saveWorkspace", async () => ({ saved: true }));
  // @ts-expect-error canvas.saveWorkspace must return its persisted outcome.
  void dependencies.transaction("canvas.saveWorkspace", async () => ({ saved: false }));
  void dependencies.transaction("citationGraph.getCached", async () => ({ entry: null }));
  // @ts-expect-error citationGraph.getCached must return its cache-entry envelope.
  void dependencies.transaction("citationGraph.getCached", async () => ({ graph: null }));
  void dependencies.transaction("citationGraph.putCached", async () => ({ stored: true }));
  // @ts-expect-error citationGraph.putCached must return its storage outcome.
  void dependencies.transaction("citationGraph.putCached", async () => ({ entry: null }));
  void dependencies.execute?.("citationGraph.getActiveLibraryDois", async () => ({
    dois: [],
    scope: { libraryId: "library-id", scopeToken: "scope-token" },
  }));
  // @ts-expect-error citationGraph.getActiveLibraryDois must return its Library-scoped result.
  void dependencies.execute?.("citationGraph.getActiveLibraryDois", async () => ({ dois: [] }));
  void dependencies.execute?.("sentinel.getPageSnapshot", async () => ({ events: [], tasks: [] }));
  // @ts-expect-error sentinel.getPageSnapshot must return its complete page snapshot.
  void dependencies.execute?.("sentinel.getPageSnapshot", async () => ({ tasks: [] }));
  void dependencies.execute?.("sentinel.getEventEvidence", async () => ({
    evidenceJson: null,
    status: "none",
  }));
  // @ts-expect-error sentinel.getEventEvidence must return its evidence status.
  void dependencies.execute?.("sentinel.getEventEvidence", async () => ({ evidenceJson: null }));
  void dependencies.execute?.("sentinel.getDuePollSnapshot", async () => ({
    libraryId: "library-id",
    tasks: [],
  }));
  // @ts-expect-error sentinel.getDuePollSnapshot must return its scoped polling snapshot.
  void dependencies.execute?.("sentinel.getDuePollSnapshot", async () => ({ tasks: [] }));
  void dependencies.execute?.("sentinel.getTaskPollSnapshot", async () => ({
    libraryId: "library-id",
    reachedStates: [],
    task: null,
  }));
  // @ts-expect-error sentinel.getTaskPollSnapshot must return its complete polling snapshot.
  void dependencies.execute?.("sentinel.getTaskPollSnapshot", async () => ({
    libraryId: "library-id",
    task: null,
  }));
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
    const scopeGateway = source("src/services/library-command-scope.ts");
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
    expect(gateway).toContain("getActiveLibraryCommandScope");
    expect(gateway).not.toContain("getLibraryDb");
    expect(gateway).not.toContain("aura-db");
    expect(scopeGateway).toContain('data.command("library.getScope"');
    expect(scopeGateway).not.toContain("getLibraryDb");
    expect(scopeGateway).not.toContain("aura-db");
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
    expect(dataService).toContain('data.command("library.getPage"');
    expect(dataService).toContain('data.command("library.getWorkRuntimeMeta"');
    expect(dataService).not.toContain("getLibraryDb");
    expect(dataService).not.toContain("aura-db");
    expect(dataService).not.toContain("citationCountsForWorks");
    expect(dataService).not.toContain("queryWorkPage");
    expect(dataService).not.toMatch(/\b(?:db|database)\s*\.\s*query\b/);
  });

  it("keeps Reader metadata reads and writes behind scoped typed commands and leaves bytes on the file bridge", () => {
    const readerSession = source("src/features/reader/library-reader-session.ts");
    const readerData = source("src/services/reader-session-data.ts");
    const pdfData = source("src/services/library-read.ts");
    const readerCommands = source("electron/main/reader-commands.ts");
    const readerMetadataQueries = source("electron/main/reader-metadata-queries.ts");
    const commandNames = [
      "reader.getAttachment",
      "reader.getWorkPdfCandidates",
      "reader.listAnnotations",
      "reader.readAttachmentPdf",
    ];
    const mutationCommandNames = [
      "reader.createAnnotation",
      "reader.deleteAnnotation",
      "reader.restoreAnnotation",
      "reader.updateAnnotationContent",
      "reader.markWorkReadingStarted",
    ];

    for (const commandName of [...commandNames, ...mutationCommandNames]) {
      expect(readerData).toContain(`data.command("${commandName}"`);
    }
    for (const rendererSource of [readerData, pdfData]) {
      expect(rendererSource).not.toContain("getLibraryDb");
      expect(rendererSource).not.toContain("aura-db");
      expect(rendererSource).not.toContain("AttachmentsRepo");
      expect(rendererSource).not.toMatch(/\b(?:db|database)\s*\.\s*query\b/);
    }
    expect(pdfData).toContain("loadReaderAttachmentPdf");
    expect(pdfData).not.toContain("auraFiles");
    expect(pdfData).toContain("loadPdfFromCandidates");
    expect(readerSession).toContain("loadReaderWorkPdfCandidates");
    expect(readerSession).toContain("loadReaderAttachment");
    expect(readerSession).toContain("loadReaderAnnotations");
    expect(readerSession).toContain("createReaderAnnotation");
    expect(readerSession).toContain("deleteReaderAnnotation");
    expect(readerSession).toContain("restoreReaderAnnotation");
    expect(readerSession).toContain("updateReaderAnnotationContent");
    expect(readerSession).toContain("markReaderWorkReadingStarted");
    expect(readerSession).not.toContain("listAttachments:");
    expect(readerSession).not.toContain("new AttachmentsRepo");
    expect(readerSession).not.toContain("new AnnotationsRepo");
    expect(readerSession).not.toContain("new WorksRepo");
    expect(readerSession).not.toContain("getLibraryDb");
    expect(readerSession).not.toContain("aura-db");
    expect(readerCommands).toContain("requireLocalLibraryId");
    expect(readerCommands).toContain("assertActiveLocalLibrary");
    expect(readerCommands).toContain("new WorksRepo");
    expect(readerCommands).toContain("new AnnotationsRepo");
    expect(readerCommands).toContain("loadReaderPdfAttachments");
    expect(readerCommands).toContain("findActiveReaderPdfAttachmentForWork");
    expect(readerCommands).not.toContain("new AttachmentsRepo");
    expect(readerMetadataQueries).toContain("loadReaderPdfAttachments");
    expect(readerMetadataQueries).toContain("findActiveReaderAttachmentForWork");
    expect(readerMetadataQueries).toContain("findActiveReaderPdfAttachmentForWork");
    expect(readerMetadataQueries).toContain("loadReaderAnnotations");
    for (const commandName of mutationCommandNames) {
      expect(readerCommands).toContain(commandName);
    }
  });

  it("keeps Library refresh and work lifecycle coordination inside feature primitives", () => {
    const libraryPage = source("src/pages/LibraryPage.tsx");
    const refreshController = source("src/features/library/library-refresh-controller.ts");
    const refreshHook = source("src/features/library/useLibraryRefreshController.ts");
    const lifecycleModel = source("src/features/library/library-work-lifecycle-model.ts");
    const noticeLifecycle = source("src/features/library/library-notice-lifecycle.ts");
    const noticeHook = source("src/features/library/useLibraryNoticeLifecycle.ts");
    const browseHook = source("src/features/library/useLibraryBrowseState.ts");
    const workspaceState = source("src/features/library/library-workspace-state.ts");

    expect(libraryPage).toContain("useLibraryRefreshController");
    expect(libraryPage).not.toContain("refreshSeqRef");
    expect(libraryPage).toContain("useLibraryBrowseState");
    expect(browseHook).toContain("searchRef.current = value");
    expect(browseHook).toContain("activeCollectionRef.current = value");
    expect(browseHook).toContain("activeFilterRef.current = value");
    expect(refreshController).toContain("class LibraryRefreshController");
    expect(refreshController).toContain("batch.latestQuery = currentQuery");
    expect(refreshController).toContain("batch.dirty = true");
    expect(refreshHook).toContain("controller.start()");
    expect(refreshHook).toContain("controller.stop()");
    expect(refreshHook).toContain("controller.updateDependencies(dependencies)");
    expect(refreshHook).not.toContain("dependenciesRef");
    expect(libraryPage).toContain("cancelCurrentRouteRequest");
    expect(browseHook).toContain("resolveActiveLibraryRouteRequest");
    expect(browseHook).not.toContain("../services/");
    expect(browseHook).not.toContain("window.");
    expect(workspaceState).toContain("libraryRouteRefreshDisposition");

    expect(libraryPage).toContain("new MutationLease<LibraryWorkAction>()");
    expect(libraryPage).toContain("scopeSelectedIds(");
    expect(libraryPage).toContain("selectedIds,");
    expect(libraryPage).toContain("reconcileTrashUndo(current, workIds)");
    expect(libraryPage).not.toContain("Array.from(selectedIds)");
    expect(libraryPage).toContain("message ?? trashUndo?.message ?? null");
    expect(libraryPage).toContain("useLibraryNoticeLifecycle");
    expect(libraryPage).toContain(
      "persistent: Boolean(trashUndo && message === trashUndo.message)",
    );
    expect(libraryPage).not.toContain("setMessageLeaving");
    expect(noticeLifecycle).toContain("class LibraryNoticeLifecycleController");
    expect(noticeLifecycle).toContain("reduceLibraryNoticeState");
    expect(noticeLifecycle).toContain("this.generation === generation");
    expect(noticeLifecycle).not.toContain('from "../../components/InlineNotice"');
    expect(noticeHook).toContain("controller.update({");
    expect(noticeHook).toContain("controller.dispose()");

    for (const pureFeatureSource of [
      refreshController,
      lifecycleModel,
      noticeLifecycle,
      workspaceState,
    ]) {
      expect(pureFeatureSource).not.toContain("../services/");
      expect(pureFeatureSource).not.toContain("window.");
      expect(pureFeatureSource).not.toContain('from "react"');
    }
  });

  it("keeps the Library inspector presentation outside the page coordinator", () => {
    const libraryPage = source("src/pages/LibraryPage.tsx");
    const selectedWorkPanel = source("src/features/library/LibrarySelectedWorkPanel.tsx");
    const selectedWorkSections = source("src/features/library/LibrarySelectedWorkSections.tsx");
    const workDisplay = source("src/features/library/library-work-display.ts");

    expect(libraryPage).toContain("<LibrarySelectedWorkPanel");
    expect(libraryPage).not.toContain("function SelectedWorkPanel");
    expect(libraryPage).not.toContain("function NotesPanel");
    expect(libraryPage).not.toContain("function CitationMiniGraph");
    expect(selectedWorkPanel).toContain("export function LibrarySelectedWorkPanel");
    expect(selectedWorkPanel).not.toContain("useEffect");

    for (const presentationSource of [selectedWorkPanel, selectedWorkSections]) {
      expect(presentationSource).not.toContain("useNavigate");
      expect(presentationSource).not.toContain("window.");
      expect(presentationSource).not.toContain("data.command(");
      expect(presentationSource).not.toContain("getLibraryDb");
    }
    expect(workDisplay).not.toContain('from "react"');
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
    expect(dataService).toContain('data.command("library.getShellStats"');
    expect(dataService).not.toContain("getLibraryDb");
    expect(dataService).not.toContain("aura-db");
    expect(dataService).not.toMatch(/\b(?:db|database)\s*\.\s*query\b/);
  });

  it("keeps migrated backup and sync transactions out of renderer SQL IPC", () => {
    const syncService = source("src/services/sync.ts");
    const sharedBackup = source("src/shared/library-backup.ts");

    expect(syncService).toContain('data.command("library.exportBackup"');
    expect(syncService).toContain('data.command("library.importBackup"');
    expect(syncService).toContain('data.command("sync.adoptLegacySettings"');
    expect(syncService).toContain('data.command("sync.getSettings"');
    expect(syncService).toContain('data.command("sync.run", {})');
    expect(syncService).toContain('data.command("sync.saveSettings"');
    expect(syncService).not.toContain("sync.applyRemoteSegment");
    expect(syncService).not.toContain("getDb");
    expect(syncService).not.toContain("auraHttp");
    expect(syncService).not.toContain("SqliteSyncStorage");
    for (const rendererSource of [syncService, sharedBackup]) {
      expect(rendererSource).not.toMatch(
        /\.exec\(\s*["'`](?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
      );
    }
  });

  it("keeps Library organization reads and writes behind the typed service gateway", () => {
    const libraryPage = source("src/pages/LibraryPage.tsx");
    const gateway = source("src/services/library-organization.ts");
    const scopeGateway = source("src/services/library-command-scope.ts");
    const commandNames = [
      "library.addTagToWorks",
      "library.createCollection",
      "library.createTag",
      "library.deleteCollection",
      "library.deleteTag",
      "library.listTags",
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
    expect(gateway).toContain("getActiveLibraryCommandScope");
    expect(scopeGateway).toContain('data.command("library.getScope"');
    expect(gateway).not.toContain("getLibraryDb");
    expect(gateway).not.toContain("aura-db");
    expect(gateway).not.toContain("TagsRepo");
  });

  it("keeps Saved Search reads and writes behind typed, network-free main-process commands", () => {
    const discoveryPage = source("src/pages/DiscoveryPage.tsx");
    const gateway = source("src/services/saved-search-runtime.ts");
    const model = source("src/services/saved-search-model.ts");
    const serviceContract = source("src/services/saved-search-service-contract.ts");
    const contract = source("electron/saved-search-command-contract.ts");
    const commands = source("electron/main/saved-search-commands.ts");
    const commandNames = [
      "savedSearch.clearNew",
      "savedSearch.create",
      "savedSearch.delete",
      "savedSearch.get",
      "savedSearch.getScope",
      "savedSearch.list",
      "savedSearch.listDue",
      "savedSearch.recordError",
      "savedSearch.recordRun",
      "savedSearch.restore",
    ];

    for (const commandName of commandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
    }
    expect(discoveryPage).not.toContain("data.command(");
    expect(discoveryPage).not.toContain("SavedSearchesRepo");
    for (const rendererSource of [gateway, model, serviceContract]) {
      expect(rendererSource).not.toContain("getLibraryDb");
      expect(rendererSource).not.toContain("aura-db");
      expect(rendererSource).not.toContain("SavedSearchesRepo");
      expect(rendererSource).not.toContain("window.aura.db");
      expect(rendererSource).not.toMatch(
        /\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\s*\(/,
      );
    }
    expect(contract).toContain('"savedSearch.getScope"');
    expect(contract).toContain('"savedSearch.listDue"');
    expect(commands).toContain("assertActiveLocalLibrary");
    expect(commands).toContain("requireLocalLibraryId");
    expect(commands).toContain("executeSavedSearchQuery");
    expect(commands).toContain("MAX_SAVED_SEARCH_ROWS + 1");
    expect(commands).toContain("MAX_SAVED_SEARCH_OUTPUT_BYTES");
    expect(commands).toContain("[libraryId, Date.now(), MAX_SAVED_SEARCH_ROWS + 1]");
    expect(commands).toContain("commitRunIfCurrent");
    expect(commands).toContain("recordErrorIfCurrent");
    expect(commands).not.toContain("searchDiscoveryDetailed");
    expect(commands).not.toContain("auraHttp");
    expect(commands).not.toMatch(/\bfetch\s*\(/);
  });

  it("keeps Research Project reads and writes behind the typed main-process gateway", () => {
    const gateway = source("src/services/research-projects.ts");
    const desktopAdapter = source("src/services/research-project-desktop-service.ts");
    const featureService = source("src/services/research-project-service.ts");
    const commands = source("electron/main/research-project-commands.ts");
    const commandNames = [
      "project.addWorks",
      "project.create",
      "project.get",
      "project.getScope",
      "project.list",
      "project.listSources",
      "project.removeWorks",
      "project.rename",
      "project.searchLibraryWorks",
    ];

    for (const commandName of commandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
    }
    for (const rendererSource of [gateway, desktopAdapter, featureService]) {
      expect(rendererSource).not.toContain("getLibraryDb");
      expect(rendererSource).not.toContain("window.aura.db");
      expect(rendererSource).not.toContain("ResearchProjectsRepo");
      expect(rendererSource).not.toMatch(/\.\s*(?:query|run|exec|queryScalar)\s*\(/);
    }
    expect(commands).toContain("assertActiveLocalLibrary");
    expect(commands).toContain("new ResearchProjectsRepo");
    expect(commands).toContain("expectedUpdatedAt");
  });

  it("keeps grounded ContentUnit search behind its typed command gateway", () => {
    const gateway = source("src/services/knowledge-search.ts");
    const commands = source("electron/main/knowledge-commands.ts");

    expect(gateway).toContain('data.command("knowledge.searchContent"');
    expect(gateway).not.toContain("ContentUnitSearchRepo");
    expect(gateway).not.toContain("window.aura.db");
    expect(gateway).not.toMatch(/\.\s*(?:query|run|exec|queryScalar)\s*\(/);
    expect(commands).toContain("assertActiveLibraryScopeToken");
    expect(commands).toContain("new ContentUnitSearchRepo");
    expect(commands).toContain("toKnowledgeContentSearchResult");
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

  it("keeps Discovery result search lifecycle inside the feature controller", () => {
    const discoveryPage = source("src/pages/DiscoveryPage.tsx");
    const controller = source("src/features/discovery/discovery-search-controller.ts");
    const hook = source("src/features/discovery/useDiscoverySearchController.ts");

    expect(discoveryPage).toContain("useDiscoverySearchController");
    expect(discoveryPage).not.toContain("searchTokenRef");
    expect(discoveryPage).not.toContain("searchAbortRef");
    expect(discoveryPage).not.toContain("searchDiscoveryDetailed");
    expect(discoveryPage).not.toContain("setResults(");
    expect(discoveryPage).not.toContain("const [searching");
    expect(discoveryPage).not.toContain("const [loadingMore");

    expect(hook).toContain("discovery-search-controller");
    expect(hook).toContain("searchDiscoveryDetailed");
    expect(hook).toContain("useSyncExternalStore");
    expect(hook).toContain("controller.start()");
    expect(hook).toContain("controller.stop()");
    expect(controller).toContain("loadMore");
    expect(controller).toContain("AbortController");
    expect(controller).not.toContain("window.");
    expect(controller).not.toContain('from "react"');
  });

  it("keeps Discovery result import lifecycle inside the feature controller", () => {
    const discoveryPage = source("src/pages/DiscoveryPage.tsx");
    const controller = source("src/features/discovery/discovery-import-controller.ts");
    const hook = source("src/features/discovery/useDiscoveryResultImportController.ts");

    expect(discoveryPage).toContain("useDiscoveryResultImportController");
    expect(discoveryPage).not.toContain("const [importingId");
    expect(discoveryPage).not.toContain("importDiscoveryResult");

    expect(hook).toContain("discovery-import-controller");
    expect(hook).toContain("importDiscoveryResult");
    expect(hook).toContain("useSyncExternalStore");
    expect(hook).toContain("controller.start()");
    expect(hook).toContain("controller.stop()");
    expect(controller).toContain("class DiscoveryImportController");
    expect(controller).not.toContain("window.");
    expect(controller).not.toContain('from "react"');
  });

  it("keeps Canvas and Citation Graph data boundaries behind scoped services", () => {
    const canvasPage = source("src/pages/SpatialCanvasPage.tsx");
    const canvasGateway = source("src/services/canvas-page-data.ts");
    const canvasPersistence = source("src/features/canvas/persistence.ts");
    const canvasWorkspaceGateway = source("src/services/canvas-workspace-data.ts");
    const canvasCitationResolver = source("src/features/canvas/canvas-citation-resolver.ts");
    const citationGraph = source("src/components/CitationGraphView.tsx");
    const citationCacheGateway = source("src/services/citation-graph.ts");
    const citationGateway = source("src/services/citation-graph-page-data.ts");
    const router = source("src/main.tsx");
    const libraryBackup = source("src/shared/library-backup.ts");
    const syncStorage = source("src/shared/sqlite-sync-storage.ts");
    const syncScope = source("src/services/document-evidence-sync-scope.ts");

    for (const renderer of [
      canvasPage,
      canvasCitationResolver,
      canvasPersistence,
      canvasWorkspaceGateway,
      citationGraph,
      citationCacheGateway,
      citationGateway,
    ]) {
      expect(renderer).not.toContain("getLibraryDb");
      expect(renderer).not.toContain("services/aura-db");
      expect(renderer).not.toMatch(/\.\s*(?:query|run|exec|queryScalar)\s*(?:<[^;{}]*>)?\s*\(/);
      expect(renderer).not.toMatch(/\bnew\s+[A-Za-z_$][\w$]*Repo\s*\(/);
    }
    expect(canvasPage).toContain("loadCanvasAnnotationIngressSource");
    expect(canvasPage).toContain("loadCanvasActiveWork");
    expect(canvasGateway).toContain('data.command("canvas.getActiveWork"');
    expect(canvasGateway).toContain('data.command("canvas.getAnnotationIngressSource"');
    expect(canvasGateway).not.toContain("getLibraryDb");
    expect(canvasGateway).not.toContain("aura-db");
    expect(canvasGateway).not.toContain("WorksRepo");
    expect(canvasGateway).not.toMatch(/\b(?:db|database)\s*\.\s*query\b/);
    expect(canvasCitationResolver).toContain('data.command("canvas.getCitationRelations"');
    expect(canvasCitationResolver).toContain('data.command("canvas.persistCitationRelations"');
    expect(canvasCitationResolver).not.toContain("getLibraryDb");
    expect(canvasCitationResolver).not.toContain("aura-db");
    expect(canvasCitationResolver).not.toContain("citationRelationsForWorks");
    expect(canvasCitationResolver).not.toContain("Database");
    for (const commandName of [
      "canvas.listWorkspaces",
      "canvas.loadWorkspace",
      "canvas.createWorkspace",
      "canvas.renameWorkspace",
      "canvas.deleteWorkspace",
      "canvas.saveWorkspace",
    ]) {
      expect(canvasWorkspaceGateway).toContain(`data.command("${commandName}"`);
    }
    expect(canvasPersistence).not.toContain("getLibraryDb");
    expect(canvasPersistence).not.toContain("aura-db");
    expect(canvasPersistence).not.toContain("CanvasRepo");
    expect(canvasPersistence).not.toMatch(
      /\b(?:db|database)\s*\.\s*(?:query|run|exec|queryScalar)\b/,
    );
    expect(citationGraph).toContain("loadCitationGraphPageSnapshot");
    expect(citationCacheGateway).toContain('data.command("citationGraph.getCached"');
    expect(citationCacheGateway).toContain('data.command("citationGraph.putCached"');
    expect(citationGateway).toContain('data.command("citationGraph.getActiveLibraryDois"');
    for (const gateway of [citationCacheGateway, citationGateway]) {
      expect(gateway).not.toContain("getLibraryDb");
      expect(gateway).not.toContain("aura-db");
      expect(gateway).not.toContain("graph_cache");
      expect(gateway).not.toContain("Database");
      expect(gateway).not.toContain("libraryId");
      expect(gateway).not.toMatch(/\b(?:db|database)\s*\.\s*query\b/);
    }

    expect(existsSync(resolve(process.cwd(), "src/pages/FlashcardsPage.tsx"))).toBe(false);
    expect(router).toContain('{ path: "flashcards", element: <Navigate to="/canvas" replace /> }');
    for (const legacyTable of ["flashcards", "flashcard_srs", "flashcard_reviews"]) {
      expect(libraryBackup).toContain(`"${legacyTable}"`);
    }
    expect(syncScope).toContain("flashcards: columns(");
    expect(syncScope).toContain("snippets: columns(");
    expect(syncScope).toContain(
      'table === "annotations" || table === "snippets" || table === "flashcards"',
    );
    expect(syncStorage).toContain("syncedColumnsForTable");
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
});
