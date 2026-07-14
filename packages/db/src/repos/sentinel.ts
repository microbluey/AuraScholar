import type { Database } from "../database.js";
import { summarizePersistedError } from "../error-summary.js";
import { newId, normalizeDoi } from "../ids.js";

export interface SentinelCreateInput {
  doi?: string | null;
  title: string;
  workId?: string;
  targets?: string[];
  hintVenue?: string;
  hintAuthor?: string;
}

export type SentinelCreateStatus = "created" | "existing" | "restored";

export interface SentinelCreateResult {
  id: string;
  status: SentinelCreateStatus;
  task: SentinelTaskRow;
}

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
  last_error: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
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

export interface SentinelEventInput {
  fromState: string;
  toState: string;
  evidence: unknown;
}

export interface SentinelCheckUpdate {
  newState?: string;
  nextPollS: number;
  errored: boolean;
  error?: string | null;
  done?: boolean;
  doi?: string | null;
  events?: SentinelEventInput[];
}

export class SentinelTaskInactiveError extends Error {
  constructor(readonly taskId: string) {
    super(`Sentinel task ${taskId} is missing, paused, done, or removed`);
    this.name = "SentinelTaskInactiveError";
  }
}

export class SentinelRepo {
  constructor(private readonly db: Database) {}

  private assertChanged(changed: number, error: Error): void {
    if (changed === 0) throw error;
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

  /** Either doi or title monitoring; title mode accepts venue/author hints. */
  async create(input: SentinelCreateInput): Promise<string> {
    const prepared = prepareCreateInput(input);
    if (prepared.workId) await this.assertActiveWork(prepared.workId);
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO sentinel_tasks (id, work_id, doi, title, current_state, target_flags,
                                   hint_venue, hint_author,
                                   poll_interval_s, next_poll_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?, 86400, ?, 'active', ?, ?)`,
      [
        id,
        prepared.workId ?? null,
        prepared.doi,
        prepared.title,
        prepared.targets ? JSON.stringify(prepared.targets) : null,
        prepared.hintVenue ?? null,
        prepared.hintAuthor ?? null,
        now, // first check due immediately
        now,
        now,
      ],
    );
    return id;
  }

  async createOrRestore(input: SentinelCreateInput): Promise<SentinelCreateResult> {
    const prepared = prepareCreateInput(input);
    if (prepared.workId) await this.assertActiveWork(prepared.workId);
    const existing = await this.findMatchingTask(prepared);

    if (existing && existing.deleted_at == null) {
      if (prepared.workId && !existing.work_id) {
        await this.db.run(`UPDATE sentinel_tasks SET work_id = ?, updated_at = ? WHERE id = ?`, [
          prepared.workId,
          Date.now(),
          existing.id,
        ]);
        const linked = await this.get(existing.id);
        return { id: existing.id, status: "existing", task: linked ?? existing };
      }
      return { id: existing.id, status: "existing", task: existing };
    }

    if (existing) {
      const now = Date.now();
      await this.db.run(
        `UPDATE sentinel_tasks SET
           work_id = COALESCE(?, work_id),
           doi = ?,
           title = ?,
           target_flags = COALESCE(?, target_flags),
           hint_venue = ?,
           hint_author = ?,
           next_poll_at = ?,
           status = 'active',
           deleted_at = NULL,
           updated_at = ?
         WHERE id = ?`,
        [
          prepared.workId ?? null,
          prepared.doi,
          prepared.title,
          prepared.targets ? JSON.stringify(prepared.targets) : null,
          prepared.hintVenue ?? null,
          prepared.hintAuthor ?? null,
          now,
          now,
          existing.id,
        ],
      );
      const restored = await this.get(existing.id);
      if (!restored) throw new Error("恢复哨兵任务失败");
      return { id: restored.id, status: "restored", task: restored };
    }

    const id = await this.create(prepared);
    const task = await this.get(id);
    if (!task) throw new Error("创建哨兵任务失败");
    return { id, status: "created", task };
  }

  async get(taskId: string): Promise<SentinelTaskRow | null> {
    const rows = await this.db.query<SentinelTaskRow>(
      `SELECT * FROM sentinel_tasks WHERE id = ? LIMIT 1`,
      [taskId],
    );
    return rows[0] ?? null;
  }

  /** Called when title monitoring discovers the DOI. */
  async setDoi(taskId: string, doi: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE sentinel_tasks SET doi = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [doi, Date.now(), taskId],
    );
    this.assertChanged(changed, new Error(`Sentinel task ${taskId} is missing or removed`));
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
    update: SentinelCheckUpdate,
  ): Promise<void> {
    await this.recordCheckWithEvents(taskId, update);
  }

  async recordCheckWithEvents(taskId: string, update: SentinelCheckUpdate): Promise<string[]> {
    const now = Date.now();
    const eventIds: string[] = [];
    await this.withSavepoint("sentinel_record_check", async () => {
      const writable = await this.db.query<{ id: string }>(
        `SELECT id FROM sentinel_tasks
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL
         LIMIT 1`,
        [taskId],
      );
      if (!writable[0]) throw new SentinelTaskInactiveError(taskId);

      for (const event of update.events ?? []) {
        const eventId = newId();
        eventIds.push(eventId);
        await this.db.run(
          `INSERT INTO sentinel_events (id, task_id, from_state, to_state, evidence_json, detected_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            eventId,
            taskId,
            event.fromState,
            event.toState,
            event.evidence ? JSON.stringify(event.evidence) : null,
            now,
          ],
        );
      }

