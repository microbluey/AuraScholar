import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { requireLocalLibraryId } from "../local-first";
import { WorksRepo } from "./works";
import { TagsRepo } from "./tags";

let db: Database;
let libraryId: string;
let works: WorksRepo;
let tags: TagsRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  libraryId = await requireLocalLibraryId(db);
  works = new WorksRepo(db, libraryId);
  tags = new TagsRepo(db, libraryId);
});

async function makeWork(title: string): Promise<string> {
  const { id } = await works.upsert({ title, year: 2020 });
  return id;
}

describe("TagsRepo", () => {
  it("ensure() upserts by name (no duplicate rows)", async () => {
    const a = await tags.ensure("方法");
    const b = await tags.ensure("方法");
    expect(a).toBe(b);
    const list = await tags.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("方法");
  });

  it("ensure() restores a soft-deleted tag with the same name", async () => {
    const id = await tags.ensure("方法");
    await tags.softDelete(id);

    const restored = await tags.ensure("方法", "#0f766e");

    expect(restored).toBe(id);
    const list = await tags.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "方法", color: "#0f766e" });
  });

  it("addToWorks attaches a tag to many works and counts them", async () => {
    const w1 = await makeWork("Paper 1");
    const w2 = await makeWork("Paper 2");
    await tags.addToWorks([w1, w2], "重点");
    const list = await tags.list();
    const tag = list.find((t) => t.name === "重点");
    expect(tag?.count).toBe(2);
  });

  it("rolls back addToWorks when a later association fails", async () => {
    const w1 = await makeWork("Paper 1");
    const w2 = await makeWork("Paper 2");
    await db.exec(`
      CREATE TEMP TRIGGER fail_second_tag_assignment
      BEFORE INSERT ON work_tags
      WHEN NEW.work_id = '${w2}'
      BEGIN
        SELECT RAISE(FAIL, 'forced tag assignment failure');
      END;
    `);

    try {
      await expect(tags.addToWorks([w1, w2], "atomic")).rejects.toThrow(
        "forced tag assignment failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_second_tag_assignment");
    }

    const tagRows = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM tags WHERE name = ?`, [
      "atomic",
    ]);
    const linkRows = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM work_tags wt
       JOIN tags t ON t.id = wt.tag_id
       WHERE t.name = ?`,
      ["atomic"],
    );
    expect(tagRows[0]!.n).toBe(0);
    expect(linkRows[0]!.n).toBe(0);
  });

  it("addToWorks is idempotent", async () => {
    const w1 = await makeWork("Paper 1");
    await tags.addToWorks([w1], "x");
    await tags.addToWorks([w1], "x");
    const tag = (await tags.list()).find((t) => t.name === "x");
    expect(tag?.count).toBe(1);
  });

  it("rejects missing or removed works when assigning or removing tag links", async () => {
    const active = await makeWork("Active Tagged Paper");
    const removed = await makeWork("Removed Tagged Paper");
    await works.softDelete(removed);

    await expect(tags.addToWorks([active, removed], "stale-target")).rejects.toThrow(
      `Work ${removed} is missing or removed`,
    );
    expect((await tags.list()).find((tag) => tag.name === "stale-target")).toBeUndefined();

    const id = await tags.ensure("recoverable");
    await db.run(`INSERT INTO work_tags (work_id, tag_id) VALUES (?, ?)`, [active, id]);

    await expect(tags.addToWorks(["missing-work"], "missing-target")).rejects.toThrow(
      "Work missing-work is missing or removed",
    );
    await expect(tags.removeFromWork(removed, id)).rejects.toThrow(
      `Work ${removed} is missing or removed`,
    );
    await expect(tags.removeFromWork(active, "missing-tag")).rejects.toThrow(
      "Tag missing-tag is missing or removed",
    );
  });

  it("workIds ignores stale associations for removed works", async () => {
    const active = await makeWork("Visible Tagged Paper");
    const removed = await makeWork("Hidden Tagged Paper");
    await tags.addToWorks([active, removed], "visible-only");
    const id = (await tags.list()).find((tag) => tag.name === "visible-only")!.id;

    await works.softDelete(removed);

    const list = await tags.list();
    expect(list.find((tag) => tag.id === id)?.count).toBe(1);
    expect(await tags.workIds(id)).toEqual([active]);
  });

  it("rename and setColor update the row", async () => {
    const id = await tags.ensure("old", "#fff");
    await tags.rename(id, "new");
    await tags.setColor(id, "#000");
    const tag = (await tags.list())[0];
    expect(tag?.name).toBe("new");
    expect(tag?.color).toBe("#000");
  });

  it("fails tag edits and state changes when the target is missing or in the wrong state", async () => {
    const id = await tags.ensure("stale", "#fff");
    await tags.softDelete(id);

    await expect(tags.rename(id, "renamed")).rejects.toThrow(`Tag ${id} is missing or removed`);
    await expect(tags.setColor(id, "#000")).rejects.toThrow(`Tag ${id} is missing or removed`);
    await expect(tags.softDelete(id)).rejects.toThrow(`Tag ${id} is missing or already removed`);
    await expect(tags.rename("missing-tag", "renamed")).rejects.toThrow(
      "Tag missing-tag is missing or removed",
    );
    await expect(tags.setColor("missing-tag", "#000")).rejects.toThrow(
      "Tag missing-tag is missing or removed",
    );
    await expect(tags.restore("missing-tag")).rejects.toThrow(
      "Tag missing-tag is missing or already active",
    );

    await tags.restore(id);

    await expect(tags.restore(id)).rejects.toThrow(`Tag ${id} is missing or already active`);
  });

  it("rename merges into an existing tag instead of failing unique constraints", async () => {
    const w1 = await makeWork("Paper 1");
    const w2 = await makeWork("Paper 2");
    await tags.addToWorks([w1], "old");
    await tags.addToWorks([w2], "new");
    const oldId = (await tags.list()).find((t) => t.name === "old")!.id;

    await tags.rename(oldId, "new");

    const list = await tags.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "new", count: 2 });
  });

  it("rolls back a rename merge when retiring the old tag fails", async () => {
    const w1 = await makeWork("Paper 1");
    const w2 = await makeWork("Paper 2");
    await tags.addToWorks([w1], "old");
    await tags.addToWorks([w2], "new");
    const oldId = (await tags.list()).find((t) => t.name === "old")!.id;
    await db.exec(`
      CREATE TEMP TRIGGER fail_tag_merge_retire
      BEFORE UPDATE OF deleted_at ON tags
      WHEN OLD.id = '${oldId}' AND NEW.deleted_at IS NOT NULL
      BEGIN
        SELECT RAISE(FAIL, 'forced tag merge failure');
      END;
    `);

    try {
      await expect(tags.rename(oldId, "new")).rejects.toThrow("forced tag merge failure");
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_tag_merge_retire");
    }

    const list = await tags.list();
    expect(list).toHaveLength(2);
    expect(list.find((tag) => tag.name === "old")).toMatchObject({ id: oldId, count: 1 });
    expect(list.find((tag) => tag.name === "new")).toMatchObject({ count: 1 });
  });

  it("can merge tags inside an existing outer transaction", async () => {
    const w1 = await makeWork("Paper 1");
    const w2 = await makeWork("Paper 2");
    await tags.addToWorks([w1], "old");
    await tags.addToWorks([w2], "new");
    const oldId = (await tags.list()).find((t) => t.name === "old")!.id;
    let committed = false;
    await db.exec("BEGIN");
    try {
      await tags.rename(oldId, "new");
      await db.exec("COMMIT");
      committed = true;
    } finally {
      if (!committed) {
        try {
          await db.exec("ROLLBACK");
        } catch {
          // Ignore cleanup errors; the assertion should surface the original failure.
        }
      }
    }

    const list = await tags.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "new", count: 2 });
  });

  it("serializes concurrent ensure calls and returns one durable tag id", async () => {
    const anotherRepo = new TagsRepo(db, libraryId);

    const [first, second] = await Promise.all([
      tags.ensure("concurrent"),
      anotherRepo.ensure("concurrent"),
    ]);

    expect(first).toBe(second);
    expect((await tags.list()).filter((tag) => tag.name === "concurrent")).toHaveLength(1);
  });

  it("rejects a silently ignored tag insert instead of returning a phantom id", async () => {
    await db.exec(`
      CREATE TEMP TRIGGER ignore_tag_insert
      BEFORE INSERT ON tags
      WHEN NEW.name = 'ignored'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    try {
      await expect(tags.ensure("ignored")).rejects.toThrow('Tag "ignored" was not created');
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS ignore_tag_insert");
    }

    expect((await tags.list()).find((tag) => tag.name === "ignored")).toBeUndefined();
  });

  it("rolls back bulk tagging when SQLite silently ignores one association", async () => {
    const first = await makeWork("Ignore Alpha");
    const second = await makeWork("Ignore Beta");
    await db.exec(`
      CREATE TEMP TRIGGER ignore_second_tag_assignment
      BEFORE INSERT ON work_tags
      WHEN NEW.work_id = '${second}'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    try {
      await expect(tags.addToWorks([first, second], "ignored-link")).rejects.toThrow(
        `was not assigned to work ${second}`,
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS ignore_second_tag_assignment");
    }

    expect((await tags.list()).find((tag) => tag.name === "ignored-link")).toBeUndefined();
    expect(
      await db.query(`SELECT * FROM work_tags WHERE work_id IN (?, ?)`, [first, second]),
    ).toHaveLength(0);
  });

  it("preserves tag membership for recycle-bin works when merging names", async () => {
    const active = await makeWork("Active Merge Member");
    const removed = await makeWork("Removed Merge Member");
    const targetMember = await makeWork("Existing Target Member");
    await tags.addToWorks([active, removed], "source");
    await tags.addToWorks([targetMember], "target");
    const sourceId = (await tags.list()).find((tag) => tag.name === "source")!.id;
    const targetId = (await tags.list()).find((tag) => tag.name === "target")!.id;
    await works.softDelete(removed);

    await expect(tags.rename(sourceId, "target")).resolves.toBe(targetId);

    const hiddenLink = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM work_tags WHERE work_id = ? AND tag_id = ?`,
      [removed, targetId],
    );
    expect(hiddenLink[0]!.n).toBe(1);
    await works.restoreMany([removed]);
    expect(await tags.workIds(targetId)).toEqual([active, removed, targetMember].sort());
  });

  it("captures and restores active and recycle-bin memberships atomically", async () => {
    const active = await makeWork("Active Undo Member");
    const removed = await makeWork("Removed Undo Member");
    await tags.addToWorks([active, removed], "undo-complete");
    const tagId = (await tags.list()).find((tag) => tag.name === "undo-complete")!.id;
    await works.softDelete(removed);

    const snapshot = await tags.softDelete(tagId);
    expect(snapshot).toEqual([active, removed].sort());
    expect(await db.query(`SELECT * FROM work_tags WHERE tag_id = ?`, [tagId])).toHaveLength(0);

    await expect(tags.restore(tagId, snapshot)).resolves.toBe(2);
    await works.restoreMany([removed]);
    expect(await tags.workIds(tagId)).toEqual([active, removed].sort());
  });

  it("restores surviving memberships and skips work purged after deletion", async () => {
    const surviving = await makeWork("Surviving Tag Member");
    const purged = await makeWork("Purged Tag Member");
    await tags.addToWorks([surviving, purged], "purge-safe-undo");
    const tagId = (await tags.list()).find((tag) => tag.name === "purge-safe-undo")!.id;
    await works.softDelete(purged);
    const snapshot = await tags.softDelete(tagId);
    await works.purgeDeleted(purged);

    await expect(tags.restore(tagId, snapshot)).resolves.toBe(1);
    expect(await tags.workIds(tagId)).toEqual([surviving]);
  });

  it("rejects foreign work during restore and rolls back surviving memberships", async () => {
    const surviving = await makeWork("Owned Tag Restore Member");
    await tags.addToWorks([surviving], "scoped-undo");
    const tagId = (await tags.list()).find((tag) => tag.name === "scoped-undo")!.id;
    const snapshot = await tags.softDelete(tagId);
    const foreignLibraryId = "library:tag-restore-foreign";
    const now = Date.now();
    await db.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Tag Restore Library', 'personal', ?, ?)`,
      [foreignLibraryId, now, now],
    );
    const foreignWork = await new WorksRepo(db, foreignLibraryId).upsert({
      title: "Foreign Tag Restore Member",
    });

    await expect(tags.restore(tagId, [...snapshot, foreignWork.id])).rejects.toThrow(
      `Work ${foreignWork.id} belongs to another Library`,
    );

    expect((await tags.list()).some((tag) => tag.id === tagId)).toBe(false);
    expect(await db.query(`SELECT * FROM work_tags WHERE tag_id = ?`, [tagId])).toHaveLength(0);
  });

  it("rejects silently ignored restore and remove operations", async () => {
    const workId = await makeWork("Ignore Restore Member");
    await tags.addToWorks([workId], "ignore-roundtrip");
    const tagId = (await tags.list()).find((tag) => tag.name === "ignore-roundtrip")!.id;
    const snapshot = await tags.softDelete(tagId);
    await db.exec(`
      CREATE TEMP TRIGGER ignore_tag_restore
      BEFORE INSERT ON work_tags
      WHEN NEW.tag_id = '${tagId}'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    try {
      await expect(tags.restore(tagId, snapshot)).rejects.toThrow(
        `Tag ${tagId} was not restored to work ${workId}`,
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS ignore_tag_restore");
    }

    const deleted = await db.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM tags WHERE id = ?`,
      [tagId],
    );
    expect(deleted[0]!.deleted_at).not.toBeNull();
    await tags.restore(tagId, snapshot);
    await db.exec(`
      CREATE TEMP TRIGGER ignore_tag_remove
      BEFORE DELETE ON work_tags
      WHEN OLD.tag_id = '${tagId}'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    try {
      await expect(tags.removeFromWork(workId, tagId)).rejects.toThrow(
        `Tag ${tagId} was not removed from work ${workId}`,
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS ignore_tag_remove");
    }
    expect(await tags.workIds(tagId)).toEqual([workId]);
  });

  it("softDelete removes the tag and its work associations", async () => {
    const w1 = await makeWork("Paper 1");
    await tags.addToWorks([w1], "temp");
    const id = (await tags.list())[0]!.id;
    await tags.softDelete(id);
    expect(await tags.list()).toHaveLength(0);
    const links = await db.query(`SELECT * FROM work_tags WHERE tag_id = ?`, [id]);
    expect(links).toHaveLength(0);
  });

  it("rolls back softDelete when marking the tag deleted fails", async () => {
    const w1 = await makeWork("Paper 1");
    await tags.addToWorks([w1], "temp");
    const id = (await tags.list())[0]!.id;
    await db.exec(`
      CREATE TEMP TRIGGER fail_tag_soft_delete
      BEFORE UPDATE OF deleted_at ON tags
      WHEN OLD.id = '${id}' AND NEW.deleted_at IS NOT NULL
      BEGIN
        SELECT RAISE(FAIL, 'forced tag delete failure');
      END;
    `);

    try {
      await expect(tags.softDelete(id)).rejects.toThrow("forced tag delete failure");
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_tag_soft_delete");
    }

    const list = await tags.list();
    const links = await db.query(`SELECT * FROM work_tags WHERE tag_id = ?`, [id]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "temp", count: 1 });
    expect(links).toHaveLength(1);
  });

  it("restores a deleted tag with its previous work associations", async () => {
    const w1 = await makeWork("Paper 1");
    const w2 = await makeWork("Paper 2");
    await tags.addToWorks([w1, w2], "temp");
    const id = (await tags.list())[0]!.id;
    const workIds = await tags.workIds(id);

    await tags.softDelete(id);
    expect(await tags.list()).toHaveLength(0);

    await tags.restore(id, workIds);

    const list = await tags.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "temp", count: 2 });
    expect(await tags.workIds(id)).toEqual([w1, w2].sort());
  });

  it("rolls back restore when a work reassignment fails", async () => {
    const w1 = await makeWork("Paper 1");
    const w2 = await makeWork("Paper 2");
    await tags.addToWorks([w1, w2], "temp");
    const id = (await tags.list())[0]!.id;
    const workIds = await tags.workIds(id);
    await tags.softDelete(id);
    await db.exec(`
      CREATE TEMP TRIGGER fail_tag_restore_assignment
      BEFORE INSERT ON work_tags
      WHEN NEW.work_id = '${w2}'
      BEGIN
        SELECT RAISE(FAIL, 'forced tag restore failure');
      END;
    `);

    try {
      await expect(tags.restore(id, workIds)).rejects.toThrow("forced tag restore failure");
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_tag_restore_assignment");
    }

    const visible = await tags.list();
    const state = await db.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM tags WHERE id = ?`,
      [id],
    );
    const links = await db.query(`SELECT * FROM work_tags WHERE tag_id = ?`, [id]);
    expect(visible).toHaveLength(0);
    expect(state[0]!.deleted_at).not.toBeNull();
    expect(links).toHaveLength(0);
  });
});
