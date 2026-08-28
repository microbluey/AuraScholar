import {
  documentAssetIdFromAttachment,
  documentRevisionIdFromAttachment,
  projectAssetMembershipId,
  projectEvidenceMembershipId,
  type Database,
} from "@aurascholar/db";
import { createHash } from "node:crypto";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { describe, expect, it } from "vitest";
import {
  exportLibraryBackupJsonFromDatabase,
  importParsedLibraryBackupIntoDatabase,
  parseLibraryBackupJson,
} from "../shared/library-backup";
import { previewLibraryBackupJson } from "./sync";

type TestDatabase = Awaited<ReturnType<typeof createNodeDatabase>>;
type BackupRow = Record<string, unknown>;
type BackupTables = Record<string, BackupRow[]>;

const KNOWLEDGE_TABLES = [
  "document_assets",
  "document_revisions",
  "project_assets",
  "evidence_items",
  "project_evidence",
] as const;

async function importBackup(text: string, db: Database, libraryId: string) {
  const backup = parseLibraryBackupJson(text);
  await db.exec("BEGIN");
  try {
    const summary = await importParsedLibraryBackupIntoDatabase(db, backup, libraryId);
    await db.exec("COMMIT");
    return summary;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

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
    [id, libraryId, `Work ${id}`],
  );
}

async function addProject(
  db: TestDatabase,
  libraryId: string,
  id: string,
  name = `Project ${id}`,
): Promise<void> {
  await db.run(
    `INSERT INTO research_projects
       (id, library_id, name, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 10, 10)`,
    [id, libraryId, name],
  );
}

async function addAttachment(
  db: TestDatabase,
  workId: string,
  id: string,
  sha = `sha-${id}`,
): Promise<void> {
  await db.run(
    `INSERT INTO attachments
       (id, work_id, kind, sha256, byte_size, original_filename,
        source_url, created_at, updated_at)
     VALUES (?, ?, 'pdf', ?, 128, ?, ?, 10, 10)`,
    [id, workId, sha, `${id}.pdf`, `https://example.test/${id}.pdf`],
  );
}

interface KnowledgeIds {
  assetId: string;
  evidenceId: string;
  projectAssetId: string;
  projectEvidenceId: string;
  revisionId: string;
}

async function addKnowledgeGraph(
  db: TestDatabase,
  input: {
    evidenceAnchor?: Record<string, unknown>;
    evidenceProvenance?: Record<string, unknown>;
    evidenceText?: string;
    attachmentId: string;
    libraryId: string;
    projectId: string;
    sourceContentHash?: string;
    suffix: string;
    workId: string;
  },
): Promise<KnowledgeIds> {
  const assetId = documentAssetIdFromAttachment(input.attachmentId);
  const revisionId = documentRevisionIdFromAttachment(input.attachmentId);
  const evidenceId = `evidence-${input.suffix}`;
  const projectAssetId = projectAssetMembershipId(input.projectId, assetId);
  const projectEvidenceId = projectEvidenceMembershipId(input.projectId, evidenceId);
  const evidenceText = input.evidenceText ?? `Captured snapshot ${input.suffix}`;
  await db.run(
    `INSERT INTO document_assets
       (id, library_id, work_id, kind, title, current_revision_id, created_at, updated_at)
     VALUES (?, ?, ?, 'pdf', ?, NULL, 10, 10)`,
    [assetId, input.libraryId, input.workId, `Document ${input.suffix}`],
  );
  await db.run(
    `INSERT INTO document_revisions
       (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256,
        byte_size, source_url, extraction_status, availability_status,
        availability_checked_at, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'application/pdf', ?, 128, ?, 'ready', 'available', 12, 10, 10)`,
    [
      revisionId,
      assetId,
      input.attachmentId,
      `sha-${input.attachmentId}`,
      `https://example.test/${input.attachmentId}.pdf`,
    ],
  );
  await db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
    revisionId,
    assetId,
  ]);
  await db.run(
    `INSERT INTO project_assets
       (id, project_id, asset_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'source', 10, 10)`,
    [projectAssetId, input.projectId, assetId],
  );
  await db.run(
    `INSERT INTO evidence_items
       (id, library_id, work_id, asset_id, revision_id, source_kind, evidence_kind,
        anchor_json, payload_kind, payload_json, title, note_md, tags_json,
        source_content_hash, provenance_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'document', 'method', ?, 'text', ?, ?, ?, ?, ?, ?, 10, 10)`,
    [
      evidenceId,
      input.libraryId,
      input.workId,
      assetId,
      revisionId,
      JSON.stringify({
        ...(input.evidenceAnchor ?? { kind: "pdf", pageIndex: 2, version: 1 }),
        revisionId,
      }),
      JSON.stringify({ text: evidenceText }),
      `Evidence ${input.suffix}`,
      `Note ${input.suffix}`,
      JSON.stringify(["method", input.suffix]),
      input.sourceContentHash ?? (input.suffix === "b" ? "b".repeat(64) : "a".repeat(64)),
      JSON.stringify(input.evidenceProvenance ?? { capturedBy: "manual", page: 3 }),
    ],
  );
  await db.run(
    `INSERT INTO project_evidence
       (id, project_id, evidence_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'evidence', 10, 10)`,
    [projectEvidenceId, input.projectId, evidenceId],
  );
  return { assetId, evidenceId, projectAssetId, projectEvidenceId, revisionId };
}

