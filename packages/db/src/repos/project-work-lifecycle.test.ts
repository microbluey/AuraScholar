import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { projectWorkMembershipId } from "../ids";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { ResearchProjectsRepo } from "./research-projects";
import { WorksRepo } from "./works";

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

describe("Project Work lifecycle", () => {
  it("unions active memberships when duplicate Works are merged", async () => {
    const firstProject = await projects.ensureDefault();
    const secondProject = await projects.create({ name: "Second Project" });
    const primary = await works.upsert({ title: "Canonical source" });
    const duplicate = await works.upsert({ title: "Duplicate source" });

    await projects.addWorks(firstProject.id, [primary.id, duplicate.id]);
    await projects.removeWorks(firstProject.id, [primary.id]);
    await projects.addWorks(secondProject.id, [duplicate.id]);
    await db.run(
      `UPDATE project_works
       SET role = 'evidence'
       WHERE project_id IN (?, ?) AND work_id = ?`,
      [firstProject.id, secondProject.id, duplicate.id],
    );

    await works.mergeInto(primary.id, [duplicate.id]);

    expect(await projects.listWorkIds(firstProject.id)).toEqual([primary.id]);
    expect(await projects.listWorkIds(secondProject.id)).toEqual([primary.id]);

    const rows = await db.query<{
      id: string;
      project_id: string;
      work_id: string;
      role: string;
      deleted_at: number | null;
    }>(
      `SELECT id, project_id, work_id, role, deleted_at
       FROM project_works
       WHERE work_id IN (?, ?)
       ORDER BY project_id, work_id`,
      [primary.id, duplicate.id],
    );
    const active = rows.filter((row) => row.deleted_at === null);
    const retired = rows.filter((row) => row.work_id === duplicate.id);

    expect(active).toHaveLength(2);
    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: projectWorkMembershipId(firstProject.id, primary.id),
          project_id: firstProject.id,
          work_id: primary.id,
          role: "evidence",
        }),
        expect.objectContaining({
          id: projectWorkMembershipId(secondProject.id, primary.id),
          project_id: secondProject.id,
          work_id: primary.id,
          role: "evidence",
        }),
      ]),
    );
    expect(retired).toHaveLength(2);
    expect(retired.every((row) => row.deleted_at !== null)).toBe(true);
  });

  it("purges only the deleted Work membership and preserves the Project", async () => {
    const project = await projects.ensureDefault();
    const purged = await works.upsert({ title: "Source to purge" });
    const survivor = await works.upsert({ title: "Source to keep" });
    await projects.addWorks(project.id, [purged.id, survivor.id]);

    await works.softDelete(purged.id);
    await works.purgeDeleted(purged.id);

    expect(await projects.get(project.id)).toMatchObject({
      id: project.id,
      status: "active",
      deleted_at: null,
    });
    expect(await projects.listWorkIds(project.id)).toEqual([survivor.id]);
    expect(await db.query(`SELECT id FROM project_works WHERE work_id = ?`, [purged.id])).toEqual(
      [],
    );
    expect(
      await db.query<{ deleted_at: number | null }>(
        `SELECT deleted_at FROM project_works WHERE project_id = ? AND work_id = ?`,
        [project.id, survivor.id],
      ),
    ).toEqual([{ deleted_at: null }]);
    expect(await works.get(survivor.id)).toMatchObject({ id: survivor.id });
  });
});
