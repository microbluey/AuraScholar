import { type Database, WorksRepo } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand } from "./data-commands";
import type { DataCommandDependencies } from "./data-command-runtime";
import {
  MAX_REFERENCE_IMPORT_INPUT_BYTES,
  MAX_REFERENCE_IMPORT_ITEMS,
} from "./reference-import-command-input";

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "reference-import-command-device",
    deviceName: "Reference import commands",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

function risReference(title: string, doi = "10.4242/reference-import"): string {
  return [
    "TY  - JOUR",
    `TI  - ${title}`,
    "AU  - Lovelace, Ada",
    `DO  - ${doi}`,
    "PY  - 1843",
    "ER  -",
  ].join("\n");
}

describe("Reference import data command", () => {
  it("parses in main and upserts the complete import exactly once inside its Library transaction", async () => {
    const upsertMany = vi.spyOn(WorksRepo.prototype, "upsertMany");
    try {
      await expect(
        command("library.importReferences", {
          format: "ris",
          text: risReference("Analytical engine notes"),
        }),
      ).resolves.toEqual({ deduped: 0, imported: 1, total: 1 });
      expect(upsertMany).toHaveBeenCalledTimes(1);
    } finally {
      upsertMany.mockRestore();
    }

    await expect(
      database.query<{ doi: string | null; library_id: string; title: string }>(
        `SELECT doi, library_id, title FROM works WHERE title = ?`,
        ["Analytical engine notes"],
      ),
    ).resolves.toEqual([
      {
        doi: "10.4242/reference-import",
        library_id: libraryId,
        title: "Analytical engine notes",
      },
    ]);
  });

  it("retains the existing DOI deduplication summary without accepting renderer work inputs", async () => {
    const text = risReference("Deduplicated import", "10.4242/reference-import-dedup");
    await expect(command("library.importReferences", { format: "ris", text })).resolves.toEqual({
      deduped: 0,
      imported: 1,
      total: 1,
    });
    await expect(command("library.importReferences", { format: "ris", text })).resolves.toEqual({
      deduped: 1,
      imported: 0,
      total: 1,
    });
  });

  it("rolls back the whole import when a later work write fails inside WorksRepo's savepoint", async () => {
    await database.exec(`
      CREATE TRIGGER fail_second_reference_import
      BEFORE INSERT ON works
      WHEN NEW.title = 'Reference import forced failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced reference import failure');
      END
    `);
    const text = [
      risReference("Reference import first", "10.4242/reference-import-first"),
      risReference("Reference import forced failure", "10.4242/reference-import-failure"),
    ].join("\n");

    await expect(command("library.importReferences", { format: "ris", text })).rejects.toThrow(
      "forced reference import failure",
    );
    await expect(
      database.query<{ title: string }>(
        `SELECT title FROM works
         WHERE title IN ('Reference import first', 'Reference import forced failure')`,
      ),
    ).resolves.toEqual([]);
  });

  it("rejects injected, oversized, malformed, and overlarge parsed payloads before leasing the database", async () => {
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
    const tooManyItems = JSON.stringify(
      Array.from({ length: MAX_REFERENCE_IMPORT_ITEMS + 1 }, (_, index) => ({
        id: `item-${index}`,
        title: `Reference ${index}`,
        type: "article-journal",
      })),
    );
    const oversizedCslItem = JSON.stringify([
      {
        id: "large-csl-item",
        title: "x".repeat(2 * 1024 * 1024 + 1),
        type: "article-journal",
      },
    ]);
    const invalidRequests = [
      { input: {}, name: "library.importReferences" },
      { input: { text: 1 }, name: "library.importReferences" },
      {
        input: { format: "unknown", text: risReference("Invalid format") },
        name: "library.importReferences",
      },
      {
        input: { libraryId: "library:foreign", text: risReference("Injected scope") },
        name: "library.importReferences",
      },
      {
        input: { text: risReference("Injected work inputs"), workInputs: [] },
        name: "library.importReferences",
      },
      {
        input: { text: "x".repeat(MAX_REFERENCE_IMPORT_INPUT_BYTES + 1) },
        name: "library.importReferences",
      },
      { input: { format: "csljson", text: tooManyItems }, name: "library.importReferences" },
      { input: { format: "csljson", text: oversizedCslItem }, name: "library.importReferences" },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("derives and verifies the durable active local Library only inside the transaction", async () => {
    await database.run(`UPDATE libraries SET deleted_at = 1 WHERE id = ?`, [libraryId]);

    await expect(
      command("library.importReferences", {
        format: "ris",
        text: risReference("Deleted Library import", "10.4242/reference-import-deleted"),
      }),
    ).rejects.toThrow("Local Library identity is not active");
    await expect(database.query(`SELECT id FROM works`)).resolves.toEqual([]);
  });
});
