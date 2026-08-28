import {
  AnnotationsRepo,
  AttachmentsRepo,
  ResearchProjectsRepo,
  TagsRepo,
  WorksRepo,
  type Database,
} from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";
import { MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS } from "./data-command-runtime";

let database: Database;
let libraryId: string;
let dependencies: DataCommandDependencies;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "research-project-command-device",
    deviceName: "Research Project commands",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
  works = new WorksRepo(database, libraryId);
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

async function createProject(name = "Project") {
  return (await command("project.create", { libraryId, name })).project;
}

describe("Research Project data commands", () => {
  it("discovers the active Library and creates the default Project on first list", async () => {
    await expect(command("project.getScope", {})).resolves.toEqual({ libraryId });
    await database.exec(`
      DROP TRIGGER research_projects_last_active_update;
      DROP TRIGGER research_projects_last_active_delete;
      DELETE FROM research_projects;
    `);
    await expect(
      database.query<{ count: number }>("SELECT COUNT(*) AS count FROM research_projects"),
    ).resolves.toEqual([{ count: 0 }]);

    const first = await command("project.list", { libraryId });
    const second = await command("project.list", { libraryId });

    expect(first.projects).toHaveLength(1);
    expect(first.projects[0]).toMatchObject({
      canvasCount: 0,
      deletedAt: null,
      description: null,
      libraryId,
      sourceCount: 0,
      status: "active",
    });
    expect(second.projects).toEqual(first.projects);
    await expect(
      database.query<{ count: number }>("SELECT COUNT(*) AS count FROM research_projects"),
    ).resolves.toEqual([{ count: 1 }]);
  });

  it("rejects malformed payloads before acquiring the database coordinator", async () => {
    let executeCalls = 0;
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const invalidRequests = [
      { name: "project.getScope", input: { unexpected: true } },
      { name: "project.create", input: { libraryId, name: " " } },
      {
        name: "project.create",
        input: { libraryId, name: "Project", description: "x".repeat(16_385) },
      },
      {
        name: "project.rename",
        input: { libraryId, projectId: "project", name: "Next", expectedUpdatedAt: -1 },
      },
      {
        name: "project.addWorks",
        input: { libraryId, projectId: "project", workIds: ["same", "same"] },
      },
      {
        name: "project.removeWorks",
        input: {
          libraryId,
          projectId: "project",
          workIds: Array.from(
            { length: MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS + 1 },
            (_, index) => `work-${index}`,
          ),
        },
      },
      {
        name: "project.listSources",
        input: { libraryId, projectId: "project", limit: 0 },
      },
      {
        name: "project.searchLibraryWorks",
        input: { libraryId, projectId: "project", query: "", limit: 101 },
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);

    await expect(
      executeDataCommand(
        {
          name: "project.addWorks",
          input: {
            libraryId,
            projectId: "project",
            workIds: Array.from({ length: 501 }, (_, index) => `work-${index}`),
          },
        },
        rejectingDependencies,
      ),
    ).rejects.toThrow("transaction reached");
    expect(transactionCalls).toBe(1);
  });

  it("creates and atomically renames with the expected Project revision", async () => {
    const created = await createProject("  Initial Project  ");
    expect(created).toMatchObject({ name: "Initial Project", sourceCount: 0 });

    const renamed = (
      await command("project.rename", {
        expectedUpdatedAt: created.updatedAt,
        libraryId,
        name: "Renamed Project",
        projectId: created.id,
      })
    ).project;
    expect(renamed.name).toBe("Renamed Project");
    expect(renamed.updatedAt).toBeGreaterThan(created.updatedAt);

    await expect(
      command("project.rename", {
        expectedUpdatedAt: created.updatedAt,
        libraryId,
        name: "Stale rename",
        projectId: created.id,
      }),
    ).rejects.toThrow(/reload/i);
    await expect(command("project.get", { libraryId, projectId: created.id })).resolves.toEqual({
      project: renamed,
    });
  });

  it("rejects stale Library, foreign Project, and mixed-library Work scopes atomically", async () => {
    const project = await createProject();
    const localWork = await works.upsert({ title: "Local Work" });
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES ('foreign-library', 'Foreign', 'personal', 1, 1)`,
    );
    const foreignProjects = new ResearchProjectsRepo(database, "foreign-library");
    const foreignProject = await foreignProjects.create({ name: "Foreign Project" });
    const foreignWork = await new WorksRepo(database, "foreign-library").upsert({
      title: "Foreign Work",
    });

    await expect(command("project.list", { libraryId: "foreign-library" })).rejects.toThrow(
      /stale or foreign Library scope/,
    );
    await expect(
      command("project.rename", {
        expectedUpdatedAt: foreignProject.updated_at,
        libraryId,
        name: "No",
        projectId: foreignProject.id,
      }),
    ).rejects.toThrow(/target Library/);
    await expect(
      command("project.addWorks", {
        libraryId,
        projectId: project.id,
        workIds: [localWork.id, foreignWork.id],
      }),
    ).rejects.toThrow(/outside library/);
    await expect(
      database.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM project_works WHERE project_id = ?`,
        [project.id],
      ),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("lists and searches source DTOs with authors, tags, PDF, and annotation counts", async () => {
    const project = await createProject("Evidence Project");
    const source = await works.upsert({
      authors: [{ displayName: "Ada Scholar", position: 0 }],
      title: "Trustworthy Retrieval",
      venueName: "Journal of Evidence",
      year: 2026,
    });
    const candidate = await works.upsert({ title: "Trustworthy Candidate" });
    const attachment = await new AttachmentsRepo(database, libraryId).create({
      byteSize: 42,
      sha256: "a".repeat(64),
      workId: source.id,
    });
    await new AnnotationsRepo(database, libraryId).create({
      attachmentId: attachment.id,
      pageIndex: 0,
      type: "highlight",
      workId: source.id,
    });
    const tags = new TagsRepo(database, libraryId);
    await tags.addToWorks([source.id], "Grounded");
    await command("project.addWorks", {
      libraryId,
      projectId: project.id,
      workIds: [source.id],
    });

    const sources = await command("project.listSources", {
      libraryId,
      limit: 20,
      offset: 0,
      projectId: project.id,
    });
    expect(sources).toEqual({
      sources: [
        expect.objectContaining({
          annotationCount: 1,
          authorNames: ["Ada Scholar"],
          inProject: true,
          pdfCount: 1,
          tagNames: ["Grounded"],
          title: "Trustworthy Retrieval",
          venueName: "Journal of Evidence",
          year: 2026,
        }),
      ],
      total: 1,
    });

    const search = await command("project.searchLibraryWorks", {
      libraryId,
      projectId: project.id,
      query: "Trustworthy",
    });
    expect(search.works).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          annotationCount: 1,
          id: source.id,
          inProject: true,
          pdfCount: 1,
        }),
        expect.objectContaining({
          annotationCount: 0,
          id: candidate.id,
          inProject: false,
          pdfCount: 0,
        }),
      ]),
    );
    const listed = await command("project.list", { libraryId });
    expect(listed.projects.find((item) => item.id === project.id)?.sourceCount).toBe(1);
  });

  it("returns the requested Project source page with an independent total", async () => {
    const project = await createProject("Paged sources");
    const first = await works.upsert({ title: "First paged source" });
    const second = await works.upsert({ title: "Second paged source" });
    const third = await works.upsert({ title: "Third paged source" });
    await command("project.addWorks", {
      libraryId,
      projectId: project.id,
      workIds: [first.id, second.id, third.id],
    });
    await database.run(
      `UPDATE project_works
       SET created_at = CASE work_id
         WHEN ? THEN 10
         WHEN ? THEN 20
         ELSE 30
       END
       WHERE project_id = ?`,
      [first.id, second.id, project.id],
    );

    await expect(
      command("project.listSources", {
        libraryId,
        limit: 1,
        offset: 1,
        projectId: project.id,
      }),
    ).resolves.toEqual({
      sources: [expect.objectContaining({ id: second.id, inProject: true })],
      total: 3,
    });
  });

  it("reports only newly added or restored Project memberships", async () => {
    const project = await createProject();
    const first = await works.upsert({ title: "First source" });
    const second = await works.upsert({ title: "Second source" });

    await expect(
      command("project.addWorks", {
        libraryId,
        projectId: project.id,
        workIds: [first.id, second.id],
      }),
    ).resolves.toEqual({ updated: 2 });
    await expect(
      command("project.addWorks", {
        libraryId,
        projectId: project.id,
        workIds: [first.id, second.id],
      }),
    ).resolves.toEqual({ updated: 0 });

    await command("project.removeWorks", {
      libraryId,
      projectId: project.id,
      workIds: [first.id],
    });
    await expect(
      command("project.addWorks", {
        libraryId,
        projectId: project.id,
        workIds: [first.id, second.id],
      }),
    ).resolves.toEqual({ updated: 1 });
  });

  it("removes only membership while preserving the Library Work and PDF", async () => {
    const project = await createProject();
    const work = await works.upsert({ title: "Preserved Source" });
    const attachment = await new AttachmentsRepo(database, libraryId).create({
      byteSize: 42,
      sha256: "b".repeat(64),
      workId: work.id,
    });
    await command("project.addWorks", {
      libraryId,
      projectId: project.id,
      workIds: [work.id],
    });

    await expect(
      command("project.removeWorks", {
        libraryId,
        projectId: project.id,
        workIds: [work.id],
      }),
    ).resolves.toEqual({ updated: 1 });
    await expect(
      command("project.removeWorks", {
        libraryId,
        projectId: project.id,
        workIds: [work.id],
      }),
    ).resolves.toEqual({ updated: 0 });

    await expect(
      database.query<{ id: string }>(`SELECT id FROM works WHERE id = ? AND deleted_at IS NULL`, [
        work.id,
      ]),
    ).resolves.toEqual([{ id: work.id }]);
    await expect(
      database.query<{ id: string }>(
        `SELECT id FROM attachments WHERE id = ? AND deleted_at IS NULL`,
        [attachment.id],
      ),
    ).resolves.toEqual([{ id: attachment.id }]);
    await expect(
      database.query<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM project_works WHERE project_id = ? AND work_id = ?`,
        [project.id, work.id],
      ),
    ).resolves.toEqual([{ deleted_at: expect.any(Number) }]);
  });
});
