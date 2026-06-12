import type { Database } from "../database";
import { newId } from "../ids";

export interface SentinelTaskRow {
  id: string;
  work_id: string | null;
  /** Null when monitoring by title — the poller discovers the DOI. */
  doi: string | null;
  title: string;
  hint_venue: string | null;
  hint_author: string | null;
  current_state: string;
  target_flags: string | null;
  poll_interval_s: number;
  next_poll_at: number;
  last_polled_at: number | null;
  error_count: number;
  status: string;
  created_at: number;
}

export interface SentinelEventRow {
  id: string;
  task_id: string;
  from_state: string;
  to_state: string;
  evidence_json: string | null;
  detected_at: number;
  notified_at: number | null;
}

export class SentinelRepo {
  constructor(private readonly db: Database) {}

  /** Either doi or title monitoring; title mode accepts venue/author hints. */
  async create(input: {
    doi?: string;
    title: string;
    workId?: string;
    targets?: string[];
    hintVenue?: string;
    hintAuthor?: string;
  }): Promise<string> {
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO sentinel_tasks (id, work_id, doi, title, current_state, target_flags,
                                   hint_venue, hint_author,
                                   poll_interval_s, next_poll_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?, 86400, ?, 'active', ?, ?)`,
      [
        id,
        input.workId ?? null,
        input.doi ?? null,
        input.title,
        input.targets ? JSON.stringify(input.targets) : null,
        input.hintVenue ?? null,
        input.hintAuthor ?? null,
        now, // first check due immediately
        now,
        now,
      ],
    );
    return id;
  }

  /** Called when title monitoring discovers the DOI. */
  async setDoi(taskId: string, doi: string): Promise<void> {
    await this.db.run(`UPDATE sentinel_tasks SET doi = ?, updated_at = ? WHERE id = ?`, [
      doi,
      Date.now(),
      taskId,
    ]);
  }

  async list(): Promise<SentinelTaskRow[]> {
    return this.db.query<SentinelTaskRow>(
      `SELECT * FROM sentinel_tasks WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
  }

  /** Active tasks whose next_poll_at has passed — the poller's work queue. */
  async duePolls(now = Date.now()): Promise<SentinelTaskRow[]> {
    return this.db.query<SentinelTaskRow>(
      `SELECT * FROM sentinel_tasks
       WHERE status = 'active' AND deleted_at IS NULL AND next_poll_at <= ?
       ORDER BY next_poll_at`,
      [now],
    );
  }

  async recordCheck(
    taskId: string,
    update: {
      newState?: string;
      nextPollS: number;
      errored: boolean;
      done?: boolean;
    },
  ): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `UPDATE sentinel_tasks SET
         current_state = COALESCE(?, current_state),
         last_polled_at = ?,
         next_poll_at = ?,
         poll_interval_s = ?,
         error_count = CASE WHEN ? THEN error_count + 1 ELSE 0 END,
         status = CASE WHEN ? THEN 'done' ELSE status END,
         updated_at = ?
       WHERE id = ?`,
      [
        update.newState ?? null,
        now,
        now + update.nextPollS * 1000,
        update.nextPollS,
        update.errored ? 1 : 0,
        update.done ? 1 : 0,
        now,
        taskId,
      ],
    );
  }

  async addEvent(
    taskId: string,
    fromState: string,
    toState: string,
    evidence: unknown,
  ): Promise<string> {
    const id = newId();
    await this.db.run(
      `INSERT INTO sentinel_events (id, task_id, from_state, to_state, evidence_json, detected_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, taskId, fromState, toState, evidence ? JSON.stringify(evidence) : null, Date.now()],
    );
    return id;
  }

  async events(taskId: string): Promise<SentinelEventRow[]> {
    return this.db.query<SentinelEventRow>(
      `SELECT * FROM sentinel_events WHERE task_id = ? ORDER BY detected_at`,
      [taskId],
    );
  }

  /** Events not yet surfaced as notifications (the app inbox). */
  async unnotifiedEvents(): Promise<SentinelEventRow[]> {
    return this.db.query<SentinelEventRow>(
      `SELECT * FROM sentinel_events WHERE notified_at IS NULL ORDER BY detected_at`,
    );
  }

  async markNotified(eventId: string): Promise<void> {
    await this.db.run(`UPDATE sentinel_events SET notified_at = ? WHERE id = ?`, [
      Date.now(),
      eventId,
    ]);
  }

  async setStatus(taskId: string, status: "active" | "paused" | "done"): Promise<void> {
    await this.db.run(`UPDATE sentinel_tasks SET status = ?, updated_at = ? WHERE id = ?`, [
      status,
      Date.now(),
      taskId,
    ]);
  }

  async linkWork(taskId: string, workId: string): Promise<void> {
    await this.db.run(`UPDATE sentinel_tasks SET work_id = ?, updated_at = ? WHERE id = ?`, [
      workId,
      Date.now(),
      taskId,
    ]);
  }

  async softDelete(taskId: string): Promise<void> {
    await this.db.run(`UPDATE sentinel_tasks SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
      Date.now(),
      Date.now(),
      taskId,
    ]);
  }
}
