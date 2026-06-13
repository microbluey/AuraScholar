import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { WorksRepo } from "./works";
import { SnippetsRepo } from "./snippets";

let db: Database;
let works: WorksRepo;
let snippets: SnippetsRepo;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  works = new WorksRepo(db);
  snippets = new SnippetsRepo(db);
});

async function makeWork(title: string): Promise<string> {
  const { id } = await works.upsert({ title, year: 2024 });
  return id;
}

describe("SnippetsRepo", () => {
  it("creates and lists snippets for a work", async () => {
    const w = await makeWork("Paper A");
    await snippets.create({ workId: w, pageIndex: 2, quote: "key claim", noteMd: "useful" });
    const list = await snippets.forWork(w);
    expect(list).toHaveLength(1);
    expect(list[0]?.quote).toBe("key claim");
    expect(list[0]?.page_index).toBe(2);
    expect(list[0]?.note_md).toBe("useful");
  });

  it("listAll joins the work title and excludes soft-deleted", async () => {
    const w = await makeWork("Paper B");
    const id = await snippets.create({ workId: w, quote: "q1" });
    await snippets.create({ workId: w, quote: "q2" });
    let all = await snippets.listAll();
    expect(all).toHaveLength(2);
    expect(all[0]?.work_title).toBe("Paper B");

    await snippets.softDelete(id);
    all = await snippets.listAll();
    expect(all).toHaveLength(1);
    expect(await snippets.count()).toBe(1);
  });

  it("updates a note", async () => {
    const w = await makeWork("Paper C");
    const id = await snippets.create({ workId: w, quote: "q" });
    await snippets.updateNote(id, "my note");
    const [row] = await snippets.forWork(w);
    expect(row?.note_md).toBe("my note");
  });
});
