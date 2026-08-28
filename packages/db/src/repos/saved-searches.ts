// Saved searches ("检索订阅"): a stored open-source aggregate query the app
// re-runs on a schedule to surface newly-published matches. The discovery
// analogue of the sentinel — see migration v11.
import type { Database } from "../database.js";
import { summarizePersistedError } from "../error-summary.js";
import { newId } from "../ids.js";
import { withDatabaseWriteLock } from "./write-lock.js";

/** Keep a complete legal polling batch while bounding durable deduplication state. */
export const MAX_SAVED_SEARCH_SEEN_IDS = 2_000;
export const MAX_SAVED_SEARCH_SEEN_IDS_BYTES = 256 * 1024;

const utf8Encoder = new TextEncoder();

export interface SavedSearchRow {
  id: string;
  library_id: string;
  query: string;
  criteria_json: string | null;
  sources_json: string | null;
  seen_ids_json: string;
  new_count: number;
  last_run_at: number | null;
  next_run_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SavedSearchInput {
  query: string;
  /** Canonical structured discovery query; null preserves legacy text-only behavior. */
  criteriaJson?: string | null;
  /** Discovery source ids to query; null = all sources. */
  sources?: string[] | null;
}

export interface SavedSearchRunCommitInput {
  expectedUpdatedAt: number;
  observedIds: string[];
  nextRunAt: number;
}

export interface SavedSearchRunCommitResult {
  committed: boolean;
  freshCount: number;
  updatedAt: number | null;
}

export interface SavedSearchErrorCommitInput {
  expectedUpdatedAt: number;
  error: string;
  nextRunAt: number;
}

export interface SavedSearchCommitResult {
  committed: boolean;
  updatedAt: number | null;
}

export class SavedSearchInactiveError extends Error {
  constructor(readonly id: string) {
    super(`Saved search ${id} is missing or removed`);
    this.name = "SavedSearchInactiveError";
  }
}

export class SavedSearchesRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    if (!libraryId.trim()) throw new Error("libraryId must be a non-empty string");
  }

  private assertChanged(changed: number, error: Error): void {
    if (changed === 0) throw error;
  }

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    return withDatabaseWriteLock(this.db, fn);
  }

  async create(input: SavedSearchInput): Promise<string> {
    return this.withWriteLock(async () => {
      const id = newId();
      const now = Date.now();
      await this.db.run(
        `INSERT INTO saved_searches
           (id, library_id, query, criteria_json, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '[]', 0, NULL, ?, ?, ?)`,
        [
          id,
          this.libraryId,
          input.query,
          input.criteriaJson ?? null,
          input.sources ? JSON.stringify(input.sources) : null,
          now,
          now,
          now,
        ],
      );
      return id;
    });
  }

  async get(id: string): Promise<SavedSearchRow | null> {
    const rows = await this.db.query<SavedSearchRow>(
      `SELECT id, library_id, query, criteria_json, sources_json, seen_ids_json, new_count, last_run_at, next_run_at,
              last_error, created_at, updated_at, deleted_at
       FROM saved_searches
       WHERE id = ? AND library_id = ?
       LIMIT 1`,
      [id, this.libraryId],
    );
    return rows[0] ?? null;
  }

  async list(): Promise<SavedSearchRow[]> {
    return this.db.query<SavedSearchRow>(
      `SELECT id, library_id, query, criteria_json, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, last_error,
              created_at, updated_at, deleted_at
       FROM saved_searches
       WHERE library_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [this.libraryId],
    );
  }

  /** Searches whose next_run_at has come due (or was never scheduled). */
  async due(now = Date.now()): Promise<SavedSearchRow[]> {
    return this.db.query<SavedSearchRow>(
      `SELECT id, library_id, query, criteria_json, sources_json, seen_ids_json, new_count, last_run_at, next_run_at, last_error,
              created_at, updated_at, deleted_at
       FROM saved_searches
       WHERE library_id = ?
         AND deleted_at IS NULL
         AND (next_run_at IS NULL OR next_run_at <= ?)
       ORDER BY created_at`,
      [this.libraryId, now],
    );
  }

  /**
   * Record a run with a bounded recent-observation baseline. This legacy
   * convenience method does not compute a delta; conditional polling does.
   */
  async recordRun(
    id: string,
    seenIds: string[],
    newCount: number,
    nextRunAt: number,
  ): Promise<void> {
    await this.withWriteLock(async () => {
      const now = Date.now();
      const changed = await this.db.run(
        `UPDATE saved_searches
         SET seen_ids_json = ?, new_count = new_count + ?, last_run_at = ?, next_run_at = ?,
             last_error = NULL, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
        [
          JSON.stringify(retainRecentSeenIds([], seenIds)),
          newCount,
          now,
          nextRunAt,
          now,
          id,
          this.libraryId,
        ],
      );
      this.assertChanged(changed, new SavedSearchInactiveError(id));
    });
  }

  /**
   * Commit observed result ids only while the row still matches the snapshot
   * that initiated the remote request. The baseline merge and unread delta are
   * derived inside the same serialized commit so callers cannot overwrite
   * newer polling, badge, delete, or restore state with a stale response. The
   * desktop command owns the surrounding SQLite transaction.
   */
  async commitRunIfCurrent(
    id: string,
    input: SavedSearchRunCommitInput,
  ): Promise<SavedSearchRunCommitResult> {
    return this.withWriteLock(async () => {
      const rows = await this.db.query<
        Pick<SavedSearchRow, "last_run_at" | "seen_ids_json" | "updated_at">
      >(
        `SELECT seen_ids_json, last_run_at, updated_at
         FROM saved_searches
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL AND updated_at = ?
         LIMIT 1`,
        [id, this.libraryId, input.expectedUpdatedAt],
      );
      const current = rows[0];
      if (!current) return { committed: false, freshCount: 0, updatedAt: null };

      const baseline = parseSeenIds(current.seen_ids_json);
      const seen = new Set(baseline.ids);
      const observedIds = [...new Set(input.observedIds)];
      const firstRun = baseline.recovered || (seen.size === 0 && current.last_run_at === null);
      const freshCount = firstRun
        ? 0
        : observedIds.reduce((count, observedId) => count + (seen.has(observedId) ? 0 : 1), 0);
      const nextSeenIds = retainRecentSeenIds(baseline.ids, observedIds);
      const now = Date.now();
      const updatedAt = Math.max(current.updated_at + 1, now);
      const changed = await this.db.run(
        `UPDATE saved_searches
         SET seen_ids_json = ?, new_count = new_count + ?, last_run_at = ?, next_run_at = ?,
             last_error = NULL, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL AND updated_at = ?`,
        [
          JSON.stringify(nextSeenIds),
          freshCount,
          now,
          input.nextRunAt,
          now,
          id,
          this.libraryId,
          input.expectedUpdatedAt,
        ],
      );
      if (changed === 0) return { committed: false, freshCount: 0, updatedAt: null };
      return { committed: true, freshCount, updatedAt };
    });
  }

  async recordError(id: string, error: string, nextRunAt: number): Promise<void> {
    await this.withWriteLock(async () => {
      const now = Date.now();
      const changed = await this.db.run(
        `UPDATE saved_searches
         SET next_run_at = ?, last_error = ?,
             updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
        [nextRunAt, summarizePersistedError(error), now, id, this.libraryId],
      );
      this.assertChanged(changed, new SavedSearchInactiveError(id));
    });
  }

  async recordErrorIfCurrent(
    id: string,
    input: SavedSearchErrorCommitInput,
  ): Promise<SavedSearchCommitResult> {
    return this.withWriteLock(async () => {
      const now = Date.now();
      const updatedAt = Math.max(input.expectedUpdatedAt + 1, now);
      const changed = await this.db.run(
        `UPDATE saved_searches
         SET next_run_at = ?, last_error = ?,
             updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL AND updated_at = ?`,
        [
          input.nextRunAt,
          summarizePersistedError(input.error),
          now,
          id,
          this.libraryId,
          input.expectedUpdatedAt,
        ],
      );
      return changed > 0 ? { committed: true, updatedAt } : { committed: false, updatedAt: null };
    });
  }

  /** Clear the unread badge (user has viewed the new results). */
  async clearNew(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const changed = await this.db.run(
        `UPDATE saved_searches
         SET new_count = 0, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
        [Date.now(), id, this.libraryId],
      );
      this.assertChanged(changed, new SavedSearchInactiveError(id));
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const now = Date.now();
      const changed = await this.db.run(
        `UPDATE saved_searches
         SET deleted_at = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
        [now, now, id, this.libraryId],
      );
      this.assertChanged(changed, new Error(`Saved search ${id} is missing or already removed`));
    });
  }

  async restore(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const changed = await this.db.run(
        `UPDATE saved_searches
         SET deleted_at = NULL, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ? AND library_id = ? AND deleted_at IS NOT NULL`,
        [Date.now(), id, this.libraryId],
      );
      this.assertChanged(changed, new Error(`Saved search ${id} is missing or already active`));
    });
  }
}

function parseSeenIds(value: string): { ids: string[]; recovered: boolean } {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return { ids: [], recovered: true };
    return {
      ids: parsed.filter((item): item is string => typeof item === "string"),
      recovered: false,
    };
  } catch {
    return { ids: [], recovered: true };
  }
}

/**
 * Preserve the most recently observed unique IDs in old-to-new order. Entries
 * observed in this run move to the tail before capacity trimming, so stable
 * results cannot age out merely because they first appeared long ago.
 */
function retainRecentSeenIds(previousIds: string[], observedIds: string[]): string[] {
  const recent = new Set<string>();
  for (const id of [...previousIds, ...observedIds]) {
    recent.delete(id);
    recent.add(id);
  }
  const retained: string[] = [];
  let serializedBytes = 2; // []
  const ids = [...recent];
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (retained.length >= MAX_SAVED_SEARCH_SEEN_IDS) break;
    const id = ids[index]!;
    const entryBytes = utf8Encoder.encode(JSON.stringify(id)).byteLength;
    const nextBytes = serializedBytes + entryBytes + (retained.length === 0 ? 0 : 1);
    if (nextBytes > MAX_SAVED_SEARCH_SEEN_IDS_BYTES) {
      if (retained.length > 0) break;
      continue;
    }
    retained.push(id);
    serializedBytes = nextBytes;
  }
  return retained.reverse();
}
