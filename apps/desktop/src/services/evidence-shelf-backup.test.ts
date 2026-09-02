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
import {
  canonicalizeEvidenceShelfAnchorJson,
  remapEvidenceShelfBackupRow,
  validateEvidenceShelfBackupGraph,
} from "../shared/library-backup-shelf";
import { sanitizeBackupRow } from "../shared/library-backup-sanitizer";
import { isSyncedTable, syncedColumnsForTable } from "./document-evidence-sync-scope";

type TestDatabase = Awaited<ReturnType<typeof createNodeDatabase>>;
type BackupRow = Record<string, unknown>;
type BackupTables = Record<string, BackupRow[]>;

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

async function addProject(db: TestDatabase, libraryId: string, id: string): Promise<void> {
  await db.run(
    `INSERT INTO research_projects (id, library_id, name, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 10, 10)`,
    [id, libraryId, `Project ${id}`],
  );
}

async function addDocumentGraph(
  db: TestDatabase,
  input: { attachmentId: string; libraryId: string; workId: string },
): Promise<{ assetId: string; revisionId: string }> {
  const assetId = documentAssetIdFromAttachment(input.attachmentId);
  const revisionId = documentRevisionIdFromAttachment(input.attachmentId);
  await db.run(
    `INSERT INTO attachments
       (id, work_id, kind, sha256, byte_size, original_filename, created_at, updated_at)
     VALUES (?, ?, 'pdf', ?, 128, ?, 10, 10)`,
    [input.attachmentId, input.workId, `sha-${input.attachmentId}`, `${input.attachmentId}.pdf`],
  );
  await db.run(
    `INSERT INTO document_assets
       (id, library_id, work_id, kind, title, created_at, updated_at)
     VALUES (?, ?, ?, 'pdf', ?, 10, 10)`,
    [assetId, input.libraryId, input.workId, `Asset ${input.attachmentId}`],
  );
  await db.run(
    `INSERT INTO document_revisions
       (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256, byte_size,
        extraction_status, availability_status, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'application/pdf', ?, 128, 'ready', 'available', 10, 10)`,
    [revisionId, assetId, input.attachmentId, `sha-${input.attachmentId}`],
  );
  await db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
    revisionId,
    assetId,
  ]);
  return { assetId, revisionId };
}

async function addShelf(
  db: TestDatabase,
  input: {
    attachmentId: string;
    libraryId: string;
    projectId: string;
    shelfId: string;
    workId: string;
    previewText?: string;
  },
): Promise<{ assetId: string; revisionId: string }> {
  const { assetId, revisionId } = await addDocumentGraph(db, input);
  // Keep this export fixture faithful to the repository contract: a durable
  // Shelf row is only stageable through a Project source membership.
  await db.run(
    `INSERT INTO project_works
       (id, project_id, work_id, role, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'source', 10, 10, NULL)`,
    [projectWorkMembershipId(input.projectId, input.workId), input.projectId, input.workId],
  );
  await db.run(
    `INSERT INTO project_assets
       (id, project_id, asset_id, role, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'source', 10, 10, NULL)`,
    [projectAssetMembershipId(input.projectId, assetId), input.projectId, assetId],
  );
  const previewText =
    input.previewText ?? "Bearer shelf-token https://example.test/read?token=preview-token";
  await db.run(
    `INSERT INTO evidence_shelf_items
       (id, library_id, project_id, work_id, asset_id, revision_id,
        anchor_snapshot_json, preview_payload_json, source_content_hash,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', 10, 10)`,
    [
      input.shelfId,
      input.libraryId,
      input.projectId,
      input.workId,
      assetId,
      revisionId,
      JSON.stringify({ kind: "pdf", pageIndex: 2, revisionId, version: 1 }),
      JSON.stringify({
        contentUnitId: `content-unit:${input.shelfId}`,
        excerpt: previewText,
        headingPath: ["Methods"],
        language: "en",
        ordinal: 0,
        sourceId: revisionId,
        sourceType: "pdf",
        text: previewText,
        tokenCount: 4,
        workTitle: "Shelf source",
      }),
      "a".repeat(64),
    ],
  );
  return { assetId, revisionId };
}

