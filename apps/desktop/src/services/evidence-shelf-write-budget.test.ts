import {
  documentAssetIdFromAttachment,
  documentRevisionIdFromAttachment,
  projectAssetMembershipId,
  projectWorkMembershipId,
  type Database,
} from "@aurascholar/db";
import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { describe, expect, it } from "vitest";
import {
  exportLibraryBackupJsonFromDatabase,
  importParsedLibraryBackupIntoDatabase,
  parseLibraryBackupJson,
} from "../shared/library-backup";

type TestDatabase = Awaited<ReturnType<typeof createNodeDatabase>>;
type BackupPayload = { tables: Record<string, Record<string, unknown>[]>; version: number };

async function createSourceBackup(): Promise<string> {
  const db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES ('source-library', 'Source', 'personal', 1, 1)`,
  );
  await db.run(
    `INSERT INTO works (id, library_id, title, created_at, updated_at)
     VALUES ('source-work', 'source-library', 'Source work', 10, 10)`,
  );
  await db.run(
    `INSERT INTO research_projects (id, library_id, name, status, created_at, updated_at)
     VALUES ('source-project', 'source-library', 'Source project', 'active', 10, 10)`,
  );
  const attachmentId = "source-attachment";
  const assetId = documentAssetIdFromAttachment(attachmentId);
  const revisionId = documentRevisionIdFromAttachment(attachmentId);
  await db.run(
    `INSERT INTO attachments
       (id, work_id, kind, sha256, byte_size, original_filename, created_at, updated_at)
     VALUES (?, 'source-work', 'pdf', ?, 128, 'source.pdf', 10, 10)`,
    [attachmentId, `sha-${attachmentId}`],
  );
  await db.run(
    `INSERT INTO document_assets
       (id, library_id, work_id, kind, title, created_at, updated_at)
     VALUES (?, 'source-library', 'source-work', 'pdf', 'Source asset', 10, 10)`,
    [assetId],
  );
  await db.run(
    `INSERT INTO document_revisions
       (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256, byte_size,
        extraction_status, availability_status, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'application/pdf', ?, 128, 'ready', 'available', 10, 10)`,
    [revisionId, assetId, attachmentId, `sha-${attachmentId}`],
  );
  await db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
    revisionId,
    assetId,
  ]);
  await db.run(
    `INSERT INTO project_works
       (id, project_id, work_id, role, created_at, updated_at, deleted_at)
     VALUES (?, 'source-project', 'source-work', 'source', 10, 10, NULL)`,
    [projectWorkMembershipId("source-project", "source-work")],
  );
  await db.run(
    `INSERT INTO project_assets
       (id, project_id, asset_id, role, created_at, updated_at, deleted_at)
     VALUES (?, 'source-project', ?, 'source', 10, 10, NULL)`,
    [projectAssetMembershipId("source-project", assetId), assetId],
  );
  await db.run(
    `INSERT INTO evidence_shelf_items
       (id, library_id, project_id, work_id, asset_id, revision_id,
        anchor_snapshot_json, preview_payload_json, source_content_hash,
        status, created_at, updated_at, deleted_at)
     VALUES (?, 'source-library', 'source-project', 'source-work', ?, ?, ?, ?, ?, 'staged', 10, 10, NULL)`,
    [
      "shelf-source",
      assetId,
      revisionId,
      JSON.stringify({ kind: "pdf", pageIndex: 0, revisionId, version: 1 }),
      JSON.stringify({
        contentUnitId: "unit-source",
        excerpt: "Shelf preview",
        headingPath: ["Methods"],
        language: "en",
        ordinal: 0,
        sourceId: revisionId,
        sourceType: "pdf",
        text: "Shelf preview",
        tokenCount: 2,
        workTitle: "Source work",
      }),
      "a".repeat(64),
    ],
  );
  return exportLibraryBackupJsonFromDatabase(db, "source-library");
}

function expandShelfRows(text: string, count: number, previewText: string): string {
  const payload = JSON.parse(text) as BackupPayload;
  const original = payload.tables.evidence_shelf_items?.[0];
  if (!original) throw new Error("source backup did not contain a Shelf row");
  const anchor = JSON.parse(String(original.anchor_snapshot_json)) as Record<string, unknown>;
  const preview = JSON.parse(String(original.preview_payload_json)) as Record<string, unknown>;
  payload.tables.evidence_shelf_items = Array.from({ length: count }, (_, index) => ({
    ...original,
    id: `shelf-budget-${index}`,
    anchor_snapshot_json: JSON.stringify({ ...anchor, pageIndex: index }),
    preview_payload_json: JSON.stringify({
      ...preview,
      contentUnitId: `unit-budget-${index}`,
      excerpt: previewText,
      text: previewText,
    }),
    source_content_hash: index.toString(16).padStart(64, "0"),
  }));
  return JSON.stringify(payload);
}

async function importInTransaction(db: Database, text: string, libraryId: string): Promise<void> {
  const backup = parseLibraryBackupJson(text);
  await db.exec("BEGIN");
  try {
    await importParsedLibraryBackupIntoDatabase(db, backup, libraryId);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function targetDatabase(): Promise<TestDatabase> {
  const db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES ('target-library', 'Target', 'personal', 1, 1)`,
  );
  return db;
}

describe("Evidence Shelf write budgets", () => {
  it("rolls back a backup import that exceeds the active row budget", async () => {
    const source = await createSourceBackup();
    const oversized = expandShelfRows(source, 1_001, "small preview");
    const target = await targetDatabase();

    await expect(importInTransaction(target, oversized, "target-library")).rejects.toThrow(
      "Evidence shelf items are limited to 1000",
    );
    await expect(
      target.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM evidence_shelf_items WHERE library_id = 'target-library'`,
      ),
    ).resolves.toEqual([{ count: 0 }]);
    await expect(
      target.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM research_projects WHERE library_id = 'target-library'`,
      ),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("rolls back a backup import that exceeds the aggregate byte budget", async () => {
    const source = await createSourceBackup();
    const oversized = expandShelfRows(source, 100, "x".repeat(80_000));
    const target = await targetDatabase();

    await expect(importInTransaction(target, oversized, "target-library")).rejects.toThrow(
      "Evidence shelf output is limited to 8388608 bytes",
    );
    await expect(
      target.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM evidence_shelf_items WHERE library_id = 'target-library'`,
      ),
    ).resolves.toEqual([{ count: 0 }]);
  });
});
