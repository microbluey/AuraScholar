// Saved searches ("检索订阅"): a stored open-source aggregate query the app
// re-runs on a schedule to surface newly-published matches. The discovery
// analogue of the sentinel — see migration v11.
import type { Database } from "../database.js";
import { summarizePersistedError } from "../error-summary.js";
import { newId } from "../ids.js";

export interface SavedSearchRow {
  id: string;
  query: string;
  sources_json: string | null;
  seen_ids_json: string;
  new_count: number;
  last_run_at: number | null;
  next_run_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface SavedSearchInput {
  query: string;
  /** Discovery source ids to query; null = all sources. */
  sources?: string[] | null;
}

export class SavedSearchInactiveError extends Error {
  constructor(readonly id: string) {
    super(`Saved search ${id} is missing or removed`);
    this.name = "SavedSearchInactiveError";
  }
}

export class SavedSearchesRepo {
  constructor(private readonly db: Database) {}

  private assertChanged(changed: number, error: Error): void {
    if (changed === 0) throw error;
  }

  async create(input: SavedSearchInput): Promise<string> {
    const id = newId();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO saved_searches
         (id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, '[]', 0, NULL, ?, ?, ?)`,
      [id, input.query, input.sources ? JSON.stringify(input.sources) : null, now, now, now],
    );
    return id;
  }

  async list(): Promise<SavedSearchRow[]> {
    return this.db.query<SavedSearchRow>(
      `SELECT id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, last_error,
              created_at, updated_at
       FROM saved_searches WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
  }

  /** Searches whose next_run_at has come due (or was never scheduled). */
  async due(now = Date.now()): Promise<SavedSearchRow[]> {
    return this.db.query<SavedSearchRow>(
      `SELECT id, query, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, last_error,
              created_at, updated_at
       FROM saved_searches
       WHERE deleted_at IS NULL AND (next_run_at IS NULL OR next_run_at <= ?)
       ORDER BY created_at`,
      [now],
    );
  }

  /**
   * Record the outcome of a run: the full set of seen ids becomes the new
   * baseline, new_count accumulates unseen hits, and the next run is scheduled.
   */
  async recordRun(
    id: string,
    seenIds: string[],
    newCount: number,
    nextRunAt: number,
  ): Promise<void> {
    const now = Date.now();
    const changed = await this.db.run(
      `UPDATE saved_searches
       SET seen_ids_json = ?, new_count = new_count + ?, last_run_at = ?, next_run_at = ?,
           last_error = NULL, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [JSON.stringify(seenIds), newCount, now, nextRunAt, now, id],
    );
    this.assertChanged(changed, new SavedSearchInactiveError(id));
  }

  async recordError(id: string, error: string, nextRunAt: number): Promise<void> {
    const now = Date.now();
    const changed = await this.db.run(
      `UPDATE saved_searches
       SET last_run_at = ?, next_run_at = ?, last_error = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [now, nextRunAt, summarizePersistedError(error), now, id],
    );
    this.assertChanged(changed, new SavedSearchInactiveError(id));
  }

  /** Clear the unread badge (user has viewed the new results). */
  async clearNew(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE saved_searches SET new_count = 0, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [Date.now(), id],
    );
    this.assertChanged(changed, new SavedSearchInactiveError(id));
  }

  async softDelete(id: string): Promise<void> {
    const now = Date.now();
    const changed = await this.db.run(
      `UPDATE saved_searches SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    this.assertChanged(changed, new Error(`Saved search ${id} is missing or already removed`));
  }

  async restore(id: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE saved_searches SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
      [Date.now(), id],
    );
    this.assertChanged(changed, new Error(`Saved search ${id} is missing or already active`));
  }
}
