import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { requireLocalLibraryId } from "../local-first";
import { runMigrations } from "../migrations";
import { WorksRepo } from "./works";

let db: Database;
let works: WorksRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  works = new WorksRepo(db, await requireLocalLibraryId(db));
});

describe("WorksRepo integrity", () => {
  it("rolls back bulk soft delete when a later update fails", async () => {
    const first = await works.upsert({ title: "Bulk Delete Alpha", doi: "10.9/bulk-delete-a" });
    const second = await works.upsert({ title: "Bulk Delete Beta", doi: "10.9/bulk-delete-b" });
    await db.exec(`
      CREATE TEMP TRIGGER fail_second_bulk_soft_delete
      BEFORE UPDATE OF deleted_at ON works
      WHEN OLD.id = '${second.id}' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
      BEGIN
        SELECT RAISE(FAIL, 'forced bulk delete failure');
      END;
    `);

    try {
      await expect(works.softDeleteMany([first.id, second.id])).rejects.toThrow(
        "forced bulk delete failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_second_bulk_soft_delete");
    }

    expect(await works.listDeleted()).toHaveLength(0);
    expect((await works.get(first.id))?.deleted_at).toBeNull();
    expect((await works.get(second.id))?.deleted_at).toBeNull();
  });

  it("rolls back bulk restore when a later update fails", async () => {
    const first = await works.upsert({ title: "Bulk Restore Alpha", doi: "10.9/bulk-restore-a" });
    const second = await works.upsert({ title: "Bulk Restore Beta", doi: "10.9/bulk-restore-b" });
    await works.softDeleteMany([first.id, second.id]);
    await db.exec(`
      CREATE TEMP TRIGGER fail_second_bulk_restore
      BEFORE UPDATE OF deleted_at ON works
      WHEN OLD.id = '${second.id}' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
      BEGIN
        SELECT RAISE(FAIL, 'forced bulk restore failure');
      END;
    `);

    try {
      await expect(works.restoreMany([first.id, second.id])).rejects.toThrow(
        "forced bulk restore failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_second_bulk_restore");
    }

    const deletedIds = (await works.listDeleted()).map((work) => work.id).sort();
    expect(deletedIds).toEqual([first.id, second.id].sort());
    expect((await works.get(first.id))?.deleted_at).not.toBeNull();
    expect((await works.get(second.id))?.deleted_at).not.toBeNull();
  });
});
