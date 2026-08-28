import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "structured-saved-search-test",
    deviceName: "Structured saved search test",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
});

describe("saved-search structured criteria command", () => {
  it("persists canonical criteria and distinguishes subscriptions with different filters", async () => {
    const first = (await executeDataCommand(
      {
        name: "savedSearch.create",
        input: {
          libraryId,
          query: " graph   retrieval ",
          criteria: {
            text: "Graph Retrieval",
            author: " Ada Lovelace ",
            yearFrom: 2020,
            yearTo: 2024,
            venue: " NeurIPS ",
          },
          sources: ["openalex"],
        },
      },
      dependencies,
    )) as { created: boolean; id: string };
    const duplicate = (await executeDataCommand(
      {
        name: "savedSearch.create",
        input: {
          libraryId,
          query: "GRAPH RETRIEVAL",
          criteria: {
            text: "graph retrieval",
            author: "ada lovelace",
            yearFrom: 2020,
            yearTo: 2024,
            venue: "neurips",
          },
          sources: ["openalex"],
        },
      },
      dependencies,
    )) as { created: boolean; id: string };
    const distinct = (await executeDataCommand(
      {
        name: "savedSearch.create",
        input: {
          libraryId,
          query: "graph retrieval",
          criteria: { text: "graph retrieval", author: "Grace Hopper" },
          sources: ["openalex"],
        },
      },
      dependencies,
    )) as { created: boolean; id: string };

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ created: false, id: first.id });
    expect(distinct.created).toBe(true);
    const rows = await database.query<{ criteria_json: string; query: string }>(
      `SELECT query, criteria_json FROM saved_searches WHERE id = ?`,
      [first.id],
    );
    expect(rows).toEqual([
      {
        query: "Graph Retrieval",
        criteria_json:
          '{"text":"Graph Retrieval","author":"Ada Lovelace","yearFrom":2020,"yearTo":2024,"venue":"NeurIPS"}',
      },
    ]);
  });

  it("keeps legacy renderer calls compatible while rejecting invalid criteria before a write", async () => {
    await expect(
      executeDataCommand(
        {
          name: "savedSearch.create",
          input: { libraryId, query: "legacy query", sources: ["crossref"] },
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ created: true });

    const transaction = vi.fn(async () => {
      throw new Error("transaction must not run");
    });
    const rejectingDependencies: DataCommandDependencies = { transaction };
    await expect(
      executeDataCommand(
        {
          name: "savedSearch.create",
          input: {
            libraryId,
            query: "topic",
            criteria: { text: "topic", yearFrom: 2025, yearTo: 2024 },
            sources: null,
          },
        },
        rejectingDependencies,
      ),
    ).rejects.toThrow("Saved search year range is invalid");
    await expect(
      executeDataCommand(
        {
          name: "savedSearch.create",
          input: {
            libraryId,
            query: "topic",
            criteria: { text: "other topic" },
            sources: null,
          },
        },
        rejectingDependencies,
      ),
    ).rejects.toThrow("Saved search query must match its criteria");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("deduplicates a legacy text-only row against a structured text-only create", async () => {
    await database.run(
      `INSERT INTO saved_searches (
         id, library_id, query, sources_json, seen_ids_json, new_count, created_at, updated_at
       ) VALUES ('legacy-saved-search', ?, 'Graph Retrieval', '["openalex"]', '[]', 0, 1, 1)`,
      [libraryId],
    );

    await expect(
      executeDataCommand(
        {
          name: "savedSearch.create",
          input: {
            libraryId,
            query: " graph retrieval ",
            criteria: { text: "GRAPH   RETRIEVAL" },
            sources: ["openalex"],
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ created: false, id: "legacy-saved-search" });
  });
});