function libraryRow(id = "source-library"): BackupRow {
  return { id, name: id, kind: "personal", created_at: 1, updated_at: 1 };
}

function workRow(id = "work-source", libraryId = "source-library"): BackupRow {
  return {
    id,
    library_id: libraryId,
    title: "Source Work",
    created_at: 10,
    updated_at: 10,
  };
}

function projectRow(id = "project-source", libraryId = "source-library"): BackupRow {
  return {
    id,
    library_id: libraryId,
    name: "Imported Project",
    status: "active",
    created_at: 10,
    updated_at: 10,
  };
}

function attachmentRow(id = "attachment-source", workId = "work-source"): BackupRow {
  return {
    id,
    work_id: workId,
    kind: "pdf",
    sha256: `sha-${id}`,
    byte_size: 128,
    original_filename: `${id}.pdf`,
    source_url: `https://example.test/${id}.pdf`,
    created_at: 10,
    updated_at: 10,
  };
}

function sourceKnowledgeTables(): BackupTables {
  const attachmentId = "attachment-source";
  const assetId = documentAssetIdFromAttachment(attachmentId);
  const revisionId = documentRevisionIdFromAttachment(attachmentId);
  const evidenceId = "evidence-source";
  const projectId = "project-source";
  return {
    libraries: [libraryRow()],
    works: [workRow()],
    research_projects: [projectRow()],
    attachments: [attachmentRow()],
    document_assets: [
      {
        id: assetId,
        library_id: "source-library",
        work_id: "work-source",
        kind: "pdf",
        title: "Source Document",
        current_revision_id: revisionId,
        created_at: 10,
        updated_at: 10,
      },
    ],
    document_revisions: [
      {
        id: revisionId,
        asset_id: assetId,
        attachment_id: attachmentId,
        revision_no: 1,
        mime_type: "application/pdf",
        blob_sha256: `sha-${attachmentId}`,
        byte_size: 128,
        source_url: `https://example.test/${attachmentId}.pdf`,
        extraction_status: "ready",
        availability_status: "available",
        availability_checked_at: 12,
        created_at: 10,
        updated_at: 10,
      },
    ],
    project_assets: [
      {
        id: projectAssetMembershipId(projectId, assetId),
        project_id: projectId,
        asset_id: assetId,
        role: "source",
        created_at: 10,
        updated_at: 10,
      },
    ],
    evidence_items: [
      {
        id: evidenceId,
        library_id: "source-library",
        work_id: "work-source",
        asset_id: assetId,
        revision_id: revisionId,
        source_kind: "document",
        evidence_kind: "method",
        anchor_json: JSON.stringify({ kind: "pdf", pageIndex: 2, revisionId, version: 1 }),
        payload_kind: "text",
        payload_json: JSON.stringify({ text: "Immutable captured snapshot" }),
        title: "Imported Evidence",
        note_md: "Mutable researcher note",
        tags_json: JSON.stringify(["method"]),
        source_content_hash: "a".repeat(64),
        provenance_json: JSON.stringify({ capturedBy: "manual", page: 3 }),
        created_at: 10,
        updated_at: 10,
      },
    ],
    project_evidence: [
      {
        id: projectEvidenceMembershipId(projectId, evidenceId),
        project_id: projectId,
        evidence_id: evidenceId,
        role: "evidence",
        created_at: 10,
        updated_at: 10,
      },
    ],
  };
}

