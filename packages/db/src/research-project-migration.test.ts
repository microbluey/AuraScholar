import { describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "./database";
import { projectWorkMembershipId } from "./ids";
import { requireLocalLibraryId } from "./local-first";
import { MIGRATIONS, runMigrations } from "./migrations";
import {
  DEFAULT_RESEARCH_PROJECT_ID,
  DEFAULT_RESEARCH_PROJECT_NAME,
  scopedDefaultResearchProjectId,
} from "./research-project-defaults";

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

interface V17Seed {
  firstLibraryId: string;
  secondLibraryId: string;
  firstProjectId: string;
  secondProjectId: string;
}

async function seedV17MultiLibraryGraph(db: Database): Promise<V17Seed> {
  const firstLibraryId = await requireLocalLibraryId(db);
  const firstLibrary = await db.query<{ created_at: number }>(
    `SELECT created_at FROM libraries WHERE id = ?`,
    [firstLibraryId],
  );
  const firstCreatedAt = firstLibrary[0]!.created_at;
  const secondLibraryId = "library:second";
  const secondCreatedAt = firstCreatedAt + 10_000;

  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, 'Second Library', 'personal', ?, ?)`,
    [secondLibraryId, secondCreatedAt, secondCreatedAt],
  );
  await db.run(
    `INSERT INTO works (
       id, library_id, title, type, created_at, updated_at
     ) VALUES
       ('work:first', ?, 'First Library Work', 'article', ?, ?),
       ('work:second', ?, 'Second Library Work', 'article', ?, ?)`,
    [
      firstLibraryId,
      firstCreatedAt + 1,
      firstCreatedAt + 1,
      secondLibraryId,
      secondCreatedAt + 1,
      secondCreatedAt + 1,
    ],
  );
  await db.run(
    `INSERT INTO attachments (
       id, work_id, sha256, byte_size, created_at, updated_at
     ) VALUES
       ('attachment:first', 'work:first', 'sha256-first', 101, ?, ?),
       ('attachment:second', 'work:second', 'sha256-second', 202, ?, ?)`,
    [firstCreatedAt + 2, firstCreatedAt + 2, secondCreatedAt + 2, secondCreatedAt + 2],
  );
  await db.run(
    `INSERT INTO annotations (
       id, attachment_id, work_id, type, page_index, sort_key, created_at, updated_at
     ) VALUES
       ('annotation:first', 'attachment:first', 'work:first', 'highlight', 0, 1, ?, ?),
       ('annotation:second', 'attachment:second', 'work:second', 'highlight', 1, 2, ?, ?)`,
    [firstCreatedAt + 3, firstCreatedAt + 3, secondCreatedAt + 3, secondCreatedAt + 3],
  );
  await db.run(
    `INSERT INTO canvas_workspaces (
       id, library_id, name, viewport_json, created_at, updated_at
     ) VALUES
       ('canvas:first', ?, 'First Canvas', '{}', ?, ?),
       ('canvas:second', ?, 'Second Canvas', '{}', ?, ?)`,
    [
      firstLibraryId,
      firstCreatedAt + 4,
      firstCreatedAt + 4,
      secondLibraryId,
      secondCreatedAt + 4,
      secondCreatedAt + 4,
    ],
  );
  await db.run(
    `INSERT INTO canvas_nodes (
       id, workspace_id, work_id, type, pos_x, pos_y, width, height,
       data_json, created_at, updated_at
     ) VALUES
       ('node:first:a', 'canvas:first', 'work:first', 'paper', 0, 0, 320, 180, '{}', ?, ?),
       ('node:first:b', 'canvas:first', NULL, 'idea-note', 360, 0, 240, 160, '{}', ?, ?),
       ('node:second', 'canvas:second', 'work:second', 'paper', 0, 0, 320, 180, '{}', ?, ?)`,
    [
      firstCreatedAt + 5,
      firstCreatedAt + 5,
      firstCreatedAt + 6,
      firstCreatedAt + 6,
      secondCreatedAt + 5,
      secondCreatedAt + 5,
    ],
  );
  await db.run(
    `INSERT INTO canvas_edges (
       id, workspace_id, source_id, target_id, relation_type, label,
       created_at, updated_at
     ) VALUES (
       'edge:first', 'canvas:first', 'node:first:a', 'node:first:b',
       'custom', 'develops', ?, ?
     )`,
    [firstCreatedAt + 7, firstCreatedAt + 7],
  );

  return {
    firstLibraryId,
    secondLibraryId,
    firstProjectId: DEFAULT_RESEARCH_PROJECT_ID,
    secondProjectId: scopedDefaultResearchProjectId(secondLibraryId),
  };
}

describe("v18 Research Project migration", () => {
  it("bootstraps exactly one active default Project for a clean database", async () => {
    const db = await createNodeDatabase(":memory:");

    await runMigrations(db);

    const libraryId = await requireLocalLibraryId(db);
    expect(
      await db.query<{
        id: string;
        library_id: string;
        name: string;
        status: string;
        deleted_at: number | null;
      }>(
        `SELECT id, library_id, name, status, deleted_at
         FROM research_projects`,
      ),
    ).toEqual([
      {
        id: DEFAULT_RESEARCH_PROJECT_ID,
        library_id: libraryId,
        name: DEFAULT_RESEARCH_PROJECT_NAME,
        status: "active",
        deleted_at: null,
      },
    ]);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM project_works`))).toBe(0);
    const canvasColumns = await db.query<{ name: string; notnull: number }>(
      `PRAGMA table_info(canvas_workspaces)`,
    );
    expect(canvasColumns.find((column) => column.name === "project_id")?.notnull).toBe(1);
    expect(Number(await db.queryScalar(`SELECT MAX(version) FROM _migrations`))).toBe(18);
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);
    expect(Number(await db.queryScalar(`PRAGMA foreign_keys`))).toBe(1);
  });

  it("upgrades a multi-Library v17 graph without losing documents or Canvas ownership", async () => {
    const db = await migrateThrough(17);
    const seed = await seedV17MultiLibraryGraph(db);

    await runMigrations(db);

    expect(
      await db.query<{ id: string; library_id: string; status: string }>(
        `SELECT id, library_id, status
         FROM research_projects
         ORDER BY library_id`,
      ),
    ).toEqual(
      [
        {
          id: seed.firstProjectId,
          library_id: seed.firstLibraryId,
          status: "active",
        },
        {
          id: seed.secondProjectId,
          library_id: seed.secondLibraryId,
          status: "active",
        },
      ].sort((a, b) => a.library_id.localeCompare(b.library_id)),
    );
    expect(
      await db.query<{ id: string; project_id: string; work_id: string; role: string }>(
        `SELECT id, project_id, work_id, role
         FROM project_works
         ORDER BY work_id`,
      ),
    ).toEqual([
      {
        id: projectWorkMembershipId(seed.firstProjectId, "work:first"),
        project_id: seed.firstProjectId,
        work_id: "work:first",
        role: "source",
      },
      {
        id: projectWorkMembershipId(seed.secondProjectId, "work:second"),
        project_id: seed.secondProjectId,
        work_id: "work:second",
        role: "source",
      },
    ]);
    expect(
      await db.query<{ id: string; library_id: string; project_id: string }>(
        `SELECT id, library_id, project_id
         FROM canvas_workspaces
         ORDER BY id`,
      ),
    ).toEqual([
      {
        id: "canvas:first",
        library_id: seed.firstLibraryId,
        project_id: seed.firstProjectId,
      },
      {
        id: "canvas:second",
        library_id: seed.secondLibraryId,
        project_id: seed.secondProjectId,
      },
    ]);
    expect(
      await db.query<{ id: string; sha256: string }>(
        `SELECT id, sha256 FROM attachments ORDER BY id`,
      ),
    ).toEqual([
      { id: "attachment:first", sha256: "sha256-first" },
      { id: "attachment:second", sha256: "sha256-second" },
    ]);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM annotations`))).toBe(2);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM canvas_nodes`))).toBe(3);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM canvas_edges`))).toBe(1);
    expect(
      Number(
        await db.queryScalar(
          `SELECT COUNT(*)
           FROM project_works membership
           JOIN research_projects project ON project.id = membership.project_id
           JOIN works work ON work.id = membership.work_id
           WHERE project.library_id <> work.library_id`,
        ),
      ),
    ).toBe(0);
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);
    expect(Number(await db.queryScalar(`PRAGMA foreign_keys`))).toBe(1);
  });

  it("rolls back an injected v18 failure, restores foreign keys, and retries cleanly", async () => {
    const db = await migrateThrough(17);
    const seed = await seedV17MultiLibraryGraph(db);
    const originalRun = db.run;
    let injectFailure = true;
    db.run = async (sql, params = []) => {
      if (injectFailure && sql.includes("INSERT INTO canvas_workspaces_v18")) {
        injectFailure = false;
        throw new Error("injected v18 canvas copy failure");
      }
      return originalRun(sql, params);
    };

    await expect(runMigrations(db)).rejects.toThrow("injected v18 canvas copy failure");

    expect(Number(await db.queryScalar(`SELECT MAX(version) FROM _migrations`))).toBe(17);
    expect(
      await db.query<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('research_projects', 'project_works', 'canvas_workspaces_v18')`,
      ),
    ).toEqual([]);
    const legacyCanvasColumns = await db.query<{ name: string }>(
      `PRAGMA table_info(canvas_workspaces)`,
    );
    expect(legacyCanvasColumns.map((column) => column.name)).not.toContain("project_id");
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM works`))).toBe(2);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM canvas_workspaces`))).toBe(2);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM canvas_nodes`))).toBe(3);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM canvas_edges`))).toBe(1);
    expect(
      await db.query<{ sha256: string }>(`SELECT sha256 FROM attachments ORDER BY sha256`),
    ).toEqual([{ sha256: "sha256-first" }, { sha256: "sha256-second" }]);
    expect(Number(await db.queryScalar(`PRAGMA foreign_keys`))).toBe(1);
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);

    await runMigrations(db);

    expect(Number(await db.queryScalar(`SELECT MAX(version) FROM _migrations`))).toBe(18);
    expect(
      await db.query<{ id: string; project_id: string }>(
        `SELECT id, project_id FROM canvas_workspaces ORDER BY id`,
      ),
    ).toEqual([
      { id: "canvas:first", project_id: seed.firstProjectId },
      { id: "canvas:second", project_id: seed.secondProjectId },
    ]);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM research_projects`))).toBe(2);
    expect(Number(await db.queryScalar(`SELECT COUNT(*) FROM project_works`))).toBe(2);
    expect(await db.query(`PRAGMA foreign_key_check`)).toEqual([]);
    expect(Number(await db.queryScalar(`PRAGMA foreign_keys`))).toBe(1);
  });
});
