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

  it("rolls back a card when SRS state creation fails", async () => {
    await db.exec(`
      CREATE TEMP TRIGGER fail_flashcard_srs_insert
      BEFORE INSERT ON flashcard_srs
      BEGIN
        SELECT RAISE(FAIL, 'forced srs failure');
      END;
    `);

    try {
      await expect(
        cards.create({ workId, frontMd: "Broken", backMd: "No SRS" }),
      ).rejects.toThrow("forced srs failure");
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_flashcard_srs_insert");
    }

    const flashcards = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM flashcards WHERE front_md = ?`,
      ["Broken"],
    );
    const srs = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM flashcard_srs`);
    expect(flashcards[0]!.n).toBe(0);
    expect(srs[0]!.n).toBe(0);
  });

  it("rolls back createMany when a later card fails", async () => {
    await db.exec(`
      CREATE TEMP TRIGGER fail_second_flashcard_insert
      BEFORE INSERT ON flashcards
      WHEN NEW.front_md = 'Q2'
      BEGIN
        SELECT RAISE(FAIL, 'forced batch flashcard failure');
      END;
    `);

    try {
      await expect(
        cards.createMany([
          { workId, frontMd: "Q1", backMd: "A1" },
          { workId, frontMd: "Q2", backMd: "A2" },
        ]),
      ).rejects.toThrow("forced batch flashcard failure");
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_second_flashcard_insert");
    }

    const flashcards = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM flashcards WHERE front_md IN ('Q1', 'Q2')`,
    );
    const srs = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM flashcard_srs s
       JOIN flashcards f ON f.id = s.flashcard_id
       WHERE f.front_md IN ('Q1', 'Q2')`,
    );
    expect(flashcards[0]!.n).toBe(0);
    expect(srs[0]!.n).toBe(0);
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

  it("rolls back SRS changes when review logging fails", async () => {
    const id = await cards.create({ workId, frontMd: "Atomic review", backMd: "Log required" });
    const before = await db.query<{
      due_at: number;
      reps: number;
      last_review_at: number | null;
    }>(`SELECT due_at, reps, last_review_at FROM flashcard_srs WHERE flashcard_id = ?`, [id]);
    await db.exec(`
      CREATE TEMP TRIGGER fail_flashcard_review_insert
      BEFORE INSERT ON flashcard_reviews
      BEGIN
        SELECT RAISE(FAIL, 'forced review log failure');
      END;
    `);

    try {
      await expect(cards.review(id, Rating.Good, Date.now())).rejects.toThrow(
        "forced review log failure",
      );
    } finally {
      await db.exec("DROP TRIGGER IF EXISTS fail_flashcard_review_insert");
    }

    const after = await db.query<{
      due_at: number;
      reps: number;
      last_review_at: number | null;
    }>(`SELECT due_at, reps, last_review_at FROM flashcard_srs WHERE flashcard_id = ?`, [id]);
    const reviews = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM flashcard_reviews WHERE flashcard_id = ?`,
      [id],
    );
    expect(after[0]).toEqual(before[0]);
    expect(reviews[0]!.n).toBe(0);
  });

  it("rejects reviews and repeated deletes for removed cards", async () => {
    const id = await cards.create({ workId, frontMd: "Removed", backMd: "No stale review" });
    await cards.softDelete(id);

    await expect(cards.review(id, Rating.Good, Date.now())).rejects.toThrow(
      `Flashcard ${id} is missing, removed, or unscheduled`,
    );
    await expect(cards.softDelete(id)).rejects.toThrow(
      `Flashcard ${id} is missing or already removed`,
    );
    await expect(cards.restore("missing-card")).rejects.toThrow(
      "Flashcard missing-card is missing or already active",
    );

    const reviews = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM flashcard_reviews WHERE flashcard_id = ?`,
      [id],
    );
    const srs = await db.query<{ reps: number; last_review_at: number | null }>(
      `SELECT reps, last_review_at FROM flashcard_srs WHERE flashcard_id = ?`,
      [id],
    );
    expect(reviews[0]!.n).toBe(0);
    expect(srs[0]).toMatchObject({ reps: 0, last_review_at: null });

    await cards.restore(id);
    await expect(cards.restore(id)).rejects.toThrow(`Flashcard ${id} is missing or already active`);
  });

  it("scopes flashcard creation, queues, and reviews to active source works", async () => {
    const id = await cards.create({ workId, frontMd: "Archived source", backMd: "Hidden card" });

    await works.softDelete(workId);

    expect(await cards.dueCards()).toHaveLength(0);
    expect(await cards.countDue()).toBe(0);
    expect(await cards.forWork(workId)).toHaveLength(0);
    await expect(cards.review(id, Rating.Good, Date.now())).rejects.toThrow(
      `Flashcard ${id} is missing, removed, or unscheduled`,
    );
    await expect(cards.create({ workId, frontMd: "Stale", backMd: "Nope" })).rejects.toThrow(
      `Work ${workId} is missing or removed`,
    );
    await expect(
      cards.createMany([
        { workId, frontMd: "Batch stale", backMd: "Nope" },
        { workId: "missing-work", frontMd: "Batch missing", backMd: "Nope" },
      ]),
    ).rejects.toThrow(`Work ${workId} is missing or removed`);

    await works.restore(workId);

    const due = await cards.dueCards();
    expect(due).toHaveLength(1);
    expect(due[0]?.id).toBe(id);
    await cards.review(id, Rating.Good, Date.now());
    expect(await cards.countDue(Date.now() + 1000)).toBe(0);
  });

  it("rejects flashcard delete and restore when the source work is removed", async () => {
    const id = await cards.create({
      workId,
      frontMd: "Archived source action",
      backMd: "Do not mutate while hidden",
    });

    await works.softDelete(workId);

    await expect(cards.softDelete(id)).rejects.toThrow(
      `Flashcard ${id} is missing or already removed`,
    );
    const stillActive = await db.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM flashcards WHERE id = ?`,
      [id],
    );
    expect(stillActive[0]!.deleted_at).toBeNull();

    await db.run(`UPDATE flashcards SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      id,
    ]);

    await expect(cards.restore(id)).rejects.toThrow(`Flashcard ${id} is missing or already active`);
    const stillDeleted = await db.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM flashcards WHERE id = ?`,
      [id],
    );
    expect(stillDeleted[0]!.deleted_at).not.toBeNull();

    await works.restore(workId);
    await cards.restore(id);
    expect(await cards.forWork(workId)).toHaveLength(1);
  });

  it("lists cards per work and soft-deletes", async () => {
    const id = await cards.create({ workId, frontMd: "Q", backMd: "A", cardType: "tldr" });
    expect(await cards.forWork(workId)).toHaveLength(1);
    await cards.softDelete(id);
    expect(await cards.forWork(workId)).toHaveLength(0);
    expect(await cards.countDue()).toBe(0);
  });

  it("restores a soft-deleted due card without losing SRS state", async () => {
    const id = await cards.create({ workId, frontMd: "Recover me", backMd: "Recovered" });

    await cards.softDelete(id);
    expect(await cards.countDue()).toBe(0);

    await cards.restore(id);

    const due = await cards.dueCards();
    expect(due).toHaveLength(1);
    expect(due[0]!.id).toBe(id);
    expect(due[0]!.front_md).toBe("Recover me");
    expect(due[0]!.reps).toBe(0);
  });
});
