import { AnnotationsRepo, AttachmentsRepo, type Database, WorksRepo } from "@aurascholar/db";
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
import { createReaderPdfReadGate } from "./reader-pdf-read-gate";

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "reader-metadata-query-device",
    deviceName: "Reader metadata queries",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    inspect: (operation) => coordinator.execute(operation),
    readPdfBlob: async () => new Uint8Array([1, 2, 3]),
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

describe("Reader metadata query boundaries", () => {
  it("returns only command-owned Reader metadata fields", async () => {
    const work = await works.upsert({
      authors: [{ displayName: "Reader Metadata Author", position: 0 }],
      cslJson: { privateFixture: "work-csl-secret" },
      title: "Reader metadata projection",
      type: "article",
    });
    const pdf = await addAttachment(work.id, "projection-pdf-sha");
    const annotations = new AnnotationsRepo(database, libraryId);
    const annotationId = await annotations.create({
      anchor: {
        pageIndex: 0,
        quote: { exact: "projection quote", prefix: "", suffix: "" },
        version: 1,
      },
      attachmentId: pdf.id,
      contentMd: "projection note",
      inkPaths: [{ points: [0, 1, 2] }],
      pageIndex: 0,
      type: "highlight",
      workId: work.id,
    });
    await database.exec(`ALTER TABLE works ADD COLUMN reader_runtime_secret TEXT`);
    await database.exec(`ALTER TABLE attachments ADD COLUMN reader_runtime_secret TEXT`);
    await database.exec(`ALTER TABLE annotations ADD COLUMN reader_runtime_secret TEXT`);
    await database.run(`UPDATE works SET reader_runtime_secret = ? WHERE id = ?`, [
      "work-runtime-secret",
      work.id,
    ]);
    await database.run(
      `UPDATE attachments
       SET source_url = ?, reader_runtime_secret = ?
       WHERE id = ?`,
      ["https://private.example/reader.pdf", "attachment-runtime-secret", pdf.id],
    );
    await database.run(`UPDATE annotations SET reader_runtime_secret = ? WHERE id = ?`, [
      "annotation-runtime-secret",
      annotationId,
    ]);

    const candidates = await command("reader.getWorkPdfCandidates", { workId: work.id });
    const attachment = await command("reader.getAttachment", { attachmentId: pdf.id, workId: work.id });
    const listed = await command("reader.listAnnotations", { attachmentId: pdf.id, workId: work.id });

    expect(Object.keys(candidates.work ?? {}).sort()).toEqual([
      "arxiv_id",
      "authorNames",
      "deleted_at",
      "doi",
      "id",
      "title",
      "year",
    ]);
    expect(Object.keys(candidates.pdfAttachments[0] ?? {}).sort()).toEqual([
      "byte_size",
      "id",
      "kind",
      "original_filename",
      "sha256",
      "work_id",
    ]);
    expect(Object.keys(attachment.attachment ?? {}).sort()).toEqual([
      "byte_size",
      "id",
      "kind",
      "original_filename",
      "sha256",
      "work_id",
    ]);
    expect(Object.keys(listed.annotations[0] ?? {}).sort()).toEqual([
      "anchor_json",
      "color",
      "content_md",
      "id",
      "orphaned",
      "page_index",
      "type",
    ]);
    const serialized = JSON.stringify({ attachment, candidates, listed });
    expect(serialized).not.toContain("runtime-secret");
    expect(serialized).not.toContain("work-csl-secret");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("ink_paths_json");
  });

  it("rejects Reader metadata row counts before oversized sessions cross IPC", async () => {
    const attachmentBoundWorkId = await addWork("Reader attachment row bound");
    for (let index = 0; index <= 100; index += 1) {
      await database.run(
        `INSERT INTO attachments
           (id, work_id, kind, sha256, byte_size, original_filename, source_url,
            fetched_via, page_count, text_extracted_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, 'pdf', ?, 42, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL)`,
        [
          `reader-bound-pdf-${index}`,
          attachmentBoundWorkId,
          `reader-bound-sha-${index}`,
          index,
          index,
        ],
      );
    }
    await expect(
      command("reader.getWorkPdfCandidates", { workId: attachmentBoundWorkId }),
    ).rejects.toThrow("Reader PDF candidates are limited to 100");
    await expect(
      command("reader.readAttachmentPdf", {
        attachmentId: "reader-bound-pdf-100",
        workId: attachmentBoundWorkId,
      }),
    ).resolves.toEqual({ data: new Uint8Array([1, 2, 3]) });

    const annotationBoundWorkId = await addWork("Reader annotation row bound");
    const annotationBoundAttachment = await addAttachment(
      annotationBoundWorkId,
      "annotation-bound-sha",
    );
    for (let index = 0; index <= 1_000; index += 1) {
      await database.run(
        `INSERT INTO annotations
           (id, attachment_id, work_id, type, color, page_index, anchor_json, content_md,
            ink_paths_json, sort_key, orphaned, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, 'note', NULL, ?, NULL, NULL, NULL, ?, 0, ?, ?, NULL)`,
        [
          `reader-bound-annotation-${index}`,
          annotationBoundAttachment.id,
          annotationBoundWorkId,
          index,
          index,
          index,
          index,
        ],
      );
    }
    await expect(
      command("reader.listAnnotations", {
        attachmentId: annotationBoundAttachment.id,
        workId: annotationBoundWorkId,
      }),
    ).rejects.toThrow("Reader annotations are limited to 1000");
  });

  it("rejects an oversized Reader author list before metadata crosses IPC", async () => {
    const work = await works.upsert({
      authors: Array.from({ length: 101 }, (_, index) => ({
        displayName: `Reader bound author ${index}`,
        position: index,
      })),
      title: "Reader author row bound",
    });

    await expect(
      command("reader.getWorkPdfCandidates", { workId: work.id }),
    ).rejects.toThrow("Reader work authors are limited to 100");
  });

  it("omits oversized Reader metadata fields before they are serialized", async () => {
    const oversizedMetadata = "m".repeat(8 * 1024 + 1);
    const oversizedAnnotation = "a".repeat(64 * 1024 + 1);
    const work = await works.upsert({
      arxivId: oversizedMetadata,
      authors: [{ displayName: oversizedMetadata, position: 0 }],
      doi: oversizedMetadata,
      title: oversizedMetadata,
    });
    const pdf = await addAttachment(work.id, "oversized-metadata-pdf");
    const annotationId = await new AnnotationsRepo(database, libraryId).create({
      attachmentId: pdf.id,
      pageIndex: 0,
      type: "note",
      workId: work.id,
    });
    await database.run(`UPDATE attachments SET original_filename = ? WHERE id = ?`, [
      oversizedMetadata,
      pdf.id,
    ]);
    await database.run(
      `UPDATE annotations SET anchor_json = ?, content_md = ? WHERE id = ?`,
      [
        JSON.stringify({
          pageIndex: 0,
          quote: { exact: oversizedAnnotation, prefix: "", suffix: "" },
          version: 1,
        }),
        oversizedAnnotation,
        annotationId,
      ],
    );

    await expect(command("reader.getWorkPdfCandidates", { workId: work.id })).resolves.toEqual({
      pdfAttachments: [
        expect.objectContaining({ id: pdf.id, original_filename: null, work_id: work.id }),
      ],
      work: expect.objectContaining({
        arxiv_id: null,
        authorNames: ["Unknown author"],
        doi: null,
        id: work.id,
        title: "Untitled work",
      }),
    });
    await expect(
      command("reader.listAnnotations", { attachmentId: pdf.id, workId: work.id }),
    ).resolves.toEqual({
      annotations: [
        expect.objectContaining({
          anchor_json: null,
          content_md: null,
          id: annotationId,
          orphaned: 1,
        }),
      ],
    });
  });

  it("rejects Reader metadata envelopes that exceed the serialized output budget", async () => {
    const workId = await addWork("Reader metadata output bound");
    const pdf = await addAttachment(workId, "metadata-output-bound-pdf");
    const content = "b".repeat(64 * 1024);
    const anchorJson = JSON.stringify({
      pageIndex: 0,
      quote: { exact: "q".repeat(63 * 1024), prefix: "", suffix: "" },
      version: 1,
    });
    for (let index = 0; index < 17; index += 1) {
      await database.run(
        `INSERT INTO annotations
           (id, attachment_id, work_id, type, color, page_index, anchor_json, content_md,
            ink_paths_json, sort_key, orphaned, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, 'note', NULL, 0, ?, ?, NULL, ?, 0, ?, ?, NULL)`,
        [
          `reader-output-bound-annotation-${index}`,
          pdf.id,
          workId,
          anchorJson,
          content,
          index,
          index,
          index,
        ],
      );
    }

    await expect(
      command("reader.listAnnotations", { attachmentId: pdf.id, workId }),
    ).rejects.toThrow("Reader metadata output is limited to 2097152 bytes");
  });
});
