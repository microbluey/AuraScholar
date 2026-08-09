import { createHash } from "node:crypto";
import {
  AnnotationsRepo,
  AttachmentsRepo,
  ContentUnitSearchRepo,
  ContentUnitsRepo,
  EvidenceRepo,
  WorksRepo,
  appendKnowledgeChangeInTransaction,
  type Database,
  type KnowledgeJobRow,
} from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { DocumentAssetsRepo } from "@aurascholar/db/repos/document-assets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseCoordinator } from "./database-coordinator";
import {
  DesktopKnowledgeJobExecutor,
  type KnowledgeExecutorDependencies,
} from "./knowledge-executor";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\\nmain process fixture\\n%%EOF");
const PDF_SHA = createHash("sha256").update(PDF_BYTES).digest("hex");

let database: Database;
let libraryId: string;
let coordinator: DatabaseCoordinator;
let executor: DesktopKnowledgeJobExecutor;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "knowledge-executor-device",
    deviceName: "Knowledge executor",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  const dependencies: KnowledgeExecutorDependencies = {
    inspect: (operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
    async readBlob() {
      return new Uint8Array(PDF_BYTES);
    },
    async openPdf() {
      return fakePdfDocument();
    },
  };
  executor = new DesktopKnowledgeJobExecutor(dependencies);
});

