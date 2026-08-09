import { describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "./database";
import { documentAssetIdFromAttachment, documentRevisionIdFromAttachment } from "./ids";
import { requireLocalLibraryId } from "./local-first";
import { MIGRATIONS, runMigrations } from "./migrations";

async function migrateThrough(version: number): Promise<Database> {
  const db = await createNodeDatabase(":memory:");
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );

  for (const migration of MIGRATIONS) {
    if (migration.version > version) break;
    if (migration.disableForeignKeys) await db.exec("PRAGMA foreign_keys = OFF");
    await db.exec("BEGIN");
    try {
      if (migration.apply) await migration.apply(db);
      else await db.exec(migration.sql);

      if (migration.disableForeignKeys) {
        expect(await db.query("PRAGMA foreign_key_check")).toEqual([]);
      }
      await db.run(
        `INSERT INTO _migrations (version, name, applied_at)
         VALUES (?, ?, ?)`,
        [migration.version, migration.name, Date.now()],
      );
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    } finally {
      if (migration.disableForeignKeys) await db.exec("PRAGMA foreign_keys = ON");
    }
  }
  return db;
}

interface V18Seed {
  firstLibraryId: string;
  secondLibraryId: string;
  firstProjectId: string;
  secondProjectId: string;
  attachmentIds: string[];
}

async function seedV18MultiLibraryGraph(db: Database): Promise<V18Seed> {
  const firstLibraryId = await requireLocalLibraryId(db);
  const [firstProject] = await db.query<{ id: string }>(
    `SELECT id FROM research_projects WHERE library_id = ?`,
    [firstLibraryId],
  );
  if (!firstProject) throw new Error("v18 seed requires the default Research Project");

  const now = Date.now();
  const secondLibraryId = "library:evidence-second";
  const secondProjectId = "project:evidence-second";
  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, 'Evidence second', 'personal', ?, ?)`,
    [secondLibraryId, now, now],
  );
  await db.run(
    `INSERT INTO research_projects (
       id, library_id, name, status, created_at, updated_at
     ) VALUES (?, ?, 'Second evidence project', 'active', ?, ?)`,
    [secondProjectId, secondLibraryId, now, now],
  );
  await db.run(
    `INSERT INTO works (
       id, library_id, title, type, created_at, updated_at
     ) VALUES
       ('work:evidence-first', ?, 'First evidence work', 'article', ?, ?),
       ('work:evidence-second', ?, 'Second evidence work', 'article', ?, ?)`,
    [firstLibraryId, now, now, secondLibraryId, now + 1, now + 1],
  );

  const attachmentIds = [
    "attachment:first-pdf",
    "attachment:first-supplement",
    "attachment:second-other",
  ];
  await db.run(
    `INSERT INTO attachments (
       id, work_id, kind, sha256, byte_size, original_filename, source_url,
       text_extracted_at, created_at, updated_at
     ) VALUES
       (?, 'work:evidence-first', 'pdf', ?, 101, 'first.pdf', 'file:///first.pdf',
        ?, ?, ?),
       (?, 'work:evidence-first', 'supplement', ?, 202, 'appendix.csv', NULL,
        NULL, ?, ?),
       (?, 'work:evidence-second', 'html', ?, 303, NULL, 'https://example.test/paper',
        ?, ?, ?)`,
    [
      attachmentIds[0],
      "a".repeat(64),
      now,
      now,
      now,
      attachmentIds[1],
      "b".repeat(64),
      now + 1,
      now + 1,
      attachmentIds[2],
      "c".repeat(64),
      now + 2,
      now + 2,
      now + 2,
    ],
  );
  await db.run(
    `INSERT INTO annotations (
       id, attachment_id, work_id, type, page_index, sort_key, created_at, updated_at
     ) VALUES
       ('annotation:evidence-first', ?, 'work:evidence-first', 'highlight', 0, 1, ?, ?),
       ('annotation:evidence-second', ?, 'work:evidence-second', 'highlight', 1, 2, ?, ?)`,
    [attachmentIds[0], now, now, attachmentIds[2], now + 2, now + 2],
  );
  await db.run(
    `INSERT INTO snippets (
       id, work_id, page_index, quote, created_at, updated_at
     ) VALUES
       ('snippet:evidence-first', 'work:evidence-first', 0, 'First quote', ?, ?),
       ('snippet:evidence-second', 'work:evidence-second', 1, 'Second quote', ?, ?)`,
    [now, now, now + 2, now + 2],
  );
  await db.run(
    `INSERT INTO canvas_workspaces (
       id, library_id, project_id, name, viewport_json, created_at, updated_at
     ) VALUES
       ('canvas:evidence-first', ?, ?, 'First canvas', '{}', ?, ?),
       ('canvas:evidence-second', ?, ?, 'Second canvas', '{}', ?, ?)`,
    [firstLibraryId, firstProject.id, now, now, secondLibraryId, secondProjectId, now + 2, now + 2],
  );
  await db.run(
    `INSERT INTO canvas_nodes (
       id, workspace_id, work_id, type, pos_x, pos_y, width, height,
       data_json, created_at, updated_at
     ) VALUES
       ('node:evidence-first-a', 'canvas:evidence-first', 'work:evidence-first',
        'paper', 0, 0, 320, 180, '{}', ?, ?),
       ('node:evidence-first-b', 'canvas:evidence-first', NULL,
        'idea-note', 360, 0, 240, 160, '{}', ?, ?),
       ('node:evidence-second', 'canvas:evidence-second', 'work:evidence-second',
        'paper', 0, 0, 320, 180, '{}', ?, ?)`,
    [now, now, now + 1, now + 1, now + 2, now + 2],
  );
  await db.run(
    `INSERT INTO canvas_edges (
       id, workspace_id, source_id, target_id, relation_type, label,
       created_at, updated_at
     ) VALUES (
       'edge:evidence-first', 'canvas:evidence-first',
       'node:evidence-first-a', 'node:evidence-first-b', 'custom', 'supports', ?, ?
     )`,
    [now + 1, now + 1],
  );

  return {
    firstLibraryId,
    secondLibraryId,
    firstProjectId: firstProject.id,
    secondProjectId,
    attachmentIds,
  };
}

async function ids(db: Database, table: string): Promise<string[]> {
  return (await db.query<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`)).map(
    (row) => row.id,
  );
}

