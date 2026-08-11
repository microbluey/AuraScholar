import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { AttachmentsRepo } from "@aurascholar/db/repos/attachments";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataCommandInput,
  DataCommandOutput,
  LibraryFinalizeIngestPdfInput,
  LibraryStagePdfCommandResult,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";

let database: Database;
let coordinator: DatabaseCoordinator;
let dependencies: DataCommandDependencies;
let libraryId: string;
let stageSerial: number;
let stagedReceipts: Map<string, LibraryStagePdfCommandResult>;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "library-ingest-command-device",
    deviceName: "Library ingest commands",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  stageSerial = 0;
  stagedReceipts = new Map();
  dependencies = {
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
    async claimStagedPdf(stageId) {
      const receipt = stagedReceipts.get(stageId);
      if (!receipt) throw new Error("staged PDF receipt did not verify");
      let settled = false;
      return {
        receipt,
        consume() {
          if (settled) return;
          settled = true;
          stagedReceipts.delete(stageId);
        },
        release() {
          if (settled) return;
          settled = true;
        },
      };
    },
    async verifyStagedPdf() {},
  };
  works = new WorksRepo(database, libraryId);
});

function stagedPdf(sha = "a".repeat(64)): LibraryFinalizeIngestPdfInput {
  const stageId = `${(++stageSerial).toString(36)}${"x".repeat(43)}`.slice(0, 43);
  stagedReceipts.set(stageId, { byteSize: 1_024, sha, stageId });
  return {
    fetchedVia: "manual",
    fileName: "staged-paper.pdf",
    pageCount: 12,
    stageId,
  };
}

function command(
  input: DataCommandInput<"library.finalizeIngest">,
  commandDependencies = dependencies,
): Promise<DataCommandOutput<"library.finalizeIngest">> {
  return executeDataCommand(
    { input, name: "library.finalizeIngest" },
    commandDependencies,
  ) as Promise<DataCommandOutput<"library.finalizeIngest">>;
}

async function activeWorkRow(workId: string) {
  const rows = await database.query<{
    deleted_at: number | null;
    title: string;
    updated_at: number;
  }>(`SELECT title, updated_at, deleted_at FROM works WHERE id = ?`, [workId]);
  return rows[0];
}

async function durableIngestRowCounts(): Promise<{
  attachments: number;
  documentAssets: number;
  documentRevisions: number;
  works: number;
}> {
  const worksRows = await database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM works`);
  const attachmentRows = await database.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM attachments`,
  );
  const assetRows = await database.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM document_assets`,
  );
  const revisionRows = await database.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM document_revisions`,
  );
  return {
    attachments: attachmentRows[0]?.count ?? -1,
    documentAssets: assetRows[0]?.count ?? -1,
    documentRevisions: revisionRows[0]?.count ?? -1,
    works: worksRows[0]?.count ?? -1,
  };
}

