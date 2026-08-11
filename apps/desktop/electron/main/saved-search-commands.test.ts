import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { SavedSearchesRepo } from "@aurascholar/db/repos/saved-searches";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";

let database: Database;
let libraryId: string;
let dependencies: DataCommandDependencies;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "saved-search-command-device",
    deviceName: "Saved Search commands",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
});

async function insertSavedSearch(
  id: string,
  options: {
    createdAt: number;
    deletedAt?: number | null;
    libraryId?: string;
    nextRunAt?: number | null;
    query?: string;
  },
): Promise<void> {
  await database.run(
    `INSERT INTO saved_searches (
       id, library_id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at,
       last_error, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, NULL, '[]', 0, NULL, ?, NULL, ?, ?, ?)`,
    [
      id,
      options.libraryId ?? libraryId,
      options.query ?? id,
      options.nextRunAt ?? null,
      options.createdAt,
      options.createdAt,
      options.deletedAt ?? null,
    ],
  );
}

describe("Saved Search data commands", () => {
  it("rejects malformed input before acquiring a database transaction", async () => {
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async transaction() {
        transactionCalls += 1;
        throw new Error("must not run");
      },
    };
    const requests = [
      {
        name: "savedSearch.create",
        input: { libraryId, query: " ", sources: null },
      },
      {
        name: "savedSearch.create",
        input: { libraryId, query: "valid", sources: [] },
      },
      {
        name: "savedSearch.create",
        input: { libraryId, query: "valid", sources: ["openalex", "openalex"] },
      },
      {
        name: "savedSearch.delete",
        input: { libraryId, savedSearchId: "" },
      },
      {
        name: "savedSearch.restore",
        input: { libraryId, savedSearchId: [] },
      },
      {
        name: "savedSearch.clearNew",
        input: { libraryId, savedSearchId: null },
      },
      {
        name: "savedSearch.recordRun",
        input: {
          expectedUpdatedAt: -1,
          libraryId,
          nextRunAt: Date.now(),
          observedIds: [],
          savedSearchId: "saved-search",
        },
      },
      {
        name: "savedSearch.recordRun",
        input: {
          expectedUpdatedAt: 1,
          libraryId,
          nextRunAt: Date.now(),
          observedIds: ["doi:10.1/example", "doi:10.1/example"],
          savedSearchId: "saved-search",
        },
      },
      {
        name: "savedSearch.recordError",
        input: {
          error: "",
          expectedUpdatedAt: 1,
          libraryId,
          nextRunAt: Date.now(),
          savedSearchId: "saved-search",
        },
      },
    ];

    for (const request of requests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(transactionCalls).toBe(0);
  });

  it("rejects malformed scoped read input before obtaining a database lease", async () => {
    let executeCalls = 0;
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const requests = [
      { name: "savedSearch.getScope", input: { libraryId } },
      { name: "savedSearch.list", input: { unexpected: true } },
      { name: "savedSearch.get", input: {} },
      { name: "savedSearch.get", input: { libraryId, savedSearchId: "saved-search" } },
      { name: "savedSearch.listDue", input: { now: -1 } },
      { name: "savedSearch.listDue", input: { savedSearchId: "saved-search" } },
    ];

    for (const request of requests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("derives saved-search reads from the active local Library", async () => {
    const now = Date.now();
    const foreignLibraryId = "foreign-saved-search-read-library";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign saved-search reads', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    await insertSavedSearch("saved:never", { createdAt: 10 });
    await insertSavedSearch("saved:due", { createdAt: 20, nextRunAt: now - 1 });
    await insertSavedSearch("saved:active", { createdAt: 30, nextRunAt: now + 120_000 });
    await insertSavedSearch("saved:future", { createdAt: 40, nextRunAt: now + 60_000 });
    await insertSavedSearch("saved:deleted", { createdAt: 50, deletedAt: 60, nextRunAt: 0 });
    await insertSavedSearch("saved:foreign", {
      createdAt: 60,
      libraryId: foreignLibraryId,
      nextRunAt: 0,
    });

    await expect(
      executeDataCommand({ name: "savedSearch.getScope", input: {} }, dependencies),
    ).resolves.toEqual({ libraryId });
    await expect(
      executeDataCommand({ name: "savedSearch.list", input: {} }, dependencies),
    ).resolves.toMatchObject({
      savedSearches: [
        { id: "saved:future" },
        { id: "saved:active" },
        { id: "saved:due" },
        { id: "saved:never" },
      ],
    });
    await expect(
      executeDataCommand({ name: "savedSearch.listDue", input: {} }, dependencies),
    ).resolves.toMatchObject({
      savedSearches: [{ id: "saved:never" }, { id: "saved:due" }],
    });
    await expect(
      executeDataCommand(
        { name: "savedSearch.get", input: { savedSearchId: "saved:deleted" } },
        dependencies,
      ),
    ).resolves.toMatchObject({ savedSearch: { deleted_at: 60, id: "saved:deleted" } });
    await expect(
      executeDataCommand(
        { name: "savedSearch.get", input: { savedSearchId: "saved:foreign" } },
        dependencies,
      ),
    ).resolves.toEqual({ savedSearch: null });
  });

  it("rejects unbounded saved-search read responses", async () => {
    await database.run(
      `WITH RECURSIVE rows(n) AS (
         SELECT 1
         UNION ALL
         SELECT n + 1 FROM rows WHERE n < 1001
       )
       INSERT INTO saved_searches (
         id, library_id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at,
         last_error, created_at, updated_at, deleted_at
       )
       SELECT 'saved:limit:' || n, ?, 'Bounded saved search', NULL, '[]', 0, NULL, 0,
              NULL, n, n, NULL
       FROM rows`,
      [libraryId],
    );

    await expect(
      executeDataCommand({ name: "savedSearch.list", input: {} }, dependencies),
    ).rejects.toThrow("Saved search rows are limited to 1000");
    await expect(
      executeDataCommand({ name: "savedSearch.listDue", input: {} }, dependencies),
    ).rejects.toThrow("Saved search rows are limited to 1000");
  });

  it("rejects oversized saved-search payloads before IPC serialization", async () => {
    await insertSavedSearch("saved:oversized", {
      createdAt: 1,
      query: "x".repeat(8 * 1024 * 1024),
    });

    await expect(
      executeDataCommand(
        { name: "savedSearch.get", input: { savedSearchId: "saved:oversized" } },
        dependencies,
      ),
    ).rejects.toThrow("Saved search output is limited to 8388608 bytes");
    await expect(
      executeDataCommand({ name: "savedSearch.list", input: {} }, dependencies),
    ).rejects.toThrow("Saved search output is limited to 8388608 bytes");
    await expect(
      executeDataCommand({ name: "savedSearch.listDue", input: {} }, dependencies),
    ).rejects.toThrow("Saved search output is limited to 8388608 bytes");
  });

  it("rejects scoped reads when the active local Library is deleted", async () => {
    await database.run(`UPDATE libraries SET deleted_at = 10_000 WHERE id = ?`, [libraryId]);

    await expect(
      executeDataCommand({ name: "savedSearch.getScope", input: {} }, dependencies),
    ).rejects.toThrow("Local Library identity is not active");
  });

  it("atomically creates and deduplicates equivalent subscriptions", async () => {
    const results = (await Promise.all([
      executeDataCommand(
        {
          name: "savedSearch.create",
          input: {
            libraryId,
            query: "  Graph   Neural Retrieval  ",
            sources: ["openalex", "crossref"],
          },
        },
        dependencies,
      ),
      executeDataCommand(
        {
          name: "savedSearch.create",
          input: {
            libraryId,
            query: "graph neural retrieval",
            sources: ["crossref", "openalex"],
          },
        },
        dependencies,
      ),
    ])) as Array<{ created: boolean; id: string }>;

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    const rows = await new SavedSearchesRepo(database, libraryId).list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      query: "Graph Neural Retrieval",
      sources_json: JSON.stringify(["crossref", "openalex"]),
    });
  });

  it("commits a polling result once and rejects stale revisions without losing state", async () => {
    const created = (await executeDataCommand(
      {
        name: "savedSearch.create",
        input: { libraryId, query: "reliable retrieval", sources: null },
      },
      dependencies,
    )) as { id: string };
    const repository = new SavedSearchesRepo(database, libraryId);
    const initial = await repository.get(created.id);

    const baseline = await executeDataCommand(
      {
        name: "savedSearch.recordRun",
        input: {
          expectedUpdatedAt: initial!.updated_at,
          libraryId,
          nextRunAt: Date.now() + 60_000,
          observedIds: ["doi:10.1000/first"],
          savedSearchId: created.id,
        },
      },
      dependencies,
    );
    expect(baseline).toEqual({
      committed: true,
      freshCount: 0,
      updatedAt: expect.any(Number),
    });

    const next = await executeDataCommand(
      {
        name: "savedSearch.recordRun",
        input: {
          expectedUpdatedAt: (baseline as { updatedAt: number }).updatedAt,
          libraryId,
          nextRunAt: Date.now() + 120_000,
          observedIds: ["doi:10.1000/first", "doi:10.1000/second"],
          savedSearchId: created.id,
        },
      },
      dependencies,
    );
    expect(next).toEqual({
      committed: true,
      freshCount: 1,
      updatedAt: expect.any(Number),
    });

    await expect(
      executeDataCommand(
        {
          name: "savedSearch.recordRun",
          input: {
            expectedUpdatedAt: initial!.updated_at,
            libraryId,
            nextRunAt: Date.now() + 180_000,
            observedIds: ["doi:10.1000/stale"],
            savedSearchId: created.id,
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ committed: false, freshCount: 0, updatedAt: null });

    const durable = await repository.get(created.id);
    expect(JSON.parse(durable!.seen_ids_json)).toEqual(["doi:10.1000/first", "doi:10.1000/second"]);
    expect(durable?.new_count).toBe(1);
  });

  it("records polling errors with CAS and exposes lifecycle writes as typed mutations", async () => {
    const created = (await executeDataCommand(
      {
        name: "savedSearch.create",
        input: { libraryId, query: "failure recovery", sources: ["s2"] },
      },
      dependencies,
    )) as { id: string };
    const repository = new SavedSearchesRepo(database, libraryId);
    const initial = await repository.get(created.id);

    const errorCommit = await executeDataCommand(
      {
        name: "savedSearch.recordError",
        input: {
          error: "Semantic Scholar returned 503",
          expectedUpdatedAt: initial!.updated_at,
          libraryId,
          nextRunAt: Date.now() + 60_000,
          savedSearchId: created.id,
        },
      },
      dependencies,
    );
    expect(errorCommit).toEqual({ committed: true, updatedAt: expect.any(Number) });
    await expect(
      executeDataCommand(
        {
          name: "savedSearch.recordError",
          input: {
            error: "stale error",
            expectedUpdatedAt: initial!.updated_at,
            libraryId,
            nextRunAt: Date.now() + 120_000,
            savedSearchId: created.id,
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ committed: false, updatedAt: null });

    await expect(
      executeDataCommand(
        {
          name: "savedSearch.clearNew",
          input: { libraryId, savedSearchId: created.id },
        },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      executeDataCommand(
        {
          name: "savedSearch.delete",
          input: { libraryId, savedSearchId: created.id },
        },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      executeDataCommand(
        {
          name: "savedSearch.restore",
          input: { libraryId, savedSearchId: created.id },
        },
        dependencies,
      ),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      executeDataCommand(
        {
          name: "savedSearch.recordRun",
          input: {
            expectedUpdatedAt: (errorCommit as { updatedAt: number }).updatedAt,
            libraryId,
            nextRunAt: Date.now() + 180_000,
            observedIds: ["doi:10.1000/pre-delete-response"],
            savedSearchId: created.id,
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ committed: false, freshCount: 0, updatedAt: null });

    expect(await repository.get(created.id)).toMatchObject({
      deleted_at: null,
      last_error: "Semantic Scholar returned 503",
      seen_ids_json: "[]",
    });
  });

  it("rejects stale Library scope and keeps foreign subscriptions isolated", async () => {
    const now = Date.now();
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES ('foreign-saved-search-library', 'Foreign searches', 'personal', ?, ?)`,
      [now, now],
    );
    const foreignRepository = new SavedSearchesRepo(database, "foreign-saved-search-library");
    const foreignId = await foreignRepository.create({ query: "foreign query", sources: null });

    await expect(
      executeDataCommand(
        {
          name: "savedSearch.create",
          input: {
            libraryId: "foreign-saved-search-library",
            query: "foreign command",
            sources: null,
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
    await expect(
      executeDataCommand(
        {
          name: "savedSearch.delete",
          input: { libraryId, savedSearchId: foreignId },
        },
        dependencies,
      ),
    ).rejects.toThrow(`Saved search ${foreignId} is missing or already removed`);

    await expect(foreignRepository.get(foreignId)).resolves.toMatchObject({
      deleted_at: null,
      query: "foreign query",
    });
    await expect(new SavedSearchesRepo(database, libraryId).list()).resolves.toEqual([]);
  });
});
