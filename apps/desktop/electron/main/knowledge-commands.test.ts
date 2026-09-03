import {
  ContentUnitsRepo,
  KnowledgeIndexesRepo,
  ResearchProjectsRepo,
  WorksRepo,
  type ContentUnit,
  type Database,
} from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataCommandInput, DataCommandOutput } from "../data-command-contract";
import type { LibraryScopeToken } from "../library-read-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { type DataCommandDependencies } from "./data-command-runtime";
import { executeKnowledgeCommand } from "./knowledge-commands";
import type { LocalSemanticSearchInput } from "./local-semantic-search-service";
import { getActiveLibraryScopeToken } from "./library-scope-token";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let database: Database;
let libraryId: string;
let expectedScope: LibraryScopeToken;
let dependencies: DataCommandDependencies;
let units: ContentUnitsRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "knowledge-command-device",
    deviceName: "Knowledge commands",
    platform: "test",
  }));
  expectedScope = await getActiveLibraryScopeToken(database);
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    inspect: (operation) => coordinator.execute(operation),
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
  units = new ContentUnitsRepo(database, libraryId);
});

function command(
  input: DataCommandInput<"knowledge.searchContent">,
): Promise<DataCommandOutput<"knowledge.searchContent">> {
  return executeKnowledgeCommand({ input, name: "knowledge.searchContent" }, dependencies);
}

function knowledgeScope(): LibraryScopeToken {
  return { ...expectedScope };
}

function statsCommand(
  input: DataCommandInput<"knowledge.getContentStats">,
): Promise<DataCommandOutput<"knowledge.getContentStats">> {
  return executeKnowledgeCommand({ input, name: "knowledge.getContentStats" }, dependencies);
}

function contentUnit(id: string, overrides: Partial<ContentUnit> = {}): ContentUnit {
  return {
    id,
    libraryId,
    sourceType: "pdf",
    sourceId: "revision:knowledge-command",
    workId: null,
    assetId: null,
    revisionId: null,
    parentUnitId: null,
    ordinal: 0,
    headingPath: ["Methods"],
    anchor: {
      kind: "pdf",
      pageIndex: 3,
      position: { start: 18, end: 48 },
      revisionId: "revision:knowledge-command",
      version: 1,
    },
    text: "Grounded retrieval preserves a durable citation anchor.",
    language: "en",
    tokenCount: 8,
    contentHash: HASH_A,
    extractorProfile: "test-extractor-v1",
    chunkProfile: "test-chunk-v1",
    state: "ready",
    ...overrides,
  };
}

async function activateFullTextGeneration(): Promise<string> {
  const indexes = new KnowledgeIndexesRepo(database, libraryId);
  const index = await indexes.begin({ mode: "fulltext" });
  await indexes.activate(index.id);
  return index.id;
}

