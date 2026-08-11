import { AnnotationsRepo, AttachmentsRepo, type Database, WorksRepo } from "@aurascholar/db";
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

let annotations: AnnotationsRepo;
let attachments: AttachmentsRepo;
let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let works: WorksRepo;
let attachmentSequence = 0;

beforeEach(async () => {
  attachmentSequence = 0;
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "annotation-recovery-command-device",
    deviceName: "Annotation recovery commands",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
  annotations = new AnnotationsRepo(database, libraryId);
  attachments = new AttachmentsRepo(database, libraryId);
  works = new WorksRepo(database, libraryId);
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

function attachmentInput(workId: string, kind = "pdf") {
  attachmentSequence += 1;
  return {
    byteSize: attachmentSequence,
    kind,
    originalFilename: `attachment-${attachmentSequence}.${kind === "pdf" ? "pdf" : "bin"}`,
    sha256: `annotation-recovery-${attachmentSequence}`.padEnd(64, "0"),
    workId,
  };
}

async function addWork(title: string): Promise<string> {
  return (await works.upsert({ title, type: "article" })).id;
}

async function addRecoveryFixture() {
  const workId = await addWork("Recoverable annotations");
  const historicalPdf = await attachments.create(attachmentInput(workId));
  const activeAnnotationId = await annotations.create({
    attachmentId: historicalPdf.id,
    contentMd: "Active historical PDF annotation",
    pageIndex: 2,
    type: "highlight",
    workId,
  });
  const deletedAnnotationId = await annotations.create({
    attachmentId: historicalPdf.id,
    contentMd: "Deleted historical PDF annotation",
    pageIndex: 3,
    type: "note",
    workId,
  });
  await annotations.softDelete(deletedAnnotationId);

  const historicalSupplement = await attachments.create(attachmentInput(workId, "supplement"));
  const supplementAnnotationId = await annotations.create({
    attachmentId: historicalSupplement.id,
    contentMd: "Historical supplement annotation",
    pageIndex: 4,
    type: "note",
    workId,
  });
  await database.run(`UPDATE attachments SET deleted_at = ?, updated_at = ? WHERE id IN (?, ?)`, [
    10_000,
    10_000,
    historicalPdf.id,
    historicalSupplement.id,
  ]);

  const activePdf = await attachments.create(attachmentInput(workId));
  return {
    activeAnnotationId,
    activePdfId: activePdf.id,
    deletedAnnotationId,
    historicalPdfId: historicalPdf.id,
    historicalSupplementId: historicalSupplement.id,
    supplementAnnotationId,
    workId,
  };
}

async function annotationState(annotationId: string) {
  const rows = await database.query<{
    attachment_id: string;
    deleted_at: number | null;
    updated_at: number;
  }>(`SELECT attachment_id, deleted_at, updated_at FROM annotations WHERE id = ?`, [annotationId]);
  return rows[0];
}

describe("Annotation recovery data command", () => {
  it("rejects malformed, scope-injected, and extra input before obtaining a database lease", async () => {
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
      { input: {}, name: "library.restoreAnnotationsForAttachment" },
      { input: { attachmentId: "attachment-1" }, name: "library.restoreAnnotationsForAttachment" },
      { input: { workId: "work-1" }, name: "library.restoreAnnotationsForAttachment" },
      {
        input: { attachmentId: "attachment-1", libraryId: "library:foreign", workId: "work-1" },
        name: "library.restoreAnnotationsForAttachment",
      },
      {
        input: { attachmentId: "attachment-1", extra: true, workId: "work-1" },
        name: "library.restoreAnnotationsForAttachment",
      },
      {
        input: { attachmentId: " ", workId: "work-1" },
        name: "library.restoreAnnotationsForAttachment",
      },
      {
        input: { attachmentId: "attachment-1", workId: " ".repeat(513) },
        name: "library.restoreAnnotationsForAttachment",
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("rebinds only active annotations from inactive PDF predecessors and stamps main-process time", async () => {
    const fixture = await addRecoveryFixture();
    const now = 1_234_567_890;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      await expect(
        command("library.restoreAnnotationsForAttachment", {
          attachmentId: fixture.activePdfId,
          workId: fixture.workId,
        }),
      ).resolves.toEqual({ restoredAnnotationCount: 1 });
    } finally {
      clock.mockRestore();
    }

    await expect(annotationState(fixture.activeAnnotationId)).resolves.toEqual({
      attachment_id: fixture.activePdfId,
      deleted_at: null,
      updated_at: now,
    });
    await expect(annotationState(fixture.deletedAnnotationId)).resolves.toEqual({
      attachment_id: fixture.historicalPdfId,
      deleted_at: expect.any(Number),
      updated_at: expect.any(Number),
    });
    await expect(annotationState(fixture.supplementAnnotationId)).resolves.toEqual({
      attachment_id: fixture.historicalSupplementId,
      deleted_at: null,
      updated_at: expect.any(Number),
    });
  });

  it("fails safely for missing, foreign, deleted, non-PDF, and mismatched target attachments", async () => {
    const fixture = await addRecoveryFixture();
    const original = await annotationState(fixture.activeAnnotationId);
    const otherWorkId = await addWork("Other local work");
    const mismatchedTarget = await attachments.create(attachmentInput(otherWorkId));
    const nonPdfTarget = await attachments.create(attachmentInput(fixture.workId, "supplement"));
    const deletedTarget = await attachments.create(attachmentInput(fixture.workId));
    await database.run(`UPDATE attachments SET deleted_at = ? WHERE id = ?`, [
      20_000,
      deletedTarget.id,
    ]);

    const foreignLibraryId = "library:annotation-recovery-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign recovery library', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWorks = new WorksRepo(database, foreignLibraryId);
    const foreignWorkId = (
      await foreignWorks.upsert({ title: "Foreign recovery work", type: "article" })
    ).id;
    const foreignAttachments = new AttachmentsRepo(database, foreignLibraryId);
    const foreignTarget = await foreignAttachments.create(attachmentInput(foreignWorkId));

    const attempts = [
      { attachmentId: "attachment:missing", workId: fixture.workId },
      { attachmentId: mismatchedTarget.id, workId: fixture.workId },
      { attachmentId: nonPdfTarget.id, workId: fixture.workId },
      { attachmentId: deletedTarget.id, workId: fixture.workId },
      { attachmentId: foreignTarget.id, workId: foreignWorkId },
    ];
    for (const input of attempts) {
      await expect(command("library.restoreAnnotationsForAttachment", input)).rejects.toThrow();
      await expect(annotationState(fixture.activeAnnotationId)).resolves.toEqual(original);
    }
  });

  it("fails safely when the requested work is missing, archived, or foreign", async () => {
    const fixture = await addRecoveryFixture();
    const original = await annotationState(fixture.activeAnnotationId);

    await expect(
      command("library.restoreAnnotationsForAttachment", {
        attachmentId: fixture.activePdfId,
        workId: "work:missing",
      }),
    ).rejects.toThrow();
    await expect(annotationState(fixture.activeAnnotationId)).resolves.toEqual(original);

    await database.run(`UPDATE works SET deleted_at = ? WHERE id = ?`, [30_000, fixture.workId]);
    await expect(
      command("library.restoreAnnotationsForAttachment", {
        attachmentId: fixture.activePdfId,
        workId: fixture.workId,
      }),
    ).rejects.toThrow();
    await expect(annotationState(fixture.activeAnnotationId)).resolves.toEqual(original);
  });

  it("fails closed when the durable local Library is deleted", async () => {
    const fixture = await addRecoveryFixture();
    const original = await annotationState(fixture.activeAnnotationId);
    await database.run(`UPDATE libraries SET deleted_at = ? WHERE id = ?`, [40_000, libraryId]);

    await expect(
      command("library.restoreAnnotationsForAttachment", {
        attachmentId: fixture.activePdfId,
        workId: fixture.workId,
      }),
    ).rejects.toThrow("Local Library identity is not active");
    await expect(annotationState(fixture.activeAnnotationId)).resolves.toEqual(original);
  });
});
