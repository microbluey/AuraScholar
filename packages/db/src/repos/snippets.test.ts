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

  it("fails updates and deletes when the snippet is missing or removed", async () => {
    const w = await makeWork("Paper Missing");
    const id = await snippets.create({ workId: w, quote: "stale quote", noteMd: "original" });

    await snippets.softDelete(id);

    await expect(snippets.updateNote(id, "stale edit")).rejects.toThrow(
      `Snippet ${id} is missing or removed`,
    );
    await expect(snippets.softDelete(id)).rejects.toThrow(
      `Snippet ${id} is missing or already removed`,
    );
    await expect(snippets.restore("missing-snippet")).rejects.toThrow(
      "Snippet missing-snippet is missing or already active",
    );
    const rows = await db.query<{ note_md: string | null }>(
      `SELECT note_md FROM snippets WHERE id = ?`,
      [id],
    );
    expect(rows[0]!.note_md).toBe("original");
  });

  it("restores a soft-deleted snippet", async () => {
    const w = await makeWork("Paper D");
    const id = await snippets.create({ workId: w, quote: "recoverable quote" });

    await snippets.softDelete(id);
    expect(await snippets.count()).toBe(0);

    await snippets.restore(id);
    const all = await snippets.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.quote).toBe("recoverable quote");
    expect(await snippets.count()).toBe(1);
    await expect(snippets.restore(id)).rejects.toThrow(
      `Snippet ${id} is missing or already active`,
    );
  });

  it("scopes snippet creation, lists, and counts to active source works", async () => {
    const w = await makeWork("Archived Snippet Source");
    const id = await snippets.create({ workId: w, quote: "source will be archived" });

    await works.softDelete(w);

    expect(await snippets.listAll()).toHaveLength(0);
    expect(await snippets.forWork(w)).toHaveLength(0);
    expect(await snippets.count()).toBe(0);
    await expect(snippets.create({ workId: w, quote: "stale save" })).rejects.toThrow(
      `Work ${w} is missing or removed`,
    );
    await expect(snippets.create({ workId: "missing-work", quote: "missing save" })).rejects.toThrow(
      "Work missing-work is missing or removed",
    );
    await expect(snippets.updateNote(id, "stale edit")).rejects.toThrow(
      `Snippet ${id} is missing or removed`,
    );
    await expect(snippets.softDelete(id)).rejects.toThrow(
      `Snippet ${id} is missing or already removed`,
    );
    await expect(snippets.restore(id)).rejects.toThrow(
      `Snippet ${id} is missing or already active`,
    );
  });
});