describe("v19 document revisions and evidence migration", () => {
  it("creates the additive document and evidence foundation on a clean database", async () => {
    const db = await createNodeDatabase(":memory:");

    await runMigrations(db);

    expect(Number(await db.queryScalar(`SELECT MAX(version) FROM _migrations`))).toBe(
      MIGRATIONS[MIGRATIONS.length - 1]!.version,
    );
    expect(
      await db.query<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'document_assets', 'document_revisions', 'project_assets',
             'evidence_items', 'project_evidence'
           )
         ORDER BY name`,
      ),
    ).toEqual([
      { name: "document_assets" },
      { name: "document_revisions" },
      { name: "evidence_items" },
      { name: "project_assets" },
      { name: "project_evidence" },
    ]);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM document_assets`))).toBe(0);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM document_revisions`))).toBe(0);
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);
    expect(Number(await db.queryScalar(`PRAGMA foreign_keys`))).toBe(1);
  });

  it("backfills v18 attachments across Libraries without rewriting legacy identities", async () => {
    const db = await migrateThrough(18);
    const seed = await seedV18MultiLibraryGraph(db);
    const legacyIds = new Map<string, string[]>();
    for (const table of [
      "attachments",
      "annotations",
      "snippets",
      "canvas_workspaces",
      "canvas_nodes",
      "canvas_edges",
    ]) {
      legacyIds.set(table, await ids(db, table));
    }

    await runMigrations(db);

    for (const [table, before] of legacyIds) {
      expect(await ids(db, table), `${table} primary keys`).toEqual(before);
    }
    expect(
      await db.query<{
        attachment_id: string;
        asset_id: string;
        library_id: string;
        work_id: string;
        revision_id: string;
        current_revision_id: string | null;
      }>(
        `SELECT revision.attachment_id, asset.id AS asset_id, asset.library_id,
                asset.work_id, revision.id AS revision_id, asset.current_revision_id
         FROM document_revisions revision
         JOIN document_assets asset ON asset.id = revision.asset_id
         ORDER BY revision.attachment_id`,
      ),
    ).toEqual(
      seed.attachmentIds
        .map((attachmentId) => ({
          attachment_id: attachmentId,
          asset_id: documentAssetIdFromAttachment(attachmentId),
          library_id: attachmentId.startsWith("attachment:first")
            ? seed.firstLibraryId
            : seed.secondLibraryId,
          work_id: attachmentId.startsWith("attachment:first")
            ? "work:evidence-first"
            : "work:evidence-second",
          revision_id: documentRevisionIdFromAttachment(attachmentId),
          current_revision_id: documentRevisionIdFromAttachment(attachmentId),
        }))
        .sort((a, b) => a.attachment_id.localeCompare(b.attachment_id)),
    );
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it("keeps multiple attachments of one Work as distinct assets and revisions", async () => {
    const db = await migrateThrough(18);
    const seed = await seedV18MultiLibraryGraph(db);

    await runMigrations(db);

    const firstWorkAttachments = seed.attachmentIds.slice(0, 2);
    expect(
      await db.query<{
        asset_id: string;
        revision_id: string;
        attachment_id: string;
        revision_no: number;
      }>(
        `SELECT asset.id AS asset_id, revision.id AS revision_id,
                revision.attachment_id, revision.revision_no
         FROM document_assets asset
         JOIN document_revisions revision ON revision.asset_id = asset.id
         WHERE asset.work_id = 'work:evidence-first'
         ORDER BY revision.attachment_id`,
      ),
    ).toEqual(
      firstWorkAttachments.map((attachmentId) => ({
        asset_id: documentAssetIdFromAttachment(attachmentId),
        revision_id: documentRevisionIdFromAttachment(attachmentId),
        attachment_id: attachmentId,
        revision_no: 1,
      })),
    );
    expect(
      Number(
        await db.queryScalar(
          `SELECT COUNT(DISTINCT id)
           FROM document_assets
           WHERE work_id = 'work:evidence-first'`,
        ),
      ),
    ).toBe(2);
  });

  it("rejects assigning another asset's revision as the current revision", async () => {
    const db = await migrateThrough(18);
    const seed = await seedV18MultiLibraryGraph(db);
    await runMigrations(db);
    const [firstAttachment, secondAttachment] = seed.attachmentIds;
    const firstAssetId = documentAssetIdFromAttachment(firstAttachment!);
    const originalRevisionId = documentRevisionIdFromAttachment(firstAttachment!);

    await expect(
      db.run(`UPDATE document_assets SET current_revision_id = ? WHERE id = ?`, [
        documentRevisionIdFromAttachment(secondAttachment!),
        firstAssetId,
      ]),
    ).rejects.toThrow(/current revision must belong to its document asset/);
    expect(
      await db.query<{ current_revision_id: string }>(
        `SELECT current_revision_id FROM document_assets WHERE id = ?`,
        [firstAssetId],
      ),
    ).toEqual([{ current_revision_id: originalRevisionId }]);
  });

  it("rejects cross-Library Project links to assets and evidence", async () => {
    const db = await migrateThrough(18);
    const seed = await seedV18MultiLibraryGraph(db);
    await runMigrations(db);
    const attachmentId = seed.attachmentIds[0]!;
    const assetId = documentAssetIdFromAttachment(attachmentId);
    const revisionId = documentRevisionIdFromAttachment(attachmentId);
    const now = Date.now();

    await db.run(
      `INSERT INTO evidence_items (
         id, library_id, work_id, asset_id, revision_id, source_kind,
         evidence_kind, anchor_json, payload_kind, payload_json, tags_json,
         source_content_hash, provenance_json, created_at, updated_at
       ) VALUES (
         'evidence:first', ?, 'work:evidence-first', ?, ?, 'document',
         'method', ?, 'text', ?, '[]', ?, '{}', ?, ?
       )`,
      [
        seed.firstLibraryId,
        assetId,
        revisionId,
        JSON.stringify({ revisionId, selector: { exact: "Evidence" } }),
        JSON.stringify({ text: "Evidence" }),
        "d".repeat(64),
        now,
        now,
      ],
    );
    await db.run(
      `INSERT INTO project_assets (
         id, project_id, asset_id, role, created_at, updated_at
       ) VALUES ('project-asset:first', ?, ?, 'source', ?, ?)`,
      [seed.firstProjectId, assetId, now, now],
    );
    await db.run(
      `INSERT INTO project_evidence (
         id, project_id, evidence_id, role, created_at, updated_at
       ) VALUES ('project-evidence:first', ?, 'evidence:first', 'evidence', ?, ?)`,
      [seed.firstProjectId, now, now],
    );

    await expect(
      db.run(
        `INSERT INTO project_assets (
           id, project_id, asset_id, role, created_at, updated_at
         ) VALUES ('project-asset:cross', ?, ?, 'source', ?, ?)`,
        [seed.secondProjectId, assetId, now, now],
      ),
    ).rejects.toThrow(/project asset must stay within its library/);
    await expect(
      db.run(
        `INSERT INTO project_evidence (
           id, project_id, evidence_id, role, created_at, updated_at
         ) VALUES ('project-evidence:cross', ?, 'evidence:first', 'evidence', ?, ?)`,
        [seed.secondProjectId, now, now],
      ),
    ).rejects.toThrow(/project evidence must stay within its library/);
  });

  it("allows revision state updates but rejects source identity mutation", async () => {
    const db = await migrateThrough(18);
    const seed = await seedV18MultiLibraryGraph(db);
    await runMigrations(db);
    const revisionId = documentRevisionIdFromAttachment(seed.attachmentIds[1]!);

    await db.run(
      `UPDATE document_revisions
       SET extraction_status = 'ready', updated_at = updated_at + 1
       WHERE id = ?`,
      [revisionId],
    );
    await expect(
      db.run(`UPDATE document_revisions SET blob_sha256 = ? WHERE id = ?`, [
        "e".repeat(64),
        revisionId,
      ]),
    ).rejects.toThrow(/document revision source identity is immutable/);
    expect(
      await db.query<{ blob_sha256: string; extraction_status: string }>(
        `SELECT blob_sha256, extraction_status
         FROM document_revisions
         WHERE id = ?`,
        [revisionId],
      ),
    ).toEqual([{ blob_sha256: "b".repeat(64), extraction_status: "ready" }]);
  });

  it("rolls back an injected v19 failure and retries without partial backfill", async () => {
    const db = await migrateThrough(18);
    const seed = await seedV18MultiLibraryGraph(db);
    const originalRun = db.run;
    let injectFailure = true;
    db.run = async (sql, params = []) => {
      if (injectFailure && sql.includes("INSERT INTO document_revisions")) {
        injectFailure = false;
        throw new Error("injected v19 revision backfill failure");
      }
      return originalRun(sql, params);
    };

    await expect(runMigrations(db)).rejects.toThrow("injected v19 revision backfill failure");

    expect(Number(await db.queryScalar(`SELECT MAX(version) FROM _migrations`))).toBe(18);
    expect(
      await db.query<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'document_assets', 'document_revisions', 'project_assets',
             'evidence_items', 'project_evidence'
           )`,
      ),
    ).toEqual([]);
    expect(await ids(db, "attachments")).toEqual([...seed.attachmentIds].sort());
    expect(Number(await db.queryScalar(`PRAGMA foreign_keys`))).toBe(1);
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);

    await runMigrations(db);

    expect(Number(await db.queryScalar(`SELECT MAX(version) FROM _migrations`))).toBe(
      MIGRATIONS[MIGRATIONS.length - 1]!.version,
    );
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM document_assets`))).toBe(3);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM document_revisions`))).toBe(3);
    expect(
      await db.query<{ id: string }>(`SELECT id FROM document_revisions ORDER BY attachment_id`),
    ).toEqual(
      seed.attachmentIds.map((attachmentId) => ({
        id: documentRevisionIdFromAttachment(attachmentId),
      })),
    );
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);
    expect(Number(await db.queryScalar(`PRAGMA foreign_keys`))).toBe(1);
  });
});
