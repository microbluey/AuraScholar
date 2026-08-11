import { projectWorkMembershipId, type Database } from "@aurascholar/db";
import { createNodeDatabase } from "@aurascholar/db/node";
import { runMigrations } from "@aurascholar/db/migrations";
import { describe, expect, it } from "vitest";
import {
  exportLibraryBackupJsonFromDatabase,
  importParsedLibraryBackupIntoDatabase,
  parseLibraryBackupJson,
} from "../shared/library-backup";
import { previewLibraryBackupJson } from "./sync";

type TestDatabase = Awaited<ReturnType<typeof createNodeDatabase>>;

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

async function addProject(
  db: TestDatabase,
  libraryId: string,
  id: string,
  name: string,
): Promise<void> {
  await db.run(
    `INSERT INTO research_projects
       (id, library_id, name, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 10, 10)`,
    [id, libraryId, name],
  );
}

async function addWork(
  db: TestDatabase,
  libraryId: string,
  id: string,
  title: string,
  doi: string | null = null,
): Promise<void> {
  await db.run(
    `INSERT INTO works (id, library_id, doi, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, 10, 10)`,
    [id, libraryId, doi, title],
  );
}

async function addProjectWork(db: TestDatabase, projectId: string, workId: string): Promise<void> {
  await db.run(
    `INSERT INTO project_works
       (id, project_id, work_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'source', 10, 10)`,
    [projectWorkMembershipId(projectId, workId), projectId, workId],
  );
}

async function addCanvas(
  db: TestDatabase,
  libraryId: string,
  projectId: string,
  id: string,
): Promise<void> {
  await db.run(
    `INSERT INTO canvas_workspaces
       (id, library_id, project_id, name, schema_version, viewport_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, '{"x":0,"y":0,"zoom":1}', 10, 10)`,
    [id, libraryId, projectId, id],
  );
}

function v3Backup(tables: Record<string, unknown[]>): string {
  return JSON.stringify({
    version: 3,
    exportedAt: "2026-07-31T00:00:00.000Z",
    sourceLibraryId: "source-library",
    tables: {
      libraries: [
        {
          id: "source-library",
          name: "Source",
          kind: "personal",
          created_at: 1,
          updated_at: 1,
        },
      ],
      ...tables,
    },
  });
}