describe("Knowledge search data command", () => {
  it("queues only a fixed local semantic-index build after validating the active Library", async () => {
    const enqueueBuild = vi.fn().mockResolvedValue({
      created: true,
      index: {
        expectedCount: 3,
        id: "index:semantic-build",
        indexedCount: 0,
        stale: false,
        status: "building",
      },
      job: { id: "job:semantic-build", status: "queued" },
      scope: expectedScope,
    });
    const getStatus = vi.fn();
    const executeNames: string[] = [];
    let inspectCalls = 0;
    const scopedDependencies: DataCommandDependencies = {
      inspect: (operation) => {
        inspectCalls += 1;
        return new DatabaseCoordinator(database).execute(operation);
      },
      execute: (commandName, operation) => {
        executeNames.push(commandName);
        return new DatabaseCoordinator(database).execute(operation);
      },
      transaction: (commandName, operation) =>
        new DatabaseCoordinator(database).transaction(commandName, operation),
    };

    await expect(
      executeKnowledgeCommand(
        { input: { expectedScope: knowledgeScope() }, name: "knowledge.buildSemanticIndex" },
        scopedDependencies,
        { semanticIndex: { enqueueBuild, getStatus } },
      ),
    ).resolves.toEqual({
      created: true,
      index: {
        expectedCount: 3,
        id: "index:semantic-build",
        indexedCount: 0,
        stale: false,
        status: "building",
      },
      job: { id: "job:semantic-build", status: "queued" },
      scope: expectedScope,
    });
    expect(executeNames).toEqual([]);
    expect(inspectCalls).toBe(2);
    expect(enqueueBuild).toHaveBeenCalledWith(libraryId, expectedScope);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("projects semantic-index status without exposing model paths or raw errors", async () => {
    const enqueueBuild = vi.fn();
    const getStatus = vi.fn().mockResolvedValue({
      active: {
        expectedCount: 2,
        id: "index:active",
        indexedCount: 2,
        stale: false,
        status: "active",
      },
      building: {
        expectedCount: 5,
        id: "index:building",
        indexedCount: 3,
        stale: true,
        status: "building",
      },
      failed: {
        expectedCount: 7,
        id: "index:failed",
        indexedCount: 1,
        stale: false,
        status: "failed",
      },
    });

    await expect(
      executeKnowledgeCommand(
        { input: { expectedScope: knowledgeScope() }, name: "knowledge.getSemanticIndexStatus" },
        dependencies,
        { semanticIndex: { enqueueBuild, getStatus } },
      ),
    ).resolves.toEqual({
      status: {
        active: {
          expectedCount: 2,
          id: "index:active",
          indexedCount: 2,
          stale: false,
          status: "active",
        },
        building: {
          expectedCount: 5,
          id: "index:building",
          indexedCount: 3,
          stale: true,
          status: "building",
        },
        failed: {
          expectedCount: 7,
          id: "index:failed",
          indexedCount: 1,
          stale: false,
          status: "failed",
        },
      },
      scope: expectedScope,
    });
    expect(getStatus).toHaveBeenCalledWith(libraryId, expectedScope);
  });

  it("does not resolve a model capability for a foreign semantic-index scope", async () => {
    const enqueueBuild = vi.fn();
    const getStatus = vi.fn();

    await expect(
      executeKnowledgeCommand(
        {
          input: {
            expectedScope: { libraryId: "library:foreign", scopeToken: expectedScope.scopeToken },
          },
          name: "knowledge.buildSemanticIndex",
        },
        dependencies,
        { semanticIndex: { enqueueBuild, getStatus } },
      ),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
    expect(enqueueBuild).not.toHaveBeenCalled();
  });

  it("returns active corpus counts through the main-process read lease", async () => {
    const ready = contentUnit("content-unit:stats-ready");
    const contextOnly = contentUnit("content-unit:stats-context", {
      contentHash: HASH_B,
      sourceId: "annotation:stats-context",
      sourceType: "annotation",
      state: "context-only",
    });
    await units.upsertMany([ready, contextOnly]);

    const executeNames: string[] = [];
    const coordinator = new DatabaseCoordinator(database);
    dependencies = {
      execute: (commandName, operation) => {
        executeNames.push(commandName);
        return coordinator.execute(operation);
      },
      transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
    };

    await expect(statsCommand({ expectedScope: knowledgeScope() })).resolves.toEqual({
      stats: {
        totalContentUnits: 2,
        readyContentUnits: 1,
        contextOnlyContentUnits: 1,
        sourceCounts: { pdf: 1, annotation: 1, evidence: 0 },
        languageCoverage: { zh: 0, en: 1, other: 0, missing: 0 },
      },
      scope: expectedScope,
    });
    expect(executeNames).toEqual(["knowledge.getContentStats"]);
    await expect(
      statsCommand({
        expectedScope: { libraryId: "library:foreign", scopeToken: expectedScope.scopeToken },
      }),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
  });

  it("rejects malformed statistics input before acquiring a database query lease", async () => {
    let executeCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        throw new Error("transaction reached");
      },
    };

    await expect(
      executeKnowledgeCommand(
        {
          input: { expectedScope: { libraryId: " ", scopeToken: "scope" } },
          name: "knowledge.getContentStats",
        } as never,
        rejectingDependencies,
      ),
    ).rejects.toThrow("Knowledge Library scope is invalid");
    expect(executeCalls).toBe(0);
  });

  it("rejects malformed inputs before acquiring a database query lease", async () => {
    let executeCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        executeCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const invalidInputs = [
      { expectedScope: knowledgeScope(), query: 42 },
      { expectedScope: knowledgeScope(), query: "grounded", limit: 0 },
      { expectedScope: knowledgeScope(), query: "grounded", sourceTypes: ["pdf", "pdf"] },
      { expectedScope: knowledgeScope(), query: "grounded", sourceTypes: ["unknown"] },
      { expectedScope: knowledgeScope(), query: "grounded", sourceId: " " },
      { expectedScope: knowledgeScope(), query: "grounded", includeContextOnly: "yes" },
      { expectedScope: knowledgeScope(), query: "x".repeat(1_025) },
      {
        expectedScope: knowledgeScope(),
        query: "grounded",
        scope: { kind: "library", projectId: "unexpected" },
      },
      {
        expectedScope: knowledgeScope(),
        query: "grounded",
        scope: { kind: "works", workIds: ["work:one", "work:one"] },
      },
      {
        expectedScope: knowledgeScope(),
        query: "grounded",
        scope: { kind: "project", projectId: " " },
      },
    ];

    for (const input of invalidInputs) {
      await expect(
        executeKnowledgeCommand(
          { input, name: "knowledge.searchContent" } as never,
          rejectingDependencies,
        ),
      ).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
  });

  it("queries through the main-process read lease and returns the original anchor", async () => {
    const ready = contentUnit("content-unit:command-ready");
    const contextOnly = contentUnit("content-unit:command-context", {
      contentHash: HASH_B,
      sourceId: "revision:context-only",
      state: "context-only",
      text: "Grounded retrieval context is not a direct citation.",
    });
    await units.upsertMany([ready, contextOnly]);

    const executeNames: string[] = [];
    let inspectCalls = 0;
    let transactionCalls = 0;
    const coordinator = new DatabaseCoordinator(database);
    dependencies = {
      inspect: (operation) => {
        inspectCalls += 1;
        return coordinator.execute(operation);
      },
      execute: (commandName, operation) => {
        executeNames.push(commandName);
        return coordinator.execute(operation);
      },
      transaction: (commandName, operation) => {
        transactionCalls += 1;
        return coordinator.transaction(commandName, operation);
      },
    };

    const response = await command({
      expectedScope: knowledgeScope(),
      query: "grounded anchor",
      sourceId: ready.sourceId,
      sourceTypes: ["pdf"],
    });

    expect(executeNames).toEqual([]);
    expect(inspectCalls).toBe(3);
    expect(transactionCalls).toBe(0);
    expect(response.results).toMatchObject([
      {
        id: ready.id,
        sourceType: "pdf",
        sourceId: ready.sourceId,
        anchor: ready.anchor,
        excerpt: expect.stringContaining("Grounded retrieval"),
        workTitle: null,
      },
    ]);
    expect(response.results[0]).not.toHaveProperty("contentHash");
    expect(response.retrieval).toEqual({ mode: "fulltext", semanticStatus: "not-configured" });
    await expect(
      command({
        expectedScope: knowledgeScope(),
        query: "direct citation",
        includeContextOnly: true,
      }),
    ).resolves.toMatchObject({ results: [{ id: contextOnly.id, state: "context-only" }] });
  });

  it("returns no result for an empty query after validating its Library scope", async () => {
    let executeCalls = 0;
    let inspectCalls = 0;
    const coordinator = new DatabaseCoordinator(database);
    dependencies = {
      inspect(operation) {
        inspectCalls += 1;
        return coordinator.execute(operation);
      },
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        throw new Error("transaction reached");
      },
    };

    await expect(command({ expectedScope: knowledgeScope(), query: "  " })).resolves.toEqual({
      results: [],
      retrieval: { mode: "fulltext", semanticStatus: "not-configured" },
      scope: expectedScope,
    });
    expect(executeCalls).toBe(0);
    expect(inspectCalls).toBe(1);
  });

  it("keeps explicit context-only retrieval on one live full-text corpus", async () => {
    const contextOnly = contentUnit("content-unit:context-only-fulltext", {
      sourceId: "annotation:context-only-fulltext",
      sourceType: "annotation",
      state: "context-only",
      text: "Diagnostic context remains outside semantic generations.",
    });
    await units.upsertMany([contextOnly]);
    const search = vi.fn();

    const response = await executeKnowledgeCommand(
      {
        input: {
          expectedScope: knowledgeScope(),
          includeContextOnly: true,
          query: "diagnostic context",
        },
        name: "knowledge.searchContent",
      },
      dependencies,
      { semanticSearch: { search } },
    );

    expect(search).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      results: [{ id: contextOnly.id, state: "context-only" }],
      retrieval: { mode: "fulltext", semanticStatus: "not-configured" },
    });
  });

  it("fuses trusted semantic candidates with FTS and hydrates semantic-only rows", async () => {
    const lexical = contentUnit("content-unit:hybrid-lexical", {
      contentHash: HASH_A,
      sourceId: "revision:hybrid-lexical",
      text: "Grounded retrieval retains the exact source anchor.",
    });
    const semanticOnly = contentUnit("content-unit:hybrid-semantic", {
      contentHash: HASH_B,
      sourceId: "revision:hybrid-semantic",
      text: "A meaning-equivalent passage has no literal query term.",
    });
    await units.upsertMany([lexical, semanticOnly]);
    const indexId = await activateFullTextGeneration();
    const outsideGeneration = contentUnit("content-unit:hybrid-outside-generation", {
      sourceId: "revision:hybrid-z-outside-generation",
      text: "Grounded retrieval was extracted after the pinned generation.",
    });
    await units.upsertMany([outsideGeneration]);
    const search = vi.fn().mockResolvedValue({
      candidates: [
        { contentUnitId: outsideGeneration.id, score: 0.06 },
        { contentUnitId: semanticOnly.id, score: 0.05 },
        { contentUnitId: lexical.id, score: 0.04 },
      ],
      mode: "hybrid",
      pinnedIndexId: indexId,
      semanticStatus: "used",
    });

    const response = await executeKnowledgeCommand(
      {
        input: { expectedScope: knowledgeScope(), query: "grounded retrieval" },
        name: "knowledge.searchContent",
      },
      dependencies,
      { semanticSearch: { search } },
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedSourceIds: [lexical.sourceId, semanticOnly.sourceId, outsideGeneration.sourceId],
        libraryId,
        limit: 80,
        query: "grounded retrieval",
      }),
    );
    expect(response).toMatchObject({
      results: [{ id: semanticOnly.id }, { id: lexical.id }],
      retrieval: { mode: "hybrid", semanticStatus: "used" },
    });
    expect(response.results.map(({ id }) => id)).not.toContain(outsideGeneration.id);
  });

  it("rejects a semantic service that changes generation after starting FTS", async () => {
    const indexed = contentUnit("content-unit:generation-consistency", {
      sourceId: "revision:generation-consistency",
      text: "Generation consistency must survive concurrent retrieval.",
    });
    await units.upsertMany([indexed]);
    const indexId = await activateFullTextGeneration();
    const search = vi.fn(async (searchInput: LocalSemanticSearchInput) => {
      await searchInput.fullText.search({
        allowedSourceIds: searchInput.allowedSourceIds,
        ...(searchInput.corpusScope ? { corpusScope: searchInput.corpusScope } : {}),
        indexId,
        libraryId: searchInput.libraryId,
        limit: searchInput.limit,
        query: searchInput.query,
      });
      return {
        candidates: [],
        mode: "fulltext" as const,
        pinnedIndexId: "index:different",
        semanticStatus: "unavailable" as const,
      };
    });

    await expect(
      executeKnowledgeCommand(
        {
          input: { expectedScope: knowledgeScope(), query: "generation consistency" },
          name: "knowledge.searchContent",
        },
        dependencies,
        { semanticSearch: { search } },
      ),
    ).rejects.toThrow("selected different index generations");
  });

  it("rejects semantic-only candidates when no generation is pinned", async () => {
    const lexical = contentUnit("content-unit:unpinned-fulltext", {
      sourceId: "revision:unpinned-fulltext",
      text: "The unpinned contract anchor is visible to full-text search.",
    });
    const semanticOnly = contentUnit("content-unit:unpinned-semantic-only", {
      sourceId: "revision:unpinned-semantic-only",
      text: "A meaning-equivalent passage without the literal query terms.",
    });
    await units.upsertMany([lexical, semanticOnly]);
    const search = vi.fn().mockResolvedValue({
      candidates: [{ contentUnitId: semanticOnly.id, score: 0.1 }],
      mode: "fulltext",
      pinnedIndexId: null,
      semanticStatus: "unavailable",
    });

    await expect(
      executeKnowledgeCommand(
        {
          input: { expectedScope: knowledgeScope(), query: "unpinned contract anchor" },
          name: "knowledge.searchContent",
        },
        dependencies,
        { semanticSearch: { search } },
      ),
    ).rejects.toThrow("Unpinned retrieval produced candidates outside full-text results");
  });

  it("freezes a Project source allowlist before FTS and semantic retrieval", async () => {
    const worksRepo = new WorksRepo(database, libraryId);
    const projectsRepo = new ResearchProjectsRepo(database, libraryId);
    const project = await projectsRepo.ensureDefault();
    const member = await worksRepo.upsert({ title: "Project member" });
    const outside = await worksRepo.upsert({ title: "Project outsider" });
    await projectsRepo.addWorks(project.id, [member.id]);

    const memberUnit = contentUnit("content-unit:project-member", {
      sourceId: "revision:project-member",
      workId: member.id,
      text: "Project-scoped grounded retrieval",
    });
    const outsideUnit = contentUnit("content-unit:project-outside", {
      contentHash: HASH_B,
      sourceId: "revision:project-outside",
      workId: outside.id,
      text: "Outside project grounded retrieval",
    });
    await units.upsertMany([memberUnit, outsideUnit]);
    const indexId = await activateFullTextGeneration();

    const search = vi.fn().mockResolvedValue({
      candidates: [{ contentUnitId: memberUnit.id, score: 0.1 }],
      mode: "hybrid",
      pinnedIndexId: indexId,
      semanticStatus: "used",
    });
    const response = await executeKnowledgeCommand(
      {
        input: {
          expectedScope: knowledgeScope(),
          query: "grounded retrieval",
          scope: { kind: "project", projectId: project.id },
        },
        name: "knowledge.searchContent",
      },
      dependencies,
      { semanticSearch: { search } },
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedSourceIds: [memberUnit.sourceId],
        corpusScope: expect.objectContaining({
          allowedSourceIds: [memberUnit.sourceId],
          libraryId,
          scope: { kind: "project", projectId: project.id },
        }),
      }),
    );
    expect(response.results.map(({ id }) => id)).toEqual([memberUnit.id]);
    expect(response.results.map(({ id }) => id)).not.toContain(outsideUnit.id);
  });

  it("prioritizes explicitly requested material language without filtering other candidates", async () => {
    const sourceLanguage = contentUnit("content-unit:language-source", {
      contentHash: HASH_A,
      language: "zh-Hans",
      sourceId: "revision:language-source",
      text: "交叉验证方法的中文说明。",
    });
    const requestedLanguage = contentUnit("content-unit:language-requested", {
      contentHash: HASH_B,
      language: "en-US",
      sourceId: "revision:language-requested",
      text: "A method passage in English explains cross-validation.",
    });
    await units.upsertMany([sourceLanguage, requestedLanguage]);
    const indexId = await activateFullTextGeneration();
    const search = vi.fn().mockResolvedValue({
      candidates: [
        {
          contentUnitId: sourceLanguage.id,
          ranks: [{ channelId: "vector", rank: 1 }],
          score: 0.03,
        },
        {
          contentUnitId: requestedLanguage.id,
          ranks: [{ channelId: "vector", rank: 2 }],
          score: 0.02,
        },
      ],
      mode: "hybrid",
      pinnedIndexId: indexId,
      semanticStatus: "used",
    });

    const response = await executeKnowledgeCommand(
      {
        input: { expectedScope: knowledgeScope(), query: "英文方法材料中的交叉验证" },
        name: "knowledge.searchContent",
      },
      dependencies,
      { semanticSearch: { search } },
    );

    expect(response.results.map(({ id }) => id)).toEqual([requestedLanguage.id, sourceLanguage.id]);
    expect(response.retrieval).toEqual({
      languagePreference: { applied: true, requestedLanguage: "en" },
      mode: "hybrid",
      semanticStatus: "used",
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "英文方法材料中的交叉验证",
      }),
    );
  });

  it("rejects stale or foreign Library scopes", async () => {
    await expect(
      command({
        expectedScope: { libraryId: "library:foreign", scopeToken: expectedScope.scopeToken },
        query: "grounded retrieval",
      }),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
  });
});
