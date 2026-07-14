// Flashcards + FSRS scheduling. ts-fsrs owns the algorithm; this repo owns
// persistence of card state and the review log.
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
} from "ts-fsrs";
import type { Database } from "../database.js";
import { newId } from "../ids.js";

export { Rating };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export interface FlashcardInput {
  workId: string;
  frontMd: string;
  backMd: string;
  cardType?: string;
  source?: string;
  aiModel?: string;
  generationId?: string;
}

export interface FlashcardRow {
  id: string;
  work_id: string;
  front_md: string;
  back_md: string;
  card_type: string;
  source: string;
  created_at: number;
}

export interface DueCard extends FlashcardRow {
  due_at: number;
  state: number;
  reps: number;
}

export class FlashcardsRepo {
  constructor(private readonly db: Database) {}

  private assertChanged(changed: number, message: string): void {
    if (changed === 0) throw new Error(message);
  }

  private async assertActiveWork(workId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM works WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [workId],
    );
    if (!rows[0]) throw new Error(`Work ${workId} is missing or removed`);
  }

  private async withSavepoint<T>(name: string, fn: () => Promise<T>): Promise<T> {
    await this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await this.db.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (e) {
      try {
        await this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      } finally {
        try {
          await this.db.exec(`RELEASE SAVEPOINT ${name}`);
        } catch {
          // Keep the original write error if SQLite already unwound the savepoint.
        }
      }
      throw e;
    }
  }

  async create(input: FlashcardInput): Promise<string> {
    await this.db.exec("BEGIN");
    try {
      const id = await this.insertCard(input);
      await this.db.exec("COMMIT");
      return id;
    } catch (e) {
      await this.db.exec("ROLLBACK");
      throw e;
    }
  }

  async createMany(inputs: FlashcardInput[]): Promise<string[]> {
    const ids: string[] = [];
    if (inputs.length === 0) return ids;
    await this.db.exec("BEGIN");
    try {
      for (const input of inputs) ids.push(await this.insertCard(input));
      await this.db.exec("COMMIT");
    } catch (e) {
      await this.db.exec("ROLLBACK");
      throw e;
    }
    return ids;
  }

  private async insertCard(input: FlashcardInput): Promise<string> {
    await this.assertActiveWork(input.workId);
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO flashcards (id, work_id, front_md, back_md, card_type, source, ai_model, generation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.workId,
        input.frontMd,
        input.backMd,
        input.cardType ?? "qa",
        input.source ?? "manual",
        input.aiModel ?? null,
        input.generationId ?? null,
        now,
        now,
      ],
    );
    // New cards are due immediately.
    const empty = createEmptyCard(new Date(now));
    await this.db.run(
      `INSERT INTO flashcard_srs (flashcard_id, due_at, stability, difficulty, reps, lapses, state)
       VALUES (?, ?, ?, ?, 0, 0, ?)`,
      [id, empty.due.getTime(), empty.stability, empty.difficulty, State.New],
    );
    return id;
  }

  async dueCards(limit = 50, now = Date.now()): Promise<DueCard[]> {
    return this.db.query<DueCard>(
      `SELECT f.*, s.due_at, s.state, s.reps
       FROM flashcards f
       JOIN flashcard_srs s ON s.flashcard_id = f.id
       JOIN works w ON w.id = f.work_id AND w.deleted_at IS NULL
       WHERE f.deleted_at IS NULL AND s.due_at <= ?
       ORDER BY s.due_at LIMIT ?`,
      [now, limit],
    );
  }

  async countDue(now = Date.now()): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n
       FROM flashcards f
       JOIN flashcard_srs s ON s.flashcard_id = f.id
       JOIN works w ON w.id = f.work_id AND w.deleted_at IS NULL
       WHERE f.deleted_at IS NULL AND s.due_at <= ?`,
      [now],
    );
    return rows[0]?.n ?? 0;
  }

  async forWork(workId: string): Promise<FlashcardRow[]> {
    return this.db.query<FlashcardRow>(
      `SELECT f.*
       FROM flashcards f
       JOIN works w ON w.id = f.work_id AND w.deleted_at IS NULL
       WHERE f.work_id = ? AND f.deleted_at IS NULL
       ORDER BY f.created_at`,
      [workId],
    );
  }

  /** Applies an FSRS review and persists the rescheduled state. */
  async review(flashcardId: string, rating: Rating, now = Date.now()): Promise<void> {
    const rows = await this.db.query<{
      due_at: number;
      stability: number;
      difficulty: number;
      reps: number;
      lapses: number;
      state: number;
      last_review_at: number | null;
    }>(
      `SELECT s.*
       FROM flashcards f
       JOIN flashcard_srs s ON s.flashcard_id = f.id
       JOIN works w ON w.id = f.work_id AND w.deleted_at IS NULL
       WHERE f.id = ? AND f.deleted_at IS NULL`,
      [flashcardId],
    );
    const srs = rows[0];
    if (!srs) throw new Error(`Flashcard ${flashcardId} is missing, removed, or unscheduled`);

    const card: FsrsCard = {
      due: new Date(srs.due_at),
      stability: srs.stability,
      difficulty: srs.difficulty,
      elapsed_days: srs.last_review_at
        ? Math.max(0, (now - srs.last_review_at) / 86_400_000)
        : 0,
      scheduled_days: 0,
      reps: srs.reps,
      lapses: srs.lapses,
      state: srs.state as State,
      last_review: srs.last_review_at ? new Date(srs.last_review_at) : undefined,
    };

    const preview = scheduler.repeat(card, new Date(now));
    const result = [...preview].find((r) => r.log.rating === rating);
    if (!result) throw new Error(`FSRS produced no schedule for rating ${rating}`);
    const next = result.card;

    await this.withSavepoint("flashcards_review", async () => {
      const changed = await this.db.run(
        `UPDATE flashcard_srs SET due_at = ?, stability = ?, difficulty = ?, reps = ?, lapses = ?, state = ?, last_review_at = ?
         WHERE flashcard_id = ?
           AND EXISTS (
             SELECT 1
             FROM flashcards f
             JOIN works w ON w.id = f.work_id AND w.deleted_at IS NULL
             WHERE f.id = ? AND f.deleted_at IS NULL
           )`,
        [
          next.due.getTime(),
          next.stability,
          next.difficulty,
          next.reps,
          next.lapses,
          next.state,
          now,
          flashcardId,
          flashcardId,
        ],
      );
      this.assertChanged(changed, `Flashcard ${flashcardId} is missing, removed, or unscheduled`);
      await this.db.run(
        `INSERT INTO flashcard_reviews (id, flashcard_id, rating, reviewed_at, elapsed_days) VALUES (?, ?, ?, ?, ?)`,
        [newId(), flashcardId, rating, now, card.elapsed_days],
      );
    });
  }

  async softDelete(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE flashcards SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM works w
           WHERE w.id = flashcards.work_id AND w.deleted_at IS NULL
         )`,
      [Date.now(), Date.now(), id],
    );
    if (changed === 0) throw new Error(`Flashcard ${id} is missing or already removed`);
  }

  async restore(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE flashcards SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM works w
           WHERE w.id = flashcards.work_id AND w.deleted_at IS NULL
         )`,
      [Date.now(), id],
    );
    if (changed === 0) throw new Error(`Flashcard ${id} is missing or already active`);
  }
}
