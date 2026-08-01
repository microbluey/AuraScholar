import { DocumentAssetsRepo, type Database } from "@aurascholar/db";
import {
  projectAssetMembershipId,
  projectEvidenceMembershipId,
  projectWorkMembershipId,
} from "@aurascholar/db/ids";
import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { HlcClock, MemorySyncProvider, SyncEngine, type ChangeEntry } from "@aurascholar/sync";
import { describe, expect, it, vi } from "vitest";
import { SqliteSyncStorage } from "../shared/sqlite-sync-storage";

const NEW_SYNC_TABLES = [
  "research_projects",
  "project_works",
  "document_assets",
  "document_revisions",
  "project_assets",
  "evidence_items",
  "project_evidence",
] as const;

const HLC = "000000000000200-000000-device-remote";
const TRANSPORT_LIBRARY_ID = "remote:document-evidence-contract";

interface GraphIds {
  libraryId: string;
  workId: string;
  projectId: string;
  projectWorkId: string;
  assetId: string;
  revisionId: string;
  projectAssetId: string;
  evidenceId: string;
  projectEvidenceId: string;
}

function graphIds(libraryId: string, suffix: string): GraphIds {
  const workId = `work-${suffix}`;
  const projectId = `project-${suffix}`;
  const assetId = `asset-${suffix}`;
  const evidenceId = `evidence-${suffix}`;
  return {
    libraryId,
    workId,
    projectId,
    projectWorkId: projectWorkMembershipId(projectId, workId),
    assetId,
    revisionId: `revision-${suffix}`,
    projectAssetId: projectAssetMembershipId(projectId, assetId),
    evidenceId,
    projectEvidenceId: projectEvidenceMembershipId(projectId, evidenceId),
  };
}

