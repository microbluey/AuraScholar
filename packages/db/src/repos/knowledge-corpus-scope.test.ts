import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import {
  documentAssetIdFromAttachment,
  documentRevisionIdFromAttachment,
  projectAssetMembershipId,
} from "../ids";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { AnnotationsRepo } from "./annotations";
import { AttachmentsRepo } from "./attachments";
import { DocumentAssetsRepo } from "./document-assets";
import { EvidenceRepo } from "./evidence";
import { ContentUnitsRepo, type ContentUnit } from "./knowledge";
import { KnowledgeCorpusScopeError, KnowledgeCorpusScopeRepo } from "./knowledge-corpus-scope";
import { ResearchProjectsRepo } from "./research-projects";
import { WorksRepo } from "./works";

let db: Database;
let libraryId: string;
let scope: KnowledgeCorpusScopeRepo;
let units: ContentUnitsRepo;
let works: WorksRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  scope = new KnowledgeCorpusScopeRepo(db, libraryId);
  units = new ContentUnitsRepo(db, libraryId);
  works = new WorksRepo(db, libraryId);
});

describe("KnowledgeCorpusScopeRepo", () => {
  it("resolves only canonical active sources and separates ready from context-only", async () => {
    const work = await works.upsert({ title: "Canonical corpus scope" });
    const source = await createAttachmentSource(work.id, "a");
    const annotationId = await new AnnotationsRepo(db, libraryId).create({
      attachmentId: source.attachmentId,
      workId: work.id,
      type: "note",
      pageIndex: 0,
      contentMd: "Context-only observation",
    });
    const current = await new DocumentAssetsRepo(db, libraryId).createRevision(source.assetId, {
      id: "revision:scope-current",
      mimeType: "application/pdf",
      blobSha256: "b".repeat(64),
      byteSize: 20,
      extractionStatus: "ready",
    });

    await units.upsertMany([
      pdfUnit("unit:scope-historical", source.revisionId, source.assetId, work.id, "1"),
      pdfUnit("unit:scope-current", current.id, source.assetId, work.id, "2"),
      sourceUnit({
        id: "unit:scope-annotation",
        sourceType: "annotation",
        sourceId: annotationId,
        workId: work.id,
        assetId: source.assetId,
        revisionId: source.revisionId,
        state: "context-only",
        hashCharacter: "3",
      }),
    ]);

    const expected = {
      allSourceIds: [annotationId, current.id].sort(),
      readySourceIds: [current.id],
    };
    await expect(scope.resolve({ kind: "library" })).resolves.toEqual(expected);
    await expect(scope.resolve({ kind: "asset", assetId: source.assetId })).resolves.toEqual(
      expected,
    );

    await db.run(`UPDATE annotations SET deleted_at = 10, updated_at = 10 WHERE id = ?`, [
      annotationId,
    ]);
    await expect(scope.resolve({ kind: "library" })).resolves.toEqual({
      allSourceIds: [current.id],
      readySourceIds: [current.id],
    });
  });

  it("validates every Work and Asset selection against active Library ownership", async () => {
    const first = await works.upsert({ title: "Selected Work" });
    const second = await works.upsert({ title: "Unselected Work" });
    const firstSource = await seedPdf(first.id, "c", "unit:work-selected");
    await seedPdf(second.id, "d", "unit:work-unselected");

    await expect(scope.resolve({ kind: "works", workIds: [first.id] })).resolves.toEqual({
      allSourceIds: [firstSource.revisionId],
      readySourceIds: [firstSource.revisionId],
    });
    await expect(scope.resolve({ kind: "works", workIds: [] })).resolves.toEqual({
      allSourceIds: [],
      readySourceIds: [],
    });

    const foreignLibraryId = await createForeignLibrary("works");
    const foreignWork = await new WorksRepo(db, foreignLibraryId).upsert({
      title: "Foreign Work",
    });
    await expect(
      scope.resolve({ kind: "works", workIds: [first.id, foreignWork.id] }),
    ).rejects.toBeInstanceOf(KnowledgeCorpusScopeError);
    await expect(
      scope.resolve({
        kind: "asset",
        assetId: await foreignAsset(foreignLibraryId, foreignWork.id),
      }),
    ).rejects.toBeInstanceOf(KnowledgeCorpusScopeError);

    await works.softDelete(first.id);
    await expect(scope.resolve({ kind: "works", workIds: [first.id] })).rejects.toThrow(
      `Work ${first.id} is missing or removed`,
    );
    await expect(scope.resolve({ kind: "asset", assetId: firstSource.assetId })).rejects.toThrow(
      "has a removed Work",
    );
  });

  it("unions active Project Work, Asset, and Evidence memberships", async () => {
    const projects = new ResearchProjectsRepo(db, libraryId);
    const project = await projects.ensureDefault();
    const workMember = await works.upsert({ title: "Project Work member" });
    const assetMember = await works.upsert({ title: "Project Asset member" });
    const evidenceMember = await works.upsert({ title: "Project Evidence member" });
    const unrelated = await works.upsert({ title: "Unrelated source" });

    const workSource = await seedPdf(workMember.id, "e", "unit:project-work");
    const assetSource = await seedPdf(assetMember.id, "f", "unit:project-asset");
    const evidenceSource = await createAttachmentSource(evidenceMember.id, "7");
    await seedPdf(unrelated.id, "8", "unit:project-unrelated");
    await projects.addWorks(project.id, [workMember.id]);
    await addProjectAsset(project.id, assetSource.assetId);

    // Evidence membership is valid when either its Work or Asset is already a
    // Project source. Remove that source membership afterwards to prove the
    // dedicated project_evidence branch remains authoritative on its own.
    await addProjectAsset(project.id, evidenceSource.assetId);
    const evidence = await new EvidenceRepo(db, libraryId).createText({
      id: "evidence:project-scope",
      workId: evidenceMember.id,
      attachmentId: evidenceSource.attachmentId,
      expectedBlobSha256: "7".repeat(64),
      anchor: {
        version: 1,
        kind: "pdf",
        pageIndex: 0,
        quote: { exact: "Project-scoped evidence" },
      },
      text: "Project-scoped evidence",
      evidenceKind: "context",
    });
    await new EvidenceRepo(db, libraryId).addToProject(project.id, evidence.evidence.id);
    await tombstoneProjectAsset(project.id, evidenceSource.assetId);
    await units.upsertMany([
      sourceUnit({
        id: "unit:project-evidence",
        sourceType: "evidence",
        sourceId: evidence.evidence.id,
        workId: evidenceMember.id,
        assetId: evidenceSource.assetId,
        revisionId: evidenceSource.revisionId,
        state: "ready",
        hashCharacter: "9",
      }),
    ]);

    await expect(scope.resolve({ kind: "project", projectId: project.id })).resolves.toEqual({
      allSourceIds: [workSource.revisionId, assetSource.revisionId, evidence.evidence.id].sort(),
      readySourceIds: [workSource.revisionId, assetSource.revisionId, evidence.evidence.id].sort(),
    });

    await db.run(
      `UPDATE project_works SET deleted_at = 30, updated_at = 30
       WHERE project_id = ? AND work_id = ?`,
      [project.id, workMember.id],
    );
    await tombstoneProjectAsset(project.id, assetSource.assetId);
    await db.run(
      `UPDATE project_evidence SET deleted_at = 31, updated_at = 31
       WHERE project_id = ? AND evidence_id = ?`,
      [project.id, evidence.evidence.id],
    );
    await expect(scope.resolve({ kind: "project", projectId: project.id })).resolves.toEqual({
      allSourceIds: [],
      readySourceIds: [],
    });
  });

  it("rejects archived, removed, and cross-Library Projects without partial fallback", async () => {
    const projects = new ResearchProjectsRepo(db, libraryId);
    await projects.ensureDefault();
    const archived = await projects.create({ name: "Archived scope" });
    await projects.archive(archived.id);

    await expect(scope.resolve({ kind: "project", projectId: archived.id })).rejects.toThrow(
      "missing, archived, or removed",
    );
    await db.run(`UPDATE research_projects SET deleted_at = 20 WHERE id = ?`, [archived.id]);
    await expect(scope.resolve({ kind: "project", projectId: archived.id })).rejects.toThrow(
      "missing, archived, or removed",
    );

    const foreignLibraryId = await createForeignLibrary("project");
    const foreign = await new ResearchProjectsRepo(db, foreignLibraryId).ensureDefault();
    await expect(scope.resolve({ kind: "project", projectId: foreign.id })).rejects.toBeInstanceOf(
      KnowledgeCorpusScopeError,
    );

    await db.run(`UPDATE libraries SET deleted_at = 40 WHERE id = ?`, [libraryId]);
    await expect(scope.resolve({ kind: "library" })).rejects.toThrow(
      `Library ${libraryId} is missing or removed`,
    );
  });
});

