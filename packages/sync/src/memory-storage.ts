// In-memory SyncStorage — reference semantics for driver implementations
// and the engine test harness.
import type { ChangeEntry } from "./types.js";
import type { ConflictRecord, MarkPushedOptions, SyncStorage } from "./engine.js";

interface Row {
  values: Record<string, unknown>;
  clocks: Record<string, string>;
  deleted?: boolean;
}

interface Snapshot {
  conflicts: ConflictRecord[];
  cursors: Map<string, number>;
  log: ChangeEntry[];
  nextSeq: number;
  pushedSeq: number;
  rows: Map<string, Row>;
}

export class MemorySyncStorage implements SyncStorage {
  readonly rows = new Map<string, Row>(); // key: table/rowId
  readonly log: ChangeEntry[] = [];
  readonly conflicts: ConflictRecord[] = [];
  private cursors = new Map<string, number>();
  private pushedSeq = 0;
  private nextSeq = 1;

  constructor(private readonly deviceId: string) {}

  /** Local write: records data + change-log entry (what the app's repos do). */
  write(table: string, rowId: string, values: Record<string, unknown>, hlc: string): void {
    const key = `${table}/${rowId}`;
    const row = this.rows.get(key) ?? { values: {}, clocks: {} };
    const columnHlcs: Record<string, string> = {};
    for (const [col, value] of Object.entries(values)) {
      row.values[col] = value;
      row.clocks[col] = hlc;
      columnHlcs[col] = hlc;
    }
    row.deleted = false;
    this.rows.set(key, row);
    this.log.push({
      seq: this.nextSeq++,
      table,
      rowId,
      op: "upsert",
      values,
      columnHlcs,
      hlc,
      deviceId: this.deviceId,
    });
  }

  deleteRow(table: string, rowId: string, hlc: string): void {
    const key = `${table}/${rowId}`;
    const row = this.rows.get(key) ?? { values: {}, clocks: {} };
    row.deleted = true;
    row.clocks["deleted_at"] = hlc;
    this.rows.set(key, row);
    this.log.push({
      seq: this.nextSeq++,
      table,
      rowId,
      op: "delete",
      values: {},
      columnHlcs: {},
      hlc,
      deviceId: this.deviceId,
    });
  }

  get(table: string, rowId: string): Record<string, unknown> | null {
    const row = this.rows.get(`${table}/${rowId}`);
    return row && !row.deleted ? row.values : null;
  }

  // --- SyncStorage ---

  async unsyncedChanges(afterSeq: number): Promise<ChangeEntry[]> {
    return this.log.filter((e) => e.seq > afterSeq);
  }
  async markPushed(uptoSeq: number, _options: MarkPushedOptions = {}): Promise<void> {
    this.pushedSeq = Math.max(this.pushedSeq, uptoSeq);
  }
  async lastPushedSeq(): Promise<number> {
    return this.pushedSeq;
  }
  async rowClocks(table: string, rowId: string): Promise<Record<string, string> | null> {
    const row = this.rows.get(`${table}/${rowId}`);
    return row ? row.clocks : null;
  }
  async rowDeleted(table: string, rowId: string): Promise<boolean> {
    return Boolean(this.rows.get(`${table}/${rowId}`)?.deleted);
  }
  async applyUpsert(
    table: string,
    rowId: string,
    values: Record<string, unknown>,
    columnHlcs: Record<string, string>,
  ): Promise<void> {
    const key = `${table}/${rowId}`;
    const row = this.rows.get(key) ?? { values: {}, clocks: {}, deleted: false };
    Object.assign(row.values, values);
    Object.assign(row.clocks, columnHlcs);
    if (Object.prototype.hasOwnProperty.call(values, "deleted_at")) {
      row.deleted = values["deleted_at"] != null;
    }
    this.rows.set(key, row);
  }
  async applyDelete(table: string, rowId: string, hlc: string): Promise<void> {
    const key = `${table}/${rowId}`;
    const row = this.rows.get(key) ?? { values: {}, clocks: {} };
    row.deleted = true;
    row.clocks["deleted_at"] = hlc;
    this.rows.set(key, row);
  }
  async getCursor(deviceId: string): Promise<number> {
    return this.cursors.get(deviceId) ?? 0;
  }
  async setCursor(deviceId: string, seq: number): Promise<void> {
    this.cursors.set(deviceId, seq);
  }
  async recordConflict(conflict: ConflictRecord): Promise<void> {
    this.conflicts.push(conflict);
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const snapshot = this.snapshot();
    try {
      return await fn();
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): Snapshot {
    return {
      conflicts: this.conflicts.map((conflict) => ({ ...conflict })),
      cursors: new Map(this.cursors),
      log: this.log.map((entry) => ({
        ...entry,
        columnHlcs: { ...entry.columnHlcs },
        values: { ...entry.values },
      })),
      nextSeq: this.nextSeq,
      pushedSeq: this.pushedSeq,
      rows: new Map(
        [...this.rows.entries()].map(([key, row]) => [
          key,
          {
            clocks: { ...row.clocks },
            deleted: row.deleted,
            values: { ...row.values },
          },
        ]),
      ),
    };
  }

  private restore(snapshot: Snapshot): void {
    this.conflicts.splice(0, this.conflicts.length, ...snapshot.conflicts);
    this.log.splice(0, this.log.length, ...snapshot.log);
    this.rows.clear();
    for (const [key, row] of snapshot.rows) this.rows.set(key, row);
    this.cursors = new Map(snapshot.cursors);
    this.nextSeq = snapshot.nextSeq;
    this.pushedSeq = snapshot.pushedSeq;
  }
}
