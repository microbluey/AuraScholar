import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { AnnotationsRepo } from "./annotations";
import { AttachmentsRepo } from "./attachments";
import { ContentUnitsRepo, type ContentUnit } from "./knowledge";
import { DocumentAssetsRepo } from "./document-assets";
import { EvidenceRepo, type PdfTextEvidenceAnchorInput } from "./evidence";
import { EvidenceShelfRepo, type EvidenceShelfItem } from "./evidence-shelf";
import {
  promoteEvidenceShelfItem,
  type PromoteEvidenceShelfInput,
} from "./evidence-shelf-promotion";
import { ResearchProjectsRepo } from "./research-projects";
import { WorksRepo } from "./works";

const BLOB_HASH = "a".repeat(64);
const PDF_TEXT = "The treatment effect is robust across specifications.";
const ANNOTATION_NOTE = "Keep this result in the discussion section.";

interface Fixture {
  db: Database;
  libraryId: string;
  projectId: string;
  workId: string;
  attachmentId: string;
  assetId: string;
  revisionId: string;
  unit: ContentUnit;
  shelf: EvidenceShelfRepo;
  evidence: EvidenceRepo;
  annotations: AnnotationsRepo;
}

let fixture: Fixture;

beforeEach(async () => {
  const db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  const libraryId = await requireLocalLibraryId(db);
  const work = await new WorksRepo(db, libraryId).upsert({ title: "Promotion paper" });
  const project = await new ResearchProjectsRepo(db, libraryId).create({
    name: "Promotion project",
  });
  await new ResearchProjectsRepo(db, libraryId).addWorks(project.id, [work.id]);
  const attachment = await new AttachmentsRepo(db, libraryId).create({
    workId: work.id,
    sha256: BLOB_HASH,
    byteSize: 2048,
    originalFilename: "promotion.pdf",
    pageCount: 4,
  });
  const revision = await new DocumentAssetsRepo(db, libraryId).resolveAttachment(attachment.id);
  if (!revision) throw new Error("promotion fixture revision is missing");
  const unit = makePdfUnit({
    libraryId,
    workId: work.id,
    assetId: revision.asset_id,
    revisionId: revision.id,
  });
  await new ContentUnitsRepo(db, libraryId).upsertMany([unit]);
  fixture = {
    db,
    libraryId,
    projectId: project.id,
    workId: work.id,
    attachmentId: attachment.id,
    assetId: revision.asset_id,
    revisionId: revision.id,
    unit,
    shelf: new EvidenceShelfRepo(db, libraryId),
    evidence: new EvidenceRepo(db, libraryId),
    annotations: new AnnotationsRepo(db, libraryId),
  };
});

function makePdfUnit(input: {
  libraryId: string;
  workId: string;
  assetId: string;
  revisionId: string;
  id?: string;
  text?: string;
}): ContentUnit {
  const text = input.text ?? PDF_TEXT;
  return {
    id: input.id ?? "unit:promotion-pdf",
    libraryId: input.libraryId,
    sourceType: "pdf",
    sourceId: input.revisionId,
    workId: input.workId,
    assetId: input.assetId,
    revisionId: input.revisionId,
    parentUnitId: null,
    ordinal: 0,
    headingPath: ["Results"],
    anchor: {
      version: 1,
      kind: "pdf",
      revisionId: input.revisionId,
      pageIndex: 1,
      quote: { exact: text, prefix: "Earlier ", suffix: " Later" },
    },
    text,
    language: "en",
    tokenCount: text.split(/\s+/).length,
    // Shelf promotion intentionally trusts the immutable source hash snapshot;
    // it is independent from the attachment/blob hash for PDF units.
    contentHash: BLOB_HASH,
    extractorProfile: "promotion-test-extractor",
    chunkProfile: "promotion-test-chunker",
    state: "ready",
  };
}

function previewFor(unit: ContentUnit, sourceType = unit.sourceType, sourceId = unit.sourceId) {
  return {
    contentUnitId: unit.id,
    excerpt: unit.text,
    headingPath: unit.headingPath,
    language: unit.language,
    ordinal: unit.ordinal,
    sourceId,
    sourceType,
    text: unit.text,
    tokenCount: unit.tokenCount,
    workTitle: "Promotion paper",
  };
}

async function stage(unit = fixture.unit, preview = previewFor(unit)): Promise<EvidenceShelfItem> {
  const result = await fixture.shelf.stage({
    projectId: fixture.projectId,
    contentUnitId: unit.id,
    anchorSnapshot: unit.anchor,
    previewPayload: preview,
  });
  return result.item;
}