interface AttachmentSource {
  attachmentId: string;
  assetId: string;
  revisionId: string;
}

async function createAttachmentSource(
  workId: string,
  hashCharacter: string,
): Promise<AttachmentSource> {
  const attachment = await new AttachmentsRepo(db, libraryId).create({
    workId,
    sha256: hashCharacter.repeat(64),
    byteSize: 10,
    pageCount: 1,
  });
  return {
    attachmentId: attachment.id,
    assetId: documentAssetIdFromAttachment(attachment.id),
    revisionId: documentRevisionIdFromAttachment(attachment.id),
  };
}

async function seedPdf(
  workId: string,
  hashCharacter: string,
  unitId: string,
): Promise<AttachmentSource> {
  const source = await createAttachmentSource(workId, hashCharacter);
  await units.upsertMany([
    pdfUnit(unitId, source.revisionId, source.assetId, workId, hashCharacter),
  ]);
  return source;
}

function pdfUnit(
  id: string,
  revisionId: string,
  assetId: string,
  workId: string,
  hashCharacter: string,
): ContentUnit {
  return sourceUnit({
    id,
    sourceType: "pdf",
    sourceId: revisionId,
    workId,
    assetId,
    revisionId,
    state: "ready",
    hashCharacter,
  });
}

function sourceUnit(input: {
  id: string;
  sourceType: ContentUnit["sourceType"];
  sourceId: string;
  workId: string;
  assetId: string;
  revisionId: string;
  state: ContentUnit["state"];
  hashCharacter: string;
}): ContentUnit {
  return {
    id: input.id,
    libraryId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    workId: input.workId,
    assetId: input.assetId,
    revisionId: input.revisionId,
    parentUnitId: null,
    ordinal: 0,
    headingPath: ["Scope"],
    anchor: { version: 1, kind: "pdf", pageIndex: 0, revisionId: input.revisionId },
    text: `Corpus source ${input.id}`,
    language: "en",
    tokenCount: 3,
    contentHash: input.hashCharacter.repeat(64),
    extractorProfile: "test-extractor-v1",
    chunkProfile: "test-chunk-v1",
    state: input.state,
  };
}

async function addProjectAsset(projectId: string, assetId: string): Promise<void> {
  const now = Date.now();
  await db.run(
    `INSERT INTO project_assets
       (id, project_id, asset_id, role, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'source', ?, ?, NULL)`,
    [projectAssetMembershipId(projectId, assetId), projectId, assetId, now, now],
  );
}

async function tombstoneProjectAsset(projectId: string, assetId: string): Promise<void> {
  await db.run(
    `UPDATE project_assets SET deleted_at = 20, updated_at = 20
     WHERE project_id = ? AND asset_id = ?`,
    [projectId, assetId],
  );
}

async function createForeignLibrary(label: string): Promise<string> {
  const id = `library:scope-foreign-${label}`;
  const now = Date.now();
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
     VALUES (?, ?, 'personal', ?, ?, NULL)`,
    [id, `Foreign ${label}`, now, now],
  );
  return id;
}

async function foreignAsset(foreignLibraryId: string, workId: string): Promise<string> {
  const asset = await new DocumentAssetsRepo(db, foreignLibraryId).create({
    workId,
    kind: "pdf",
    title: "foreign.pdf",
  });
  return asset.id;
}