function backupJson(version: number, tables: BackupTables): string {
  return JSON.stringify({
    version,
    exportedAt: "2026-07-31T00:00:00.000Z",
    sourceLibraryId: "source-library",
    tables,
  });
}

function cloneTables(tables: BackupTables): BackupTables {
  return JSON.parse(JSON.stringify(tables)) as BackupTables;
}

describe("Document/Evidence Library backup", () => {
  it("exports the five knowledge tables parent-first and only for the selected Library", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    for (const suffix of ["a", "b"] as const) {
      const libraryId = `library-${suffix}`;
      const workId = `work-${suffix}`;
      const projectId = `project-${suffix}`;
      const attachmentId = `attachment-${suffix}`;
      await addLibrary(db, libraryId);
      await addWork(db, libraryId, workId);
      await addProject(db, libraryId, projectId);
      await addAttachment(db, workId, attachmentId);
      await addKnowledgeGraph(db, { attachmentId, libraryId, projectId, suffix, workId });
    }

    const text = await exportLibraryBackupJsonFromDatabase(db, "library-a");
    const backup = JSON.parse(text) as { tables: BackupTables; version: number };
    const tableNames = Object.keys(backup.tables);

    expect(backup.version).toBe(5);
    for (let index = 1; index < KNOWLEDGE_TABLES.length; index += 1) {
      expect(tableNames.indexOf(KNOWLEDGE_TABLES[index - 1]!)).toBeLessThan(
        tableNames.indexOf(KNOWLEDGE_TABLES[index]!),
      );
    }
    const ids = exportedIdsForLibraryA();
    expect(backup.tables.document_assets?.map((row) => row.id)).toEqual([ids.assetId]);
    expect(backup.tables.document_revisions?.map((row) => row.id)).toEqual([ids.revisionId]);
    expect(backup.tables.project_assets?.map((row) => row.id)).toEqual([ids.projectAssetId]);
    expect(backup.tables.evidence_items?.map((row) => row.id)).toEqual([ids.evidenceId]);
    expect(backup.tables.project_evidence?.map((row) => row.id)).toEqual([ids.projectEvidenceId]);
  });

  it("preserves credential-shaped immutable Evidence through export and import", async () => {
    const sourceDb = await createNodeDatabase(":memory:");
    await runMigrations(sourceDb);
    await addLibrary(sourceDb, "source-library");
    await addWork(sourceDb, "source-library", "work-sensitive");
    await addProject(sourceDb, "source-library", "project-sensitive");
    await addAttachment(sourceDb, "work-sensitive", "attachment-sensitive");

    const evidenceText =
      "The paper reports https://example.test/run?token=study-token and Bearer cited-token.";
    const sourceContentHash = createHash("sha256").update(evidenceText).digest("hex");
    const evidenceAnchor = {
      kind: "pdf",
      pageIndex: 4,
      quote: {
        exact: evidenceText,
        prefix: "Quoted protocol uses Bearer context-token before the result.",
      },
      version: 1,
    };
    const evidenceProvenance = {
      capturedAt: 42,
      capturedBy: "user",
      captureMethod: "reader-selection",
      sourceAuthority: "published-source",
      sourceContext: "The appendix literally labels the example token=provenance-token.",
    };
    const ids = await addKnowledgeGraph(sourceDb, {
      attachmentId: "attachment-sensitive",
      evidenceAnchor,
      evidenceProvenance,
      evidenceText,
      libraryId: "source-library",
      projectId: "project-sensitive",
      sourceContentHash,
      suffix: "sensitive",
      workId: "work-sensitive",
    });

    const exportedText = await exportLibraryBackupJsonFromDatabase(sourceDb, "source-library");
    const exported = JSON.parse(exportedText) as { tables: BackupTables };
    const exportedEvidence = exported.tables.evidence_items?.find(
      (row) => row.id === ids.evidenceId,
    );
    expect(exportedEvidence).toMatchObject({
      anchor_json: JSON.stringify({
        ...evidenceAnchor,
        revisionId: ids.revisionId,
      }),
      payload_json: JSON.stringify({ text: evidenceText }),
      provenance_json: JSON.stringify(evidenceProvenance),
      source_content_hash: sourceContentHash,
    });

    const targetDb = await createNodeDatabase(":memory:");
    await runMigrations(targetDb);
    await addLibrary(targetDb, "target-library");
    await importBackup(exportedText, targetDb, "target-library");

    const [importedEvidence] = await targetDb.query<{
      anchor_json: string;
      payload_json: string;
      provenance_json: string;
      source_content_hash: string;
    }>(
      `SELECT anchor_json, payload_json, provenance_json, source_content_hash
       FROM evidence_items WHERE library_id = ?`,
      ["target-library"],
    );
    expect(importedEvidence).toEqual({
      anchor_json: exportedEvidence!.anchor_json,
      payload_json: JSON.stringify({ text: evidenceText }),
      provenance_json: JSON.stringify(evidenceProvenance),
      source_content_hash: sourceContentHash,
    });
    const importedText = (JSON.parse(importedEvidence!.payload_json) as { text: string }).text;
    expect(createHash("sha256").update(importedText).digest("hex")).toBe(
      importedEvidence!.source_content_hash,
    );
  });

  it("remaps attachment-derived identities, pointers, anchors, and deterministic joins together", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    await addLibrary(db, "foreign-library");
    await addWork(db, "foreign-library", "foreign-work");
    await addProject(db, "foreign-library", "project-source", "Foreign Project");
    await addAttachment(db, "foreign-work", "attachment-source");

    await importBackup(backupJson(4, sourceKnowledgeTables()), db, "target-library");

    const [attachment] = await db.query<{ id: string }>(
      `SELECT id FROM attachments WHERE work_id = 'work-source'`,
    );
    const [project] = await db.query<{ id: string }>(
      `SELECT id FROM research_projects
       WHERE library_id = 'target-library' AND name = 'Imported Project'`,
    );
    expect(attachment?.id).toBeTruthy();
    expect(attachment?.id).not.toBe("attachment-source");
    expect(project?.id).toBeTruthy();
    expect(project?.id).not.toBe("project-source");

    const assetId = documentAssetIdFromAttachment(attachment!.id);
    const revisionId = documentRevisionIdFromAttachment(attachment!.id);
    await expect(
      db.query<{ current_revision_id: string }>(
        `SELECT current_revision_id FROM document_assets WHERE id = ?`,
        [assetId],
      ),
    ).resolves.toEqual([{ current_revision_id: revisionId }]);
    await expect(
      db.query<{ asset_id: string; attachment_id: string }>(
        `SELECT asset_id, attachment_id FROM document_revisions WHERE id = ?`,
        [revisionId],
      ),
    ).resolves.toEqual([{ asset_id: assetId, attachment_id: attachment!.id }]);

    const [evidence] = await db.query<{
      anchor_json: string;
      asset_id: string;
      id: string;
      revision_id: string;
    }>(
      `SELECT id, asset_id, revision_id, anchor_json
       FROM evidence_items WHERE library_id = 'target-library'`,
    );
    expect(evidence).toMatchObject({ asset_id: assetId, revision_id: revisionId });
    expect(JSON.parse(evidence!.anchor_json)).toMatchObject({ revisionId });
    await expect(
      db.query<{ id: string }>(`SELECT id FROM project_assets WHERE project_id = ?`, [project!.id]),
    ).resolves.toEqual([{ id: projectAssetMembershipId(project!.id, assetId) }]);
    await expect(
      db.query<{ id: string }>(`SELECT id FROM project_evidence WHERE project_id = ?`, [
        project!.id,
      ]),
    ).resolves.toEqual([{ id: projectEvidenceMembershipId(project!.id, evidence!.id) }]);
  });

  it("backfills attachment-derived assets and revisions when importing v3", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const attachmentId = "legacy-attachment";
    await importBackup(
      backupJson(3, {
        libraries: [libraryRow()],
        works: [workRow()],
        attachments: [attachmentRow(attachmentId)],
      }),
      db,
      "target-library",
    );

    const assetId = documentAssetIdFromAttachment(attachmentId);
    const revisionId = documentRevisionIdFromAttachment(attachmentId);
    await expect(
      db.query<{ id: string; work_id: string }>(
        `SELECT id, work_id FROM document_assets WHERE id = ?`,
        [assetId],
      ),
    ).resolves.toEqual([{ id: assetId, work_id: "work-source" }]);
    await expect(
      db.query<{ asset_id: string; attachment_id: string; availability_status: string }>(
        `SELECT asset_id, attachment_id, availability_status
         FROM document_revisions WHERE id = ?`,
        [revisionId],
      ),
    ).resolves.toEqual([
      { asset_id: assetId, attachment_id: attachmentId, availability_status: "relink-required" },
    ]);
  });

  it.each(KNOWLEDGE_TABLES)("rejects v3 payloads that smuggle %s", (table) => {
    expect(() =>
      previewLibraryBackupJson(
        backupJson(3, {
          libraries: [libraryRow()],
          [table]: [{ id: "smuggled-row" }],
        }),
      ),
    ).toThrow(new RegExp(`v3.*v4.*${table}`));
  });

  it("rejects cross-Library, cross-asset, and mismatched-anchor source graphs", () => {
    const valid = sourceKnowledgeTables();
    expect(() => previewLibraryBackupJson(backupJson(4, valid))).not.toThrow();

    const crossLibrary = cloneTables(valid);
    crossLibrary.document_revisions![0]!.attachment_id = "attachment-outside";
    expect(() => previewLibraryBackupJson(backupJson(4, crossLibrary))).toThrow(
      /跨 Library 关系：document_revisions\.attachment_id/,
    );

    const crossAsset = cloneTables(valid);
    crossAsset.document_assets!.push({
      id: "asset-other",
      library_id: "source-library",
      work_id: "work-source",
      kind: "pdf",
      title: "Other Asset",
      current_revision_id: "revision-other",
      created_at: 10,
      updated_at: 10,
    });
    crossAsset.document_revisions!.push({
      id: "revision-other",
      asset_id: "asset-other",
      attachment_id: null,
      revision_no: 1,
      mime_type: "application/pdf",
      blob_sha256: "other-sha",
      byte_size: 1,
      extraction_status: "ready",
      availability_status: "unchecked",
      created_at: 10,
      updated_at: 10,
    });
    crossAsset.evidence_items![0]!.revision_id = "revision-other";
    crossAsset.evidence_items![0]!.anchor_json = JSON.stringify({
      kind: "pdf",
      pageIndex: 0,
      revisionId: "revision-other",
      version: 1,
    });
    expect(() => previewLibraryBackupJson(backupJson(4, crossAsset))).toThrow(
      /跨 Asset 关系：evidence_items\.revision_id/,
    );

    const wrongAnchor = cloneTables(valid);
    wrongAnchor.evidence_items![0]!.anchor_json = JSON.stringify({
      kind: "pdf",
      pageIndex: 0,
      revisionId: "revision-other",
      version: 1,
    });
    expect(() => previewLibraryBackupJson(backupJson(4, wrongAnchor))).toThrow(
      /anchor revision does not match/,
    );
  });

  it("resets imported device-local revision state while preserving the Evidence snapshot", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    await importBackup(backupJson(4, sourceKnowledgeTables()), db, "target-library");

    await expect(
      db.query<{
        availability_checked_at: number | null;
        availability_status: string;
        extraction_status: string;
        updated_at: number;
      }>(
        `SELECT extraction_status, availability_status, availability_checked_at, updated_at
         FROM document_revisions`,
      ),
    ).resolves.toEqual([
      {
        availability_checked_at: expect.any(Number),
        availability_status: "relink-required",
        extraction_status: "pending",
        updated_at: expect.any(Number),
      },
    ]);
    const [revision] = await db.query<{ updated_at: number }>(
      "SELECT updated_at FROM document_revisions",
    );
    expect(revision!.updated_at).toBeGreaterThan(10);
    await expect(
      db.query<{
        note_md: string;
        payload_json: string;
        provenance_json: string;
        source_content_hash: string;
        tags_json: string;
      }>(
        `SELECT payload_json, provenance_json, source_content_hash, note_md, tags_json
         FROM evidence_items`,
      ),
    ).resolves.toEqual([
      {
        note_md: "Mutable researcher note",
        payload_json: JSON.stringify({ text: "Immutable captured snapshot" }),
        provenance_json: JSON.stringify({ capturedBy: "manual", page: 3 }),
        source_content_hash: "a".repeat(64),
        tags_json: JSON.stringify(["method"]),
      },
    ]);
  });

  it("marks a revision without a compatibility attachment unchecked on import", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const tables = sourceKnowledgeTables();
    tables.attachments = [];
    tables.document_revisions![0]!.attachment_id = null;
    tables.document_revisions![0]!.availability_status = "missing";

    await importBackup(backupJson(4, tables), db, "target-library");

    await expect(
      db.query<{
        availability_checked_at: number | null;
        availability_status: string;
        extraction_status: string;
      }>(
        `SELECT extraction_status, availability_status, availability_checked_at
         FROM document_revisions`,
      ),
    ).resolves.toEqual([
      {
        availability_checked_at: null,
        availability_status: "unchecked",
        extraction_status: "pending",
      },
    ]);
  });

  it("does not recreate an attachment-derived asset after its canonical revision detaches", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    const tables = sourceKnowledgeTables();
    tables.document_revisions![0]!.attachment_id = null;

    await importBackup(backupJson(4, tables), db, "target-library");

    const attachmentId = "attachment-source";
    const assetId = documentAssetIdFromAttachment(attachmentId);
    const revisionId = documentRevisionIdFromAttachment(attachmentId);
    await expect(
      db.query<{ count: number }>("SELECT COUNT(*) AS count FROM document_assets WHERE id = ?", [
        assetId,
      ]),
    ).resolves.toEqual([{ count: 1 }]);
    await expect(
      db.query<{ attachment_id: string | null; count: number }>(
        `SELECT attachment_id, COUNT(*) AS count
         FROM document_revisions WHERE asset_id = ? GROUP BY attachment_id`,
        [assetId],
      ),
    ).resolves.toEqual([{ attachment_id: null, count: 1 }]);
    await expect(
      db.query<{ current_revision_id: string }>(
        "SELECT current_revision_id FROM document_assets WHERE id = ?",
        [assetId],
      ),
    ).resolves.toEqual([{ current_revision_id: revisionId }]);
  });
});

function exportedIdsForLibraryA(): KnowledgeIds {
  const attachmentId = "attachment-a";
  const assetId = documentAssetIdFromAttachment(attachmentId);
  const evidenceId = "evidence-a";
  return {
    assetId,
    evidenceId,
    projectAssetId: projectAssetMembershipId("project-a", assetId),
    projectEvidenceId: projectEvidenceMembershipId("project-a", evidenceId),
    revisionId: documentRevisionIdFromAttachment(attachmentId),
  };
}
