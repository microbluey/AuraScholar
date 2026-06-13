import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { WorksRepo } from "./works";
import { TagsRepo } from "./tags";

let db: Database;
let works: WorksRepo;
let tags: TagsRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  works = new WorksRepo(db);
  tags = new TagsRepo(db);
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

  it("addToWorks attaches a tag to many works and counts them", async () => {
    const w1 = await makeWork("Paper 1");
    const w2 = await makeWork("Paper 2");
    await tags.addToWorks([w1, w2], "重点");
    const list = await tags.list();
    const tag = list.find((t) => t.name === "重点");
    expect(tag?.count).toBe(2);
  });

  it("addToWorks is idempotent", async () => {
    const w1 = await makeWork("Paper 1");
    await tags.addToWorks([w1], "x");
    await tags.addToWorks([w1], "x");
    const tag = (await tags.list()).find((t) => t.name === "x");
    expect(tag?.count).toBe(1);
  });

  it("rename and setColor update the row", async () => {
    const id = await tags.ensure("old", "#fff");
    await tags.rename(id, "new");
    await tags.setColor(id, "#000");
    const tag = (await tags.list())[0];
    expect(tag?.name).toBe("new");
    expect(tag?.color).toBe("#000");
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
});
