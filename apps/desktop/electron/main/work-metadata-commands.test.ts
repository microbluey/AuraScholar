import { type Database, WorksRepo } from "@aurascholar/db";
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
    deviceId: "work-metadata-command-device",
    deviceName: "Work metadata commands",
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

async function addWork(title = "Metadata source"): Promise<string> {
  return (
    await works.upsert({
      authors: [
        { displayName: "Ada Lovelace", orcid: "0000-0000-0000-0001", position: 0, role: "author" },
      ],
      keywords: ["methods", "history"],
      title,
      type: "article",
      year: 1843,
    })
  ).id;
}

async function addForeignLibrary(id = "library:work-metadata-foreign"): Promise<string> {
  await database.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, 'Foreign metadata', 'personal', 1, 1)`,
    [id],
  );
  return id;
}

describe("Work metadata data commands", () => {
  it("rejects malformed, scope-injected, and invalid-author input before obtaining a database lease", async () => {
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
      { input: {}, name: "library.getWorkMetadata" },
      { input: { libraryId: "library:foreign", workId: "work-1" }, name: "library.getWorkMetadata" },
      { input: { extra: true, workId: "work-1" }, name: "library.getWorkMetadata" },
      { input: { workId: " " }, name: "library.getWorkMetadata" },
      { input: { workId: "work-1" }, name: "library.updateWorkMetadata" },
      {
        input: { libraryId: "library:foreign", patch: { title: "Forged" }, workId: "work-1" },
        name: "library.updateWorkMetadata",
      },
      { input: { patch: { unknown: "value" }, workId: "work-1" }, name: "library.updateWorkMetadata" },
      { input: { patch: { year: 1843.5 }, workId: "work-1" }, name: "library.updateWorkMetadata" },
      {
        input: { patch: { authors: [{ displayName: " ", position: 0 }] }, workId: "work-1" },
        name: "library.updateWorkMetadata",
      },
      {
        input: { patch: { authors: [{ displayName: "Ada", position: -1 }] }, workId: "work-1" },
        name: "library.updateWorkMetadata",
      },
      {
        input: {
          patch: {
            authors: [
              { displayName: "Ada", position: 0 },
              { displayName: "Grace", position: 0 },
            ],
          },
          workId: "work-1",
        },
        name: "library.updateWorkMetadata",
      },
      {
        input: { patch: { authors: [{ displayName: "Ada", position: 0, role: "reviewer" }] }, workId: "work-1" },
        name: "library.updateWorkMetadata",
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("loads the complete scoped editor snapshot and explicitly omits repository-only authorNames", async () => {
    const workId = await addWork();

    await expect(command("library.getWorkMetadata", { workId })).resolves.toEqual({
      metadata: expect.objectContaining({
        authors: [
          expect.objectContaining({
            displayName: "Ada Lovelace",
            orcid: "0000-0000-0000-0001",
            position: 0,
            role: "author",
          }),
        ],
        keywords: ["methods", "history"],
        work: expect.objectContaining({ id: workId, title: "Metadata source", year: 1843 }),
      }),
    });
    const result = await command("library.getWorkMetadata", { workId });
    expect(result.metadata?.work).not.toHaveProperty("authorNames");
  });

  it("does not spread undeclared CSL payloads into the editor snapshot", async () => {
    const workId = await addWork();
    await database.run(`UPDATE works SET csl_json = ? WHERE id = ?`, ["x".repeat(256 * 1024), workId]);

    const result = await command("library.getWorkMetadata", { workId });

    expect(result.metadata?.work).not.toHaveProperty("csl_json");
  });

  it("preserves the editor's deleted-read behavior while its update remains rejected", async () => {
    const workId = await addWork("Deleted metadata source");
    await works.softDelete(workId);

    await expect(command("library.getWorkMetadata", { workId })).resolves.toEqual({
      metadata: expect.objectContaining({
        work: expect.objectContaining({ deleted_at: expect.any(Number), id: workId }),
      }),
    });
    await expect(
      command("library.updateWorkMetadata", { patch: { title: "Cannot update" }, workId }),
    ).rejects.toThrow(`Work ${workId} is missing or removed`);
  });

  it("retains malformed keyword-json fallback and updates every supported metadata field", async () => {
    const workId = await addWork();
    await database.run(`UPDATE works SET keywords_json = '{not json' WHERE id = ?`, [workId]);
    await expect(command("library.getWorkMetadata", { workId })).resolves.toEqual({
      metadata: expect.objectContaining({ keywords: [] }),
    });

    await expect(
      command("library.updateWorkMetadata", {
        patch: {
          abstract: "Full abstract",
          accessedDate: "2026-08-09",
          accessionNumber: "A-1",
          arxivId: "2608.00001",
          authors: [
            { displayName: "Ada Lovelace", orcid: "0000-0000-0000-0001", position: 0, role: "author" },
            { displayName: "Grace Hopper", position: 1, role: "editor" },
          ],
          callNumber: "QA76",
          databaseName: "Archive",
          doi: "10.1000/metadata",
          edition: "2",
          isbn: "978-0-00-000000-0",
          issn: "1234-5678",
          issue: "4",
          keywords: ["typed", "metadata"],
          label: "Primary",
          language: "en",
          notesMd: "Editor note",
          numberOfVolumes: "2",
          openalexId: "W1",
          originalTitle: "Original title",
          pages: "1-20",
          placePublished: "London",
          pmid: "12345",
          publicationDate: "1843-01-01",
          publisher: "Publisher",
          s2Id: "S2-1",
          section: "Methods",
          seriesTitle: "Series",
          shortTitle: "Short",
          title: "Updated metadata",
          type: "book",
          url: "https://example.test/metadata",
          venueName: "Journal",
          venueType: "journal",
          volume: "3",
          year: 1844,
        },
        workId,
      }),
    ).resolves.toEqual({ updated: 1 });

    const result = await command("library.getWorkMetadata", { workId });
    expect(result.metadata).toEqual(
      expect.objectContaining({
        authors: [
          expect.objectContaining({ displayName: "Ada Lovelace", position: 0, role: "author" }),
          expect.objectContaining({ displayName: "Grace Hopper", position: 1, role: "editor" }),
        ],
        keywords: ["typed", "metadata"],
        work: expect.objectContaining({
          abstract: "Full abstract",
          accession_number: "A-1",
          arxiv_id: "2608.00001",
          database_name: "Archive",
          notes_md: "Editor note",
          publication_date: "1843-01-01",
          title: "Updated metadata",
          venue_type: "journal",
          year: 1844,
        }),
      }),
    );
  });

  it("uses the serialized execute lease for updates, leaving WorksRepo to own its transaction", async () => {
    const workId = await addWork();
    const coordinator = new DatabaseCoordinator(database);
    let executeCalls = 0;
    let transactionCalls = 0;
    const executeOnlyDependencies: DataCommandDependencies = {
      execute: (_commandName, operation) => {
        executeCalls += 1;
        return coordinator.execute(operation);
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("metadata update must not open a handler transaction");
      },
    };

    await expect(
      executeDataCommand(
        { input: { patch: { title: "Updated via execute" }, workId }, name: "library.updateWorkMetadata" },
        executeOnlyDependencies,
      ),
    ).resolves.toEqual({ updated: 1 });
    expect(executeCalls).toBe(1);
    expect(transactionCalls).toBe(0);
    await expect(works.get(workId)).resolves.toEqual(
      expect.objectContaining({ title: "Updated via execute" }),
    );
  });

  it("does not expose or mutate a work from another Library", async () => {
    const foreignLibraryId = await addForeignLibrary();
    const foreignWorks = new WorksRepo(database, foreignLibraryId);
    const foreignWorkId = (await foreignWorks.upsert({ title: "Foreign metadata", type: "article" })).id;

    await expect(command("library.getWorkMetadata", { workId: foreignWorkId })).resolves.toEqual({
      metadata: null,
    });
    await expect(
      command("library.updateWorkMetadata", {
        patch: { title: "Forged local metadata" },
        workId: foreignWorkId,
      }),
    ).rejects.toThrow(`Work ${foreignWorkId} is missing or removed`);
    await expect(
      command("library.updateWorkMetadata", { patch: {}, workId: foreignWorkId }),
    ).rejects.toThrow(`Work ${foreignWorkId} is missing or removed`);
    await expect(foreignWorks.get(foreignWorkId)).resolves.toEqual(
      expect.objectContaining({ title: "Foreign metadata" }),
    );
  });

  it("rejects an unexpectedly oversized metadata DTO before IPC serialization", async () => {
    const workId = await addWork("Oversized metadata");
    await database.run(`UPDATE works SET abstract = ? WHERE id = ?`, [
      "x".repeat(8 * 1024 * 1024),
      workId,
    ]);

    await expect(command("library.getWorkMetadata", { workId })).rejects.toThrow(
      "Work metadata output is limited to 8388608 bytes",
    );
  });

  it("fails closed when the durable local Library is deleted", async () => {
    const workId = await addWork();
    await database.run(`UPDATE libraries SET deleted_at = 10_000 WHERE id = ?`, [libraryId]);

    await expect(command("library.getWorkMetadata", { workId })).rejects.toThrow(
      "Local Library identity is not active",
    );
  });
});
