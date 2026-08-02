import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { documentAssetIdFromAttachment, documentRevisionIdFromAttachment } from "../ids";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { AttachmentsRepo } from "./attachments";
import { EvidenceRepo } from "./evidence";
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
  });
});
