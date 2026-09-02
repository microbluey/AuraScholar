import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { MIGRATIONS, runMigrations } from "../migrations";
import { AnnotationsRepo } from "./annotations";
import { AttachmentsRepo } from "./attachments";
import { ContentUnitsRepo, type ContentUnit } from "./knowledge";
import { DocumentAssetsRepo } from "./document-assets";
import {
  EvidenceShelfRepo,
  EvidenceShelfScopeError,
  type EvidenceShelfItem,
} from "./evidence-shelf";
import { ResearchProjectsRepo, type ResearchProjectRow } from "./research-projects";
import { WorksRepo, type WorkRow } from "./works";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const TEXT_A = "A citation-safe source paragraph.";
const TEXT_B = "A revised citation-safe source paragraph.";

let db: Database;
let libraryId: string;
let works: WorksRepo;
let attachments: AttachmentsRepo;
let documents: DocumentAssetsRepo;
let units: ContentUnitsRepo;
let projects: ResearchProjectsRepo;
let shelf: EvidenceShelfRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  works = new WorksRepo(db, libraryId);
  attachments = new AttachmentsRepo(db, libraryId);
  documents = new DocumentAssetsRepo(db, libraryId);
  units = new ContentUnitsRepo(db, libraryId);
  projects = new ResearchProjectsRepo(db, libraryId);
  shelf = new EvidenceShelfRepo(db, libraryId);
});

interface Seed {
  work: WorkRow;
  attachmentId: string;
  assetId: string;
  revisionId: string;
  project: ResearchProjectRow;
  unit: ContentUnit;
}

async function seedSource(): Promise<Seed> {
  const workId = (await works.upsert({ title: "Evidence Shelf source" })).id;
  const work = await works.get(workId);
  if (!work) throw new Error("seed Work is missing");
  const attachmentId = (
    await attachments.create({
      workId,
      sha256: HASH_A,
      byteSize: 1024,
      originalFilename: "source.pdf",
      pageCount: 4,
    })
  ).id;
  const revision = await documents.resolveAttachment(attachmentId);
  if (!revision) throw new Error("seed revision is missing");
  const project = await projects.create({ name: "Shelf project" });
  await projects.addWorks(project.id, [workId]);
  const unit = makeUnit({
    id: "unit:shelf-a",
    workId,
    assetId: revision.asset_id,
    revisionId: revision.id,
    sourceId: revision.id,
    hash: HASH_A,
    text: TEXT_A,
    pageIndex: 0,
  });
  await units.upsertMany([unit]);
  return {
    work,
    attachmentId,
    assetId: revision.asset_id,
    revisionId: revision.id,
    project,
    unit,
  };
}

function makeUnit(input: {
  id: string;
  workId: string;
  assetId: string;
  revisionId: string;
  sourceId: string;
  hash: string;
  text: string;
  pageIndex: number;
}): ContentUnit {
  return {
    id: input.id,
    libraryId,
    sourceType: "pdf",
    sourceId: input.sourceId,
    workId: input.workId,
    assetId: input.assetId,
    revisionId: input.revisionId,
    parentUnitId: null,
    ordinal: input.pageIndex,
    headingPath: ["Results"],
    anchor: {
      version: 1,
      kind: "pdf",
      pageIndex: input.pageIndex,
      revisionId: input.revisionId,
      quote: { exact: input.text },
    },
    text: input.text,
    language: "en",
    tokenCount: input.text.split(/\s+/).length,
    contentHash: input.hash,
    extractorProfile: "shelf-test-extractor",
    chunkProfile: "shelf-test-chunker",
    state: "ready",
  };
}

function previewFor(unit: ContentUnit, label?: string): Record<string, unknown> {
  return {
    contentUnitId: unit.id,
    excerpt: unit.text,
    headingPath: unit.headingPath,
    language: unit.language,
    ordinal: unit.ordinal,
    sourceId: unit.sourceId,
    sourceType: unit.sourceType,
    text: unit.text,
    tokenCount: unit.tokenCount,
    workTitle: "Evidence Shelf source",
    ...(label ? { label } : {}),
  };
}