describe("Research Project Library backup", () => {
  it("exports only the selected Library project graph in v4 dependency order", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "library-a");
    await addLibrary(db, "library-b");
    await addProject(db, "library-a", "project-a", "Project A");
    await addProject(db, "library-b", "project-b", "Project B");
    await addWork(db, "library-a", "work-a", "Work A");
    await addWork(db, "library-b", "work-b", "Work B");
    await addProjectWork(db, "project-a", "work-a");
    await addProjectWork(db, "project-b", "work-b");
    await addCanvas(db, "library-a", "project-a", "canvas-a");
    await addCanvas(db, "library-b", "project-b", "canvas-b");

    const text = await exportLibraryBackupJsonFromDatabase(db, "library-a");
    const backup = JSON.parse(text) as {
      version: number;
      tables: Record<string, Array<Record<string, unknown>>>;
    };

    expect(backup.version).toBe(4);
    expect(Object.keys(backup.tables).indexOf("works")).toBeLessThan(
      Object.keys(backup.tables).indexOf("research_projects"),
    );
    expect(Object.keys(backup.tables).indexOf("research_projects")).toBeLessThan(
      Object.keys(backup.tables).indexOf("project_works"),
    );
    expect(Object.keys(backup.tables).indexOf("project_works")).toBeLessThan(
      Object.keys(backup.tables).indexOf("canvas_workspaces"),
    );
    expect(backup.tables.research_projects?.map((row) => row.id)).toEqual(["project-a"]);
    expect(backup.tables.project_works).toEqual([
      expect.objectContaining({
        id: projectWorkMembershipId("project-a", "work-a"),
        project_id: "project-a",
        work_id: "work-a",
      }),
    ]);
    expect(backup.tables.canvas_workspaces).toEqual([
      expect.objectContaining({ id: "canvas-a", project_id: "project-a" }),
    ]);
    expect(previewLibraryBackupJson(text).version).toBe(4);
  });

  it("strictly rejects invalid v3 Project ownership, memberships, and Canvas links", () => {
    const work = {
      id: "work-source",
      library_id: "source-library",
      title: "Work",
      created_at: 10,
      updated_at: 10,
    };
    const project = {
      id: "project-source",
      library_id: "source-library",
      name: "Project",
      status: "active",
      created_at: 10,
      updated_at: 10,
    };

    expect(() =>
      previewLibraryBackupJson(
        v3Backup({
          works: [work],
          research_projects: [{ ...project, library_id: "foreign-library" }],
        }),
      ),
    ).toThrow(/混合或缺失的 Library owner：research_projects/);

    expect(() =>
      previewLibraryBackupJson(
        v3Backup({
          works: [work],
          research_projects: [project],
          project_works: [
            {
              id: "not-deterministic",
              project_id: "project-source",
              work_id: "work-source",
              role: "source",
              created_at: 10,
              updated_at: 10,
            },
          ],
        }),
      ),
    ).toThrow(/无效的研究项目文献关系标识/);

    expect(() =>
      previewLibraryBackupJson(
        v3Backup({
          works: [work],
          research_projects: [project],
          project_works: [
            {
              id: projectWorkMembershipId("project-source", "work-outside"),
              project_id: "project-source",
              work_id: "work-outside",
              role: "source",
              created_at: 10,
              updated_at: 10,
            },
          ],
        }),
      ),
    ).toThrow(/跨 Library 关系：project_works\.work_id/);

    expect(() =>
      previewLibraryBackupJson(
        v3Backup({
          works: [work],
          research_projects: [project],
          canvas_workspaces: [
            {
              id: "canvas-source",
              library_id: "source-library",
              project_id: "project-outside",
              name: "Canvas",
              schema_version: 1,
              viewport_json: "{}",
              created_at: 10,
              updated_at: 10,
            },
          ],
        }),
      ),
    ).toThrow(/跨 Library 关系：canvas_workspaces\.project_id/);
  });

  it("rejects duplicate semantic memberships before import", () => {
    const id = projectWorkMembershipId("project-source", "work-source");
    expect(() =>
      previewLibraryBackupJson(
        v3Backup({
          works: [
            {
              id: "work-source",
              library_id: "source-library",
              title: "Work",
              created_at: 10,
              updated_at: 10,
            },
          ],
          research_projects: [
            {
              id: "project-source",
              library_id: "source-library",
              name: "Project",
              status: "active",
              created_at: 10,
              updated_at: 10,
            },
          ],
          project_works: [
            {
              id,
              project_id: "project-source",
              work_id: "work-source",
              role: "source",
              created_at: 10,
              updated_at: 10,
            },
            {
              id: `${id}:duplicate`,
              project_id: "project-source",
              work_id: "work-source",
              role: "source",
              created_at: 11,
              updated_at: 11,
            },
          ],
        }),
      ),
    ).toThrow(/重复的行标识：project_works\.project_id\+work_id/);
  });

  it("remaps Project, Work, membership, and Canvas identities as one graph", async () => {
    const db = await createNodeDatabase(":memory:");
    await runMigrations(db);
    await addLibrary(db, "target-library");
    await addLibrary(db, "foreign-library");
    await addProject(db, "foreign-library", "project-source", "Foreign Project");
    await addWork(db, "foreign-library", "work-source", "Foreign Work");
    await addProjectWork(db, "project-source", "work-source");
    await addCanvas(db, "foreign-library", "project-source", "canvas-source");
    await addWork(db, "target-library", "work-target", "Existing Target Work", "10.1000/shared");

    const sourceMembershipId = projectWorkMembershipId("project-source", "work-source");
    const backup = v3Backup({
      works: [
        {
          id: "work-source",
          library_id: "source-library",
          doi: "10.1000/shared",
          title: "Imported Work",
          created_at: 20,
          updated_at: 20,
        },
      ],
      research_projects: [
        {
          id: "project-source",
          library_id: "source-library",
          name: "Imported Project",
          description: null,
          status: "active",
          created_at: 20,
          updated_at: 20,
          deleted_at: null,
        },
      ],
      project_works: [
        {
          id: sourceMembershipId,
          project_id: "project-source",
          work_id: "work-source",
          role: "source",
          created_at: 20,
          updated_at: 20,
          deleted_at: null,
        },
      ],
      canvas_workspaces: [
        {
          id: "canvas-source",
          library_id: "source-library",
          project_id: "project-source",
          name: "Imported Canvas",
          description: null,
          schema_version: 1,
          viewport_json: '{"x":0,"y":0,"zoom":1}',
          created_at: 20,
          updated_at: 20,
        },
      ],
    });

    await importBackup(backup, db, "target-library");

    const [project] = await db.query<{ id: string; library_id: string }>(
      `SELECT id, library_id FROM research_projects
       WHERE library_id = 'target-library' AND name = 'Imported Project'`,
    );
    expect(project?.id).toBeTruthy();
    expect(project?.id).not.toBe("project-source");
    expect(project?.library_id).toBe("target-library");

    const expectedMembershipId = projectWorkMembershipId(project!.id, "work-target");
    await expect(
      db.query<{ id: string; project_id: string; work_id: string }>(
        `SELECT id, project_id, work_id FROM project_works WHERE id = ?`,
        [expectedMembershipId],
      ),
    ).resolves.toEqual([
      {
        id: expectedMembershipId,
        project_id: project!.id,
        work_id: "work-target",
      },
    ]);
    await expect(
      db.query<{ project_id: string; library_id: string }>(
        `SELECT project_id, library_id FROM canvas_workspaces
         WHERE library_id = 'target-library' AND name = 'Imported Canvas'`,
      ),
    ).resolves.toEqual([{ project_id: project!.id, library_id: "target-library" }]);
    await expect(
      db.query<{ library_id: string }>(
        `SELECT library_id FROM research_projects WHERE id = 'project-source'`,
      ),
    ).resolves.toEqual([{ library_id: "foreign-library" }]);
    await expect(
      db.query<{ total: number }>(`SELECT COUNT(*) AS total FROM project_works WHERE id = ?`, [
        sourceMembershipId,
      ]),
    ).resolves.toEqual([{ total: 1 }]);
  });

  for (const version of [1, 2]) {
    it(`binds a v${version} Canvas without project_id to the target default Project`, async () => {
      const db = await createNodeDatabase(":memory:");
      await runMigrations(db);
      await addLibrary(db, "target-library");
      await addProject(db, "target-library", "target-default", "Target Default");

      const backup = JSON.stringify({
        version,
        exportedAt: "2026-07-31T00:00:00.000Z",
        ...(version >= 2 ? { sourceLibraryId: "source-library" } : {}),
        tables: {
          libraries: [
            {
              id: "source-library",
              name: "Source",
              kind: "personal",
              created_at: 1,
              updated_at: 1,
            },
          ],
          canvas_workspaces: [
            {
              id: `legacy-canvas-v${version}`,
              ...(version >= 2 ? { library_id: "source-library" } : {}),
              name: "Legacy Canvas",
              description: null,
              schema_version: 1,
              viewport_json: '{"x":0,"y":0,"zoom":1}',
              created_at: 10,
              updated_at: 10,
            },
          ],
        },
      });

      const summary = await importBackup(backup, db, "target-library");

      expect(summary.redirectedRows).toBeGreaterThan(0);
      await expect(
        db.query<{ project_id: string; library_id: string }>(
          `SELECT project_id, library_id FROM canvas_workspaces
           WHERE id = ?`,
          [`legacy-canvas-v${version}`],
        ),
      ).resolves.toEqual([{ project_id: "target-default", library_id: "target-library" }]);
    });
  }
});
