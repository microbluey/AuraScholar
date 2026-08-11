import { AttachmentsRepo, type Database, WorksRepo } from "@aurascholar/db";
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

const SHA = "a".repeat(64);
let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "library-ingest-dedup-device",
    deviceName: "Library ingest dedup commands",
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

async function addAttachment(workId: string, sha256 = SHA, pageCount?: number): Promise<void> {
  await new AttachmentsRepo(database, libraryId).create({
    byteSize: 1_024,
    originalFilename: "paper.pdf",
    pageCount,
    sha256,
    workId,
  });
}

describe("Library ingest dedup data command", () => {
  it("rejects malformed, overbroad, and scope-injecting input before obtaining a lease", async () => {
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
      { input: {}, name: "library.findIngestDedup" },
      { input: { kind: "attachmentSha", sha256: "not-a-sha" }, name: "library.findIngestDedup" },
      {
        input: { kind: "attachmentSha", libraryId: "library:foreign", sha256: SHA },
        name: "library.findIngestDedup",
      },
      { input: { doi: "", kind: "doi" }, name: "library.findIngestDedup" },
      {
        input: { doi: "10.1000/test", kind: "doi", workId: "work:foreign" },
        name: "library.findIngestDedup",
      },
      { input: { doi: "10.1000/test", kind: "arxiv" }, name: "library.findIngestDedup" },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
  });

  it("returns an active local attachment hash hit with its title and page count only", async () => {
    const supplement = await works.upsert({ title: "Same bytes, non-PDF attachment" });
    await new AttachmentsRepo(database, libraryId).create({
      byteSize: 1_024,
      kind: "supplement",
      sha256: SHA,
      workId: supplement.id,
    });

    const local = await works.upsert({ title: "Local exact PDF" });
    await addAttachment(local.id, SHA, 17);

    const removed = await works.upsert({ title: "Removed exact PDF" });
    await addAttachment(removed.id, "b".repeat(64), 9);
    await works.softDelete(removed.id);

    const foreignLibraryId = "library:foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreign = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign exact PDF",
    });
    await new AttachmentsRepo(database, foreignLibraryId).create({
      byteSize: 2_048,
      pageCount: 4,
      sha256: "c".repeat(64),
      workId: foreign.id,
    });

    await expect(
      command("library.findIngestDedup", { kind: "attachmentSha", sha256: SHA.toUpperCase() }),
    ).resolves.toEqual({
      hit: {
        pageCount: 17,
        reason: "exact-file",
        title: "Local exact PDF",
        workId: local.id,
      },
    });
    await expect(
      command("library.findIngestDedup", { kind: "attachmentSha", sha256: "b".repeat(64) }),
    ).resolves.toEqual({ hit: null });
    await expect(
      command("library.findIngestDedup", { kind: "attachmentSha", sha256: "c".repeat(64) }),
    ).resolves.toEqual({ hit: null });
  });

  it("normalizes DOI input and excludes removed active-Library works", async () => {
    const local = await works.upsert({ doi: "10.1000/Local-Doi", title: "Local DOI" });
    const removed = await works.upsert({ doi: "10.1000/Removed-Doi", title: "Removed DOI" });
    await works.softDelete(removed.id);

    await expect(
      command("library.findIngestDedup", { doi: "https://doi.org/10.1000/LOCAL-doi", kind: "doi" }),
    ).resolves.toEqual({
      hit: { reason: "doi", title: "Local DOI", workId: local.id },
    });
    await expect(
      command("library.findIngestDedup", { doi: "10.1000/removed-doi", kind: "doi" }),
    ).resolves.toEqual({ hit: null });
  });
});