describe("DesktopKnowledgeJobExecutor", () => {
  it("extracts canonical PDF page text and marks the revision ready", async () => {
    const fixture = await seedDocument();

    const result = await executor.execute(
      knowledgeJob({
        expectedContentHash: PDF_SHA,
        expectedRevisionId: fixture.revision.id,
        sourceId: fixture.revision.id,
      }),
      new AbortController().signal,
    );

    expect(result.progress).toEqual({ status: "ready", units: 1, pages: 1 });
    await expect(
      new ContentUnitsRepo(database, libraryId).listForSource("pdf", fixture.revision.id),
    ).resolves.toMatchObject([{ revisionId: fixture.revision.id, text: "Alpha beta" }]);
    await expect(
      new ContentUnitSearchRepo(database, libraryId).search({
        query: "Alpha",
        revisionId: fixture.revision.id,
        sourceTypes: ["pdf"],
      }),
    ).resolves.toMatchObject([
      {
        sourceId: fixture.revision.id,
        sourceType: "pdf",
        text: "Alpha beta",
        anchor: { kind: "pdf", pageIndex: 0 },
      },
    ]);
    await expect(revisionStatus(fixture.revision.id)).resolves.toMatchObject({
      extraction_status: "ready",
      extractor_profile: "pdf-text-v1",
    });
  });

  it("materializes annotation and Evidence ContentUnits without reopening the PDF", async () => {
    const fixture = await seedDocument();
    const anchor = {
      kind: "pdf",
      pageIndex: 0,
      position: { end: 5, start: 0 },
      quote: { exact: "quote" },
      revisionId: fixture.revision.id,
      version: 1,
    };
    const annotationId = await new AnnotationsRepo(database, libraryId).create({
      anchor,
      attachmentId: fixture.attachment.id,
      contentMd: "research note",
      pageIndex: 0,
      type: "highlight",
      workId: fixture.work.id,
    });
    const evidence = await new EvidenceRepo(database, libraryId).createText({
      anchor: {
        kind: "pdf",
        pageIndex: 0,
        position: { end: 5, start: 0 },
        quote: { exact: "quote" },
        version: 1,
      },
      attachmentId: fixture.attachment.id,
      evidenceKind: "method",
      expectedBlobSha256: PDF_SHA,
      text: "quote",
      workId: fixture.work.id,
    });

    await executor.execute(
      knowledgeJob({
        expectedContentHash: PDF_SHA,
        expectedRevisionId: fixture.revision.id,
        sourceId: annotationId,
        sourceType: "annotation",
      }),
      new AbortController().signal,
    );
    await executor.execute(
      knowledgeJob({
        expectedContentHash: evidence.evidence.sourceContentHash,
        expectedRevisionId: fixture.revision.id,
        sourceId: evidence.evidence.id,
        sourceType: "evidence",
      }),
      new AbortController().signal,
    );

    await expect(
      new ContentUnitsRepo(database, libraryId).listForSource("annotation", annotationId),
    ).resolves.toMatchObject([{ text: "quote\n\nresearch note" }]);
    await expect(
      new ContentUnitsRepo(database, libraryId).listForSource("evidence", evidence.evidence.id),
    ).resolves.toMatchObject([{ text: "quote", revisionId: fixture.revision.id }]);
  });

  it("does not let a superseded job overwrite a newer source change", async () => {
    const fixture = await seedDocument();
    const first = await appendKnowledgeChangeInTransaction(database, {
      changeKind: "upsert",
      expectedContentHash: PDF_SHA,
      expectedRevisionId: fixture.revision.id,
      libraryId,
      sourceId: fixture.revision.id,
      sourceType: "revision",
    });
    await appendKnowledgeChangeInTransaction(database, {
      changeKind: "upsert",
      expectedContentHash: PDF_SHA,
      expectedRevisionId: fixture.revision.id,
      libraryId,
      sourceId: fixture.revision.id,
      sourceType: "revision",
    });

    const result = await executor.execute(
      knowledgeJob({
        expectedContentHash: PDF_SHA,
        expectedRevisionId: fixture.revision.id,
        sourceChangeSeq: first.seq,
        sourceId: fixture.revision.id,
      }),
      new AbortController().signal,
    );

    expect(result.progress).toEqual({ status: "skipped", reason: "superseded" });
    await expect(
      new ContentUnitsRepo(database, libraryId).listForSource("pdf", fixture.revision.id),
    ).resolves.toEqual([]);
  });

  it("retires derived units when a durable remove job is consumed", async () => {
    const fixture = await seedDocument();
    await executor.execute(
      knowledgeJob({
        expectedContentHash: PDF_SHA,
        expectedRevisionId: fixture.revision.id,
        sourceId: fixture.revision.id,
      }),
      new AbortController().signal,
    );

    const result = await executor.execute(
      knowledgeJob({
        kind: "remove",
        sourceId: fixture.revision.id,
      }),
      new AbortController().signal,
    );

    expect(result.progress).toEqual({ status: "retired", reason: "removed", units: 1 });
    await expect(
      new ContentUnitsRepo(database, libraryId).listForSource("pdf", fixture.revision.id),
    ).resolves.toEqual([]);
  });

  it("fans a library reindex into source-specific durable changes", async () => {
    const fixture = await seedDocument();
    const annotationId = await new AnnotationsRepo(database, libraryId).create({
      anchor: {
        kind: "pdf",
        pageIndex: 0,
        position: { end: 5, start: 0 },
        quote: { exact: "quote" },
        revisionId: fixture.revision.id,
        version: 1,
      },
      attachmentId: fixture.attachment.id,
      pageIndex: 0,
      type: "highlight",
      workId: fixture.work.id,
    });
    const evidence = await new EvidenceRepo(database, libraryId).createText({
      anchor: {
        kind: "pdf",
        pageIndex: 0,
        position: { end: 5, start: 0 },
        quote: { exact: "quote" },
        version: 1,
      },
      attachmentId: fixture.attachment.id,
      evidenceKind: "method",
      expectedBlobSha256: PDF_SHA,
      text: "quote",
      workId: fixture.work.id,
    });
    const before = await lastKnowledgeChangeSeq();

    const result = await executor.execute(
      knowledgeJob({ kind: "reindex", sourceId: libraryId, sourceType: "library" }),
      new AbortController().signal,
    );

    expect(result.progress).toEqual({
      status: "enqueued",
      revisions: 1,
      annotations: 1,
      evidence: 1,
    });
    await expect(
      database.query<{ source_id: string; source_type: string }>(
        `SELECT source_id, source_type FROM knowledge_changes
         WHERE library_id = ? AND seq > ? ORDER BY seq ASC`,
        [libraryId, before],
      ),
    ).resolves.toEqual([
      { source_id: fixture.revision.id, source_type: "revision" },
      { source_id: annotationId, source_type: "annotation" },
      { source_id: evidence.evidence.id, source_type: "evidence" },
    ]);
  });

  it("delegates a durable embed job to the local semantic-index materializer", async () => {
    const materializeSemanticIndex = vi.fn().mockResolvedValue({
      progress: { embedded: 2, status: "active" },
    });
    const delegated = new DesktopKnowledgeJobExecutor({
      inspect: (operation) => coordinator.execute(operation),
      materializeSemanticIndex,
      async openPdf() {
        return fakePdfDocument();
      },
      async readBlob() {
        return new Uint8Array(PDF_BYTES);
      },
      transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
    });
    const controller = new AbortController();
    const job = knowledgeJob({
      indexId: "index:semantic",
      kind: "embed",
      sourceId: libraryId,
      sourceType: "library",
    });

    await expect(delegated.execute(job, controller.signal)).resolves.toEqual({
      progress: { embedded: 2, status: "active" },
    });
    expect(materializeSemanticIndex).toHaveBeenCalledWith(job, controller.signal);
  });
});

