import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { documentAssetIdFromAttachment, documentRevisionIdFromAttachment } from "../ids";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { AttachmentsRepo } from "./attachments";
import { AnnotationsRepo } from "./annotations";
import { DocumentAssetsRepo } from "./document-assets";
import { type CreateTextEvidenceInput, EvidenceRepo } from "./evidence";
import { ResearchProjectsRepo } from "./research-projects";
import { WorksRepo } from "./works";

const BLOB_SHA256 = "a".repeat(64);
const NEXT_BLOB_SHA256 = "b".repeat(64);
const EVIDENCE_TEXT = "A causal estimate.";
const EVIDENCE_TEXT_SHA256 = "893fb1594949722c523a853b23065c6eab36d231a401562a4828efa2f1dde167";

let db: Database;
let libraryId: string;
let works: WorksRepo;
let attachments: AttachmentsRepo;
let annotations: AnnotationsRepo;
let documents: DocumentAssetsRepo;
let evidence: EvidenceRepo;
let projects: ResearchProjectsRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  works = new WorksRepo(db, libraryId);
  attachments = new AttachmentsRepo(db, libraryId);
  annotations = new AnnotationsRepo(db, libraryId);
  documents = new DocumentAssetsRepo(db, libraryId);
  evidence = new EvidenceRepo(db, libraryId);
  projects = new ResearchProjectsRepo(db, libraryId);
});

async function seedPdfSource() {
  const work = await works.upsert({ title: "Evidence source" });
  const attachment = await attachments.create({
    workId: work.id,
    sha256: BLOB_SHA256,
    byteSize: 4096,
    originalFilename: "evidence-source.pdf",
    pageCount: 3,
  });
  return {
    workId: work.id,
    attachmentId: attachment.id,
    assetId: documentAssetIdFromAttachment(attachment.id),
    revisionId: documentRevisionIdFromAttachment(attachment.id),
  };
}

function createInput(
  source: Awaited<ReturnType<typeof seedPdfSource>>,
  overrides: Partial<CreateTextEvidenceInput> = {},
): CreateTextEvidenceInput {
  return {
    id: "evidence-fixed-id",
    workId: source.workId,
    attachmentId: source.attachmentId,
    expectedBlobSha256: BLOB_SHA256,
    anchor: {
      version: 1,
      kind: "pdf",
      pageIndex: 1,
      quote: { exact: EVIDENCE_TEXT, prefix: "Before ", suffix: " After" },
      position: { start: 120, end: 138 },
      quads: {
        pageIndex: 1,
        rects: [{ x1: 10, y1: 20, x2: 80, y2: 35 }],
      },
    },
    text: EVIDENCE_TEXT,
    evidenceKind: "method",
    title: "  Identification strategy  ",
    noteMd: "  Compare against the baseline.  ",
    tags: ["causal", "method", "causal"],
    ...overrides,
  };
}

async function evidenceCount(): Promise<number> {
  return Number(await db.queryScalar("SELECT COUNT(*) FROM evidence_items"));
}