async function importBackup(text: string, db: Database, libraryId: string): Promise<void> {
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

function shelfGraph(sourceType: "annotation" | "evidence" | "pdf"): BackupTables {
  const sourceId =
    sourceType === "annotation"
      ? "annotation-source"
      : sourceType === "evidence"
        ? "evidence-source"
        : "revision-source";
  return {
    annotations:
      sourceType === "annotation"
        ? [
            {
              id: sourceId,
              attachment_id: "attachment-source",
              work_id: "work-source",
            },
          ]
        : [],
    attachments: [{ id: "attachment-source", work_id: "work-source" }],
    document_assets: [{ id: "asset-source", library_id: "library-source", work_id: "work-source" }],
    document_revisions: [
      {
        id: "revision-source",
        asset_id: "asset-source",
        attachment_id: "attachment-source",
      },
    ],
    evidence_items:
      sourceType === "evidence"
        ? [
            {
              id: sourceId,
              library_id: "library-source",
              work_id: "work-source",
              asset_id: "asset-source",
              revision_id: "revision-source",
              source_content_hash: "a".repeat(64),
            },
          ]
        : [],
    evidence_shelf_items: [
      {
        id: "shelf-source",
        library_id: "library-source",
        project_id: "project-source",
        work_id: "work-source",
        asset_id: "asset-source",
        revision_id: "revision-source",
        anchor_snapshot_json: JSON.stringify({
          kind: "pdf",
          pageIndex: 2,
          revisionId: "revision-source",
          version: 1,
        }),
        preview_payload_json: JSON.stringify({
          contentUnitId: "unit-source",
          excerpt: "Shelf preview",
          headingPath: null,
          language: null,
          ordinal: 0,
          sourceId,
          sourceType,
          text: "Shelf preview",
          tokenCount: null,
          workTitle: null,
        }),
        source_content_hash: "a".repeat(64),
        status: "staged",
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
      },
    ],
    research_projects: [{ id: "project-source", library_id: "library-source" }],
    works: [{ id: "work-source", library_id: "library-source" }],
  };
}

describe("Evidence Shelf whole-Library backup", () => {
  it("preserves the stored SourceAnchor key order during import normalization", () => {
    const stored = JSON.stringify({
      version: 1,
      kind: "pdf",
      revisionId: "revision-source",
      pageIndex: 2,
      quote: { exact: "quoted" },
      position: { start: 0, end: 6 },
    });
    expect(canonicalizeEvidenceShelfAnchorJson(stored)).toBe(stored);
    expect(
      canonicalizeEvidenceShelfAnchorJson(
        JSON.stringify({
          version: 1,
          kind: "pdf",
          revision_id: "revision-source",
          pageIndex: 2,
        }),
      ),
    ).toBe(
      JSON.stringify({
        version: 1,
        kind: "pdf",
        revisionId: "revision-source",
        pageIndex: 2,
      }),
    );
  });

  it("round-trips Shelf rows, preserves anchor/hash, and sanitizes only preview payload text", async () => {
    const source = await createNodeDatabase(":memory:");
    await runMigrations(source);
    await addLibrary(source, "source-library");
    await addWork(source, "source-library", "source-work");
    await addProject(source, "source-library", "source-project");
    const ids = await addShelf(source, {
      attachmentId: "source-attachment",
      libraryId: "source-library",
      projectId: "source-project",
      shelfId: "shelf-source",
      workId: "source-work",
    });

    const text = await exportLibraryBackupJsonFromDatabase(source, "source-library");
    const exported = JSON.parse(text) as { tables: BackupTables; version: number };
    expect(exported.version).toBe(6);
    const shelf = exported.tables.evidence_shelf_items?.[0];
    expect(shelf).toMatchObject({
      asset_id: ids.assetId,
      project_id: "source-project",
      revision_id: ids.revisionId,
      source_content_hash: "a".repeat(64),
      work_id: "source-work",
    });
    expect(shelf?.anchor_snapshot_json).toBe(
      JSON.stringify({ kind: "pdf", pageIndex: 2, revisionId: ids.revisionId, version: 1 }),
    );
    const preview = JSON.parse(String(shelf?.preview_payload_json)) as {
      text: string;
      sourceId: string;
    };
    expect(preview.sourceId).toBe(ids.revisionId);
    expect(preview.text).not.toContain("Bearer shelf-token");
    expect(preview.text).not.toContain("preview-token");

    const target = await createNodeDatabase(":memory:");
    await runMigrations(target);
    await addLibrary(target, "target-library");
    await importBackup(text, target, "target-library");
    const [restored] = await target.query<{
      anchor_snapshot_json: string;
      project_id: string;
      revision_id: string;
      source_content_hash: string;
      work_id: string;
    }>(
      `SELECT anchor_snapshot_json, project_id, revision_id, source_content_hash, work_id
       FROM evidence_shelf_items WHERE library_id = 'target-library'`,
    );
    expect(restored).toMatchObject({
      anchor_snapshot_json: shelf?.anchor_snapshot_json,
      project_id: "source-project",
      revision_id: ids.revisionId,
      source_content_hash: "a".repeat(64),
      work_id: "source-work",
    });
  });

  it("remaps canonical Shelf references and embedded PDF source ids around foreign collisions", async () => {
    const source = await createNodeDatabase(":memory:");
    await runMigrations(source);
    await addLibrary(source, "source-library");
    await addWork(source, "source-library", "source-work");
    await addProject(source, "source-library", "source-project");
    const sourceIds = await addShelf(source, {
      attachmentId: "source-attachment",
      libraryId: "source-library",
      projectId: "source-project",
      shelfId: "shelf-source",
      workId: "source-work",
    });
    const text = await exportLibraryBackupJsonFromDatabase(source, "source-library");

    const target = await createNodeDatabase(":memory:");
    await runMigrations(target);
    await addLibrary(target, "target-library");
    await addLibrary(target, "foreign-library");
    await addWork(target, "foreign-library", "source-work");
    await addProject(target, "foreign-library", "source-project");
    await addDocumentGraph(target, {
      attachmentId: "source-attachment",
      libraryId: "foreign-library",
      workId: "source-work",
    });
    const foreignShelfIds = await addDocumentGraph(target, {
      attachmentId: "foreign-shelf-attachment",
      libraryId: "foreign-library",
      workId: "source-work",
    });
    await target.run(
      `INSERT INTO evidence_shelf_items
         (id, library_id, project_id, work_id, asset_id, revision_id,
          anchor_snapshot_json, preview_payload_json, source_content_hash,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', 10, 10)`,
      [
        "shelf-source",
        "foreign-library",
        "source-project",
        "source-work",
        foreignShelfIds.assetId,
        foreignShelfIds.revisionId,
        JSON.stringify({ kind: "pdf", pageIndex: 0, revisionId: foreignShelfIds.revisionId }),
        JSON.stringify({
          contentUnitId: "foreign-unit",
          sourceId: foreignShelfIds.revisionId,
          sourceType: "pdf",
          text: "foreign shelf",
        }),
        "b".repeat(64),
      ],
    );

    await importBackup(text, target, "target-library");
    const [restored] = await target.query<{
      anchor_snapshot_json: string;
      asset_id: string;
      project_id: string;
      preview_payload_json: string;
      revision_id: string;
      id: string;
      work_id: string;
    }>(
      `SELECT id, anchor_snapshot_json, asset_id, project_id, preview_payload_json, revision_id, work_id
       FROM evidence_shelf_items WHERE library_id = 'target-library'`,
    );
    expect(restored?.id).toBeTruthy();
    expect(restored?.id).not.toBe("shelf-source");
    expect(restored?.work_id).toBeTruthy();
    expect(restored?.work_id).not.toBe("source-work");
    expect(restored?.project_id).toBeTruthy();
    expect(restored?.project_id).not.toBe("source-project");
    expect(restored?.asset_id).toBeTruthy();
    expect(restored?.asset_id).not.toBe(sourceIds.assetId);
    expect(restored?.revision_id).toBeTruthy();
    expect(restored?.revision_id).not.toBe(sourceIds.revisionId);
    expect(JSON.parse(restored!.anchor_snapshot_json)).toMatchObject({
      revisionId: restored!.revision_id,
    });
    expect(JSON.parse(restored!.preview_payload_json)).toMatchObject({
      sourceId: restored!.revision_id,
    });
  });

  it("remaps every supported alias inside anchor and preview JSON", () => {
    const empty = new Map<string, string>();
    const remapped = remapEvidenceShelfBackupRow(
      "evidence_shelf_items",
      {
        id: "shelf-source",
        revision_id: "revision-source",
        anchor_snapshot_json: JSON.stringify({
          revisionId: "revision-source",
          revision_id: "revision-source",
        }),
        preview_payload_json: JSON.stringify({
          contentUnitId: "unit-source",
          revisionId: "revision-source",
          revision_id: "revision-source",
          sourceId: "revision-source",
          source_id: "revision-source",
          sourceType: "pdf",
          source_type: "pdf",
        }),
      },
      {
        annotations: empty,
        assets: empty,
        evidence: empty,
        projects: empty,
        revisions: new Map([["revision-source", "revision-target"]]),
        shelfItems: empty,
        works: empty,
      },
    );

    expect(remapped.redirected).toBe(true);
    expect(JSON.parse(String(remapped.row.anchor_snapshot_json))).toMatchObject({
      revisionId: "revision-target",
      revision_id: "revision-target",
    });
    expect(JSON.parse(String(remapped.row.preview_payload_json))).toMatchObject({
      revisionId: "revision-target",
      revision_id: "revision-target",
      sourceId: "revision-target",
      source_id: "revision-target",
    });
  });

  it("remaps a historical anchor even when the Shelf revision pointer is detached", () => {
    const remapped = remapEvidenceShelfBackupRow(
      "evidence_shelf_items",
      {
        id: "shelf-source",
        revision_id: null,
        anchor_snapshot_json: JSON.stringify({ revisionId: "revision-source" }),
        preview_payload_json: JSON.stringify({
          contentUnitId: "unit-source",
          excerpt: "Shelf preview",
          headingPath: null,
          language: null,
          ordinal: 0,
          sourceId: "annotation-source",
          sourceType: "annotation",
          text: "Shelf preview",
          tokenCount: null,
          workTitle: null,
        }),
      },
      {
        annotations: new Map([["annotation-source", "annotation-target"]]),
        assets: new Map(),
        evidence: new Map(),
        projects: new Map(),
        revisions: new Map([["revision-source", "revision-target"]]),
        shelfItems: new Map(),
        works: new Map(),
      },
    );
    expect(JSON.parse(String(remapped.row.anchor_snapshot_json))).toEqual({
      revisionId: "revision-target",
    });
    expect(JSON.parse(String(remapped.row.preview_payload_json))).toMatchObject({
      sourceId: "annotation-target",
    });
  });

  it("preserves Shelf graph identities while redacting preview text", () => {
    const sanitized = sanitizeBackupRow("evidence_shelf_items", {
      id: "Bearer shelf-id",
      library_id: "ghp_library_identity_1234567890",
      project_id: "project-source",
      revision_id: "revision-source",
      anchor_snapshot_json: JSON.stringify({ revisionId: "Bearer revision-id" }),
      preview_payload_json: JSON.stringify({
        contentUnitId: "Bearer unit-id",
        excerpt: "Bearer preview-secret",
        sourceId: "ghp_source_identity_1234567890",
        sourceType: "pdf",
        text: "The result uses Bearer preview-secret.",
        metadata: {
          contentUnitId: "Bearer nested-unit-secret",
          sourceId: "Bearer nested-source-secret",
          sourceType: "Bearer nested-source-type",
          sourceContentHash: "Bearer nested-hash-secret",
          nested: {
            revisionId: "Bearer nested-revision-secret",
          },
        },
      }),
      source_content_hash: "a".repeat(64),
    });
    expect(sanitized).not.toBeNull();
    expect(sanitized?.id).toBe("Bearer shelf-id");
    expect(sanitized?.library_id).toBe("ghp_library_identity_1234567890");
    expect(JSON.parse(String(sanitized?.anchor_snapshot_json))).toEqual({
      revisionId: "Bearer revision-id",
    });
    expect(JSON.parse(String(sanitized?.preview_payload_json))).toMatchObject({
      contentUnitId: "Bearer unit-id",
      sourceId: "ghp_source_identity_1234567890",
      sourceType: "pdf",
    });
    expect(JSON.parse(String(sanitized?.preview_payload_json)).text).not.toContain(
      "preview-secret",
    );
    expect(JSON.parse(String(sanitized?.preview_payload_json)).metadata).toEqual({
      contentUnitId: "Bearer [redacted]",
      sourceId: "Bearer [redacted]",
      sourceType: "Bearer [redacted]",
      sourceContentHash: "Bearer [redacted]",
      nested: {
        revisionId: "Bearer [redacted]",
      },
    });
  });

  it("rejects Shelf rows that point outside the source graph before writing", async () => {
    const source = await createNodeDatabase(":memory:");
    await runMigrations(source);
    await addLibrary(source, "source-library");
    await addWork(source, "source-library", "source-work");
    await addProject(source, "source-library", "source-project");
    await addShelf(source, {
      attachmentId: "source-attachment",
      libraryId: "source-library",
      projectId: "source-project",
      shelfId: "shelf-source",
      workId: "source-work",
    });
    const exported = JSON.parse(
      await exportLibraryBackupJsonFromDatabase(source, "source-library"),
    ) as { tables: BackupTables; version: number };
    exported.tables.evidence_shelf_items![0]!.project_id = "foreign-project";
    const forged = JSON.stringify(exported);

    expect(() => parseLibraryBackupJson(forged)).toThrow(/evidence_shelf_items\.project_id/);
    const target = await createNodeDatabase(":memory:");
    await runMigrations(target);
    await addLibrary(target, "target-library");
    await expect(importBackup(forged, target, "target-library")).rejects.toThrow(
      /evidence_shelf_items\.project_id/,
    );
    await expect(
      target.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM evidence_shelf_items WHERE library_id = 'target-library'`,
      ),
    ).resolves.toEqual([{ count: 0 }]);

    const missingMembershipTable = JSON.parse(
      await exportLibraryBackupJsonFromDatabase(source, "source-library"),
    ) as { tables: BackupTables; version: number };
    delete missingMembershipTable.tables.project_works;
    expect(() => parseLibraryBackupJson(JSON.stringify(missingMembershipTable))).toThrow(
      /缺少项目成员表：project_works/,
    );
  });

  it("rejects malformed Shelf snapshots and non-canonical hashes before import", async () => {
    const source = await createNodeDatabase(":memory:");
    await runMigrations(source);
    await addLibrary(source, "source-library");
    await addWork(source, "source-library", "source-work");
    await addProject(source, "source-library", "source-project");
    await addShelf(source, {
      attachmentId: "source-attachment",
      libraryId: "source-library",
      projectId: "source-project",
      shelfId: "shelf-source",
      workId: "source-work",
    });
    const exported = JSON.parse(
      await exportLibraryBackupJsonFromDatabase(source, "source-library"),
    ) as { tables: BackupTables; version: number };

    const malformedAnchor = structuredClone(exported);
    malformedAnchor.tables.evidence_shelf_items![0]!.anchor_snapshot_json = "{not-json";
    expect(() => parseLibraryBackupJson(JSON.stringify(malformedAnchor))).toThrow(
      /anchor_snapshot_json/,
    );

    const malformedPreview = structuredClone(exported);
    malformedPreview.tables.evidence_shelf_items![0]!.preview_payload_json = "[]";
    expect(() => parseLibraryBackupJson(JSON.stringify(malformedPreview))).toThrow(
      /preview_payload_json/,
    );

    const uppercaseHash = structuredClone(exported);
    uppercaseHash.tables.evidence_shelf_items![0]!.source_content_hash = "A".repeat(64);
    expect(() => parseLibraryBackupJson(JSON.stringify(uppercaseHash))).toThrow(
      /source_content_hash/,
    );
  });

  it("rejects mismatched preview sources and duplicate active Shelf semantics", () => {
    const evidence = shelfGraph("evidence");
    expect(() => validateEvidenceShelfBackupGraph(evidence, 6)).not.toThrow();
    evidence.evidence_items![0]!.library_id = "foreign-library";
    expect(() => validateEvidenceShelfBackupGraph(evidence, 6)).toThrow(/preview source/);

    const evidenceHash = shelfGraph("evidence");
    evidenceHash.evidence_items![0]!.source_content_hash = "b".repeat(64);
    expect(() => validateEvidenceShelfBackupGraph(evidenceHash, 6)).toThrow(/source_content_hash/);

    const annotation = shelfGraph("annotation");
    expect(() => validateEvidenceShelfBackupGraph(annotation, 6)).not.toThrow();
    annotation.works!.push({ id: "other-work", library_id: "library-source" });
    annotation.annotations![0]!.work_id = "other-work";
    expect(() => validateEvidenceShelfBackupGraph(annotation, 6)).toThrow(/跨 Work 关系/);

    const alternateSource = shelfGraph("pdf");
    alternateSource.evidence_items = [
      {
        id: "evidence-source",
        library_id: "library-source",
        work_id: "work-source",
        asset_id: "asset-source",
        revision_id: "revision-source",
        source_content_hash: "a".repeat(64),
      },
    ];
    alternateSource.evidence_shelf_items!.push({
      ...alternateSource.evidence_shelf_items![0]!,
      id: "shelf-evidence",
      preview_payload_json: JSON.stringify({
        contentUnitId: "unit-evidence",
        excerpt: "Shelf preview",
        headingPath: null,
        language: null,
        ordinal: 0,
        sourceId: "evidence-source",
        sourceType: "evidence",
        text: "Shelf preview",
        tokenCount: null,
        workTitle: null,
      }),
    });
    expect(() => validateEvidenceShelfBackupGraph(alternateSource, 6)).not.toThrow();

    const duplicate = shelfGraph("pdf");
    duplicate.evidence_shelf_items!.push({
      ...duplicate.evidence_shelf_items![0]!,
      id: "shelf-duplicate",
      anchor_snapshot_json: JSON.stringify({
        version: 1,
        revisionId: "revision-source",
        pageIndex: 2,
        kind: "pdf",
      }),
    });
    expect(() => validateEvidenceShelfBackupGraph(duplicate, 6)).toThrow(
      /重复的 Evidence Shelf 语义行/,
    );

    const detached = shelfGraph("annotation");
    detached.evidence_shelf_items![0]!.revision_id = null;
    detached.document_revisions![0]!.attachment_id = null;
    expect(() => validateEvidenceShelfBackupGraph(detached, 6)).not.toThrow();

    const forgedMembership = shelfGraph("pdf");
    forgedMembership.project_works = [
      {
        id: "project-work:forged",
        project_id: "project-source",
        work_id: "other-work",
        deleted_at: null,
      },
    ];
    expect(() => validateEvidenceShelfBackupGraph(forgedMembership, 6)).toThrow(
      /不属于目标 Research Project/,
    );

    const removedMembership = shelfGraph("pdf");
    removedMembership.project_works = [
      {
        id: "project-work:removed",
        project_id: "project-source",
        work_id: "work-source",
        deleted_at: 99,
      },
    ];
    expect(() => validateEvidenceShelfBackupGraph(removedMembership, 6)).not.toThrow();
  });

  it("keeps a valid v5 payload importable when no Shelf rows are present", async () => {
    const target = await createNodeDatabase(":memory:");
    await runMigrations(target);
    await addLibrary(target, "target-library");
    const v5 = JSON.stringify({
      version: 5,
      exportedAt: "2026-08-01T00:00:00.000Z",
      sourceLibraryId: "legacy-library",
      tables: {
        libraries: [
          {
            id: "legacy-library",
            name: "Legacy",
            kind: "personal",
            created_at: 1,
            updated_at: 1,
          },
        ],
        saved_searches: [
          {
            id: "legacy-search",
            library_id: "legacy-library",
            query: "graph retrieval",
            criteria_json: '{"text":"graph retrieval"}',
            sources_json: '["openalex"]',
            seen_ids_json: "[]",
            new_count: 0,
            created_at: 1,
            updated_at: 1,
          },
        ],
      },
    });

    const parsed = parseLibraryBackupJson(v5);
    expect(parsed.version).toBe(5);
    await importBackup(v5, target, "target-library");
    await expect(
      target.query<{ library_id: string; query: string }>(
        `SELECT library_id, query FROM saved_searches WHERE id = 'legacy-search'`,
      ),
    ).resolves.toEqual([{ library_id: "target-library", query: "graph retrieval" }]);
  });

  it("rejects v5 payloads that smuggle non-empty Shelf rows and keeps Shelf out of WebDAV sync", async () => {
    const v5 = JSON.stringify({
      version: 5,
      exportedAt: "2026-08-01T00:00:00.000Z",
      sourceLibraryId: "source-library",
      tables: {
        libraries: [
          { id: "source-library", name: "Source", kind: "personal", created_at: 1, updated_at: 1 },
        ],
        evidence_shelf_items: [
          {
            id: "shelf-source",
            library_id: "source-library",
            project_id: "project-source",
            source_content_hash: "a".repeat(64),
            status: "staged",
            anchor_snapshot_json: "{}",
            preview_payload_json: "{}",
            created_at: 1,
            updated_at: 1,
          },
        ],
      },
    });
    expect(() => parseLibraryBackupJson(v5)).toThrow(/v5.*v6.*evidence_shelf_items/);
    expect(isSyncedTable("evidence_shelf_items")).toBe(false);
    expect(syncedColumnsForTable("evidence_shelf_items")).toBeNull();
  });

  it("rejects malformed Shelf table containers and non-object rows", () => {
    const nonArray = JSON.stringify({ version: 6, tables: { evidence_shelf_items: {} } });
    expect(() => parseLibraryBackupJson(nonArray)).toThrow(/必须是数组/);
    const nonObject = JSON.stringify({ version: 6, tables: { evidence_shelf_items: [null] } });
    expect(() => parseLibraryBackupJson(nonObject)).toThrow(/非对象行/);
  });
});
