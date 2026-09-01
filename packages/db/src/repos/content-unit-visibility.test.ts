import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { ContentUnitSearchRepo, ContentUnitsRepo, type ContentUnit } from "./knowledge";
import { AnnotationsRepo } from "./annotations";
import { AttachmentsRepo } from "./attachments";
import { KnowledgeIndexesRepo } from "./knowledge-indexes";
import { DocumentAssetsRepo } from "./document-assets";
import { EvidenceRepo } from "./evidence";
import { WorksRepo } from "./works";

let db: Database;
let libraryId: string;
let units: ContentUnitsRepo;
let search: ContentUnitSearchRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  units = new ContentUnitsRepo(db, libraryId);
  search = new ContentUnitSearchRepo(db, libraryId);
});

describe("canonical ContentUnit visibility", () => {
  it("returns only the current PDF revision and hides removed canonical parents", async () => {
    const works = new WorksRepo(db, libraryId);
    const assets = new DocumentAssetsRepo(db, libraryId);
    const work = await works.upsert({ title: "Canonical visibility paper" });
    const asset = await assets.create({ workId: work.id, kind: "pdf", title: "paper.pdf" });
    const first = await assets.createRevision(asset.id, {
      id: "revision:visibility-first",
      mimeType: "application/pdf",
      blobSha256: "1".repeat(64),
      byteSize: 10,
      extractionStatus: "ready",
    });
    const second = await assets.createRevision(asset.id, {
      id: "revision:visibility-second",
      mimeType: "application/pdf",
      blobSha256: "2".repeat(64),
      byteSize: 20,
      extractionStatus: "ready",
    });
    const oldUnit = pdfUnit("content-unit:visibility-old", first.id, asset.id, work.id, {
      text: "historical revision should never win default retrieval",
      contentHash: "a".repeat(64),
    });
    const currentUnit = pdfUnit("content-unit:visibility-current", second.id, asset.id, work.id, {
      text: "current revision remains available for default retrieval",
      contentHash: "b".repeat(64),
      ordinal: 1,
    });
    await units.upsertMany([oldUnit, currentUnit]);

    await expect(search.search({ query: "revision retrieval" })).resolves.toMatchObject([
      { id: currentUnit.id },
    ]);
    await expect(search.listReadySourceIds()).resolves.toEqual([second.id]);
    await expect(
      search.findReadyByIds({ contentUnitIds: [oldUnit.id, currentUnit.id] }),
    ).resolves.toMatchObject([{ id: currentUnit.id }]);
    await expect(units.get(oldUnit.id)).resolves.toBeNull();
    await expect(units.listForSource("pdf", first.id)).resolves.toEqual([]);
    await expect(units.get(oldUnit.id, { includeHistorical: true })).resolves.toMatchObject({
      id: oldUnit.id,
      revisionId: first.id,
    });
    await expect(
      units.listForSource("pdf", first.id, { includeHistorical: true }),
    ).resolves.toMatchObject([{ id: oldUnit.id, revisionId: first.id }]);
    await expect(units.getIndexStats()).resolves.toMatchObject({
      total: 1,
      ready: 1,
      sourceCounts: { pdf: 1, annotation: 0, evidence: 0 },
    });

    await works.softDelete(work.id);
    await expect(search.search({ query: "current revision" })).resolves.toEqual([]);
    await expect(search.listReadySourceIds()).resolves.toEqual([]);

    await works.restore(work.id);
    await db.run(`UPDATE document_assets SET deleted_at = 900, updated_at = 900 WHERE id = ?`, [
      asset.id,
    ]);
    await expect(search.search({ query: "current revision" })).resolves.toEqual([]);
  });

  it("rejects cross-Library parent links and keeps legacy detached fixtures readable", async () => {
    const foreignLibraryId = "library:visibility-foreign";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign visibility library', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );
    const foreignWork = await new WorksRepo(db, foreignLibraryId).upsert({
      title: "Foreign parent",
    });
    const mismatched = pdfUnit(
      "content-unit:visibility-cross-library",
      "revision:missing",
      null,
      foreignWork.id,
      {
        text: "cross library parent must be invisible",
      },
    );
    const detached = pdfUnit("content-unit:visibility-detached", "revision:legacy", null, null, {
      text: "legacy detached unit remains readable",
      contentHash: "c".repeat(64),
    });
    await units.upsertMany([mismatched, detached]);

    await expect(search.search({ query: "parent invisible" })).resolves.toEqual([]);
    await expect(search.search({ query: "legacy detached" })).resolves.toMatchObject([
      { id: detached.id },
    ]);
  });

  it("hides soft-deleted Annotation and Evidence sources before their units are retired", async () => {
    const work = await new WorksRepo(db, libraryId).upsert({ title: "Short-source paper" });
    const attachment = await new AttachmentsRepo(db, libraryId).create({
      workId: work.id,
      sha256: "a".repeat(64),
      byteSize: 10,
      pageCount: 1,
    });
    const source = (
      await db.query<{ asset_id: string; revision_id: string }>(
        `SELECT revision.asset_id, revision.id AS revision_id
         FROM document_revisions revision
         WHERE revision.attachment_id = ?
         LIMIT 1`,
        [attachment.id],
      )
    )[0]!;
    const annotationId = await new AnnotationsRepo(db, libraryId).create({
      attachmentId: attachment.id,
      workId: work.id,
      type: "highlight",
      pageIndex: 0,
      contentMd: "annotation source text",
    });
    const evidence = await new EvidenceRepo(db, libraryId).createText({
      id: "evidence:visibility",
      workId: work.id,
      attachmentId: attachment.id,
      expectedBlobSha256: "a".repeat(64),
      anchor: {
        version: 1,
        kind: "pdf",
        pageIndex: 0,
        quote: { exact: "evidence source text" },
      },
      text: "evidence source text",
      evidenceKind: "definition",
    });
    const annotationUnit = sourceUnit(
      "content-unit:annotation-visibility",
      "annotation",
      annotationId,
      {
        workId: work.id,
        assetId: source.asset_id,
        revisionId: source.revision_id,
        text: "annotation source text",
        contentHash: "b".repeat(64),
      },
    );
    const evidenceUnit = sourceUnit(
      "content-unit:evidence-visibility",
      "evidence",
      evidence.evidence.id,
      {
        workId: work.id,
        assetId: source.asset_id,
        revisionId: source.revision_id,
        text: "evidence source text",
        contentHash: "c".repeat(64),
        ordinal: 1,
      },
    );
    await units.upsertMany([annotationUnit, evidenceUnit]);

    await expect(
      search.search({ query: "source text", sourceTypes: ["annotation", "evidence"] }),
    ).resolves.toMatchObject([{ id: annotationUnit.id }, { id: evidenceUnit.id }]);
    await new AnnotationsRepo(db, libraryId).softDelete(annotationId);
    await expect(
      search.search({ query: "annotation source", sourceTypes: ["annotation"] }),
    ).resolves.toEqual([]);
    await new EvidenceRepo(db, libraryId).softDelete(
      evidence.evidence.id,
      evidence.evidence.updatedAt,
    );
    await expect(
      search.search({ query: "evidence source", sourceTypes: ["evidence"] }),
    ).resolves.toEqual([]);
  });

  it("does not pin a historical unit and rejects a stale entry after a current switch", async () => {
    const works = new WorksRepo(db, libraryId);
    const assets = new DocumentAssetsRepo(db, libraryId);
    const work = await works.upsert({ title: "Generation visibility paper" });
    const asset = await assets.create({ workId: work.id, kind: "pdf", title: "generation.pdf" });
    const first = await assets.createRevision(asset.id, {
      id: "revision:generation-first",
      mimeType: "application/pdf",
      blobSha256: "3".repeat(64),
      byteSize: 10,
    });
    const firstUnit = pdfUnit("content-unit:generation-first", first.id, asset.id, work.id);
    await units.upsertMany([firstUnit]);

    const second = await assets.createRevision(asset.id, {
      id: "revision:generation-second",
      mimeType: "application/pdf",
      blobSha256: "4".repeat(64),
      byteSize: 10,
    });
    const secondUnit = pdfUnit("content-unit:generation-second", second.id, asset.id, work.id, {
      contentHash: "d".repeat(64),
    });
    await units.upsertMany([secondUnit]);

    const indexes = new KnowledgeIndexesRepo(db, libraryId);
    const generation = await indexes.begin({ mode: "fulltext", now: 10 });
    expect(generation.expectedCount).toBe(1);

    // Bypass the outbox only to isolate canonical validation from snapshot
    // sequencing: the generation must still refuse the now-historical unit.
    await db.run(
      `UPDATE document_assets SET current_revision_id = ?, updated_at = 12 WHERE id = ?`,
      [first.id, asset.id],
    );
    await expect(
      db.run(
        `INSERT INTO knowledge_index_entries
           (index_id, content_unit_id, content_hash, vector_ref, status, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'ready', 11, 11)`,
        [generation.id, secondUnit.id, secondUnit.contentHash],
      ),
    ).rejects.toThrow("visible ready ContentUnit");
    await expect(indexes.activate(generation.id, { now: 13 })).rejects.toThrow(
      "stale or incompatible entries",
    );
  });
});

function pdfUnit(
  id: string,
  revisionId: string,
  assetId: string | null,
  workId: string | null,
  overrides: Partial<ContentUnit> = {},
): ContentUnit {
  return {
    id,
    libraryId,
    sourceType: "pdf",
    sourceId: revisionId,
    workId,
    assetId,
    revisionId: assetId ? revisionId : null,
    parentUnitId: null,
    ordinal: 0,
    headingPath: ["Methods"],
    anchor: { kind: "pdf", pageIndex: 0, revisionId, version: 1 },
    text: `Visibility text for ${id}`,
    language: "en",
    tokenCount: 4,
    contentHash: "0".repeat(64),
    extractorProfile: "test-extractor-v1",
    chunkProfile: "test-chunk-v1",
    state: "ready",
    ...overrides,
  };
}

function sourceUnit(
  id: string,
  sourceType: "annotation" | "evidence",
  sourceId: string,
  overrides: Partial<ContentUnit> = {},
): ContentUnit {
  const revisionId = overrides.revisionId ?? "revision:source";
  return {
    ...pdfUnit(id, revisionId, null, null, overrides),
    sourceType,
    sourceId,
    anchor: { kind: "pdf", pageIndex: 0, revisionId, version: 1 },
  };
}