async function addLibrary(db: Database, id: string): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'personal', 1, 1)`,
    [id, id],
  );
}

async function seedDocumentEvidenceGraph(
  db: Database,
  ids: GraphIds,
  updatedAt = 100,
): Promise<void> {
  await addLibrary(db, ids.libraryId);
  await db.run(
    `INSERT INTO works (id, library_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [ids.workId, ids.libraryId, `Work ${ids.workId}`, updatedAt, updatedAt],
  );
  await db.run(
    `INSERT INTO research_projects
       (id, library_id, name, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [
      ids.projectId,
      ids.libraryId,
      `Project ${ids.projectId}`,
      "Document evidence sync contract",
      updatedAt,
      updatedAt,
    ],
  );
  await db.run(
    `INSERT INTO project_works
       (id, project_id, work_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'source', ?, ?)`,
    [ids.projectWorkId, ids.projectId, ids.workId, updatedAt, updatedAt],
  );
  await db.run(
    `INSERT INTO document_assets
       (id, library_id, work_id, kind, title, current_revision_id, created_at, updated_at)
     VALUES (?, ?, ?, 'pdf', ?, NULL, ?, ?)`,
    [ids.assetId, ids.libraryId, ids.workId, `Asset ${ids.assetId}`, updatedAt, updatedAt],
  );
  await db.run(
    `INSERT INTO document_revisions
       (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256, byte_size,
        source_url, extractor_profile, extraction_status, availability_status,
        availability_checked_at, created_at, updated_at)
     VALUES (?, ?, NULL, 1, 'application/pdf', ?, 1024,
             'https://example.test/paper.pdf', 'pdf-text-v1', 'ready', 'available',
             ?, ?, ?)`,
    [ids.revisionId, ids.assetId, "a".repeat(64), updatedAt, updatedAt, updatedAt],
  );
  await db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
    ids.revisionId,
    ids.assetId,
  ]);
  await db.run(
    `INSERT INTO project_assets
       (id, project_id, asset_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'source', ?, ?)`,
    [ids.projectAssetId, ids.projectId, ids.assetId, updatedAt, updatedAt],
  );
  await db.run(
    `INSERT INTO evidence_items
       (id, library_id, work_id, asset_id, revision_id, source_kind, evidence_kind,
        anchor_json, payload_kind, payload_json, title, note_md, tags_json,
        source_content_hash, provenance_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'document', 'method', ?, 'text', ?, ?, NULL, '[]', ?, ?, ?, ?)`,
    [
      ids.evidenceId,
      ids.libraryId,
      ids.workId,
      ids.assetId,
      ids.revisionId,
      JSON.stringify({
        version: 1,
        kind: "pdf",
        revisionId: ids.revisionId,
        pageIndex: 0,
        quote: { exact: "Evidence text" },
      }),
      JSON.stringify({ text: "Evidence text" }),
      `Evidence ${ids.evidenceId}`,
      "b".repeat(64),
      JSON.stringify({ capturedBy: "user", captureMethod: "reader-selection" }),
      updatedAt,
      updatedAt,
    ],
  );
  await db.run(
    `INSERT INTO project_evidence
       (id, project_id, evidence_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'evidence', ?, ?)`,
    [ids.projectEvidenceId, ids.projectId, ids.evidenceId, updatedAt, updatedAt],
  );
}

function relevantChanges(changes: ChangeEntry[], ids: GraphIds): ChangeEntry[] {
  const graphRowIds = new Set([
    ids.projectId,
    ids.projectWorkId,
    ids.assetId,
    ids.revisionId,
    ids.projectAssetId,
    ids.evidenceId,
    ids.projectEvidenceId,
  ]);
  return changes.filter((change) => graphRowIds.has(change.rowId));
}

function requireChange(changes: ChangeEntry[], table: string, rowId: string): ChangeEntry {
  const change = changes.find((item) => item.table === table && item.rowId === rowId);
  if (!change) throw new Error(`Missing sync change ${table}.${rowId}`);
  return change;
}

async function applyChange(storage: SqliteSyncStorage, change: ChangeEntry): Promise<void> {
  if (change.op !== "upsert") throw new Error(`Expected an upsert for ${change.table}`);
  await storage.applyUpsert(change.table, change.rowId, change.values, change.columnHlcs);
}

function ownedValues(values: Record<string, unknown>): Record<string, unknown> {
  return { library_id: TRANSPORT_LIBRARY_ID, ...values };
}

function clocksFor(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.keys(values).map((column) => [column, HLC]));
}

describe("Document revision and Evidence row-level sync", () => {
  it("snapshots all seven new tables in dependency order and only for the selected Library", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    const idsA = graphIds("library-sync-a", "a");
    const idsB = graphIds("library-sync-b", "b");
    await seedDocumentEvidenceGraph(db, idsA);
    await seedDocumentEvidenceGraph(db, idsB);

    const storage = new SqliteSyncStorage(
      db,
      "device-a",
      idsA.libraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    expect(NEW_SYNC_TABLES.every((table) => storage.supportsTable(table))).toBe(true);

    const changes = relevantChanges(await storage.unsyncedChanges(0), idsA);
    expect(changes.map((change) => change.table)).toEqual(NEW_SYNC_TABLES);
    expect(changes.map((change) => change.rowId)).toEqual([
      idsA.projectId,
      idsA.projectWorkId,
      idsA.assetId,
      idsA.revisionId,
      idsA.projectAssetId,
      idsA.evidenceId,
      idsA.projectEvidenceId,
    ]);
    expect(changes.every((change) => change.values.library_id === TRANSPORT_LIBRARY_ID)).toBe(true);
    expect(changes.some((change) => change.rowId === idsB.evidenceId)).toBe(false);

    const asset = requireChange(changes, "document_assets", idsA.assetId);
    expect(asset.values.current_revision_id).toBe(idsA.revisionId);
    const revision = requireChange(changes, "document_revisions", idsA.revisionId);
    // attachment_id points at a device-local compatibility record and must not
    // become a portable cross-device foreign key.
    expect(revision.values).not.toHaveProperty("attachment_id");
  });

  it("applies the emitted graph across device-local Library ids and resolves the asset/revision cycle in two phases", async () => {
    const source = await createNodeDatabase(":memory:");
    const target = await createNodeDatabase(":memory:");
    await runMigrations(source);
    await runMigrations(target);
    const sourceIds = graphIds("library-source", "portable");
    const targetLibraryId = "library-target";
    await seedDocumentEvidenceGraph(source, sourceIds);
    await addLibrary(target, targetLibraryId);

    const sourceStorage = new SqliteSyncStorage(
      source,
      "device-source",
      sourceIds.libraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    const targetStorage = new SqliteSyncStorage(
      target,
      "device-target",
      targetLibraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    const changes = await sourceStorage.unsyncedChanges(0);
    const work = requireChange(changes, "works", sourceIds.workId);
    const graph = relevantChanges(changes, sourceIds);

    await applyChange(targetStorage, work);
    await applyChange(
      targetStorage,
      requireChange(graph, "research_projects", sourceIds.projectId),
    );
    await applyChange(
      targetStorage,
      requireChange(graph, "project_works", sourceIds.projectWorkId),
    );
    await applyChange(targetStorage, requireChange(graph, "document_assets", sourceIds.assetId));

    await expect(
      target.query<{ current_revision_id: string | null }>(
        `SELECT current_revision_id FROM document_assets WHERE id = ?`,
        [sourceIds.assetId],
      ),
    ).resolves.toEqual([{ current_revision_id: null }]);

    // A pull segment may end between the asset and its revision. Recreate the
    // adapter to prove deferred current-revision state survives that boundary.
    const resumedTargetStorage = new SqliteSyncStorage(
      target,
      "device-target",
      targetLibraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    await applyChange(
      resumedTargetStorage,
      requireChange(graph, "document_revisions", sourceIds.revisionId),
    );
    await expect(
      target.query<{ current_revision_id: string | null }>(
        `SELECT current_revision_id FROM document_assets WHERE id = ?`,
        [sourceIds.assetId],
      ),
    ).resolves.toEqual([{ current_revision_id: sourceIds.revisionId }]);

    for (const table of ["project_assets", "evidence_items", "project_evidence"] as const) {
      const rowId = {
        project_assets: sourceIds.projectAssetId,
        evidence_items: sourceIds.evidenceId,
        project_evidence: sourceIds.projectEvidenceId,
      }[table];
      await applyChange(resumedTargetStorage, requireChange(graph, table, rowId));
    }

    await expect(
      target.query<{ library_id: string }>(
        `SELECT library_id FROM research_projects WHERE id = ?
         UNION ALL SELECT library_id FROM document_assets WHERE id = ?
         UNION ALL SELECT library_id FROM evidence_items WHERE id = ?`,
        [sourceIds.projectId, sourceIds.assetId, sourceIds.evidenceId],
      ),
    ).resolves.toEqual([
      { library_id: targetLibraryId },
      { library_id: targetLibraryId },
      { library_id: targetLibraryId },
    ]);
    await expect(
      target.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM project_works WHERE id = ?
         UNION ALL SELECT COUNT(*) AS total FROM project_assets WHERE id = ?
         UNION ALL SELECT COUNT(*) AS total FROM project_evidence WHERE id = ?`,
        [sourceIds.projectWorkId, sourceIds.projectAssetId, sourceIds.projectEvidenceId],
      ),
    ).resolves.toEqual([{ total: 1 }, { total: 1 }, { total: 1 }]);
  });

  it("syncs both immutable branches when two offline devices allocate revision 2", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      const deviceA = await createNodeDatabase(":memory:");
      const deviceB = await createNodeDatabase(":memory:");
      await runMigrations(deviceA);
      await runMigrations(deviceB);
      const idsA = graphIds("library-fork-a", "offline-fork");
      const idsB = graphIds("library-fork-b", "offline-fork");
      await seedDocumentEvidenceGraph(deviceA, idsA);
      await addLibrary(deviceB, idsB.libraryId);

      const provider = new MemorySyncProvider();
      const storageA = new SqliteSyncStorage(
        deviceA,
        "device-fork-a",
        idsA.libraryId,
        "document-evidence-provider",
        TRANSPORT_LIBRARY_ID,
      );
      const storageB = new SqliteSyncStorage(
        deviceB,
        "device-fork-b",
        idsB.libraryId,
        "document-evidence-provider",
        TRANSPORT_LIBRARY_ID,
      );
      const engineA = new SyncEngine(
        provider,
        storageA,
        "device-fork-a",
        new HlcClock("device-fork-a"),
      );
      const engineB = new SyncEngine(
        provider,
        storageB,
        "device-fork-b",
        new HlcClock("device-fork-b"),
      );

      await engineA.push();
      await engineB.pull();

      vi.setSystemTime(20_000);
      const repoA = new DocumentAssetsRepo(deviceA, idsA.libraryId);
      const repoB = new DocumentAssetsRepo(deviceB, idsB.libraryId);
      const branchA = await repoA.createRevision(idsA.assetId, {
        id: "revision:offline-fork-a",
        mimeType: "application/pdf",
        blobSha256: "c".repeat(64),
        byteSize: 2048,
        expectedCurrentRevisionId: idsA.revisionId,
      });
      const branchB = await repoB.createRevision(idsB.assetId, {
        id: "revision:offline-fork-b",
        mimeType: "application/pdf",
        blobSha256: "d".repeat(64),
        byteSize: 4096,
        expectedCurrentRevisionId: idsB.revisionId,
      });
      expect(branchA.revision_no).toBe(2);
      expect(branchB.revision_no).toBe(2);

      vi.setSystemTime(20_010);
      await engineA.push();
      await engineB.push();
      await engineA.pull();
      await engineB.pull();

      const expectedBranches = [
        { id: idsA.revisionId, revision_no: 1 },
        { id: branchA.id, revision_no: 2 },
        { id: branchB.id, revision_no: 2 },
      ];
      for (const database of [deviceA, deviceB]) {
        await expect(
          database.query<{ id: string; revision_no: number }>(
            `SELECT id, revision_no FROM document_revisions
             WHERE asset_id = ?
             ORDER BY revision_no, created_at, id`,
            [idsA.assetId],
          ),
        ).resolves.toEqual(expectedBranches);
        await expect(database.query(`PRAGMA foreign_key_check`)).resolves.toEqual([]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not resolve a deferred pointer over an intervening local revision selection", async () => {
    const source = await createNodeDatabase(":memory:");
    const target = await createNodeDatabase(":memory:");
    await runMigrations(source);
    await runMigrations(target);
    const sourceIds = graphIds("library-source-cas", "cas");
    const targetLibraryId = "library-target-cas";
    const localRevisionId = "revision-local-cas";
    await seedDocumentEvidenceGraph(source, sourceIds);
    await addLibrary(target, targetLibraryId);

    const sourceStorage = new SqliteSyncStorage(
      source,
      "device-source",
      sourceIds.libraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    const targetStorage = new SqliteSyncStorage(
      target,
      "device-target",
      targetLibraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    const changes = await sourceStorage.unsyncedChanges(0);
    await applyChange(targetStorage, requireChange(changes, "works", sourceIds.workId));
    await applyChange(targetStorage, requireChange(changes, "document_assets", sourceIds.assetId));

    await target.run(
      `INSERT INTO document_revisions
         (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256, byte_size,
          extraction_status, availability_status, created_at, updated_at)
       VALUES (?, ?, NULL, 2, 'application/pdf', ?, 2048,
               'ready', 'available', 300, 300)`,
      [localRevisionId, sourceIds.assetId, "c".repeat(64)],
    );
    await target.run(
      `UPDATE document_assets
       SET current_revision_id = ?, updated_at = 300
       WHERE id = ?`,
      [localRevisionId, sourceIds.assetId],
    );

    const resumedStorage = new SqliteSyncStorage(
      target,
      "device-target",
      targetLibraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    await applyChange(
      resumedStorage,
      requireChange(changes, "document_revisions", sourceIds.revisionId),
    );

    await expect(
      target.query<{ current_revision_id: string | null }>(
        `SELECT current_revision_id FROM document_assets WHERE id = ?`,
        [sourceIds.assetId],
      ),
    ).resolves.toEqual([{ current_revision_id: localRevisionId }]);
    await expect(
      target.query<{ total: number }>(`SELECT COUNT(*) AS total FROM settings WHERE key = ?`, [
        deferredPointerKey(targetLibraryId, sourceIds.assetId),
      ]),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("does not resolve a deferred pointer whose HLC was superseded across adapter restarts", async () => {
    const source = await createNodeDatabase(":memory:");
    const target = await createNodeDatabase(":memory:");
    await runMigrations(source);
    await runMigrations(target);
    const sourceIds = graphIds("library-source-hlc", "hlc");
    const targetLibraryId = "library-target-hlc";
    await seedDocumentEvidenceGraph(source, sourceIds);
    await addLibrary(target, targetLibraryId);

    const sourceStorage = new SqliteSyncStorage(
      source,
      "device-source",
      sourceIds.libraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    const targetStorage = new SqliteSyncStorage(
      target,
      "device-target",
      targetLibraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    const changes = await sourceStorage.unsyncedChanges(0);
    await applyChange(targetStorage, requireChange(changes, "works", sourceIds.workId));
    await applyChange(targetStorage, requireChange(changes, "document_assets", sourceIds.assetId));

    const clockRows = await target.query<{ column_hlcs_json: string }>(
      `SELECT column_hlcs_json FROM sync_row_clocks
       WHERE library_id = ? AND table_name = 'document_assets' AND row_id = ?`,
      [targetLibraryId, sourceIds.assetId],
    );
    const clocks = JSON.parse(clockRows[0]!.column_hlcs_json) as Record<string, string>;
    clocks.current_revision_id = "000000000000300-000000-device-target";
    await target.run(
      `UPDATE sync_row_clocks SET column_hlcs_json = ?, updated_at = 300
       WHERE library_id = ? AND table_name = 'document_assets' AND row_id = ?`,
      [JSON.stringify(clocks), targetLibraryId, sourceIds.assetId],
    );

    const resumedStorage = new SqliteSyncStorage(
      target,
      "device-target",
      targetLibraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    await applyChange(
      resumedStorage,
      requireChange(changes, "document_revisions", sourceIds.revisionId),
    );

    await expect(
      target.query<{ current_revision_id: string | null }>(
        `SELECT current_revision_id FROM document_assets WHERE id = ?`,
        [sourceIds.assetId],
      ),
    ).resolves.toEqual([{ current_revision_id: null }]);
    await expect(
      target.query<{ total: number }>(`SELECT COUNT(*) AS total FROM settings WHERE key = ?`, [
        deferredPointerKey(targetLibraryId, sourceIds.assetId),
      ]),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("rejects cross-Library Project, asset, revision, and Evidence relationships before SQLite triggers", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    const idsA = graphIds("library-guard-a", "guard-a");
    const idsB = graphIds("library-guard-b", "guard-b");
    await seedDocumentEvidenceGraph(db, idsA);
    await seedDocumentEvidenceGraph(db, idsB);
    const storage = new SqliteSyncStorage(
      db,
      "device-a",
      idsA.libraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );

    const projectWork = ownedValues({
      project_id: idsA.projectId,
      work_id: idsB.workId,
      role: "source",
      created_at: 200,
      updated_at: 200,
    });
    await expect(
      storage.applyUpsert(
        "project_works",
        projectWorkMembershipId(idsA.projectId, idsB.workId),
        projectWork,
        clocksFor(projectWork),
      ),
    ).rejects.toThrow(/cross-library project_works\.work_id/);

    const projectAsset = ownedValues({
      project_id: idsA.projectId,
      asset_id: idsB.assetId,
      role: "source",
      created_at: 200,
      updated_at: 200,
    });
    await expect(
      storage.applyUpsert(
        "project_assets",
        projectAssetMembershipId(idsA.projectId, idsB.assetId),
        projectAsset,
        clocksFor(projectAsset),
      ),
    ).rejects.toThrow(/cross-library project_assets\.asset_id/);

    const revision = ownedValues({
      asset_id: idsB.assetId,
      revision_no: 2,
      mime_type: "application/pdf",
      blob_sha256: "c".repeat(64),
      byte_size: 2048,
      extraction_status: "pending",
      availability_status: "missing",
      created_at: 200,
      updated_at: 200,
    });
    await expect(
      storage.applyUpsert(
        "document_revisions",
        "revision-cross-library",
        revision,
        clocksFor(revision),
      ),
    ).rejects.toThrow(/cross-library document_revisions\.asset_id/);

    const evidence = ownedValues({
      work_id: idsB.workId,
      asset_id: idsB.assetId,
      revision_id: idsB.revisionId,
      source_kind: "document",
      evidence_kind: "method",
      anchor_json: JSON.stringify({
        version: 1,
        kind: "pdf",
        revisionId: idsB.revisionId,
        pageIndex: 0,
        quote: { exact: "Foreign evidence" },
      }),
      payload_kind: "text",
      payload_json: JSON.stringify({ text: "Foreign evidence" }),
      tags_json: "[]",
      source_content_hash: "d".repeat(64),
      provenance_json: "{}",
      created_at: 200,
      updated_at: 200,
    });
    await expect(
      storage.applyUpsert(
        "evidence_items",
        "evidence-cross-library",
        evidence,
        clocksFor(evidence),
      ),
    ).rejects.toThrow(/cross-library evidence_items\.(work_id|asset_id|revision_id)/);

    const projectEvidence = ownedValues({
      project_id: idsA.projectId,
      evidence_id: idsB.evidenceId,
      role: "evidence",
      created_at: 200,
      updated_at: 200,
    });
    await expect(
      storage.applyUpsert(
        "project_evidence",
        projectEvidenceMembershipId(idsA.projectId, idsB.evidenceId),
        projectEvidence,
        clocksFor(projectEvidence),
      ),
    ).rejects.toThrow(/cross-library project_evidence\.evidence_id/);
  });

  it("rejects forged membership identities and malformed Evidence anchors before storage", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    const ids = graphIds("library-identity-guard", "identity-guard");
    await seedDocumentEvidenceGraph(db, ids);
    const storage = new SqliteSyncStorage(
      db,
      "device-a",
      ids.libraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );

    const membership = ownedValues({
      project_id: ids.projectId,
      work_id: ids.workId,
      role: "source",
      created_at: 200,
      updated_at: 200,
    });
    await expect(
      storage.applyUpsert(
        "project_works",
        "forged-membership-id",
        membership,
        clocksFor(membership),
      ),
    ).rejects.toThrow(/invalid project_works deterministic row id/);

    const malformedAnchorEvidence = ownedValues({
      work_id: ids.workId,
      asset_id: ids.assetId,
      revision_id: ids.revisionId,
      source_kind: "document",
      evidence_kind: "method",
      anchor_json: JSON.stringify({
        version: 1,
        kind: "pdf",
        revisionId: ids.revisionId,
        pageIndex: 0,
        position: { start: 10, end: 2 },
      }),
      payload_kind: "text",
      payload_json: JSON.stringify({ text: "Malformed anchor" }),
      tags_json: "[]",
      source_content_hash: "d".repeat(64),
      provenance_json: "{}",
      created_at: 200,
      updated_at: 200,
    });
    await expect(
      storage.applyUpsert(
        "evidence_items",
        "evidence-malformed-anchor",
        malformedAnchorEvidence,
        clocksFor(malformedAnchorEvidence),
      ),
    ).rejects.toThrow(/invalid evidence_items\.anchor_json/);
  });

  it("uses a new Evidence-aware scope state so a v2 watermark cannot hide v19 rows", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    const ids = graphIds("library-scope-upgrade", "scope-upgrade");
    await seedDocumentEvidenceGraph(db, ids, 100);
    await db.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES (?, ?, 'local', 200)`,
      [
        `sync.${ids.libraryId}.document-evidence-provider.library-scope-v2.last_pushed_at`,
        JSON.stringify(Date.now() + 60_000),
      ],
    );

    const storage = new SqliteSyncStorage(
      db,
      "device-a",
      ids.libraryId,
      "document-evidence-provider",
      TRANSPORT_LIBRARY_ID,
    );
    const changes = relevantChanges(await storage.unsyncedChanges(0), ids);
    expect(changes.map((change) => change.table)).toEqual(NEW_SYNC_TABLES);

    await storage.markPushed(changes.at(-1)!.seq, { complete: true });
    await expect(
      db.query<{ key: string }>(
        `SELECT key FROM settings
         WHERE key = ?`,
        [
          `sync.${ids.libraryId}.document-evidence-provider.library-scope-v3-evidence.last_pushed_at`,
        ],
      ),
    ).resolves.toEqual([
      {
        key: `sync.${ids.libraryId}.document-evidence-provider.library-scope-v3-evidence.last_pushed_at`,
      },
    ]);
  });
});

function deferredPointerKey(libraryId: string, assetId: string): string {
  return `sync.${libraryId}.document-evidence-provider.library-scope-v3-evidence.pending-current-revision.${assetId}`;
}
