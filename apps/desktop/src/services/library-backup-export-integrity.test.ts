import {
  documentAssetIdFromAttachment,
  documentRevisionIdFromAttachment,
  projectAssetMembershipId,
  projectWorkMembershipId,
} from "@aurascholar/db";
import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { describe, expect, it } from "vitest";
import {
  exportLibraryBackupJsonFromDatabase,
  parseLibraryBackupJson,
} from "../shared/library-backup";

type TestDatabase = Awaited<ReturnType<typeof createNodeDatabase>>;

async function addLibrary(db: TestDatabase, id: string): Promise<void> {
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'personal', 1, 1)`,
    [id, id],
  );
}

async function addWork(db: TestDatabase, libraryId: string, id: string): Promise<void> {
  await db.run(
    `INSERT INTO works (id, library_id, title, created_at, updated_at)
     VALUES (?, ?, ?, 10, 10)`,
    [id, libraryId, id],
  );
}

async function addShelfGraph(
  db: TestDatabase,
  input: { assetWorkId: string; libraryId: string; projectId: string; shelfWorkId: string },
): Promise<void> {
  const attachmentId = "attachment-source";
  const assetId = documentAssetIdFromAttachment(attachmentId);
  const revisionId = documentRevisionIdFromAttachment(attachmentId);
  await db.run(
    `INSERT INTO research_projects
       (id, library_id, name, status, created_at, updated_at)
     VALUES (?, ?, 'Project', 'active', 10, 10)`,
    [input.projectId, input.libraryId],
  );
  await db.run(
    `INSERT INTO attachments
       (id, work_id, kind, sha256, byte_size, original_filename, created_at, updated_at)
     VALUES (?, ?, 'pdf', ?, 128, 'source.pdf', 10, 10)`,
    [attachmentId, input.assetWorkId, "a".repeat(64)],
  );
  await db.run(
    `INSERT INTO document_assets
       (id, library_id, work_id, kind, title, current_revision_id, created_at, updated_at)
     VALUES (?, ?, ?, 'pdf', 'Source', NULL, 10, 10)`,
    [assetId, input.libraryId, input.assetWorkId],
  );
  await db.run(
    `INSERT INTO document_revisions
       (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256, byte_size,
        extraction_status, availability_status, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'application/pdf', ?, 128, 'ready', 'available', 10, 10)`,
    [revisionId, assetId, attachmentId, "a".repeat(64)],
  );
  await db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
    revisionId,
    assetId,
  ]);
  await db.run(
    `INSERT INTO project_works
       (id, project_id, work_id, role, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'source', 10, 10, NULL)`,
    [
      projectWorkMembershipId(input.projectId, input.shelfWorkId),
      input.projectId,
      input.shelfWorkId,
    ],
  );
  await db.run(
    `INSERT INTO project_assets
       (id, project_id, asset_id, role, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'source', 10, 10, NULL)`,
    [projectAssetMembershipId(input.projectId, assetId), input.projectId, assetId],
  );
  await db.run(
    `INSERT INTO evidence_shelf_items
       (id, library_id, project_id, work_id, asset_id, revision_id,
        anchor_snapshot_json, preview_payload_json, source_content_hash,
        status, created_at, updated_at)
     VALUES ('shelf-source', ?, ?, ?, ?, ?, ?, ?, ?, 'staged', 10, 10)`,
    [
      input.libraryId,
      input.projectId,
      input.assetWorkId,
      assetId,
      revisionId,
      JSON.stringify({ kind: "pdf", pageIndex: 0, revisionId, version: 1 }),
      JSON.stringify({
        contentUnitId: "content-unit:shelf-source",
        excerpt: "Source excerpt",
        headingPath: [],
        language: "en",
        ordinal: 0,
        sourceId: revisionId,
        sourceType: "pdf",
        text: "Source excerpt",
        tokenCount: 2,
        workTitle: "Source",
      }),
      "a".repeat(64),
    ],
  );
  if (input.shelfWorkId !== input.assetWorkId) {
    // Simulate a legacy sync/merge that bypassed the v29 scope trigger. The
    // export validator must still reject the resulting contradictory graph.
    await db.exec(
      "DROP TRIGGER evidence_shelf_scope_update; DROP TRIGGER evidence_shelf_snapshot_immutable;",
    );
    await db.run(`UPDATE evidence_shelf_items SET work_id = ? WHERE id = 'shelf-source'`, [
      input.shelfWorkId,
    ]);
  }
}

async function createDatabase(): Promise<TestDatabase> {
  const db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  return db;
}

describe("Library backup export integrity", () => {
  it("rejects a Shelf graph whose asset points to a different Work", async () => {
    const db = await createDatabase();
    await addLibrary(db, "library-source");
    await addWork(db, "library-source", "work-shelf");
    await addWork(db, "library-source", "work-asset");
    await addShelfGraph(db, {
      assetWorkId: "work-asset",
      libraryId: "library-source",
      projectId: "project-source",
      shelfWorkId: "work-shelf",
    });

    await expect(exportLibraryBackupJsonFromDatabase(db, "library-source")).rejects.toThrow(
      /跨 Work 关系/,
    );
  });

  it("exports a valid Shelf graph that can be parsed", async () => {
    const db = await createDatabase();
    await addLibrary(db, "library-source");
    await addWork(db, "library-source", "work-source");
    await addShelfGraph(db, {
      assetWorkId: "work-source",
      libraryId: "library-source",
      projectId: "project-source",
      shelfWorkId: "work-source",
    });

    const text = await exportLibraryBackupJsonFromDatabase(db, "library-source");
    const backup = parseLibraryBackupJson(text);
    expect(backup.tables.evidence_shelf_items).toHaveLength(1);
  });
});