describe("Library ingest data command", () => {
  it("rejects malformed, scope-injected, and temporary-path input before acquiring a database lease", async () => {
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const invalidInputs = [
      {},
      { mode: "create", pdf: null },
      { mode: "create", pdf: null, workInput: { title: "Valid" }, libraryId: "library:foreign" },
      { mode: "create", pdf: null, workInput: { title: "Valid", extra: true } },
      { mode: "create", pdf: null, workInput: { title: " " } },
      { mode: "create", pdf: null, workInput: { title: "Invalid year", year: 10_001 } },
      { mode: "attach", pdf: null, workId: " " },
      { mode: "attach", pdf: null, workId: "work-1", libraryId: "library:foreign" },
      {
        mode: "attach",
        pdf: { ...stagedPdf(), relPath: "research-downloads/private.pdf" },
        workId: "work-1",
      },
      { mode: "attach", pdf: { ...stagedPdf(), fetchedVia: "oa" }, workId: "work-1" },
      { mode: "attach", pdf: { ...stagedPdf(), pageCount: 0 }, workId: "work-1" },
      { mode: "attach", pdf: { ...stagedPdf(), stageId: "not-a-stage-id" }, workId: "work-1" },
      {
        mode: "create",
        pdf: null,
        workInput: {
          authors: [
            { displayName: "One", position: 0 },
            { displayName: "Two", position: 0 },
          ],
          title: "Duplicate author positions",
        },
      },
      { mode: "create", pdf: null, workInput: { cslJson: { bad: 1n }, title: "Invalid JSON" } },
    ];

    for (const input of invalidInputs) {
      await expect(
        executeDataCommand({ input, name: "library.finalizeIngest" }, rejectingDependencies),
      ).rejects.toThrow();
    }
    expect(transactionCalls).toBe(0);
  });

  it("bounds a valid-looking work payload before acquiring a database lease", async () => {
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const oversizedAuthors = Array.from({ length: 1_000 }, (_, position) => ({
      displayName: "a".repeat(9_000),
      position,
    }));

    await expect(
      executeDataCommand(
        {
          input: {
            mode: "create",
            pdf: null,
            workInput: { authors: oversizedAuthors, title: "Oversized work payload" },
          },
          name: "library.finalizeIngest",
        },
        rejectingDependencies,
      ),
    ).rejects.toThrow("Work input is limited");
    expect(transactionCalls).toBe(0);
  });

  it("fails staged-PDF receipt claiming before acquiring a database lease or writing durable records", async () => {
    let transactionCalls = 0;
    let claimCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
      async claimStagedPdf() {
        claimCalls += 1;
        throw new Error("staged PDF receipt did not verify");
      },
    };
    const before = await durableIngestRowCounts();

    await expect(
      executeDataCommand(
        {
          input: {
            mode: "create",
            pdf: stagedPdf(),
            workInput: { title: "Unverified staged PDF must not write" },
          },
          name: "library.finalizeIngest",
        },
        rejectingDependencies,
      ),
    ).rejects.toThrow("staged PDF receipt did not verify");

    expect(claimCalls).toBe(1);
    expect(transactionCalls).toBe(0);
    await expect(durableIngestRowCounts()).resolves.toEqual(before);
    expect(before).toEqual({
      attachments: 0,
      documentAssets: 0,
      documentRevisions: 0,
      works: 0,
    });
  });

  it("revalidates a claimed PDF before the transaction and releases it when the canonical blob fails", async () => {
    const pdf = stagedPdf();
    const receipt = stagedReceipts.get(pdf.stageId);
    if (!receipt) throw new Error("test staged receipt was not registered");
    const before = await durableIngestRowCounts();
    let claimCalls = 0;
    let releaseCalls = 0;
    let transactionCalls = 0;
    let verificationCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async claimStagedPdf(stageId) {
        claimCalls += 1;
        expect(stageId).toBe(pdf.stageId);
        return {
          consume() {
            throw new Error("failed verification must not consume the receipt");
          },
          receipt,
          release() {
            releaseCalls += 1;
          },
        };
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("verification failure must precede the transaction");
      },
      async verifyStagedPdf(candidate) {
        verificationCalls += 1;
        expect(candidate).toEqual(receipt);
        throw new Error("canonical staged PDF hash mismatch");
      },
    };

    await expect(
      command(
        {
          mode: "create",
          pdf,
          workInput: { title: "Failed revalidation must not write" },
        },
        rejectingDependencies,
      ),
    ).rejects.toThrow("canonical staged PDF hash mismatch");

    expect(claimCalls).toBe(1);
    expect(verificationCalls).toBe(1);
    expect(releaseCalls).toBe(1);
    expect(transactionCalls).toBe(0);
    await expect(durableIngestRowCounts()).resolves.toEqual(before);
  });

  it("fails closed and releases a claimed PDF when the main verifier is unavailable", async () => {
    const pdf = stagedPdf();
    const receipt = stagedReceipts.get(pdf.stageId);
    if (!receipt) throw new Error("test staged receipt was not registered");
    let releaseCalls = 0;
    let transactionCalls = 0;
    const unavailableDependencies: DataCommandDependencies = {
      async claimStagedPdf() {
        return {
          consume() {},
          receipt,
          release() {
            releaseCalls += 1;
          },
        };
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("unavailable verifier must precede the transaction");
      },
    };

    await expect(
      command(
        {
          mode: "create",
          pdf,
          workInput: { title: "Unavailable verifier must not write" },
        },
        unavailableDependencies,
      ),
    ).rejects.toThrow("Main-process staged PDF verification is unavailable");

    expect(releaseCalls).toBe(1);
    expect(transactionCalls).toBe(0);
  });

  it("creates the work and optional staged-PDF attachment atomically", async () => {
    const result = await command({
      mode: "create",
      pdf: stagedPdf(),
      workInput: {
        authors: [{ displayName: "Ada Lovelace", position: 0 }],
        cslJson: { type: "article-journal" },
        doi: "10.4242/finalize-ingest",
        keywords: ["ingest", "transaction"],
        title: "Finalize ingest creates one durable work",
        type: "article",
        year: 2026,
      },
    });

    expect(result).toEqual({
      attachment: { deduped: false, id: expect.any(String) },
      deduped: false,
      pdfFetched: true,
      title: "Finalize ingest creates one durable work",
      workId: expect.any(String),
    });
    await expect(works.get(result.workId)).resolves.toMatchObject({
      doi: "10.4242/finalize-ingest",
      title: "Finalize ingest creates one durable work",
    });
    await expect(new AttachmentsRepo(database, libraryId).forWork(result.workId)).resolves.toEqual([
      expect.objectContaining({
        id: result.attachment?.id,
        original_filename: "staged-paper.pdf",
        sha256: "a".repeat(64),
      }),
    ]);
  });

  it("creates a metadata-only work for automatic imports through the same scoped finalizer", async () => {
    const result = await command({
      mode: "create",
      pdf: null,
      workInput: {
        doi: "10.4242/metadata-only-finalize",
        title: "Finalize ingest metadata-only work",
      },
    });

    expect(result).toEqual({
      attachment: null,
      deduped: false,
      pdfFetched: false,
      title: "Finalize ingest metadata-only work",
      workId: expect.any(String),
    });
    await expect(works.get(result.workId)).resolves.toMatchObject({
      doi: "10.4242/metadata-only-finalize",
      title: "Finalize ingest metadata-only work",
    });
    await expect(new AttachmentsRepo(database, libraryId).forWork(result.workId)).resolves.toEqual([]);
  });

  it("deduplicates create decisions against active DOI and fingerprint matches while linking PDFs idempotently", async () => {
    const scenarios = [
      {
        existing: {
          doi: "10.4242/active-create-dedup",
          title: "Original DOI work",
        },
        input: {
          doi: "10.4242/active-create-dedup",
          title: "Incoming DOI duplicate",
        },
        sha: "c".repeat(64),
      },
      {
        existing: {
          authors: [{ displayName: "Ada Lovelace", position: 0 }],
          title: "Fingerprint duplicate",
          year: 2026,
        },
        input: {
          authors: [{ displayName: "Ada Lovelace", position: 0 }],
          title: "Fingerprint duplicate",
          year: 2026,
        },
        sha: "d".repeat(64),
      },
    ];

    for (const scenario of scenarios) {
      const existing = await works.upsert(scenario.existing);
      const first = await command({
        mode: "create",
        pdf: stagedPdf(scenario.sha),
        workInput: scenario.input,
      });
      const second = await command({
        mode: "create",
        pdf: stagedPdf(scenario.sha),
        workInput: scenario.input,
      });

      expect(first).toMatchObject({
        attachment: { deduped: false, id: expect.any(String) },
        deduped: true,
        pdfFetched: true,
        title: scenario.existing.title,
        workId: existing.id,
      });
      expect(second).toMatchObject({
        attachment: { deduped: true, id: first.attachment?.id },
        deduped: true,
        pdfFetched: true,
        workId: existing.id,
      });
      await expect(
        new AttachmentsRepo(database, libraryId).forWork(existing.id),
      ).resolves.toHaveLength(1);
    }
  });

  it("rolls back a newly created work when its optional attachment cannot be written", async () => {
    await database.exec(`
      CREATE TRIGGER reject_finalize_ingest_attachment
      BEFORE INSERT ON attachments
      BEGIN
        SELECT RAISE(ABORT, 'test attachment rejection');
      END;
    `);

    const pdf = stagedPdf();
    const input = {
      mode: "create" as const,
      pdf,
      workInput: { title: "Must not survive a failed attachment" },
    };
    await expect(command(input)).rejects.toThrow("test attachment rejection");
    await expect(
      database.query<{ n: number }>(`SELECT COUNT(*) AS n FROM works WHERE title = ?`, [
        "Must not survive a failed attachment",
      ]),
    ).resolves.toEqual([{ n: 0 }]);
    await database.exec(`DROP TRIGGER reject_finalize_ingest_attachment`);
    await expect(command(input)).resolves.toMatchObject({
      attachment: { deduped: false },
      pdfFetched: true,
      title: "Must not survive a failed attachment",
    });
  });

  it("validates active local attach targets without attempting to restore an already-active dedup hit", async () => {
    const work = await works.upsert({ title: "Active DOI/exact-file dedup target" });
    const before = await activeWorkRow(work.id);

    await expect(command({ mode: "attach", pdf: null, workId: work.id })).resolves.toEqual({
      attachment: null,
      deduped: true,
      pdfFetched: false,
      title: "Active DOI/exact-file dedup target",
      workId: work.id,
    });
    await expect(activeWorkRow(work.id)).resolves.toEqual(before);

    const first = await command({ mode: "attach", pdf: stagedPdf(), workId: work.id });
    const second = await command({ mode: "attach", pdf: stagedPdf(), workId: work.id });
    expect(first.attachment).toEqual({ deduped: false, id: expect.any(String) });
    expect(second.attachment).toEqual({ deduped: true, id: first.attachment?.id });
    await expect(new AttachmentsRepo(database, libraryId).forWork(work.id)).resolves.toHaveLength(
      1,
    );
  });

  it("keeps PDF-free attach validation independent of the staged-PDF receipt resolver", async () => {
    const work = await works.upsert({ title: "PDF-free attach target" });
    let transactionCalls = 0;
    const noVerifierDependencies: DataCommandDependencies = {
      transaction: async (commandName, operation) => {
        transactionCalls += 1;
        return coordinator.transaction(commandName, operation);
      },
    };

    await expect(
      command({ mode: "attach", pdf: null, workId: work.id }, noVerifierDependencies),
    ).resolves.toMatchObject({
      attachment: null,
      deduped: true,
      pdfFetched: false,
      workId: work.id,
    });
    expect(transactionCalls).toBe(1);
  });

  it("fails closed for deleted or foreign attach targets without writing an attachment", async () => {
    const deleted = await works.upsert({ title: "Deleted dedup target" });
    await works.softDelete(deleted.id);

    const foreignLibraryId = "library:foreign-finalize-ingest";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign ingest Library', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWork = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign dedup target",
    });

    for (const workId of [deleted.id, foreignWork.id, "work:missing"]) {
      await expect(command({ mode: "attach", pdf: stagedPdf(), workId })).rejects.toThrow();
    }
    await expect(new AttachmentsRepo(database, libraryId).forWork(deleted.id)).resolves.toEqual([]);
    await expect(
      new AttachmentsRepo(database, foreignLibraryId).forWork(foreignWork.id),
    ).resolves.toEqual([]);
  });

  it("fails closed when the durable local Library is not active", async () => {
    const work = await works.upsert({ title: "Local library must remain active" });
    await database.run(`UPDATE libraries SET deleted_at = ? WHERE id = ?`, [10_000, libraryId]);

    await expect(command({ mode: "attach", pdf: null, workId: work.id })).rejects.toThrow(
      "Local Library identity is not active",
    );
  });
});
