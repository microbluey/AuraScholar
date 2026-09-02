import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { documentAssetIdFromAttachment, documentRevisionIdFromAttachment } from "../ids";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { AttachmentsRepo } from "./attachments";
import { EvidenceRepo } from "./evidence";
import { ResearchProjectsRepo } from "./research-projects";
import { WorksRepo } from "./works";

const BLOB_SHA256 = "a".repeat(64);
const QUOTE = "Stable source quote.";

let db: Database;
let libraryId: string;
let works: WorksRepo;
let attachments: AttachmentsRepo;
let evidence: EvidenceRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  works = new WorksRepo(db, libraryId);
  attachments = new AttachmentsRepo(db, libraryId);
  evidence = new EvidenceRepo(db, libraryId);
});

async function seedEvidence(workId: string, attachmentId: string, id = "evidence:lifecycle") {
  return evidence.createText({
    id,
    workId,
    attachmentId,
    expectedBlobSha256: BLOB_SHA256,
    anchor: {
      version: 1,
      kind: "pdf",
      pageIndex: 0,
      quote: { exact: QUOTE },
    },
    text: QUOTE,
    evidenceKind: "context",
  });
}

async function seedShelfRow(input: {
  id: string;
  workId: string;
  attachmentId: string;
  deletedAt?: number | null;
}): Promise<{ projectId: string; assetId: string; revisionId: string }> {
  const projects = new ResearchProjectsRepo(db, libraryId);
  const project = await projects.create({ name: `Shelf merge ${input.id}` });
  await projects.addWorks(project.id, [input.workId]);
  const assetId = documentAssetIdFromAttachment(input.attachmentId);
  const revisionId = documentRevisionIdFromAttachment(input.attachmentId);
  const now = Date.now();
  await db.run(
    `INSERT INTO evidence_shelf_items
       (id, library_id, project_id, work_id, asset_id, revision_id,
        anchor_snapshot_json, preview_payload_json, source_content_hash,
        status, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?, ?, ?)`,
    [
      input.id,
      libraryId,
      project.id,
      input.workId,
      assetId,
      revisionId,
      JSON.stringify({ version: 1, kind: "pdf", pageIndex: 0 }),
      JSON.stringify({ sourceType: "pdf", sourceId: revisionId }),
      BLOB_SHA256,
      now,
      now,
      input.deletedAt ?? null,
    ],
  );
  return { projectId: project.id, assetId, revisionId };
}

