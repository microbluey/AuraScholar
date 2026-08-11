import { WorksRepo, type Database } from "@aurascholar/db";
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
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "library-csl-command-device",
    deviceName: "Library CSL commands",
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

describe("Library CSL data command", () => {
  it("rejects malformed, unbounded, and scope-injected input before obtaining a database lease", async () => {
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
    const invalidRequests = [
      { input: {}, name: "library.getCslItems" },
      { input: { libraryId: "library:foreign", workIds: ["work-1"] }, name: "library.getCslItems" },
      { input: { workIds: "work-1" }, name: "library.getCslItems" },
      { input: { workIds: [" "] }, name: "library.getCslItems" },
      { input: { workIds: ["x".repeat(513)] }, name: "library.getCslItems" },
      {
        input: { workIds: Array.from({ length: 501 }, (_, index) => `work-${index}`) },
        name: "library.getCslItems",
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
  });

  it("keeps an empty selection as a local no-op without obtaining a database lease", async () => {
    let executeCalls = 0;
    const emptySelectionDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("empty selection must not query");
      },
      async transaction() {
        throw new Error("empty selection must not transact");
      },
    };

    await expect(
      executeDataCommand(
        { input: { workIds: [] }, name: "library.getCslItems" },
        emptySelectionDependencies,
      ),
    ).resolves.toEqual({ items: [] });
    expect(executeCalls).toBe(0);
  });

  it("returns bounded CSL items in requested order and preserves author/editor roles", async () => {
    const first = await works.upsert({
      authors: [
        { displayName: "Ada Lovelace", position: 0, role: "author" },
        { displayName: "Ed Itor", position: 1, role: "editor" },
        { displayName: "Tracy Translator", position: 2, role: "translator" },
      ],
      cslJson: {
        DOI: "10.1000/raw-doi",
        author: [{ family: "Raw", given: "Author" }],
        editor: [{ family: "Raw", given: "Editor" }],
        title: "Raw CSL title",
        type: "book",
        volume: "raw-volume",
      },
      doi: "10.1000/structured-doi",
      edition: "2",
      isbn: "978-0-00-000000-0",
      issn: "1234-5678",
      issue: "4",
      language: "en",
      pages: "1-20",
      placePublished: "London",
      pmid: "41000001",
      publisher: "Structured publisher",
      title: "Structured title",
      type: "book",
      url: "https://example.test/structured",
      venueName: "Structured venue",
      volume: "7",
      year: 1843,
    });
    const second = await works.upsert({
      authors: [{ displayName: "Grace Hopper", position: 0, role: "author" }],
      publicationDate: "1952-01-01",
      title: "Second local work",
      type: "article",
    });
    const deleted = await works.upsert({ title: "Deleted local work", type: "article" });
    await works.softDelete(deleted.id);

    const foreignLibraryId = "library:csl-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign CSL', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreign = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign work",
      type: "article",
    });

    const result = await command("library.getCslItems", {
      workIds: [second.id, "work:missing", first.id, deleted.id, foreign.id, second.id],
    });

    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.id)).toEqual([second.id, first.id, second.id]);
    expect(result.items[0]).toMatchObject({
      author: [{ family: "Hopper", given: "Grace" }],
      id: second.id,
      issued: { raw: "1952-01-01" },
      title: "Second local work",
      type: "article-journal",
    });
    expect(result.items[1]).toMatchObject({
      DOI: "10.1000/structured-doi",
      ISBN: "978-0-00-000000-0",
      ISSN: "1234-5678",
      PMID: "41000001",
      URL: "https://example.test/structured",
      author: [{ family: "Lovelace", given: "Ada" }],
      edition: "2",
      editor: [{ family: "Itor", given: "Ed" }],
      id: first.id,
      issue: "4",
      language: "en",
      page: "1-20",
      publisher: "Structured publisher",
      "publisher-place": "London",
      title: "Raw CSL title",
      type: "book",
      volume: "7",
    });
    expect(result.items[1]?.author?.map((author) => author.family)).not.toContain("Translator");
  });

  it("falls back to normalized columns when legacy CSL JSON is malformed", async () => {
    const target = await works.upsert({
      authors: [{ displayName: "Katherine Johnson", position: 0, role: "author" }],
      doi: "10.1000/fallback",
      title: "Recoverable reference",
      type: "conference",
      venueName: "Local-first notes",
      year: 2026,
    });
    await database.run(`UPDATE works SET csl_json = '{not json' WHERE id = ?`, [target.id]);

    await expect(command("library.getCslItems", { workIds: [target.id] })).resolves.toEqual({
      items: [
        expect.objectContaining({
          DOI: "10.1000/fallback",
          author: [{ family: "Johnson", given: "Katherine" }],
          id: target.id,
          issued: { "date-parts": [[2026]] },
          title: "Recoverable reference",
          type: "paper-conference",
        }),
      ],
    });
  });

  it("rejects output that exceeds the renderer IPC budget", async () => {
    const target = await works.upsert({
      cslJson: { abstract: "x".repeat(8 * 1024 * 1024), title: "Oversized CSL" },
      title: "Oversized CSL",
      type: "article",
    });

    await expect(command("library.getCslItems", { workIds: [target.id] })).rejects.toThrow(
      "CSL item output is limited to 8388608 bytes",
    );
  });

  it("fails closed when the durable local Library is no longer active", async () => {
    const target = await works.upsert({ title: "Scoped reference", type: "article" });
    await database.run(`UPDATE libraries SET deleted_at = 10_000 WHERE id = ?`, [libraryId]);

    await expect(command("library.getCslItems", { workIds: [target.id] })).rejects.toThrow(
      "Local Library identity is not active",
    );
  });
});