function promoteInput(item: EvidenceShelfItem, overrides: Partial<PromoteEvidenceShelfInput> = {}) {
  return {
    projectId: fixture.projectId,
    itemId: item.id,
    expectedUpdatedAt: item.updatedAt,
    evidenceKind: "method" as const,
    ...overrides,
  };
}

async function activeShelfRow(itemId: string): Promise<Record<string, unknown> | undefined> {
  const rows = await fixture.db.query<Record<string, unknown>>(
    `SELECT id, deleted_at, updated_at, status
       FROM evidence_shelf_items WHERE id = ?`,
    [itemId],
  );
  return rows[0];
}

describe("promoteEvidenceShelfItem", () => {
  it("promotes a PDF snapshot into canonical Evidence and consumes the Shelf row", async () => {
    const item = await stage();
    const result = await promoteEvidenceShelfItem(
      fixture.db,
      fixture.libraryId,
      promoteInput(item, {
        title: "Robustness result",
        noteMd: "Use in the methods section.",
        tags: ["causal", "robustness"],
      }),
    );

    expect(result).toMatchObject({
      created: true,
      projectMembershipAdded: true,
      removedFromShelf: true,
      evidence: {
        libraryId: fixture.libraryId,
        workId: fixture.workId,
        assetId: fixture.assetId,
        revisionId: fixture.revisionId,
        sourceKind: "document",
        evidenceKind: "method",
        text: PDF_TEXT,
        title: "Robustness result",
        noteMd: "Use in the methods section.",
        tags: ["causal", "robustness"],
        canonicalStatus: "active",
      },
    });
    expect(result.evidence.anchor).toMatchObject({
      revisionId: fixture.revisionId,
      pageIndex: 1,
      quote: { exact: PDF_TEXT },
    });
    const row = await activeShelfRow(item.id);
    expect(row?.deleted_at).toEqual(expect.any(Number));
    expect(
      await fixture.evidence.list({ scope: { kind: "project", projectId: fixture.projectId } }),
    ).toHaveLength(1);
  });

  it("uses compare-and-swap and leaves the candidate untouched after a stale retry", async () => {
    const item = await stage();
    await expect(
      promoteEvidenceShelfItem(
        fixture.db,
        fixture.libraryId,
        promoteInput(item, { expectedUpdatedAt: item.updatedAt - 1 }),
      ),
    ).rejects.toThrow("changed; reload");
    expect(await fixture.evidence.list({ scope: { kind: "library" } })).toEqual([]);
    expect(await activeShelfRow(item.id)).toMatchObject({ deleted_at: null, status: "staged" });
  });

  it("falls back to source identity when a preview ContentUnit id is stale", async () => {
    // A backup created by an older build may retain a disposable preview id.
    // Insert that immutable snapshot directly to exercise promotion's source
    // identity fallback (normal staging correctly rejects the drift).
    const itemId = "shelf:promotion-stale-preview-id";
    const now = Date.now();
    await fixture.db.run(
      `INSERT INTO evidence_shelf_items
         (id, library_id, project_id, work_id, asset_id, revision_id,
          anchor_snapshot_json, preview_payload_json, source_content_hash,
          status, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?, ?, NULL)`,
      [
        itemId,
        fixture.libraryId,
        fixture.projectId,
        fixture.workId,
        fixture.assetId,
        fixture.revisionId,
        JSON.stringify(fixture.unit.anchor),
        JSON.stringify({
          ...previewFor(fixture.unit),
          contentUnitId: "content-unit:from-an-old-backup",
        }),
        BLOB_HASH,
        now,
        now,
      ],
    );
    const item = (await fixture.shelf.get(itemId, { projectId: fixture.projectId }))!;
    const result = await promoteEvidenceShelfItem(
      fixture.db,
      fixture.libraryId,
      promoteInput(item),
    );
    expect(result.created).toBe(true);
    expect(result.evidence.text).toBe(PDF_TEXT);
  });

  it("promotes an annotation as the exact quote and carries its note by default", async () => {
    const annotationId = await fixture.annotations.create({
      attachmentId: fixture.attachmentId,
      workId: fixture.workId,
      type: "highlight",
      pageIndex: 1,
      anchor: fixture.unit.anchor,
      contentMd: ANNOTATION_NOTE,
    });
    const annotationUnit: ContentUnit = {
      ...fixture.unit,
      id: "unit:promotion-annotation",
      sourceType: "annotation",
      sourceId: annotationId,
      // Annotation extraction may include quote + note, while the promoted
      // Evidence payload remains the exact source quote.
      text: `${PDF_TEXT}\n\n${ANNOTATION_NOTE}`,
      contentHash: BLOB_HASH,
    };
    await new ContentUnitsRepo(fixture.db, fixture.libraryId).upsertMany([annotationUnit]);
    const item = await stage(annotationUnit, previewFor(annotationUnit));
    const result = await promoteEvidenceShelfItem(
      fixture.db,
      fixture.libraryId,
      promoteInput(item, { evidenceKind: "context" }),
    );

    expect(result.evidence).toMatchObject({
      sourceKind: "annotation",
      evidenceKind: "context",
      text: PDF_TEXT,
      noteMd: ANNOTATION_NOTE,
      provenance: { captureMethod: "annotation", annotationId },
    });
    expect(result.created).toBe(true);
    expect((await activeShelfRow(item.id))?.deleted_at).toEqual(expect.any(Number));
  });

  it("accepts a legacy annotation anchor when it matches the canonical revision", async () => {
    const legacyAnchor = {
      version: 1,
      pageIndex: 1,
      quote: { exact: PDF_TEXT, prefix: "Earlier ", suffix: " Later" },
    };
    const annotationId = await fixture.annotations.create({
      attachmentId: fixture.attachmentId,
      workId: fixture.workId,
      type: "highlight",
      pageIndex: 1,
      anchor: legacyAnchor,
    });
    const annotationUnit: ContentUnit = {
      ...fixture.unit,
      id: "unit:promotion-legacy-annotation",
      sourceType: "annotation",
      sourceId: annotationId,
      text: PDF_TEXT,
    };
    await new ContentUnitsRepo(fixture.db, fixture.libraryId).upsertMany([annotationUnit]);
    const item = await stage(annotationUnit, previewFor(annotationUnit));

    await expect(
      promoteEvidenceShelfItem(fixture.db, fixture.libraryId, promoteInput(item)),
    ).resolves.toMatchObject({
      created: true,
      evidence: { sourceKind: "annotation", text: PDF_TEXT },
    });
  });

  it("rolls back a newly-created Evidence when Project membership disappears", async () => {
    const item = await stage();
    await fixture.db.run(
      `UPDATE project_works SET deleted_at = ?, updated_at = ?
       WHERE project_id = ? AND work_id = ?`,
      [Date.now(), Date.now(), fixture.projectId, fixture.workId],
    );

    await expect(
      promoteEvidenceShelfItem(fixture.db, fixture.libraryId, promoteInput(item)),
    ).rejects.toThrow("not a member");
    expect(await fixture.evidence.list({ scope: { kind: "library" } })).toEqual([]);
    expect((await activeShelfRow(item.id))?.deleted_at).toBeNull();
  });

  it("rejects an orphaned Annotation without consuming its Shelf snapshot", async () => {
    const annotationId = await fixture.annotations.create({
      attachmentId: fixture.attachmentId,
      workId: fixture.workId,
      type: "highlight",
      pageIndex: 1,
      anchor: fixture.unit.anchor,
      contentMd: ANNOTATION_NOTE,
    });
    const annotationUnit: ContentUnit = {
      ...fixture.unit,
      id: "unit:promotion-orphaned-annotation",
      sourceType: "annotation",
      sourceId: annotationId,
      text: PDF_TEXT,
    };
    await new ContentUnitsRepo(fixture.db, fixture.libraryId).upsertMany([annotationUnit]);
    const item = await stage(annotationUnit, previewFor(annotationUnit));
    await fixture.annotations.setOrphaned(annotationId, true);

    await expect(
      promoteEvidenceShelfItem(fixture.db, fixture.libraryId, promoteInput(item)),
    ).rejects.toThrow("missing, removed, or unresolved");
    expect(await fixture.evidence.list({ scope: { kind: "library" } })).toEqual([]);
    expect((await activeShelfRow(item.id))?.deleted_at).toBeNull();
  });

  it("reuses an existing Evidence source without creating a duplicate", async () => {
    const created = await fixture.evidence.createText({
      id: "evidence:promotion-existing",
      workId: fixture.workId,
      attachmentId: fixture.attachmentId,
      expectedBlobSha256: BLOB_HASH,
      anchor: fixture.unit.anchor as PdfTextEvidenceAnchorInput,
      text: PDF_TEXT,
      evidenceKind: "data",
    });
    const evidenceUnit: ContentUnit = {
      ...fixture.unit,
      id: "unit:promotion-existing",
      sourceType: "evidence",
      sourceId: created.evidence.id,
      contentHash: created.evidence.sourceContentHash,
    };
    await new ContentUnitsRepo(fixture.db, fixture.libraryId).upsertMany([evidenceUnit]);
    const item = await stage(evidenceUnit, previewFor(evidenceUnit));
    const result = await promoteEvidenceShelfItem(
      fixture.db,
      fixture.libraryId,
      promoteInput(item, { evidenceKind: "data" }),
    );

    expect(result).toMatchObject({ created: false, evidence: created.evidence });
    expect(
      await fixture.db.query("SELECT id FROM evidence_items WHERE id = ?", [created.evidence.id]),
    ).toHaveLength(1);
    expect(
      await fixture.db.query(
        `SELECT evidence_id FROM project_evidence
         WHERE project_id = ? AND evidence_id = ? AND deleted_at IS NULL`,
        [fixture.projectId, created.evidence.id],
      ),
    ).toHaveLength(1);
  });

  it("reuses an active Evidence membership even after its Work membership is removed", async () => {
    const created = await fixture.evidence.createText({
      id: "evidence:promotion-membership-only",
      workId: fixture.workId,
      attachmentId: fixture.attachmentId,
      expectedBlobSha256: BLOB_HASH,
      anchor: fixture.unit.anchor as PdfTextEvidenceAnchorInput,
      text: PDF_TEXT,
      evidenceKind: "data",
    });
    await fixture.evidence.addToProject(fixture.projectId, created.evidence.id);
    await fixture.db.run(
      `UPDATE project_works SET deleted_at = ?, updated_at = ?
       WHERE project_id = ? AND work_id = ?`,
      [Date.now(), Date.now() + 1, fixture.projectId, fixture.workId],
    );
    const evidenceUnit: ContentUnit = {
      ...fixture.unit,
      id: "unit:promotion-membership-only",
      sourceType: "evidence",
      sourceId: created.evidence.id,
      contentHash: created.evidence.sourceContentHash,
    };
    await new ContentUnitsRepo(fixture.db, fixture.libraryId).upsertMany([evidenceUnit]);
    const item = await stage(evidenceUnit, previewFor(evidenceUnit));

    await expect(
      promoteEvidenceShelfItem(
        fixture.db,
        fixture.libraryId,
        promoteInput(item, { evidenceKind: "data" }),
      ),
    ).resolves.toMatchObject({ created: false, projectMembershipAdded: false });
    expect((await activeShelfRow(item.id))?.deleted_at).toEqual(expect.any(Number));
  });

  it("fails closed when the canonical source changes and keeps the Shelf candidate", async () => {
    const item = await stage();
    const replacement = makePdfUnit({
      libraryId: fixture.libraryId,
      workId: fixture.workId,
      assetId: fixture.assetId,
      revisionId: fixture.revisionId,
      id: "unit:promotion-replacement",
      text: "A changed extraction must not be promoted.",
    });
    // Preserve the anchor but change the canonical content hash/text.
    replacement.anchor = fixture.unit.anchor;
    replacement.contentHash = "b".repeat(64);
    await new ContentUnitsRepo(fixture.db, fixture.libraryId).replaceForSource({
      sourceType: "pdf",
      sourceId: fixture.revisionId,
      revisionId: fixture.revisionId,
      units: [replacement],
    });
    await expect(
      promoteEvidenceShelfItem(fixture.db, fixture.libraryId, promoteInput(item)),
    ).rejects.toThrow("missing, stale, or not citation-safe");
    expect(await fixture.evidence.list({ scope: { kind: "library" } })).toEqual([]);
    expect((await activeShelfRow(item.id))?.deleted_at).toBeNull();
  });

  it("fails closed when duplicate canonical ContentUnits make the source ambiguous", async () => {
    const item = await stage();
    await new ContentUnitsRepo(fixture.db, fixture.libraryId).upsertMany([
      { ...fixture.unit, id: "unit:promotion-duplicate" },
    ]);

    await expect(
      promoteEvidenceShelfItem(fixture.db, fixture.libraryId, promoteInput(item)),
    ).rejects.toThrow("multiple canonical ContentUnits");
    expect(await fixture.evidence.list({ scope: { kind: "library" } })).toEqual([]);
    expect((await activeShelfRow(item.id))?.deleted_at).toBeNull();
  });

  it("serializes concurrent promotions and leaves exactly one committed Evidence", async () => {
    const item = await stage();
    const results = await Promise.allSettled([
      promoteEvidenceShelfItem(fixture.db, fixture.libraryId, promoteInput(item)),
      promoteEvidenceShelfItem(fixture.db, fixture.libraryId, promoteInput(item)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await fixture.evidence.list({ scope: { kind: "library" } })).toHaveLength(1);
    expect((await activeShelfRow(item.id))?.deleted_at).toEqual(expect.any(Number));
  });
});