describe("Evidence Shelf migration and repository", () => {
  it("registers v29 with the scoped table, indexes, and cascade foreign keys", async () => {
    expect(MIGRATIONS.at(-1)).toMatchObject({
      version: 29,
      name: "evidence_shelf_items",
    });
    const columns = await db.query<{ name: string; notnull: number }>(
      "PRAGMA table_info(evidence_shelf_items)",
    );
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "library_id",
      "project_id",
      "work_id",
      "asset_id",
      "revision_id",
      "anchor_snapshot_json",
      "preview_payload_json",
      "source_content_hash",
      "status",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);
    expect(columns.filter((column) => column.notnull).map((column) => column.name)).toEqual([
      "library_id",
      "project_id",
      "anchor_snapshot_json",
      "preview_payload_json",
      "source_content_hash",
      "status",
      "created_at",
      "updated_at",
    ]);
    const indexes = await db.query<{ name: string; unique: number }>(
      "PRAGMA index_list(evidence_shelf_items)",
    );
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "evidence_shelf_project_source_uq", unique: 1 }),
        expect.objectContaining({ name: "evidence_shelf_project_active_idx", unique: 0 }),
      ]),
    );
    const foreignKeys = await db.query<{ table: string; on_delete: string }>(
      "PRAGMA foreign_key_list(evidence_shelf_items)",
    );
    expect(
      foreignKeys
        .filter((key) => key.on_delete.toLowerCase() === "cascade")
        .map((key) => key.table),
    ).toEqual(
      expect.arrayContaining([
        "libraries",
        "research_projects",
        "works",
        "document_assets",
        "document_revisions",
      ]),
    );
  });

  it("stages canonical ContentUnits, preserves identity, and deduplicates by anchor", async () => {
    const seed = await seedSource();
    const first = await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: seed.unit.id,
      anchorSnapshot: seed.unit.anchor,
      previewPayload: previewFor(seed.unit, "first"),
    });
    expect(first.created).toBe(true);
    assertShelfItem(first.item);
    expect(first.item).toMatchObject({
      libraryId,
      projectId: seed.project.id,
      workId: seed.work.id,
      assetId: seed.assetId,
      revisionId: seed.revisionId,
      sourceContentHash: HASH_A,
      anchorSnapshot: seed.unit.anchor,
      previewPayload: { label: "first", text: TEXT_A },
      status: "staged",
      isStale: false,
    });

    await expect(
      shelf.stage({
        projectId: seed.project.id,
        contentUnitId: seed.unit.id,
        anchorSnapshot: seed.unit.anchor,
        previewPayload: { ...previewFor(seed.unit), text: TEXT_B },
      }),
    ).rejects.toThrow("does not match the canonical ContentUnit");

    const duplicate = await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: seed.unit.id,
      anchorSnapshot: seed.unit.anchor,
      previewPayload: previewFor(seed.unit, "different display"),
    });
    expect(duplicate.created).toBe(false);
    expect(duplicate.item.id).toBe(first.item.id);

    await expect(
      shelf.stage({
        itemId: first.item.id,
        projectId: seed.project.id,
        contentUnitId: seed.unit.id,
        anchorSnapshot: seed.unit.anchor,
        previewPayload: previewFor(seed.unit, "retry display"),
      }),
    ).resolves.toMatchObject({ created: false, item: { id: first.item.id } });

    const secondUnit = makeUnit({
      id: "unit:shelf-b",
      workId: seed.work.id,
      assetId: seed.assetId,
      revisionId: seed.revisionId,
      sourceId: seed.revisionId,
      hash: HASH_A,
      text: TEXT_A,
      pageIndex: 1,
    });
    await units.upsertMany([secondUnit]);
    const second = await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: secondUnit.id,
      anchorSnapshot: secondUnit.anchor,
      previewPayload: previewFor(secondUnit),
    });
    expect(second.created).toBe(true);
    expect(second.item.id).not.toBe(first.item.id);
    expect(await shelf.list(seed.project.id)).toHaveLength(2);
  });

  it("keeps PDF, Annotation, and Evidence sources distinct when their anchor and hash collide", async () => {
    const seed = await seedSource();
    const annotationId = await new AnnotationsRepo(db, libraryId).create({
      attachmentId: seed.attachmentId,
      workId: seed.work.id,
      type: "highlight",
      pageIndex: 0,
      anchor: seed.unit.anchor,
      contentMd: TEXT_A,
    });
    const annotationUnit = makeUnit({
      id: "unit:shelf-annotation-collision",
      workId: seed.work.id,
      assetId: seed.assetId,
      revisionId: seed.revisionId,
      sourceId: annotationId,
      hash: HASH_A,
      text: TEXT_A,
      pageIndex: 0,
    });
    annotationUnit.sourceType = "annotation";

    const evidenceId = "evidence:shelf-collision";
    const now = Date.now();
    await db.run(
      `INSERT INTO evidence_items
         (id, library_id, work_id, asset_id, revision_id, source_kind,
          evidence_kind, anchor_json, payload_kind, payload_json, title,
          note_md, tags_json, source_content_hash, provenance_json,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 'document', 'context', ?, 'text', ?, NULL,
               NULL, '[]', ?, '{}', ?, ?, NULL)`,
      [
        evidenceId,
        libraryId,
        seed.work.id,
        seed.assetId,
        seed.revisionId,
        JSON.stringify(seed.unit.anchor),
        JSON.stringify({ kind: "text", text: TEXT_A }),
        HASH_A,
        now,
        now,
      ],
    );
    const evidenceUnit = makeUnit({
      id: "unit:shelf-evidence-collision",
      workId: seed.work.id,
      assetId: seed.assetId,
      revisionId: seed.revisionId,
      sourceId: evidenceId,
      hash: HASH_A,
      text: TEXT_A,
      pageIndex: 0,
    });
    evidenceUnit.sourceType = "evidence";
    await units.upsertMany([annotationUnit, evidenceUnit]);

    const pdf = await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: seed.unit.id,
      anchorSnapshot: seed.unit.anchor,
      previewPayload: previewFor(seed.unit),
    });
    const annotation = await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: annotationUnit.id,
      anchorSnapshot: annotationUnit.anchor,
      previewPayload: previewFor(annotationUnit),
    });
    const evidence = await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: evidenceUnit.id,
      anchorSnapshot: evidenceUnit.anchor,
      previewPayload: previewFor(evidenceUnit),
    });

    expect(pdf.created).toBe(true);
    expect(annotation.created).toBe(true);
    expect(evidence.created).toBe(true);
    expect(new Set([pdf.item.id, annotation.item.id, evidence.item.id]).size).toBe(3);
    expect(await shelf.list(seed.project.id)).toHaveLength(3);
    expect(
      (await shelf.list(seed.project.id)).map((item) => {
        const preview = item.previewPayload as Record<string, unknown>;
        return [preview.sourceType, preview.sourceId];
      }),
    ).toEqual(
      expect.arrayContaining([
        ["pdf", seed.revisionId],
        ["annotation", annotationId],
        ["evidence", evidenceId],
      ]),
    );
  });

  it("requires an active Project and an active Work/Asset/Evidence membership", async () => {
    const seed = await seedSource();
    await expect(
      shelf.stage({
        libraryId: "library:wrong",
        projectId: seed.project.id,
        contentUnitId: seed.unit.id,
        anchorSnapshot: seed.unit.anchor,
        previewPayload: previewFor(seed.unit),
      }),
    ).rejects.toBeInstanceOf(EvidenceShelfScopeError);
    const unrelated = await projects.create({ name: "Unrelated project" });
    await expect(
      shelf.stage({
        projectId: unrelated.id,
        contentUnitId: seed.unit.id,
        anchorSnapshot: seed.unit.anchor,
        previewPayload: previewFor(seed.unit),
      }),
    ).rejects.toThrow("not a member");

    await projects.archive(unrelated.id);
    await expect(shelf.list(unrelated.id)).rejects.toThrow("missing, archived, or removed");

    const foreignLibraryId = "library:shelf-foreign";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );
    const foreignWorks = new WorksRepo(db, foreignLibraryId);
    const foreignAttachments = new AttachmentsRepo(db, foreignLibraryId);
    const foreignDocuments = new DocumentAssetsRepo(db, foreignLibraryId);
    const foreignUnits = new ContentUnitsRepo(db, foreignLibraryId);
    const foreignWork = await foreignWorks.upsert({ title: "Foreign shelf source" });
    const foreignAttachment = await foreignAttachments.create({
      workId: foreignWork.id,
      sha256: HASH_B,
      byteSize: 100,
    });
    const foreignRevision = await foreignDocuments.resolveAttachment(foreignAttachment.id);
    if (!foreignRevision) throw new Error("foreign revision is missing");
    await foreignUnits.upsertMany([
      {
        ...seed.unit,
        id: "unit:shelf-foreign",
        libraryId: foreignLibraryId,
        sourceId: foreignRevision.id,
        workId: foreignWork.id,
        assetId: foreignRevision.asset_id,
        revisionId: foreignRevision.id,
        contentHash: HASH_B,
        anchor: { ...seed.unit.anchor, revisionId: foreignRevision.id },
      },
    ]);
    await expect(
      shelf.stage({
        projectId: seed.project.id,
        contentUnitId: "unit:shelf-foreign",
        anchorSnapshot: seed.unit.anchor,
        previewPayload: previewFor(seed.unit),
      }),
    ).rejects.toBeInstanceOf(EvidenceShelfScopeError);
  });

  it("accepts a source reached only through active Project Evidence membership", async () => {
    const seed = await seedSource();
    const evidenceId = "evidence:shelf-membership";
    const now = Date.now();
    await db.run(
      `INSERT INTO evidence_items
         (id, library_id, work_id, asset_id, revision_id, source_kind,
          evidence_kind, anchor_json, payload_kind, payload_json, title,
          note_md, tags_json, source_content_hash, provenance_json,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 'document', 'context', ?, 'text', ?, NULL,
               NULL, '[]', ?, '{}', ?, ?, NULL)`,
      [
        evidenceId,
        libraryId,
        seed.work.id,
        seed.assetId,
        seed.revisionId,
        JSON.stringify({ ...seed.unit.anchor, revisionId: seed.revisionId }),
        JSON.stringify({ kind: "text", text: TEXT_A }),
        HASH_A,
        now,
        now,
      ],
    );
    await db.run(
      `INSERT INTO project_evidence
         (id, project_id, evidence_id, role, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'evidence', ?, ?, NULL)`,
      ["membership:shelf-evidence", seed.project.id, evidenceId, now, now],
    );
    await db.run(
      `UPDATE project_works SET deleted_at = ?, updated_at = ?
       WHERE project_id = ? AND work_id = ?`,
      [now, now, seed.project.id, seed.work.id],
    );
    const evidenceUnit = makeUnit({
      id: "unit:shelf-evidence",
      workId: seed.work.id,
      assetId: seed.assetId,
      revisionId: seed.revisionId,
      sourceId: evidenceId,
      hash: HASH_A,
      text: TEXT_A,
      pageIndex: 0,
    });
    evidenceUnit.sourceType = "evidence";
    await units.upsertMany([evidenceUnit]);

    const mismatchedEvidenceId = "evidence:shelf-membership-hash-mismatch";
    await db.run(
      `INSERT INTO evidence_items
         (id, library_id, work_id, asset_id, revision_id, source_kind,
          evidence_kind, anchor_json, payload_kind, payload_json, title,
          note_md, tags_json, source_content_hash, provenance_json,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 'document', 'context', ?, 'text', ?, NULL,
               NULL, '[]', ?, '{}', ?, ?, NULL)`,
      [
        mismatchedEvidenceId,
        libraryId,
        seed.work.id,
        seed.assetId,
        seed.revisionId,
        JSON.stringify({ ...seed.unit.anchor, revisionId: seed.revisionId }),
        JSON.stringify({ kind: "text", text: TEXT_A }),
        HASH_B,
        now,
        now,
      ],
    );
    await db.run(
      `INSERT INTO project_evidence
         (id, project_id, evidence_id, role, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'evidence', ?, ?, NULL)`,
      ["membership:shelf-evidence-hash-mismatch", seed.project.id, mismatchedEvidenceId, now, now],
    );
    const mismatchedUnit = { ...evidenceUnit, id: "unit:shelf-evidence-hash-mismatch" };
    mismatchedUnit.sourceId = mismatchedEvidenceId;
    await units.upsertMany([mismatchedUnit]);
    await expect(
      shelf.stage({
        projectId: seed.project.id,
        contentUnitId: mismatchedUnit.id,
        anchorSnapshot: mismatchedUnit.anchor,
        previewPayload: previewFor(mismatchedUnit),
      }),
    ).rejects.toThrow("not a member");

    await expect(
      shelf.stage({
        projectId: seed.project.id,
        contentUnitId: evidenceUnit.id,
        anchorSnapshot: evidenceUnit.anchor,
        previewPayload: previewFor(evidenceUnit),
      }),
    ).resolves.toMatchObject({ created: true, item: { sourceContentHash: HASH_A } });
  });

  it("reports hash and revision replacement as stale and validates save snapshots", async () => {
    const seed = await seedSource();
    const staged = await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: seed.unit.id,
      anchorSnapshot: seed.unit.anchor,
      previewPayload: previewFor(seed.unit),
    });

    const changed = makeUnit({
      id: "unit:shelf-a-replaced",
      workId: seed.work.id,
      assetId: seed.assetId,
      revisionId: seed.revisionId,
      sourceId: seed.revisionId,
      hash: HASH_B,
      text: TEXT_B,
      pageIndex: 0,
    });
    // Keep the source anchor stable while the extracted payload/hash changes.
    changed.anchor = seed.unit.anchor;
    await units.replaceForSource({
      sourceType: "pdf",
      sourceId: seed.revisionId,
      revisionId: seed.revisionId,
      units: [changed],
    });
    const hashStale = (await shelf.list(seed.project.id))[0]!;
    expect(hashStale).toMatchObject({
      id: staged.item.id,
      isStale: true,
      status: "stale",
      currentSourceContentHash: HASH_B,
    });
    await expect(
      shelf.resolveForSave({
        projectId: seed.project.id,
        itemId: staged.item.id,
        expectedRevisionId: seed.revisionId,
        expectedSourceContentHash: HASH_A,
      }),
    ).resolves.toMatchObject({ stale: true, item: { id: staged.item.id, status: "stale" } });

    await units.replaceForSource({
      sourceType: "pdf",
      sourceId: seed.revisionId,
      revisionId: seed.revisionId,
      units: [seed.unit],
    });
    // A previously persisted stale marker remains until the caller explicitly
    // revalidates for save. Dynamic isStale can recover when the source is
    // restored, but silently changing status would bypass that confirmation.
    await expect(shelf.list(seed.project.id)).resolves.toMatchObject([
      { id: staged.item.id, isStale: false, status: "stale" },
    ]);
    await expect(
      shelf.resolveForSave(staged.item.id, seed.revisionId, HASH_A, seed.project.id),
    ).resolves.toMatchObject({ stale: false, item: { status: "staged", isStale: false } });

    await projects.create({ name: "Shelf resolve sibling" });
    await projects.archive(seed.project.id);
    await expect(shelf.resolveForSave(staged.item.id, seed.revisionId, HASH_A)).rejects.toThrow(
      "missing, archived, or removed",
    );
    await projects.restore(seed.project.id);

    const nextRevision = await documents.createRevision(seed.assetId, {
      id: "revision:shelf-next",
      mimeType: "application/pdf",
      blobSha256: HASH_B,
      byteSize: 200,
      extractionStatus: "ready",
      expectedCurrentRevisionId: seed.revisionId,
    });
    const revisionStale = (await shelf.list(seed.project.id))[0]!;
    expect(revisionStale).toMatchObject({
      isStale: true,
      currentRevisionId: nextRevision.id,
      currentSourceContentHash: null,
    });
  });

  it("soft-removes, clears, restores, and honors optimistic timestamps", async () => {
    const seed = await seedSource();
    const staged = await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: seed.unit.id,
      anchorSnapshot: seed.unit.anchor,
      previewPayload: previewFor(seed.unit),
    });
    const before = staged.item.updatedAt;
    await expect(shelf.remove(seed.project.id, staged.item.id, before - 1)).rejects.toThrow(
      "changed; reload",
    );
    await expect(shelf.remove(seed.project.id, staged.item.id, before)).resolves.toBe(true);
    await expect(shelf.get(staged.item.id)).resolves.toBeNull();
    await expect(
      shelf.list({ projectId: seed.project.id, includeDeleted: true }),
    ).resolves.toMatchObject([{ id: staged.item.id, deletedAt: expect.any(Number) }]);
    await expect(
      shelf.stage({
        projectId: seed.project.id,
        contentUnitId: seed.unit.id,
        anchorSnapshot: seed.unit.anchor,
        previewPayload: previewFor(seed.unit),
      }),
    ).resolves.toMatchObject({
      created: false,
      item: { id: staged.item.id, deletedAt: null },
    });

    const secondUnit = makeUnit({
      id: "unit:shelf-clear",
      workId: seed.work.id,
      assetId: seed.assetId,
      revisionId: seed.revisionId,
      sourceId: seed.revisionId,
      hash: HASH_A,
      text: TEXT_A,
      pageIndex: 2,
    });
    await units.upsertMany([secondUnit]);
    await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: secondUnit.id,
      anchorSnapshot: secondUnit.anchor,
      previewPayload: previewFor(secondUnit),
    });
    await expect(shelf.clear(seed.project.id)).resolves.toBe(2);
    await expect(shelf.list(seed.project.id)).resolves.toEqual([]);
  });

  it("cascades Project deletes and permanently purges Work-owned shelf rows", async () => {
    const seed = await seedSource();
    const siblingProject = await projects.create({ name: "Sibling active project" });
    await projects.addWorks(siblingProject.id, [seed.work.id]);
    const staged = await shelf.stage({
      projectId: seed.project.id,
      contentUnitId: seed.unit.id,
      anchorSnapshot: seed.unit.anchor,
      previewPayload: previewFor(seed.unit),
    });
    await db.run("DELETE FROM research_projects WHERE id = ?", [seed.project.id]);
    expect(
      await db.query("SELECT id FROM evidence_shelf_items WHERE id = ?", [staged.item.id]),
    ).toEqual([]);

    const second = await shelf.stage({
      projectId: siblingProject.id,
      contentUnitId: seed.unit.id,
      anchorSnapshot: seed.unit.anchor,
      previewPayload: previewFor(seed.unit),
    });
    await works.softDelete(seed.work.id);
    await works.purgeDeleted(seed.work.id);
    expect(
      await db.query("SELECT id FROM evidence_shelf_items WHERE id = ?", [second.item.id]),
    ).toEqual([]);
  });
});

// Keep this assertion close to the fixtures so a future source-unit schema
// change cannot silently make all staged rows stale.
function assertShelfItem(item: EvidenceShelfItem): void {
  expect(item.sourceContentHash).toMatch(/^[0-9a-f]{64}$/);
}

void assertShelfItem;
