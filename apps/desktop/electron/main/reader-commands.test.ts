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
import { CanonicalPdfBlobReadLimitError } from "./platform-fs-policy";
import { createReaderPdfReadGate } from "./reader-pdf-read-gate";
import { MAX_READER_PDF_IPC_BYTES } from "../reader-pdf-ipc-limit";

let database: Database;
let dependencies: DataCommandDependencies;
let coordinator: DatabaseCoordinator;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "reader-command-device",
    deviceName: "Reader commands",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    inspect: (operation) => coordinator.execute(operation),
    readPdfBlob: vi.fn(async () => new Uint8Array([1, 2, 3])),
    readerPdfReadGate: createReaderPdfReadGate(),
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

async function addAttachment(
  workId: string,
  sha256: string,
  kind = "pdf",
  byteSize = 42,
): Promise<{ id: string }> {
  return new AttachmentsRepo(database, libraryId).create({
    byteSize,
    kind,
    originalFilename: `${kind}.fixture`,
    sha256,
    workId,
  });
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("Reader data commands", () => {
  it("rejects malformed or scope-injected payloads before obtaining a database lease", async () => {
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
      {
        input: { attachmentId: "attachment-1", pageIndex: 0, type: "highlight" },
        name: "reader.createAnnotation",
      },
      {
        input: {
          attachmentId: "attachment-1",
          libraryId: "library:foreign",
          pageIndex: 0,
          type: "highlight",
          workId: "work-1",
        },
        name: "reader.createAnnotation",
      },
      {
        input: {
          attachmentId: "attachment-1",
          pageIndex: -1,
          type: "highlight",
          workId: "work-1",
        },
        name: "reader.createAnnotation",
      },
      { input: { annotationId: "annotation-1", extra: true }, name: "reader.deleteAnnotation" },
      { input: {}, name: "reader.getWorkPdfCandidates" },
      { input: { workId: " " }, name: "reader.getWorkPdfCandidates" },
      {
        input: { libraryId: "library:foreign", workId: "work-1" },
        name: "reader.getWorkPdfCandidates",
      },
      { input: { workId: "work-1" }, name: "reader.getAttachment" },
      {
        input: { attachmentId: "attachment-1", workId: "work-1", extra: true },
        name: "reader.getAttachment",
      },
      { input: { attachmentId: " ", workId: "work-1" }, name: "reader.listAnnotations" },
      {
        input: { attachmentId: "attachment-1", libraryId: "library:foreign", workId: "work-1" },
        name: "reader.listAnnotations",
      },
      { input: { workId: "work-1" }, name: "reader.readAttachmentPdf" },
      {
        input: { attachmentId: "attachment-1", extra: true, workId: "work-1" },
        name: "reader.readAttachmentPdf",
      },
      {
        input: { libraryId: "library:foreign", workId: "work-1" },
        name: "reader.markWorkReadingStarted",
      },
      { input: { annotationId: " " }, name: "reader.restoreAnnotation" },
      {
        input: { annotationId: "annotation-1", contentMd: null },
        name: "reader.updateAnnotationContent",
      },
      {
        input: { annotationId: "annotation-1", contentMd: "updated", libraryId: "library:foreign" },
        name: "reader.updateAnnotationContent",
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("creates, edits, removes, restores, and starts reading through scoped transactions", async () => {
    const workId = await addWork("Reader write lifecycle");
    const attachment = await addAttachment(workId, "0".repeat(64));
    const created = await command("reader.createAnnotation", {
      anchor: {
        pageIndex: 2,
        quads: { pageIndex: 2, rects: [{ x1: 0, x2: 5, y1: 10, y2: 20 }] },
        quote: { exact: "Selected text", prefix: "before", suffix: "after" },
        version: 1,
      },
      attachmentId: attachment.id,
      color: "#ffd866",
      contentMd: "Initial annotation",
      inkPaths: [{ points: [0, 1, 2] }],
      pageIndex: 2,
      type: "highlight",
      workId,
    });

    expect(created.annotationId).toEqual(expect.any(String));
    await expect(
      command("reader.updateAnnotationContent", {
        annotationId: created.annotationId,
        contentMd: "Edited annotation",
      }),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      command("reader.listAnnotations", { attachmentId: attachment.id, workId }),
    ).resolves.toEqual({
      annotations: [
        expect.objectContaining({
          content_md: "Edited annotation",
          id: created.annotationId,
          ink_paths_json: JSON.stringify([{ points: [0, 1, 2] }]),
          page_index: 2,
          type: "highlight",
        }),
      ],
    });

    await expect(
      command("reader.deleteAnnotation", { annotationId: created.annotationId }),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      command("reader.listAnnotations", { attachmentId: attachment.id, workId }),
    ).resolves.toEqual({
      annotations: [],
    });
    await expect(
      command("reader.restoreAnnotation", { annotationId: created.annotationId }),
    ).resolves.toEqual({ updated: 1 });
    await expect(command("reader.markWorkReadingStarted", { workId })).resolves.toEqual({
      started: true,
    });
    await expect(command("reader.markWorkReadingStarted", { workId })).resolves.toEqual({
      started: false,
    });
  });

  it("rejects reader writes across attachment, work, annotation, and Library boundaries", async () => {
    const sourceWorkId = await addWork("Reader write source");
    const sourceAttachment = await addAttachment(sourceWorkId, "1".repeat(64));
    const sourceAnnotationId = await new AnnotationsRepo(database, libraryId).create({
      attachmentId: sourceAttachment.id,
      contentMd: "local annotation",
      pageIndex: 0,
      type: "note",
      workId: sourceWorkId,
    });
    const otherWorkId = await addWork("Reader write target");

    await expect(
      command("reader.createAnnotation", {
        attachmentId: sourceAttachment.id,
        pageIndex: 0,
        type: "highlight",
        workId: otherWorkId,
      }),
    ).rejects.toThrow(
      `Attachment ${sourceAttachment.id} is missing, removed, or not active for work ${otherWorkId}`,
    );

    const foreignLibraryId = "library:reader-write-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Reader Writes', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWork = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign Reader Work",
    });
    const foreignAttachment = await new AttachmentsRepo(database, foreignLibraryId).create({
      byteSize: 42,
      sha256: "2".repeat(64),
      workId: foreignWork.id,
    });
    const foreignAnnotationId = await new AnnotationsRepo(database, foreignLibraryId).create({
      attachmentId: foreignAttachment.id,
      pageIndex: 0,
      type: "note",
      workId: foreignWork.id,
    });

    await expect(
      command("reader.createAnnotation", {
        attachmentId: foreignAttachment.id,
        pageIndex: 0,
        type: "highlight",
        workId: foreignWork.id,
      }),
    ).rejects.toThrow(
      `Attachment ${foreignAttachment.id} is missing, removed, or not active for work ${foreignWork.id}`,
    );
    await expect(
      command("reader.updateAnnotationContent", {
        annotationId: foreignAnnotationId,
        contentMd: "foreign edit",
      }),
    ).rejects.toThrow(`Annotation ${foreignAnnotationId} is missing or removed`);
    await expect(
      command("reader.deleteAnnotation", { annotationId: foreignAnnotationId }),
    ).rejects.toThrow(`Annotation ${foreignAnnotationId} is missing or already removed`);
    await expect(
      command("reader.restoreAnnotation", { annotationId: foreignAnnotationId }),
    ).rejects.toThrow(`Annotation ${foreignAnnotationId} is missing or already active`);
    await expect(
      command("reader.markWorkReadingStarted", { workId: foreignWork.id }),
    ).resolves.toEqual({ started: false });

    await expect(
      command("reader.updateAnnotationContent", {
        annotationId: sourceAnnotationId,
        contentMd: "still local",
      }),
    ).resolves.toEqual({ updated: 1 });
  });

  it("preserves annotation soft-delete semantics and rejects archived or removed parents", async () => {
    const workId = await addWork("Reader write archived");
    const attachment = await addAttachment(workId, "3".repeat(64));
    const annotationId = await new AnnotationsRepo(database, libraryId).create({
      attachmentId: attachment.id,
      contentMd: "will be archived",
      pageIndex: 0,
      type: "note",
      workId,
    });

    await expect(command("reader.deleteAnnotation", { annotationId })).resolves.toEqual({
      updated: 1,
    });
    await expect(
      command("reader.updateAnnotationContent", { annotationId, contentMd: "stale edit" }),
    ).rejects.toThrow(`Annotation ${annotationId} is missing or removed`);
    await expect(command("reader.deleteAnnotation", { annotationId })).rejects.toThrow(
      `Annotation ${annotationId} is missing or already removed`,
    );
    await expect(command("reader.restoreAnnotation", { annotationId })).resolves.toEqual({
      updated: 1,
    });

    await database.run(`UPDATE works SET deleted_at = ? WHERE id = ?`, [30_000, workId]);
    await expect(
      command("reader.createAnnotation", {
        attachmentId: attachment.id,
        pageIndex: 0,
        type: "highlight",
        workId,
      }),
    ).rejects.toThrow(
      `Attachment ${attachment.id} is missing, removed, or not active for work ${workId}`,
    );
    await expect(
      command("reader.updateAnnotationContent", { annotationId, contentMd: "archived edit" }),
    ).rejects.toThrow(`Annotation ${annotationId} is missing or removed`);
    await expect(command("reader.deleteAnnotation", { annotationId })).rejects.toThrow(
      `Annotation ${annotationId} is missing or already removed`,
    );
    await expect(command("reader.markWorkReadingStarted", { workId })).resolves.toEqual({
      started: false,
    });

    await database.run(`UPDATE annotations SET deleted_at = ? WHERE id = ?`, [
      31_000,
      annotationId,
    ]);
    await expect(command("reader.restoreAnnotation", { annotationId })).rejects.toThrow(
      `Annotation ${annotationId} is missing or already active`,
    );
  });

  it("returns active local PDF candidates, one scoped attachment, and active annotations", async () => {
    const workId = await addWork("Active Reader Work");
    const pdf = await addAttachment(workId, "a".repeat(64));
    const supplement = await addAttachment(workId, "b".repeat(64), "supplement");
    const secondPdf = await addAttachment(workId, "c".repeat(64));
    const annotations = new AnnotationsRepo(database, libraryId);
    await annotations.create({
      attachmentId: pdf.id,
      pageIndex: 3,
      type: "highlight",
      workId,
    });
    await annotations.create({
      attachmentId: pdf.id,
      pageIndex: 1,
      type: "note",
      workId,
    });
    const deletedAnnotation = await annotations.create({
      attachmentId: pdf.id,
      pageIndex: 2,
      type: "highlight",
      workId,
    });
    await annotations.softDelete(deletedAnnotation);

    const candidates = await command("reader.getWorkPdfCandidates", { workId });
    expect(candidates.work).toEqual(expect.objectContaining({ id: workId, deleted_at: null }));
    expect(candidates.pdfAttachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pdf.id, kind: "pdf" }),
        expect.objectContaining({ id: secondPdf.id, kind: "pdf" }),
      ]),
    );
    expect(candidates.pdfAttachments).toHaveLength(2);
    expect(candidates.pdfAttachments).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: supplement.id })]),
    );
    await expect(
      command("reader.getAttachment", { attachmentId: pdf.id, workId }),
    ).resolves.toEqual({
      attachment: expect.objectContaining({ id: pdf.id, work_id: workId }),
    });
    await expect(
      command("reader.listAnnotations", { attachmentId: pdf.id, workId }),
    ).resolves.toEqual({
      annotations: [
        expect.objectContaining({ page_index: 1, type: "note" }),
        expect.objectContaining({ page_index: 3, type: "highlight" }),
      ],
    });
  });

  it("reads only an active local PDF after scoped inspection", async () => {
    const workId = await addWork("Reader PDF bytes");
    const pdfSha = "1".repeat(64);
    const pdf = await addAttachment(workId, pdfSha);
    const supplement = await addAttachment(workId, "2".repeat(64), "supplement");
    const otherWorkId = await addWork("Reader PDF other work");
    const otherPdf = await addAttachment(otherWorkId, "3".repeat(64));
    const foreignLibraryId = "library:reader-pdf-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Reader PDF', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWork = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign Reader PDF work",
    });
    const foreignPdf = await new AttachmentsRepo(database, foreignLibraryId).create({
      byteSize: MAX_READER_PDF_IPC_BYTES + 1,
      sha256: "5".repeat(64),
      workId: foreignWork.id,
    });
    const bytes = new Uint8Array([9, 8, 7]);
    const events: string[] = [];
    const readPdfBlob = vi.fn(async (sha256: string) => {
      events.push(`read:${sha256}`);
      return bytes;
    });
    dependencies.readPdfBlob = readPdfBlob;
    const inspected = dependencies.inspect!;
    dependencies.inspect = async (operation) => {
      events.push("inspect:start");
      const result = await inspected(operation);
      events.push("inspect:end");
      return result;
    };

    await expect(
      command("reader.readAttachmentPdf", { attachmentId: pdf.id, workId }),
    ).resolves.toEqual({ data: bytes });
    expect(events).toEqual(["inspect:start", "inspect:end", `read:${pdfSha}`]);
    expect(readPdfBlob).toHaveBeenCalledWith(pdfSha, {
      expectedByteSize: 42,
      maxBytes: MAX_READER_PDF_IPC_BYTES,
    });

    await expect(
      command("reader.readAttachmentPdf", { attachmentId: supplement.id, workId }),
    ).rejects.toThrow("missing, removed, or not active");
    await expect(
      command("reader.readAttachmentPdf", { attachmentId: pdf.id, workId: otherWorkId }),
    ).rejects.toThrow("missing, removed, or not active");
    await expect(
      command("reader.readAttachmentPdf", { attachmentId: otherPdf.id, workId }),
    ).rejects.toThrow("missing, removed, or not active");
    await expect(
      command("reader.readAttachmentPdf", {
        attachmentId: foreignPdf.id,
        workId: foreignWork.id,
      }),
    ).rejects.toThrow("missing, removed, or not active");
    await database.run(`UPDATE attachments SET deleted_at = ? WHERE id = ?`, [20_000, pdf.id]);
    await expect(
      command("reader.readAttachmentPdf", { attachmentId: pdf.id, workId }),
    ).rejects.toThrow("missing, removed, or not active");
    await database.run(`UPDATE attachments SET deleted_at = NULL WHERE id = ?`, [pdf.id]);
    await database.run(`UPDATE works SET deleted_at = ? WHERE id = ?`, [21_000, workId]);
    await expect(
      command("reader.readAttachmentPdf", { attachmentId: pdf.id, workId }),
    ).rejects.toThrow("missing, removed, or not active");
    expect(readPdfBlob).toHaveBeenCalledOnce();
  });

  it("rejects oversized Reader PDF metadata before the canonical blob is materialized", async () => {
    const workId = await addWork("Reader PDF size limit");
    const oversized = await addAttachment(
      workId,
      "6".repeat(64),
      "pdf",
      MAX_READER_PDF_IPC_BYTES + 1,
    );
    const atLimit = await addAttachment(workId, "7".repeat(64), "pdf", MAX_READER_PDF_IPC_BYTES);
    const readPdfBlob = vi.fn(async () => new Uint8Array([7, 8, 9]));
    dependencies.readPdfBlob = readPdfBlob;

    await expect(
      command("reader.readAttachmentPdf", { attachmentId: oversized.id, workId }),
    ).rejects.toThrow("reader-pdf-ipc-limit");
    expect(readPdfBlob).not.toHaveBeenCalled();
    await expect(new AttachmentsRepo(database, libraryId).forWork(workId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          byte_size: MAX_READER_PDF_IPC_BYTES + 1,
          id: oversized.id,
        }),
      ]),
    );

    await expect(
      command("reader.readAttachmentPdf", { attachmentId: atLimit.id, workId }),
    ).resolves.toEqual({ data: new Uint8Array([7, 8, 9]) });
    expect(readPdfBlob).toHaveBeenCalledWith("7".repeat(64), {
      expectedByteSize: MAX_READER_PDF_IPC_BYTES,
      maxBytes: MAX_READER_PDF_IPC_BYTES,
    });
  });

  it("maps a bounded canonical blob rejection and releases its Reader admission", async () => {
    const workId = await addWork("Reader actual PDF size limit");
    const pdf = await addAttachment(workId, "8".repeat(64));
    const readPdfBlob = vi
      .fn()
      .mockRejectedValueOnce(new CanonicalPdfBlobReadLimitError(MAX_READER_PDF_IPC_BYTES))
      .mockResolvedValueOnce(new Uint8Array([8]));
    dependencies.readPdfBlob = readPdfBlob;

    await expect(
      command("reader.readAttachmentPdf", { attachmentId: pdf.id, workId }),
    ).rejects.toThrow("reader-pdf-ipc-limit");
    await expect(
      command("reader.readAttachmentPdf", { attachmentId: pdf.id, workId }),
    ).resolves.toEqual({ data: new Uint8Array([8]) });
    expect(readPdfBlob).toHaveBeenCalledTimes(2);
    expect(readPdfBlob).toHaveBeenLastCalledWith("8".repeat(64), {
      expectedByteSize: 42,
      maxBytes: MAX_READER_PDF_IPC_BYTES,
    });
  });

  it("admits only one bounded Reader PDF read at a time", async () => {
    const firstWorkId = await addWork("First concurrent Reader PDF");
    const firstPdf = await addAttachment(firstWorkId, "9".repeat(64));
    const secondWorkId = await addWork("Second concurrent Reader PDF");
    const secondPdf = await addAttachment(secondWorkId, "a".repeat(64));
    const pendingBytes = deferred<Uint8Array>();
    const readPdfBlob = vi.fn(async () => pendingBytes.promise);
    dependencies.readPdfBlob = readPdfBlob;

    const first = command("reader.readAttachmentPdf", {
      attachmentId: firstPdf.id,
      workId: firstWorkId,
    });
    await vi.waitFor(() => expect(readPdfBlob).toHaveBeenCalledOnce());

    await expect(
      command("reader.readAttachmentPdf", { attachmentId: secondPdf.id, workId: secondWorkId }),
    ).rejects.toThrow("reader-pdf-ipc-busy");
    expect(readPdfBlob).toHaveBeenCalledOnce();

    pendingBytes.resolve(new Uint8Array([9]));
    await expect(first).resolves.toEqual({ data: new Uint8Array([9]) });
    await expect(
      command("reader.readAttachmentPdf", { attachmentId: secondPdf.id, workId: secondWorkId }),
    ).resolves.toEqual({ data: new Uint8Array([9]) });
  });

  it("propagates a main-owned PDF read failure after scope validation", async () => {
    const workId = await addWork("Reader PDF read failure");
    const pdf = await addAttachment(workId, "4".repeat(64));
    const failure = new Error("canonical PDF read failed");
    const readPdfBlob = vi.fn(async () => {
      throw failure;
    });
    dependencies.readPdfBlob = readPdfBlob;

    await expect(
      command("reader.readAttachmentPdf", { attachmentId: pdf.id, workId }),
    ).rejects.toBe(failure);
    expect(readPdfBlob).toHaveBeenCalledWith("4".repeat(64), {
      expectedByteSize: 42,
      maxBytes: MAX_READER_PDF_IPC_BYTES,
    });
  });

  it("fails closed when the main PDF lookup or reader dependency is unavailable", async () => {
    const input = { attachmentId: "attachment-1", workId: "work-1" } as const;
    await expect(
      executeDataCommand(
        { name: "reader.readAttachmentPdf", input },
        { ...dependencies, inspect: undefined },
      ),
    ).rejects.toThrow("Main-process Reader PDF lookup is unavailable");
    await expect(
      executeDataCommand(
        { name: "reader.readAttachmentPdf", input },
        { ...dependencies, readPdfBlob: undefined },
      ),
    ).rejects.toThrow("Main-process Reader PDF read is unavailable");
    await expect(
      executeDataCommand(
        { name: "reader.readAttachmentPdf", input },
        { ...dependencies, readerPdfReadGate: undefined },
      ),
    ).rejects.toThrow("Main-process Reader PDF admission is unavailable");
  });

  it("preserves archived local work context but hides its attachments and annotations", async () => {
    const workId = await addWork("Archived Reader Work");
    const attachment = await addAttachment(workId, "d".repeat(64));
    await new AnnotationsRepo(database, libraryId).create({
      attachmentId: attachment.id,
      pageIndex: 0,
      type: "highlight",
      workId,
    });
    await database.run(`UPDATE works SET deleted_at = ? WHERE id = ?`, [10_000, workId]);

    await expect(command("reader.getWorkPdfCandidates", { workId })).resolves.toEqual({
      pdfAttachments: [],
      work: expect.objectContaining({ deleted_at: 10_000, id: workId }),
    });
    await expect(
      command("reader.getAttachment", { attachmentId: attachment.id, workId }),
    ).resolves.toEqual({
      attachment: null,
    });
    await expect(
      command("reader.listAnnotations", { attachmentId: attachment.id, workId }),
    ).resolves.toEqual({
      annotations: [],
    });
  });

  it("does not expose a same-Library attachment through a different active work", async () => {
    const sourceWorkId = await addWork("Reader source work");
    const sourceAttachment = await addAttachment(sourceWorkId, "e".repeat(64));
    await new AnnotationsRepo(database, libraryId).create({
      attachmentId: sourceAttachment.id,
      pageIndex: 0,
      type: "highlight",
      workId: sourceWorkId,
    });
    const otherWorkId = await addWork("Reader other work");
    await addAttachment(otherWorkId, "f".repeat(64));

    await expect(
      command("reader.getAttachment", {
        attachmentId: sourceAttachment.id,
        workId: otherWorkId,
      }),
    ).resolves.toEqual({ attachment: null });
    await expect(
      command("reader.listAnnotations", {
        attachmentId: sourceAttachment.id,
        workId: otherWorkId,
      }),
    ).resolves.toEqual({ annotations: [] });
  });

  it("fails closed for deleted attachments, foreign scopes, and injected identifiers", async () => {
    const workId = await addWork("Deleted Attachment Work");
    const attachment = await addAttachment(workId, "e".repeat(64));
    await new AnnotationsRepo(database, libraryId).create({
      attachmentId: attachment.id,
      pageIndex: 0,
      type: "highlight",
      workId,
    });
    await database.run(`UPDATE attachments SET deleted_at = ? WHERE id = ?`, [
      20_000,
      attachment.id,
    ]);

    await expect(command("reader.getWorkPdfCandidates", { workId })).resolves.toEqual({
      pdfAttachments: [],
      work: expect.objectContaining({ id: workId }),
    });
    await expect(
      command("reader.getAttachment", { attachmentId: attachment.id, workId }),
    ).resolves.toEqual({
      attachment: null,
    });
    await expect(
      command("reader.listAnnotations", { attachmentId: attachment.id, workId }),
    ).resolves.toEqual({
      annotations: [],
    });

    const foreignLibraryId = "library:reader-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Reader', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreignWork = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign Reader Work",
    });
    const foreignAttachment = await new AttachmentsRepo(database, foreignLibraryId).create({
      byteSize: 42,
      sha256: "f".repeat(64),
      workId: foreignWork.id,
    });

    await expect(
      command("reader.getWorkPdfCandidates", { workId: foreignWork.id }),
    ).resolves.toEqual({ pdfAttachments: [], work: null });
    await expect(
      command("reader.getAttachment", {
        attachmentId: foreignAttachment.id,
        workId: foreignWork.id,
      }),
    ).resolves.toEqual({ attachment: null });
    await expect(
      command("reader.listAnnotations", {
        attachmentId: foreignAttachment.id,
        workId: foreignWork.id,
      }),
    ).resolves.toEqual({ annotations: [] });
    await expect(
      command("reader.getAttachment", { attachmentId: foreignAttachment.id, workId }),
    ).resolves.toEqual({ attachment: null });
    await expect(
      command("reader.listAnnotations", { attachmentId: foreignAttachment.id, workId }),
    ).resolves.toEqual({ annotations: [] });
    await expect(
      command("reader.getWorkPdfCandidates", { workId: "' OR 1 = 1 --" }),
    ).resolves.toEqual({ pdfAttachments: [], work: null });
  });
});