async function seedDocument() {
  const work = await new WorksRepo(database, libraryId).upsert({
    title: "Knowledge executor fixture",
  });
  const attachment = await new AttachmentsRepo(database, libraryId).create({
    byteSize: PDF_BYTES.byteLength,
    originalFilename: "fixture.pdf",
    pageCount: 1,
    sha256: PDF_SHA,
    workId: work.id,
  });
  const revision = await new DocumentAssetsRepo(database, libraryId).resolveAttachment(
    attachment.id,
  );
  if (!revision) throw new Error("fixture revision is missing");
  return { attachment, revision, work };
}

function knowledgeJob(
  input: Partial<KnowledgeJobRow> & Pick<KnowledgeJobRow, "sourceId">,
): KnowledgeJobRow {
  return {
    attempts: 1,
    availableAt: 0,
    createdAt: 0,
    dedupeKey: `test:${input.sourceId}`,
    error: null,
    expectedContentHash: null,
    expectedRevisionId: null,
    id: "job:knowledge-executor",
    indexId: null,
    kind: "extract",
    leaseExpiresAt: Date.now() + 60_000,
    leaseOwner: "test-worker",
    libraryId,
    maxAttempts: 3,
    progress: null,
    sourceChangeSeq: null,
    sourceType: "revision",
    status: "running",
    updatedAt: 0,
    ...input,
  };
}

function fakePdfDocument() {
  return {
    numPages: 1,
    async getPage(pageNumber: number) {
      if (pageNumber !== 1) throw new Error("unexpected page");
      return {
        async getTextContent() {
          return {
            items: [
              { str: "Alpha", hasEOL: true },
              { type: "marked-content" },
              { str: "beta", hasEOL: false },
            ],
          };
        },
      };
    },
    async destroy() {},
  };
}

async function revisionStatus(revisionId: string) {
  const rows = await database.query<{
    extraction_status: string;
    extractor_profile: string | null;
  }>(
    `SELECT extraction_status, extractor_profile
     FROM document_revisions WHERE id = ?`,
    [revisionId],
  );
  return rows[0]!;
}

async function lastKnowledgeChangeSeq(): Promise<number> {
  const rows = await database.query<{ seq: number }>(
    "SELECT COALESCE(MAX(seq), 0) AS seq FROM knowledge_changes WHERE library_id = ?",
    [libraryId],
  );
  return Number(rows[0]?.seq ?? 0);
}
