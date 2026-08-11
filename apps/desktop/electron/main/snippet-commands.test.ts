import { SnippetsRepo, type Database, WorksRepo } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand } from "./data-commands";
import type { DataCommandDependencies } from "./data-command-runtime";

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "snippet-command-device",
    deviceName: "Snippet commands",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
  works = new WorksRepo(database, libraryId);
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

async function addWork(title: string): Promise<string> {
  return (await works.upsert({ title, type: "article" })).id;
}

async function addForeignLibrary(id = "library:snippet-foreign"): Promise<string> {
  await database.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, 'Foreign snippets', 'personal', 1, 1)`,
    [id],
  );
  return id;
}

describe("Snippet data commands", () => {
  it("rejects malformed and scope-injected input before obtaining a database lease", async () => {
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
    const invalidRequests = [
      { input: { libraryId: "library:foreign" }, name: "snippet.listAll" },
      { input: { quote: "excerpt" }, name: "snippet.create" },
      { input: { workId: "work-1" }, name: "snippet.create" },
      {
        input: { libraryId: "library:foreign", quote: "excerpt", workId: "work-1" },
        name: "snippet.create",
      },
      { input: { pageIndex: -1, quote: "excerpt", workId: "work-1" }, name: "snippet.create" },
      {
        input: { pageIndex: 1.5, quote: "excerpt", workId: "work-1" },
        name: "snippet.create",
      },
      {
        input: { noteMd: 2, quote: "excerpt", workId: "work-1" },
        name: "snippet.create",
      },
      { input: { noteMd: "note" }, name: "snippet.updateNote" },
      {
        input: { libraryId: "library:foreign", noteMd: "note", snippetId: "snippet-1" },
        name: "snippet.updateNote",
      },
      { input: { snippetId: " ", extra: true }, name: "snippet.delete" },
      { input: { libraryId: "library:foreign", snippetId: "snippet-1" }, name: "snippet.restore" },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("creates, lists, edits, soft-deletes, and restores snippets in the active Library", async () => {
    const workId = await addWork("Snippet lifecycle");
    const created = await command("snippet.create", {
      noteMd: null,
      pageIndex: 3,
      quote: "  Exact selected passage  ",
      tag: "method",
      workId,
    });

    expect(created.snippetId).toEqual(expect.any(String));
    await expect(command("snippet.listAll", {})).resolves.toEqual({
      snippets: [
        expect.objectContaining({
          id: created.snippetId,
          note_md: null,
          page_index: 3,
          quote: "  Exact selected passage  ",
          tag: "method",
          work_id: workId,
          work_title: "Snippet lifecycle",
        }),
      ],
    });

    await expect(
      command("snippet.updateNote", {
        noteMd: "Revised writing note",
        snippetId: created.snippetId,
      }),
    ).resolves.toEqual({ updated: 1 });
    await expect(command("snippet.delete", { snippetId: created.snippetId })).resolves.toEqual({
      updated: 1,
    });
    await expect(command("snippet.listAll", {})).resolves.toEqual({ snippets: [] });
    await expect(command("snippet.restore", { snippetId: created.snippetId })).resolves.toEqual({
      updated: 1,
    });
    await expect(command("snippet.listAll", {})).resolves.toEqual({
      snippets: [
        expect.objectContaining({
          id: created.snippetId,
          note_md: "Revised writing note",
          work_id: workId,
        }),
      ],
    });
  });

  it("does not expose or mutate snippets that belong to another Library", async () => {
    const foreignLibraryId = await addForeignLibrary();
    const foreignWorks = new WorksRepo(database, foreignLibraryId);
    const foreignWorkId = (await foreignWorks.upsert({ title: "Foreign source" })).id;
    const foreignSnippets = new SnippetsRepo(database, foreignLibraryId);
    const foreignSnippetId = await foreignSnippets.create({
      noteMd: "Private note",
      quote: "Foreign excerpt",
      workId: foreignWorkId,
    });

    await expect(
      command("snippet.create", { quote: "Forged local write", workId: foreignWorkId }),
    ).rejects.toThrow(`Work ${foreignWorkId} is missing or removed`);
    await expect(
      command("snippet.updateNote", { noteMd: "Forged edit", snippetId: foreignSnippetId }),
    ).rejects.toThrow(`Snippet ${foreignSnippetId} is missing or removed`);
    await expect(command("snippet.delete", { snippetId: foreignSnippetId })).rejects.toThrow(
      `Snippet ${foreignSnippetId} is missing or already removed`,
    );
    await expect(command("snippet.restore", { snippetId: foreignSnippetId })).rejects.toThrow(
      `Snippet ${foreignSnippetId} is missing or already active`,
    );
    await expect(command("snippet.listAll", {})).resolves.toEqual({ snippets: [] });
    await expect(foreignSnippets.listAll()).resolves.toEqual([
      expect.objectContaining({ id: foreignSnippetId, note_md: "Private note" }),
    ]);
  });

  it("rejects oversized snippet result sets and IPC output before serialization", async () => {
    const workId = await addWork("Bounded snippets");
    await database.run(
      `WITH RECURSIVE rows(n) AS (
         SELECT 1
         UNION ALL
         SELECT n + 1 FROM rows WHERE n < 10001
       )
       INSERT INTO snippets (id, work_id, page_index, quote, note_md, tag, created_at, updated_at)
       SELECT 'snippet:limit:' || n, ?, NULL, 'Bounded excerpt', NULL, NULL, n, n
       FROM rows`,
      [workId],
    );

    await expect(command("snippet.listAll", {})).rejects.toThrow(
      "Snippet rows are limited to 10000",
    );
  });

  it("rejects oversized snippet payloads before IPC serialization", async () => {
    const workId = await addWork("Oversized snippet");
    await database.run(
      `INSERT INTO snippets (id, work_id, page_index, quote, note_md, tag, created_at, updated_at)
       VALUES ('snippet:oversized', ?, NULL, ?, NULL, NULL, 1, 1)`,
      [workId, "x".repeat(8 * 1024 * 1024)],
    );

    await expect(command("snippet.listAll", {})).rejects.toThrow(
      "Snippet output is limited to 8388608 bytes",
    );
  });

  it("fails closed when the durable local Library is deleted", async () => {
    await database.run(`UPDATE libraries SET deleted_at = 10_000 WHERE id = ?`, [libraryId]);

    await expect(command("snippet.listAll", {})).rejects.toThrow(
      "Local Library identity is not active",
    );
  });
});
