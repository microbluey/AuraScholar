import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { projectWorkMembershipId } from "../ids";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { WorksRepo } from "./works";
import {
  LastActiveResearchProjectError,
  ResearchProjectScopeError,
  ResearchProjectsRepo,
} from "./research-projects";

let db: Database;
let libraryId: string;
let projects: ResearchProjectsRepo;
let works: WorksRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  projects = new ResearchProjectsRepo(db, libraryId);
  works = new WorksRepo(db, libraryId);
});

describe("ResearchProjectsRepo", () => {
  it("returns one stable oldest active Project and creates trimmed Projects", async () => {
    const defaultProject = await projects.ensureDefault();
    const repeated = await projects.ensureDefault();

    expect(repeated).toEqual(defaultProject);
    expect(defaultProject).toMatchObject({
      library_id: libraryId,
      status: "active",
      deleted_at: null,
    });

    const created = await projects.create({
      name: "  Causal Inference  ",
      description: "  Methods and evidence  ",
    });
    expect(created).toMatchObject({
      library_id: libraryId,
      name: "Causal Inference",
      description: "Methods and evidence",
      status: "active",
      deleted_at: null,
    });
    expect(await projects.get(created.id)).toEqual(created);
    expect((await projects.list()).map((project) => project.id)).toEqual([
      defaultProject.id,
      created.id,
    ]);
  });

  it("validates Project inputs and refuses to create under an inactive Library", async () => {
    await expect(projects.create({ name: "   " })).rejects.toThrow(
      "Research project name must be a non-empty string",
    );
    await expect(
      projects.create({ name: "Valid", description: 42 as unknown as string }),
    ).rejects.toThrow("Research project description must be a string");
    expect(await projects.get("missing-project")).toBeNull();

    await db.run(`UPDATE libraries SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      libraryId,
    ]);
    await expect(projects.create({ name: "Must not exist" })).rejects.toThrow(
      `Library ${libraryId} is missing or removed`,
    );
  });

  it("renames, archives, and restores without allowing the last active Project to disappear", async () => {
    const oldest = await projects.ensureDefault();
    await expect(projects.archive(oldest.id)).rejects.toThrow(LastActiveResearchProjectError);

    const second = await projects.create({ name: "Second Project" });
    const beforeRename = (await projects.get(second.id))!.updated_at;
    await projects.rename(second.id, "  Renamed Project  ");
    const renamed = (await projects.get(second.id))!;
    expect(renamed.name).toBe("Renamed Project");
    expect(renamed.updated_at).toBeGreaterThan(beforeRename);

    await projects.archive(oldest.id);
    const archived = (await projects.get(oldest.id))!;
    expect(archived.status).toBe("archived");
    expect((await projects.list()).map(({ id, status }) => ({ id, status }))).toEqual([
      { id: second.id, status: "active" },
      { id: oldest.id, status: "archived" },
    ]);
    await expect(projects.archive(oldest.id)).rejects.toThrow("already archived");

    await projects.restore(oldest.id);
    const restored = (await projects.get(oldest.id))!;
    expect(restored.status).toBe("active");
    expect(restored.updated_at).toBeGreaterThan(archived.updated_at);
    await expect(projects.restore(oldest.id)).rejects.toThrow("already active");
  });

  it("restores a recoverable Project tombstone", async () => {
    const first = await projects.ensureDefault();
    await projects.create({ name: "Keeps the Library active" });
    const removedAt = Date.now();
    await db.run(
      `UPDATE research_projects
       SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND library_id = ?`,
      [removedAt, removedAt, first.id, libraryId],
    );

    expect((await projects.list()).some((project) => project.id === first.id)).toBe(false);
    await projects.restore(first.id);
    expect(await projects.get(first.id)).toMatchObject({
      status: "active",
      deleted_at: null,
    });
  });

  it("adds Works once and restores the same deterministic membership tombstone", async () => {
    const project = await projects.ensureDefault();
    const first = await works.upsert({ title: "Project source one" });
    const second = await works.upsert({ title: "Project source two" });

    await expect(projects.addWorks(project.id, [first.id, second.id, first.id])).resolves.toBe(2);
    expect(await projects.listWorkIds(project.id)).toEqual([first.id, second.id]);

    const initialRows = await db.query<{
      id: string;
      project_id: string;
      work_id: string;
      updated_at: number;
      deleted_at: number | null;
    }>(
      `SELECT id, project_id, work_id, updated_at, deleted_at
       FROM project_works
       WHERE project_id = ?
       ORDER BY work_id`,
      [project.id],
    );
    expect(initialRows).toHaveLength(2);
    expect(initialRows.find((row) => row.work_id === first.id)?.id).toBe(
      projectWorkMembershipId(project.id, first.id),
    );
    expect(initialRows.every((row) => row.deleted_at === null)).toBe(true);

    await expect(projects.addWorks(project.id, [first.id, second.id])).resolves.toBe(2);
    const idempotentRows = await db.query<{ id: string; updated_at: number }>(
      `SELECT id, updated_at FROM project_works WHERE project_id = ? ORDER BY work_id`,
      [project.id],
    );
    expect(idempotentRows).toEqual(initialRows.map(({ id, updated_at }) => ({ id, updated_at })));

    await expect(projects.removeWorks(project.id, [first.id, first.id])).resolves.toBe(1);
    expect(await projects.listWorkIds(project.id)).toEqual([second.id]);
    const removed = await db.query<{ id: string; updated_at: number; deleted_at: number | null }>(
      `SELECT id, updated_at, deleted_at
       FROM project_works
       WHERE project_id = ? AND work_id = ?`,
      [project.id, first.id],
    );
    expect(removed[0]?.id).toBe(projectWorkMembershipId(project.id, first.id));
    expect(removed[0]?.deleted_at).not.toBeNull();

    await projects.addWorks(project.id, [first.id]);
    const restored = await db.query<{ id: string; updated_at: number; deleted_at: number | null }>(
      `SELECT id, updated_at, deleted_at
       FROM project_works
       WHERE project_id = ? AND work_id = ?`,
      [project.id, first.id],
    );
    expect(restored[0]?.id).toBe(removed[0]?.id);
    expect(restored[0]?.deleted_at).toBeNull();
    expect(restored[0]!.updated_at).toBeGreaterThan(removed[0]!.updated_at);
  });

  it("keeps membership while a Work is trashed and exposes it again after restore", async () => {
    const project = await projects.ensureDefault();
    const work = await works.upsert({ title: "Recoverable source" });
    await projects.addWorks(project.id, [work.id]);

    await works.softDelete(work.id);
    expect(await projects.listWorkIds(project.id)).toEqual([]);
    const membership = await db.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM project_works WHERE project_id = ? AND work_id = ?`,
      [project.id, work.id],
    );
    expect(membership).toEqual([{ deleted_at: null }]);

    await works.restore(work.id);
    expect(await projects.listWorkIds(project.id)).toEqual([work.id]);
  });

  it("rejects foreign Projects and Works without partially adding local memberships", async () => {
    const project = await projects.ensureDefault();
    const localWork = await works.upsert({ title: "Local source" });
    const foreignLibraryId = "foreign-project-library";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Foreign Library', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );
    const foreignProjects = new ResearchProjectsRepo(db, foreignLibraryId);
    const foreignProject = await foreignProjects.ensureDefault();
    const foreignWork = await new WorksRepo(db, foreignLibraryId).upsert({
      title: "Foreign source",
    });

    expect(await projects.get(foreignProject.id)).toBeNull();
    await expect(projects.rename(foreignProject.id, "Cross-scope rename")).rejects.toThrow(
      ResearchProjectScopeError,
    );
    await expect(projects.listWorkIds(foreignProject.id)).rejects.toThrow(
      ResearchProjectScopeError,
    );
    await expect(projects.addWorks(project.id, [localWork.id, foreignWork.id])).rejects.toThrow(
      `Work ${foreignWork.id} is outside library ${libraryId}`,
    );
    expect(await projects.listWorkIds(project.id)).toEqual([]);
    await expect(projects.removeWorks(project.id, [foreignWork.id])).rejects.toThrow(
      `Work ${foreignWork.id} is outside library ${libraryId}`,
    );
  });

  it("rejects missing or archived mutation targets and leaves membership unchanged", async () => {
    const project = await projects.ensureDefault();
    const second = await projects.create({ name: "Archive target" });
    const work = await works.upsert({ title: "Protected membership" });
    await projects.addWorks(second.id, [work.id]);
    await projects.archive(second.id);

    await expect(projects.addWorks(second.id, [work.id])).rejects.toThrow(
      `Research project ${second.id} is archived`,
    );
    await expect(projects.removeWorks(second.id, [work.id])).rejects.toThrow(
      `Research project ${second.id} is archived`,
    );
    await expect(projects.addWorks(project.id, ["missing-work"])).rejects.toThrow(
      "Work missing-work is missing or removed",
    );
    await expect(projects.removeWorks("missing-project", [work.id])).rejects.toThrow(
      "Research project missing-project is missing or removed",
    );

    const rows = await db.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM project_works WHERE project_id = ? AND work_id = ?`,
      [second.id, work.id],
    );
    expect(rows).toEqual([{ deleted_at: null }]);
  });

  it("serializes concurrent default resolution and membership restoration", async () => {
    const foreignLibraryId = "concurrent-project-library";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
       VALUES (?, 'Concurrent Library', 'personal', ?, ?, NULL)`,
      [foreignLibraryId, now, now],
    );
    const a = new ResearchProjectsRepo(db, foreignLibraryId);
    const b = new ResearchProjectsRepo(db, foreignLibraryId);
    const [first, second] = await Promise.all([a.ensureDefault(), b.ensureDefault()]);

    expect(second.id).toBe(first.id);
    const active = await db.query<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM research_projects
       WHERE library_id = ? AND status = 'active' AND deleted_at IS NULL`,
      [foreignLibraryId],
    );
    expect(Number(active[0]?.count)).toBe(1);

    const foreignWorks = new WorksRepo(db, foreignLibraryId);
    const work = await foreignWorks.upsert({ title: "Concurrent membership" });
    await a.addWorks(first.id, [work.id]);
    await a.removeWorks(first.id, [work.id]);
    await Promise.all([a.addWorks(first.id, [work.id]), b.addWorks(first.id, [work.id])]);

    const memberships = await db.query<{ count: number; active: number }>(
      `SELECT COUNT(*) AS count,
              SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active
       FROM project_works
       WHERE project_id = ? AND work_id = ?`,
      [first.id, work.id],
    );
    expect(memberships).toEqual([{ count: 1, active: 1 }]);
  });
});