      const changed = await this.db.run(
        `UPDATE sentinel_tasks SET
           doi = COALESCE(?, doi),
           current_state = COALESCE(?, current_state),
           last_polled_at = ?,
           next_poll_at = ?,
           poll_interval_s = ?,
           error_count = CASE WHEN ? THEN error_count + 1 ELSE 0 END,
           last_error = CASE WHEN ? THEN ? ELSE NULL END,
           status = CASE WHEN ? THEN 'done' ELSE status END,
           updated_at = ?
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
        [
          update.doi ?? null,
          update.newState ?? null,
          now,
          now + update.nextPollS * 1000,
          update.nextPollS,
          update.errored ? 1 : 0,
          update.errored ? 1 : 0,
          update.error ? summarizePersistedError(update.error) : null,
          update.done ? 1 : 0,
          now,
          taskId,
        ],
      );
      this.assertChanged(changed, new SentinelTaskInactiveError(taskId));
    });
    return eventIds;
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
      `SELECT e.*
       FROM sentinel_events e
       JOIN sentinel_tasks t ON t.id = e.task_id
       WHERE e.notified_at IS NULL AND t.deleted_at IS NULL
       ORDER BY e.detected_at`,
    );
  }

  async markNotified(eventId: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE sentinel_events SET notified_at = ? WHERE id = ? AND notified_at IS NULL`,
      [Date.now(), eventId],
    );
    this.assertChanged(changed, new Error(`Sentinel event ${eventId} is missing or already notified`));
  }

  async setStatus(taskId: string, status: "active" | "paused" | "done"): Promise<void> {
    const changed = await this.db.run(
      `UPDATE sentinel_tasks SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [status, Date.now(), taskId],
    );
    this.assertChanged(changed, new Error(`Sentinel task ${taskId} is missing or removed`));
  }

  async linkWork(taskId: string, workId: string): Promise<void> {
    await this.assertActiveWork(workId);
    const changed = await this.db.run(
      `UPDATE sentinel_tasks SET work_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [workId, Date.now(), taskId],
    );
    this.assertChanged(changed, new Error(`Sentinel task ${taskId} is missing or removed`));
  }

  async softDelete(taskId: string): Promise<void> {
    const now = Date.now();
    const changed = await this.db.run(
      `UPDATE sentinel_tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, taskId],
    );
    this.assertChanged(changed, new Error(`Sentinel task ${taskId} is missing or already removed`));
  }

  async restore(taskId: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE sentinel_tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
      [Date.now(), taskId],
    );
    this.assertChanged(changed, new Error(`Sentinel task ${taskId} is missing or already active`));
  }

  private async findMatchingTask(input: PreparedSentinelCreateInput): Promise<SentinelTaskRow | null> {
    if (input.doi) {
      const rows = await this.db.query<SentinelTaskRow>(
        `SELECT * FROM sentinel_tasks
         WHERE doi = ?
         ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, created_at DESC
         LIMIT 1`,
        [input.doi],
      );
      return rows[0] ?? null;
    }

    const targetTitle = normalizeSentinelTitle(input.title);
    const rows = await this.db.query<SentinelTaskRow>(
      `SELECT * FROM sentinel_tasks WHERE doi IS NULL`,
    );
    return (
      rows
        .filter((task) => normalizeSentinelTitle(task.title) === targetTitle)
        .sort(
          (a, b) =>
            Number(a.deleted_at !== null) - Number(b.deleted_at !== null) ||
            b.created_at - a.created_at,
        )[0] ?? null
    );
  }
}

interface PreparedSentinelCreateInput {
  doi: string | null;
  title: string;
  workId?: string;
  targets?: string[];
  hintVenue?: string;
  hintAuthor?: string;
}

function prepareCreateInput(input: SentinelCreateInput): PreparedSentinelCreateInput {
  const doi = input.doi ? normalizeDoi(input.doi) ?? input.doi.trim().toLowerCase() : null;
  return {
    doi,
    title: input.title.trim(),
    workId: input.workId,
    targets: input.targets,
    hintVenue: input.hintVenue?.trim() || undefined,
    hintAuthor: input.hintAuthor?.trim() || undefined,
  };
}

function normalizeSentinelTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
