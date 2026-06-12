import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "../database";
import { runMigrations } from "../migrations";
import { WorksRepo } from "./works";
import { FlashcardsRepo, Rating } from "./flashcards";

let db: Database;
let works: WorksRepo;
let cards: FlashcardsRepo;
let workId: string;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
  works = new WorksRepo(db);
  cards = new FlashcardsRepo(db);
  workId = (await works.upsert({ title: "Test Paper", year: 2024 })).id;
});

describe("FlashcardsRepo", () => {
  it("creates cards due immediately", async () => {
    await cards.create({ workId, frontMd: "Q1", backMd: "A1" });
    const due = await cards.dueCards();
    expect(due).toHaveLength(1);
    expect(due[0]!.front_md).toBe("Q1");
    expect(await cards.countDue()).toBe(1);
  });

  it("reschedules into the future after a Good review", async () => {
    const id = await cards.create({ workId, frontMd: "Q", backMd: "A" });
    const now = Date.now();
    await cards.review(id, Rating.Good, now);
    // Card should no longer be due right now…
    expect(await cards.countDue(now + 1000)).toBe(0);
    // …and a review log entry exists.
    const reviews = await db.query(`SELECT * FROM flashcard_reviews WHERE flashcard_id = ?`, [id]);
    expect(reviews).toHaveLength(1);
  });

  it("Again keeps the card in the near-term queue", async () => {
    const id = await cards.create({ workId, frontMd: "Q", backMd: "A" });
    const now = Date.now();
    await cards.review(id, Rating.Again, now);
    // "Again" schedules minutes ahead, so it is due again within a day.
    expect(await cards.countDue(now + 86_400_000)).toBe(1);
  });

  it("repeated Good reviews stretch the interval", async () => {
    const id = await cards.create({ workId, frontMd: "Q", backMd: "A" });
    let t = Date.now();
    await cards.review(id, Rating.Good, t);
    const r1 = await db.query<{ due_at: number }>(
      `SELECT due_at FROM flashcard_srs WHERE flashcard_id = ?`,
      [id],
    );
    t = r1[0]!.due_at + 1000;
    await cards.review(id, Rating.Good, t);
    const r2 = await db.query<{ due_at: number }>(
      `SELECT due_at FROM flashcard_srs WHERE flashcard_id = ?`,
      [id],
    );
    const interval1 = r1[0]!.due_at - Date.now();
    const interval2 = r2[0]!.due_at - t;
    expect(interval2).toBeGreaterThan(interval1);
  });

  it("lists cards per work and soft-deletes", async () => {
    const id = await cards.create({ workId, frontMd: "Q", backMd: "A", cardType: "tldr" });
    expect(await cards.forWork(workId)).toHaveLength(1);
    await cards.softDelete(id);
    expect(await cards.forWork(workId)).toHaveLength(0);
    expect(await cards.countDue()).toBe(0);
  });
});