describe("Work knowledge lifecycle", () => {
  it("detaches a retired duplicate attachment before retargeting its canonical asset", async () => {
    const primary = await works.upsert({ title: "Primary Work", doi: "10.1/primary" });
    const duplicate = await works.upsert({ title: "Duplicate Work", doi: "10.1/duplicate" });
    await attachments.create({ workId: primary.id, sha256: BLOB_SHA256, byteSize: 4096 });
    const duplicateAttachment = await attachments.create({
      workId: duplicate.id,
      sha256: BLOB_SHA256,
      byteSize: 4096,
    });
    const created = await seedEvidence(duplicate.id, duplicateAttachment.id);

    await works.mergeInto(primary.id, [duplicate.id]);

    const revision = (
      await db.query<{
        asset_id: string;
        attachment_id: string | null;
        availability_status: string;
      }>(
        `SELECT asset_id, attachment_id, availability_status
         FROM document_revisions WHERE id = ?`,
        [documentRevisionIdFromAttachment(duplicateAttachment.id)],
      )
    )[0];
    expect(revision).toEqual({
      asset_id: documentAssetIdFromAttachment(duplicateAttachment.id),
      attachment_id: null,
      availability_status: "relink-required",
    });
    const asset = await db.query<{ work_id: string }>(
      "SELECT work_id FROM document_assets WHERE id = ?",
      [revision!.asset_id],
    );
    expect(asset[0]?.work_id).toBe(primary.id);
    expect(await evidence.get(created.evidence.id)).toMatchObject({
      workId: primary.id,
      assetId: revision!.asset_id,
      canonicalStatus: "active",
      availabilityStatus: "relink-required",
    });
  });

  it("blocks a Work merge while an active Evidence Shelf candidate references the duplicate", async () => {
    const primary = await works.upsert({ title: "Shelf merge primary" });
    const duplicate = await works.upsert({ title: "Shelf merge duplicate" });
    const duplicateAttachment = await attachments.create({
      workId: duplicate.id,
      sha256: "shelf-merge-active",
      byteSize: 4096,
    });
    const shelf = await seedShelfRow({
      id: "shelf:merge-active",
      workId: duplicate.id,
      attachmentId: duplicateAttachment.id,
    });

    await expect(works.mergeInto(primary.id, [duplicate.id])).rejects.toThrow(
      "Evidence Shelf candidates must be cleared first",
    );
    expect(await works.get(primary.id)).toMatchObject({ deleted_at: null });
    expect(await works.get(duplicate.id)).toMatchObject({ deleted_at: null });
    expect(
      await db.query<{ work_id: string }>("SELECT work_id FROM document_assets WHERE id = ?", [
        shelf.assetId,
      ]),
    ).toEqual([{ work_id: duplicate.id }]);
    expect(
      await db.query<{ id: string; deleted_at: number | null }>(
        "SELECT id, deleted_at FROM evidence_shelf_items WHERE id = ?",
        ["shelf:merge-active"],
      ),
    ).toEqual([{ id: "shelf:merge-active", deleted_at: null }]);
  });

  it("compacts a cleared Shelf tombstone before merging its duplicate Work", async () => {
    const primary = await works.upsert({ title: "Shelf tombstone primary" });
    const duplicate = await works.upsert({ title: "Shelf tombstone duplicate" });
    const duplicateAttachment = await attachments.create({
      workId: duplicate.id,
      sha256: "shelf-merge-tombstone",
      byteSize: 4096,
    });
    const shelf = await seedShelfRow({
      id: "shelf:merge-tombstone",
      workId: duplicate.id,
      attachmentId: duplicateAttachment.id,
      deletedAt: Date.now(),
    });
    await db.run(
      `INSERT INTO sync_row_clocks
         (table_name, row_id, library_id, column_hlcs_json, updated_at)
       VALUES ('evidence_shelf_items', ?, ?, '{}', ?)`,
      ["shelf:merge-tombstone", libraryId, Date.now()],
    );

    await expect(works.mergeInto(primary.id, [duplicate.id])).resolves.toMatchObject({
      merged: 1,
    });
    expect(
      await db.query("SELECT id FROM evidence_shelf_items WHERE id = ?", ["shelf:merge-tombstone"]),
    ).toEqual([]);
    expect(
      await db.query(
        "SELECT row_id FROM sync_row_clocks WHERE table_name = 'evidence_shelf_items' AND row_id = ?",
        ["shelf:merge-tombstone"],
      ),
    ).toEqual([]);
    expect(
      await db.query<{ work_id: string }>("SELECT work_id FROM document_assets WHERE id = ?", [
        shelf.assetId,
      ]),
    ).toEqual([{ work_id: primary.id }]);
  });

  it("purges canonical derived payloads atomically and preserves another Library", async () => {
    const work = await works.upsert({ title: "Erase Me" });
    const attachment = await attachments.create({
      workId: work.id,
      sha256: BLOB_SHA256,
      byteSize: 4096,
    });
    const created = await seedEvidence(work.id, attachment.id, "evidence:erase");
    const assetId = documentAssetIdFromAttachment(attachment.id);
    const revisionId = documentRevisionIdFromAttachment(attachment.id);
    const foreignLibraryId = "library:foreign-erasure";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );
    for (const [id, owner, sourceTable, sourceId] of [
      ["artifact:evidence", libraryId, "evidence_items", created.evidence.id],
      ["artifact:revision", libraryId, "document_revisions", revisionId],
      ["artifact:asset", libraryId, "document_assets", assetId],
      ["artifact:foreign", foreignLibraryId, "evidence_items", created.evidence.id],
    ] as const) {
      await db.run(
        `INSERT INTO derived_artifacts
           (id, library_id, source_table, source_id, kind, payload_json,
            local_only, syncable, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'test', ?, 1, 0, ?, ?)`,
        [id, owner, sourceTable, sourceId, JSON.stringify({ text: QUOTE }), now, now],
      );
    }
    for (const owner of [libraryId, foreignLibraryId]) {
      await db.run(
        `INSERT INTO sync_row_clocks
           (table_name, row_id, library_id, column_hlcs_json, updated_at)
         VALUES ('evidence_items', ?, ?, '{}', ?)`,
        [created.evidence.id, owner, now],
      );
    }

    await works.softDelete(work.id);
    await db.exec(`CREATE TRIGGER fail_knowledge_purge BEFORE DELETE ON works
      WHEN OLD.id = '${work.id}' BEGIN SELECT RAISE(ABORT, 'forced purge failure'); END`);
    await expect(works.purgeDeleted(work.id)).rejects.toThrow("forced purge failure");
    const evidenceAfterRollback = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM evidence_items WHERE id = ?",
      [created.evidence.id],
    );
    expect(evidenceAfterRollback[0]?.count).toBe(1);
    expect(await db.queryScalar("SELECT COUNT(*) FROM derived_artifacts")).toBe(4);

    await db.exec("DROP TRIGGER fail_knowledge_purge");
    await works.purgeDeleted(work.id);
    const evidenceAfterPurge = await db.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM evidence_items WHERE id = ?",
      [created.evidence.id],
    );
    expect(evidenceAfterPurge[0]?.count).toBe(0);
    expect(await db.query<{ id: string }>("SELECT id FROM derived_artifacts ORDER BY id")).toEqual([
      { id: "artifact:foreign" },
    ]);
    expect(
      await db.query<{ library_id: string }>(
        `SELECT library_id
         FROM sync_row_clocks
         WHERE table_name = 'evidence_items' AND row_id = ?
         ORDER BY library_id`,
        [created.evidence.id],
      ),
    ).toEqual([{ library_id: foreignLibraryId }]);
  });
});
