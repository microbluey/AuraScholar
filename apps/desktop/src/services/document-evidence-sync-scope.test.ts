import { createNodeDatabase } from "@aurascholar/db/node";
import {
  projectAssetMembershipId,
  projectEvidenceMembershipId,
  projectWorkMembershipId,
} from "@aurascholar/db/ids";
import { runMigrations } from "@aurascholar/db/migrations";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_EVIDENCE_SYNC_SCOPE_VERSION,
  DOCUMENT_REVISION_LOCAL_ONLY_COLUMNS,
  SYNCED_TABLE_COLUMNS,
  SYNC_APPLY_ORDER,
  assertSyncParentScope,
  documentRevisionLocalInsertDefaults,
  isDirectLibraryOwnedSyncTable,
  partitionSyncApplyValues,
  syncScopePredicate,
  syncedColumnsForTable,
  type SyncedTable,
} from "./document-evidence-sync-scope";

type TestDatabase = Awaited<ReturnType<typeof createNodeDatabase>>;

async function addLibrary(db: TestDatabase, id: string): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'personal', 1, 1)`,
    [id, id],
  );
}

async function seedLibraryGraph(db: TestDatabase, suffix: "a" | "b"): Promise<void> {
  const libraryId = `library-${suffix}`;
  const workId = `work-${suffix}`;
  const projectId = `project-${suffix}`;
  const attachmentId = `attachment-${suffix}`;
  const assetId = `asset-${suffix}`;
  const revisionId = `revision-${suffix}`;
  const evidenceId = `evidence-${suffix}`;
  const projectWorkId = projectWorkMembershipId(projectId, workId);
  const projectAssetId = projectAssetMembershipId(projectId, assetId);
  const projectEvidenceId = projectEvidenceMembershipId(projectId, evidenceId);
  const sha = suffix.repeat(64);

  await addLibrary(db, libraryId);
  await db.run(
    `INSERT INTO works (id, library_id, title, created_at, updated_at)
     VALUES (?, ?, ?, 10, 10)`,
    [workId, libraryId, `Work ${suffix}`],
  );
  await db.run(
    `INSERT INTO research_projects
       (id, library_id, name, description, status, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, NULL, 'active', 10, 10, NULL)`,
    [projectId, libraryId, `Project ${suffix}`],
  );
  await db.run(
    `INSERT INTO attachments
       (id, work_id, kind, sha256, byte_size, created_at, updated_at)
     VALUES (?, ?, 'pdf', ?, 100, 10, 10)`,
    [attachmentId, workId, sha],
  );
  await db.run(
    `INSERT INTO document_assets
       (id, library_id, work_id, kind, title, current_revision_id, created_at, updated_at)
     VALUES (?, ?, ?, 'pdf', ?, NULL, 10, 10)`,
    [assetId, libraryId, workId, `Asset ${suffix}`],
  );
  await db.run(
    `INSERT INTO document_revisions
       (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256, byte_size,
        extraction_status, availability_status, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'application/pdf', ?, 100, 'ready', 'available', 10, 10)`,
    [revisionId, assetId, attachmentId, sha],
  );
  await db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
    revisionId,
    assetId,
  ]);
  await db.run(
    `INSERT INTO evidence_items
       (id, library_id, work_id, asset_id, revision_id, source_kind, evidence_kind,
        anchor_json, payload_kind, payload_json, tags_json, source_content_hash,
        provenance_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'document', 'context', ?, 'text', ?, '[]', ?, '{}', 10, 10)`,
    [
      evidenceId,
      libraryId,
      workId,
      assetId,
      revisionId,
      JSON.stringify({ version: 1, kind: "pdf", revisionId, pageIndex: 0 }),
      JSON.stringify({ text: `Evidence ${suffix}` }),
      sha,
    ],
  );
  await db.run(
    `INSERT INTO project_works
       (id, project_id, work_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'source', 10, 10)`,
    [projectWorkId, projectId, workId],
  );
  await db.run(
    `INSERT INTO project_assets
       (id, project_id, asset_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'source', 10, 10)`,
    [projectAssetId, projectId, assetId],
  );
  await db.run(
    `INSERT INTO project_evidence
       (id, project_id, evidence_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'evidence', 10, 10)`,
    [projectEvidenceId, projectId, evidenceId],
  );
  await db.run(
    `INSERT INTO annotations
       (id, attachment_id, work_id, type, page_index, created_at, updated_at)
     VALUES (?, ?, ?, 'highlight', 0, 10, 10)`,
    [`annotation-${suffix}`, attachmentId, workId],
  );
  await db.run(
    `INSERT INTO flashcards
       (id, work_id, front_md, back_md, card_type, source, created_at, updated_at)
     VALUES (?, ?, 'front', 'back', 'basic', 'manual', 10, 10)`,
    [`flashcard-${suffix}`, workId],
  );
  await db.run(
    `INSERT INTO sentinel_tasks
       (id, library_id, work_id, title, next_poll_at, created_at, updated_at)
     VALUES (?, ?, ?, 'Sentinel', 20, 10, 10)`,
    [`sentinel-${suffix}`, libraryId, workId],
  );
}

async function setup(): Promise<TestDatabase> {
  const db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  await seedLibraryGraph(db, "a");
  await seedLibraryGraph(db, "b");
  return db;
}

function validation(
  db: TestDatabase,
  table: SyncedTable,
  rowId: string,
  values: Record<string, unknown>,
  exists = false,
) {
  return assertSyncParentScope({
    db,
    table,
    rowId,
    values,
    exists,
    libraryId: "library-a",
  });
}

describe("document/evidence row-sync table contract", () => {
  it("declares canonical and legacy tables while excluding revision-local state", () => {
    expect(DOCUMENT_EVIDENCE_SYNC_SCOPE_VERSION).toBe("library-scope-v3-evidence");
    expect(SYNC_APPLY_ORDER).toEqual([
      "works",
      "research_projects",
      "project_works",
      "document_assets",
      "document_revisions",
      "project_assets",
      "evidence_items",
      "project_evidence",
      "annotations",
      "flashcards",
      "sentinel_tasks",
    ]);
    expect(Object.keys(SYNCED_TABLE_COLUMNS)).toEqual(SYNC_APPLY_ORDER);
    expect(syncedColumnsForTable("unknown")).toBeNull();
    expect(syncedColumnsForTable("document_revisions")).not.toEqual(
      expect.arrayContaining([...DOCUMENT_REVISION_LOCAL_ONLY_COLUMNS]),
    );
    expect(isDirectLibraryOwnedSyncTable("works")).toBe(true);
    expect(isDirectLibraryOwnedSyncTable("research_projects")).toBe(true);
    expect(isDirectLibraryOwnedSyncTable("document_assets")).toBe(true);
    expect(isDirectLibraryOwnedSyncTable("evidence_items")).toBe(true);
    expect(isDirectLibraryOwnedSyncTable("sentinel_tasks")).toBe(true);
    expect(isDirectLibraryOwnedSyncTable("project_assets")).toBe(false);
  });

  it("produces executable Library scope predicates for every table", async () => {
    const db = await setup();
    const rowByTable: Record<SyncedTable, string> = {
      works: "work-a",
      research_projects: "project-a",
      project_works: projectWorkMembershipId("project-a", "work-a"),
      document_assets: "asset-a",
      document_revisions: "revision-a",
      project_assets: projectAssetMembershipId("project-a", "asset-a"),
      evidence_items: "evidence-a",
      project_evidence: projectEvidenceMembershipId("project-a", "evidence-a"),
      annotations: "annotation-a",
      flashcards: "flashcard-a",
      sentinel_tasks: "sentinel-a",
    };
    for (const table of SYNC_APPLY_ORDER) {
      const rows = await db.query<{ id: string }>(
        `SELECT t.id FROM "${table}" t
         WHERE t.id = ? AND ${syncScopePredicate(table, "t")}`,
        [rowByTable[table], "library-a"],
      );
      expect(rows).toEqual([{ id: rowByTable[table] }]);
    }
    expect(() => syncScopePredicate("unknown", "t")).toThrow(/Unsupported sync table/);
  });
});

describe("document revision two-phase apply", () => {
  it("defers a non-null current revision pointer and defines safe local revision state", () => {
    const values = { title: "Paper", current_revision_id: "revision-a", updated_at: 20 };
    expect(partitionSyncApplyValues("document_assets", values)).toEqual({
      immediate: { title: "Paper", updated_at: 20 },
      deferred: { current_revision_id: "revision-a" },
    });
    expect(values.current_revision_id).toBe("revision-a");
    expect(partitionSyncApplyValues("document_assets", { current_revision_id: null })).toEqual({
      immediate: { current_revision_id: null },
      deferred: null,
    });
    expect(partitionSyncApplyValues("works", values)).toEqual({
      immediate: values,
      deferred: null,
    });
    expect(documentRevisionLocalInsertDefaults(42)).toEqual({
      attachment_id: null,
      extraction_status: "pending",
      availability_status: "relink-required",
      availability_checked_at: 42,
    });
  });

  it("validates the deferred pointer only after its matching revision exists", async () => {
    const db = await setup();
    await expect(
      validation(db, "document_assets", "asset-a", { current_revision_id: "revision-a" }, true),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "document_assets", "asset-a", { current_revision_id: "revision-b" }, true),
    ).rejects.toThrow(/document_assets\.current_revision_id.*cross-asset/);
    await expect(
      validation(db, "document_assets", "asset-a", { current_revision_id: "missing" }, true),
    ).rejects.toThrow(/missing/);
  });
});

describe("document/evidence parent scope validation", () => {
  it("accepts coherent parents for canonical and legacy rows", async () => {
    const db = await setup();
    await expect(validation(db, "works", "new-work", {})).resolves.toBeUndefined();
    await expect(validation(db, "research_projects", "new-project", {})).resolves.toBeUndefined();
    await expect(
      validation(db, "sentinel_tasks", "new-sentinel", { work_id: "work-a" }),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "annotations", "new-annotation", {
        work_id: "work-a",
        attachment_id: "attachment-a",
      }),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "flashcards", "new-flashcard", { work_id: "work-a" }),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "project_works", projectWorkMembershipId("project-a", "work-a"), {
        project_id: "project-a",
        work_id: "work-a",
      }),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "document_assets", "new-asset", { work_id: "work-a" }),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "document_revisions", "new-revision", { asset_id: "asset-a" }),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "project_assets", projectAssetMembershipId("project-a", "asset-a"), {
        project_id: "project-a",
        asset_id: "asset-a",
      }),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "evidence_items", "new-evidence", {
        work_id: "work-a",
        asset_id: "asset-a",
        revision_id: "revision-a",
        anchor_json: JSON.stringify({
          version: 1,
          kind: "pdf",
          revisionId: "revision-a",
          pageIndex: 0,
        }),
      }),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "project_evidence", projectEvidenceMembershipId("project-a", "evidence-a"), {
        project_id: "project-a",
        evidence_id: "evidence-a",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects cross-Library and missing parents for every relationship shape", async () => {
    const db = await setup();
    const invalid: Array<[SyncedTable, string, Record<string, unknown>, string]> = [
      ["sentinel_tasks", "bad-sentinel", { work_id: "work-b" }, "sentinel_tasks.work_id"],
      [
        "annotations",
        "bad-annotation",
        { work_id: "work-a", attachment_id: "attachment-b" },
        "annotations.attachment_id",
      ],
      ["flashcards", "bad-flashcard", { work_id: "missing" }, "flashcards.work_id"],
      [
        "project_works",
        projectWorkMembershipId("project-a", "work-b"),
        { project_id: "project-a", work_id: "work-b" },
        "project_works.work_id",
      ],
      ["document_assets", "bad-asset", { work_id: "work-b" }, "document_assets.work_id"],
      [
        "document_revisions",
        "bad-revision",
        { asset_id: "asset-b" },
        "document_revisions.asset_id",
      ],
      [
        "project_assets",
        projectAssetMembershipId("project-a", "asset-b"),
        { project_id: "project-a", asset_id: "asset-b" },
        "project_assets.asset_id",
      ],
      [
        "evidence_items",
        "bad-evidence",
        { work_id: "work-a", asset_id: "asset-b", revision_id: "revision-b" },
        "evidence_items.asset_id",
      ],
      [
        "project_evidence",
        projectEvidenceMembershipId("project-a", "evidence-b"),
        { project_id: "project-a", evidence_id: "evidence-b" },
        "project_evidence.evidence_id",
      ],
    ];
    for (const [table, rowId, values, relation] of invalid) {
      await expect(validation(db, table, rowId, values)).rejects.toThrow(
        `Rejected cross-library ${relation}`,
      );
    }
  });

  it("resolves omitted relationship fields for scoped partial updates", async () => {
    const db = await setup();
    await expect(
      validation(
        db,
        "project_works",
        projectWorkMembershipId("project-a", "work-a"),
        { role: "reviewed" },
        true,
      ),
    ).resolves.toBeUndefined();
    await expect(
      validation(db, "document_assets", "asset-a", { title: "Renamed" }, true),
    ).resolves.toBeUndefined();
    await expect(
      validation(
        db,
        "project_works",
        projectWorkMembershipId("project-b", "work-b"),
        { role: "foreign" },
        true,
      ),
    ).rejects.toThrow(/unowned/);
    await expect(
      validation(db, "project_assets", "missing-row", { role: "unknown" }, true),
    ).rejects.toThrow(/unowned/);
  });

  it("rejects non-canonical membership row ids on insert and update", async () => {
    const db = await setup();
    await expect(
      validation(db, "project_works", "forged-membership-id", {
        project_id: "project-a",
        work_id: "work-a",
      }),
    ).rejects.toThrow(/invalid project_works deterministic row id/);
    await expect(
      validation(
        db,
        "project_assets",
        projectAssetMembershipId("project-a", "asset-a"),
        { project_id: "project-b" },
        true,
      ),
    ).rejects.toThrow(/invalid project_assets deterministic row id/);
    await expect(
      validation(db, "project_evidence", "forged-membership-id", {
        project_id: "project-a",
        evidence_id: "evidence-a",
      }),
    ).rejects.toThrow(/invalid project_evidence deterministic row id/);
  });

  it("rejects malformed, non-revision-bound, and cross-revision Evidence anchors", async () => {
    const db = await setup();
    await expect(
      validation(db, "evidence_items", "new-evidence", {
        work_id: "work-a",
        asset_id: "asset-a",
        revision_id: "revision-a",
        anchor_json: JSON.stringify({
          version: 1,
          kind: "pdf",
          revisionId: "revision-b",
          pageIndex: 0,
        }),
      }),
    ).rejects.toThrow(/anchor bound to another revision/);
    await expect(
      validation(db, "evidence_items", "new-evidence", {
        work_id: "work-a",
        asset_id: "asset-a",
        revision_id: "revision-a",
        anchor_json: "not-json",
      }),
    ).rejects.toThrow(/invalid evidence_items\.anchor_json/);
    for (const anchor of [
      { version: 2, kind: "pdf", revisionId: "revision-a", pageIndex: 0 },
      { version: 1, kind: "pdf", revisionId: "revision-a", pageIndex: -1 },
      {
        version: 1,
        kind: "pdf",
        revisionId: "revision-a",
        pageIndex: 0,
        quote: { exact: 42 },
      },
      {
        version: 1,
        kind: "pdf",
        revisionId: "revision-a",
        pageIndex: 0,
        quads: { pageIndex: 0, rects: [] },
      },
    ]) {
      await expect(
        validation(db, "evidence_items", "new-evidence", {
          work_id: "work-a",
          asset_id: "asset-a",
          revision_id: "revision-a",
          anchor_json: JSON.stringify(anchor),
        }),
      ).rejects.toThrow(/invalid evidence_items\.anchor_json/);
    }
    await expect(
      validation(db, "evidence_items", "new-evidence", {
        work_id: "work-a",
        asset_id: "asset-a",
        revision_id: "revision-a",
        anchor_json: JSON.stringify({
          version: 1,
          kind: "canvas",
          workspaceId: "workspace-a",
          nodeId: "node-a",
          nodeRevision: 0,
        }),
      }),
    ).rejects.toThrow(/not revision-bound/);
  });
});
