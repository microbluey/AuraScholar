import type { Database } from "@aurascholar/db";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { describe, expect, it } from "vitest";
import { SqliteSyncStorage } from "./sqlite-sync-storage";

const HLC = "000000000000200-000000-device-remote";
const TRANSPORT_LIBRARY_ID = "remote:revision-bridge-repair";

interface BridgedAssetIds {
  libraryId: string;
  workId: string;
  assetId: string;
  revisionId: string;
  attachmentId: string;
}

async function seedBridgedAsset(
  db: Database,
  suffix: string,
  libraryId = `library-${suffix}`,
): Promise<BridgedAssetIds> {
  const ids = {
    libraryId,
    workId: `work-${suffix}`,
    assetId: `asset-${suffix}`,
    revisionId: `revision-${suffix}`,
    attachmentId: `attachment-${suffix}`,
  };
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'personal', 100, 100)`,
    [libraryId, libraryId],
  );
  await addWork(db, libraryId, ids.workId, `Work ${suffix}`);
  await db.run(
    `INSERT INTO attachments
       (id, work_id, kind, sha256, byte_size, created_at, updated_at)
     VALUES (?, ?, 'pdf', ?, 1024, 100, 100)`,
    [ids.attachmentId, ids.workId, "a".repeat(64)],
  );
  await db.run(
    `INSERT INTO document_assets
       (id, library_id, work_id, kind, title, current_revision_id, created_at, updated_at)
     VALUES (?, ?, ?, 'pdf', 'Paper', NULL, 100, 100)`,
    [ids.assetId, libraryId, ids.workId],
  );
  await db.run(
    `INSERT INTO document_revisions
       (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256, byte_size,
        extraction_status, availability_status, availability_checked_at, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'application/pdf', ?, 1024,
             'ready', 'available', 77, 100, 100)`,
    [ids.revisionId, ids.assetId, ids.attachmentId, "a".repeat(64)],
  );
  await db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
    ids.revisionId,
    ids.assetId,
  ]);
  return ids;
}

async function addWork(db: Database, libraryId: string, id: string, title: string): Promise<void> {
  await db.run(
    `INSERT INTO works (id, library_id, title, created_at, updated_at)
     VALUES (?, ?, ?, 100, 100)`,
    [id, libraryId, title],
  );
}

function storageFor(db: Database, libraryId: string): SqliteSyncStorage {
  return new SqliteSyncStorage(
    db,
    "device-target",
    libraryId,
    "document-evidence-provider",
    TRANSPORT_LIBRARY_ID,
  );
}

function ownedValues(values: Record<string, unknown>): Record<string, unknown> {
  return { library_id: TRANSPORT_LIBRARY_ID, ...values };
}

function clocksFor(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.keys(values).map((column) => [column, HLC]));
}

async function expectAvailableBridge(
  db: Database,
  revisionId: string,
  attachmentId: string,
): Promise<void> {
  await expect(
    db.query<{
      attachment_id: string | null;
      availability_status: string;
      availability_checked_at: number | null;
    }>(
      `SELECT attachment_id, availability_status, availability_checked_at
       FROM document_revisions WHERE id = ?`,
      [revisionId],
    ),
  ).resolves.toEqual([
    {
      attachment_id: attachmentId,
      availability_status: "available",
      availability_checked_at: 77,
    },
  ]);
}

describe("document revision bridge repair during row sync", () => {
  it("detaches only local bridge state when a remote merge retargets an asset", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    const ids = await seedBridgedAsset(db, "remote-merge");
    const primaryWorkId = "work-remote-merge-primary";
    await addWork(db, ids.libraryId, primaryWorkId, "Primary Work");
    const values = ownedValues({ work_id: primaryWorkId, updated_at: 200 });
    const checkedAfter = Date.now();

    await storageFor(db, ids.libraryId).applyUpsert(
      "document_assets",
      ids.assetId,
      values,
      clocksFor(values),
    );

    await expect(
      db.query<{ work_id: string | null }>(`SELECT work_id FROM document_assets WHERE id = ?`, [
        ids.assetId,
      ]),
    ).resolves.toEqual([{ work_id: primaryWorkId }]);
    const revisions = await db.query<{
      attachment_id: string | null;
      extraction_status: string;
      availability_status: string;
      availability_checked_at: number | null;
      updated_at: number;
    }>(
      `SELECT attachment_id, extraction_status, availability_status,
              availability_checked_at, updated_at
       FROM document_revisions WHERE id = ?`,
      [ids.revisionId],
    );
    expect(revisions).toEqual([
      {
        attachment_id: null,
        extraction_status: "ready",
        availability_status: "relink-required",
        availability_checked_at: expect.any(Number),
        updated_at: 100,
      },
    ]);
    expect(revisions[0]!.availability_checked_at).toBeGreaterThanOrEqual(checkedAfter);
    await expect(
      db.query<{ work_id: string; deleted_at: number | null }>(
        `SELECT work_id, deleted_at FROM attachments WHERE id = ?`,
        [ids.attachmentId],
      ),
    ).resolves.toEqual([{ work_id: ids.workId, deleted_at: null }]);
  });

  it("detaches every local bridge when a remote asset becomes standalone", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    const ids = await seedBridgedAsset(db, "standalone");
    const values = ownedValues({ work_id: null, updated_at: 200 });

    await storageFor(db, ids.libraryId).applyUpsert(
      "document_assets",
      ids.assetId,
      values,
      clocksFor(values),
    );

    await expect(
      db.query<{ work_id: string | null }>(`SELECT work_id FROM document_assets WHERE id = ?`, [
        ids.assetId,
      ]),
    ).resolves.toEqual([{ work_id: null }]);
    await expect(
      db.query<{ attachment_id: string | null; availability_status: string }>(
        `SELECT attachment_id, availability_status FROM document_revisions WHERE id = ?`,
        [ids.revisionId],
      ),
    ).resolves.toEqual([{ attachment_id: null, availability_status: "relink-required" }]);
  });

  it("validates Library scope first and rolls repair back with a failed sync segment", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    const ids = await seedBridgedAsset(db, "guard-a");
    const foreign = await seedBridgedAsset(db, "guard-b");
    const storage = storageFor(db, ids.libraryId);
    const crossLibrary = ownedValues({ work_id: foreign.workId, updated_at: 200 });

    await expect(
      storage.applyUpsert("document_assets", ids.assetId, crossLibrary, clocksFor(crossLibrary)),
    ).rejects.toThrow(/cross-library document_assets\.work_id/);
    await expectAvailableBridge(db, ids.revisionId, ids.attachmentId);

    const primaryWorkId = "work-guard-primary";
    await addWork(db, ids.libraryId, primaryWorkId, "Primary Work");
    await db.exec(
      `CREATE TRIGGER reject_test_asset_move
       BEFORE UPDATE OF work_id ON document_assets
       WHEN NEW.id = '${ids.assetId}'
       BEGIN
         SELECT RAISE(ABORT, 'injected asset move failure');
       END`,
    );
    const failingMove = ownedValues({ work_id: primaryWorkId, updated_at: 201 });

    await expect(
      storage.withTransaction(() =>
        storage.applyUpsert("document_assets", ids.assetId, failingMove, clocksFor(failingMove)),
      ),
    ).rejects.toThrow(/injected asset move failure/);
    await expectAvailableBridge(db, ids.revisionId, ids.attachmentId);
  });
});