describe("EvidenceRepo", () => {
  it("creates canonical text Evidence with a content hash and revision-bound anchor", async () => {
    const source = await seedPdfSource();

    const created = await evidence.createText(createInput(source));

    expect(created.created).toBe(true);
    expect(created.evidence).toMatchObject({
      id: "evidence-fixed-id",
      libraryId,
      workId: source.workId,
      assetId: source.assetId,
      revisionId: source.revisionId,
      sourceKind: "document",
      evidenceKind: "method",
      text: EVIDENCE_TEXT,
      title: "Identification strategy",
      noteMd: "Compare against the baseline.",
      tags: ["causal", "method"],
      sourceContentHash: EVIDENCE_TEXT_SHA256,
      revisionStatus: "current",
      canonicalStatus: "active",
      availabilityStatus: "unchecked",
      deletedAt: null,
    });
    expect(created.evidence.anchor).toEqual({
      version: 1,
      kind: "pdf",
      pageIndex: 1,
      quote: { exact: EVIDENCE_TEXT, prefix: "Before ", suffix: " After" },
      position: { start: 120, end: 138 },
      quads: {
        pageIndex: 1,
        rects: [{ x1: 10, y1: 20, x2: 80, y2: 35 }],
      },
      revisionId: source.revisionId,
    });
    expect(created.evidence.provenance).toMatchObject({
      capturedBy: "user",
      sourceAuthority: "captured-source",
      captureMethod: "reader-selection",
    });
    expect(await evidence.get(created.evidence.id)).toEqual(created.evidence);
  });

  it("is idempotent for the same explicit id and rejects conflicting content", async () => {
    const source = await seedPdfSource();
    const input = createInput(source);
    const first = await evidence.createText(input);

    await expect(evidence.createText(input)).resolves.toEqual({
      evidence: first.evidence,
      created: false,
    });
    await expect(evidence.createText({ ...input, title: "Conflicting title" })).rejects.toThrow(
      "Evidence evidence-fixed-id already exists with different content",
    );

    expect(await evidenceCount()).toBe(1);
    expect(await evidence.get(first.evidence.id)).toEqual(first.evidence);
  });

  it("keeps an explicit-id retry idempotent after the source becomes historical", async () => {
    const source = await seedPdfSource();
    const input = createInput(source);
    const first = await evidence.createText(input);

    await documents.createRevision(source.assetId, {
      mimeType: "application/pdf",
      blobSha256: NEXT_BLOB_SHA256,
      byteSize: 8192,
      extractionStatus: "ready",
      expectedCurrentRevisionId: source.revisionId,
    });

    await expect(evidence.createText(input)).resolves.toEqual({
      evidence: { ...first.evidence, revisionStatus: "historical" },
      created: false,
    });
    expect(await evidenceCount()).toBe(1);
  });

  it("validates annotation provenance and rejects a semantic id collision", async () => {
    const source = await seedPdfSource();
    const annotationId = await annotations.create({
      attachmentId: source.attachmentId,
      workId: source.workId,
      type: "highlight",
      pageIndex: 1,
      anchor: {
        version: 1,
        pageIndex: 1,
        quote: { exact: EVIDENCE_TEXT, prefix: "Before ", suffix: " After" },
        position: { start: 120, end: 138 },
        quads: {
          pageIndex: 1,
          rects: [{ x1: 10, y1: 20, x2: 80, y2: 35 }],
        },
      },
    });
    const input = createInput(source, { captureMethod: "annotation", annotationId });

    const created = await evidence.createText(input);
    expect(created.evidence).toMatchObject({
      sourceKind: "annotation",
      provenance: {
        capturedBy: "user",
        sourceAuthority: "user-annotation",
        captureMethod: "annotation",
        annotationId,
      },
    });
    await expect(
      evidence.createText({ ...input, captureMethod: "reader-selection", annotationId: null }),
    ).rejects.toThrow("already exists with different content");

    await annotations.softDelete(annotationId);
    await expect(evidence.createText(input)).resolves.toEqual({
      evidence: created.evidence,
      created: false,
    });
  });

  it("rejects missing, unresolved, or mismatched annotation sources without writes", async () => {
    const source = await seedPdfSource();
    const missing = createInput(source, {
      captureMethod: "annotation",
      annotationId: "missing-annotation",
    });
    await expect(evidence.createText(missing)).rejects.toThrow(
      "Annotation Evidence source is missing, removed, or unresolved",
    );

    const annotationId = await annotations.create({
      attachmentId: source.attachmentId,
      workId: source.workId,
      type: "highlight",
      pageIndex: 0,
      anchor: {
        version: 1,
        pageIndex: 0,
        quote: { exact: "A different selection." },
      },
    });
    await expect(
      evidence.createText(
        createInput(source, { captureMethod: "annotation", annotationId, id: "mismatch" }),
      ),
    ).rejects.toThrow("Annotation Evidence source does not match");

    await annotations.setOrphaned(annotationId, true);
    await expect(
      evidence.createText(
        createInput(source, { captureMethod: "annotation", annotationId, id: "orphaned" }),
      ),
    ).rejects.toThrow("Annotation Evidence source is missing, removed, or unresolved");

    const selectorMismatches = [
      {
        id: "quote-context",
        anchor: {
          version: 1,
          pageIndex: 1,
          quote: { exact: EVIDENCE_TEXT, prefix: "A different prefix", suffix: " After" },
          position: { start: 120, end: 138 },
          quads: {
            pageIndex: 1,
            rects: [{ x1: 10, y1: 20, x2: 80, y2: 35 }],
          },
        },
      },
      {
        id: "position",
        anchor: {
          version: 1,
          pageIndex: 1,
          quote: { exact: EVIDENCE_TEXT, prefix: "Before ", suffix: " After" },
          position: { start: 240, end: 258 },
          quads: {
            pageIndex: 1,
            rects: [{ x1: 10, y1: 20, x2: 80, y2: 35 }],
          },
        },
      },
      {
        id: "quads",
        anchor: {
          version: 1,
          pageIndex: 1,
          quote: { exact: EVIDENCE_TEXT, prefix: "Before ", suffix: " After" },
          position: { start: 120, end: 138 },
          quads: {
            pageIndex: 1,
            rects: [{ x1: 110, y1: 120, x2: 180, y2: 135 }],
          },
        },
      },
    ] as const;
    for (const mismatch of selectorMismatches) {
      const ambiguousAnnotationId = await annotations.create({
        attachmentId: source.attachmentId,
        workId: source.workId,
        type: "highlight",
        pageIndex: 1,
        anchor: mismatch.anchor,
      });
      await expect(
        evidence.createText(
          createInput(source, {
            captureMethod: "annotation",
            annotationId: ambiguousAnnotationId,
            id: `same-text-wrong-${mismatch.id}`,
          }),
        ),
      ).rejects.toThrow("Annotation Evidence source does not match");
    }
    expect(await evidenceCount()).toBe(0);
  });

  it("rejects cross-Library, stale-hash, non-current, out-of-page, and quote-mismatch captures without writes", async () => {
    const source = await seedPdfSource();
    const input = createInput(source);
    const foreignLibraryId = "foreign-evidence-library";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign Evidence Library', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );

    await expect(new EvidenceRepo(db, foreignLibraryId).createText(input)).rejects.toThrow(
      "Evidence source is missing, removed, or outside this Library",
    );
    expect(await evidenceCount()).toBe(0);

    await expect(
      evidence.createText({ ...input, expectedBlobSha256: NEXT_BLOB_SHA256 }),
    ).rejects.toThrow("Evidence source revision changed; reopen the document before saving");
    expect(await evidenceCount()).toBe(0);

    await expect(
      evidence.createText({
        ...input,
        anchor: {
          ...input.anchor,
          pageIndex: 3,
          quads: input.anchor.quads ? { ...input.anchor.quads, pageIndex: 3 } : undefined,
        },
      }),
    ).rejects.toThrow("Evidence anchor page is outside the source document");
    expect(await evidenceCount()).toBe(0);

    await expect(
      evidence.createText({
        ...input,
        anchor: { ...input.anchor, quote: { exact: "Different quote" } },
      }),
    ).rejects.toThrow("Evidence text must exactly match its TextQuote selector");
    expect(await evidenceCount()).toBe(0);

    await documents.createRevision(source.assetId, {
      mimeType: "application/pdf",
      blobSha256: NEXT_BLOB_SHA256,
      byteSize: 8192,
      extractionStatus: "ready",
      expectedCurrentRevisionId: source.revisionId,
    });
    await expect(evidence.createText(input)).rejects.toThrow(
      "Evidence source is no longer the current document revision",
    );
    expect(await evidenceCount()).toBe(0);
  });

  it("requires project source membership and adds, lists, removes, and restores membership idempotently", async () => {
    const source = await seedPdfSource();
    const project = await projects.ensureDefault();
    const created = (await evidence.createText(createInput(source))).evidence;

    await expect(evidence.addToProject(project.id, created.id)).rejects.toThrow(
      "Evidence source is not a member of the target Research Project",
    );
    expect(await db.queryScalar("SELECT COUNT(*) FROM project_evidence")).toBe(0);

    await projects.addWorks(project.id, [source.workId]);
    await expect(evidence.addToProject(project.id, created.id)).resolves.toBe(true);
    await expect(evidence.addToProject(project.id, created.id)).resolves.toBe(false);
    expect(await evidence.list({ scope: { kind: "project", projectId: project.id } })).toEqual([
      created,
    ]);
    expect(await evidence.list({ scope: { kind: "inbox" } })).toEqual([]);

    await expect(evidence.removeFromProject(project.id, created.id)).resolves.toBe(true);
    await expect(evidence.removeFromProject(project.id, created.id)).resolves.toBe(false);
    expect(await evidence.list({ scope: { kind: "project", projectId: project.id } })).toEqual([]);
    expect(await evidence.list({ scope: { kind: "inbox" } })).toEqual([created]);

    await expect(evidence.addToProject(project.id, created.id)).resolves.toBe(true);
    expect(await evidence.list({ scope: { kind: "project", projectId: project.id } })).toEqual([
      expect.objectContaining({ id: created.id }),
    ]);
  });

  it("keeps Evidence readable while canonical source records are soft-deleted", async () => {
    const source = await seedPdfSource();
    const created = (await evidence.createText(createInput(source))).evidence;
    const now = Date.now();

    await db.run("UPDATE document_revisions SET deleted_at = ?, updated_at = ? WHERE id = ?", [
      now,
      now,
      source.revisionId,
    ]);
    expect(await evidence.get(created.id)).toMatchObject({
      id: created.id,
      canonicalStatus: "revision-removed",
      deletedAt: null,
    });

    await db.run("UPDATE document_revisions SET deleted_at = NULL, updated_at = ? WHERE id = ?", [
      now + 1,
      source.revisionId,
    ]);
    await db.run("UPDATE document_assets SET deleted_at = ?, updated_at = ? WHERE id = ?", [
      now + 2,
      now + 2,
      source.assetId,
    ]);
    expect(await evidence.get(created.id)).toMatchObject({
      id: created.id,
      canonicalStatus: "asset-removed",
      deletedAt: null,
    });

    await db.run("UPDATE document_assets SET deleted_at = NULL, updated_at = ? WHERE id = ?", [
      now + 3,
      source.assetId,
    ]);
    await works.softDelete(source.workId);
    expect(await evidence.get(created.id)).toMatchObject({
      id: created.id,
      canonicalStatus: "work-removed",
      deletedAt: null,
    });
  });

  it("marks Evidence historical when its Document Asset moves to a new revision", async () => {
    const source = await seedPdfSource();
    const created = (await evidence.createText(createInput(source))).evidence;

    const nextRevision = await documents.createRevision(source.assetId, {
      mimeType: "application/pdf",
      blobSha256: NEXT_BLOB_SHA256,
      byteSize: 8192,
      extractionStatus: "ready",
      expectedCurrentRevisionId: source.revisionId,
    });

    expect(nextRevision.id).not.toBe(source.revisionId);
    expect(await evidence.get(created.id)).toMatchObject({
      id: created.id,
      revisionId: source.revisionId,
      revisionStatus: "historical",
      canonicalStatus: "active",
    });
    expect((await evidence.get(created.id))?.anchor).toMatchObject({
      revisionId: source.revisionId,
    });
  });

  it("soft-deletes and restores with optimistic revision checks", async () => {
    const source = await seedPdfSource();
    const created = (await evidence.createText(createInput(source))).evidence;

    await expect(evidence.softDelete(created.id, created.updatedAt - 1)).rejects.toThrow(
      "Evidence changed; reload it before updating",
    );
    expect(await evidence.get(created.id)).toEqual(created);

    await evidence.softDelete(created.id, created.updatedAt);
    expect(await evidence.get(created.id)).toBeNull();
    const removed = await evidence.get(created.id, { includeDeleted: true });
    expect(removed?.deletedAt).not.toBeNull();
    expect(removed!.updatedAt).toBeGreaterThan(created.updatedAt);

    await expect(evidence.restore(created.id, created.updatedAt)).rejects.toThrow(
      "Evidence changed; reload it before updating",
    );
    await evidence.restore(created.id, removed!.updatedAt);
    const restored = await evidence.get(created.id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored!.updatedAt).toBeGreaterThan(removed!.updatedAt);

    await expect(evidence.restore(created.id, restored!.updatedAt)).rejects.toThrow(
      "Evidence changed; reload it before updating",
    );
  });
});
