// In-memory SyncStorage — reference semantics for driver implementations
// and the engine test harness.
import type { ChangeEntry } from "./types";
import type { ConflictRecord, SyncStorage } from "./engine";

interface Row {
  values: Record<string, unknown>;
  clocks: Record<string, string>;
  deleted?: boolean;
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
    const row = this.rows.get(key);
    if (row) row.deleted = true;
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
  async markPushed(uptoSeq: number): Promise<void> {
    this.pushedSeq = Math.max(this.pushedSeq, uptoSeq);
  }
  async lastPushedSeq(): Promise<number> {
    return this.pushedSeq;
  }
  async rowClocks(table: string, rowId: string): Promise<Record<string, string> | null> {
    const row = this.rows.get(`${table}/${rowId}`);
    return row && !row.deleted ? row.clocks : null;
  }
  async applyUpsert(
    table: string,
    rowId: string,
    values: Record<string, unknown>,
    columnHlcs: Record<string, string>,
  ): Promise<void> {
    const key = `${table}/${rowId}`;
    const row = this.rows.get(key) ?? { values: {}, clocks: {} };
    Object.assign(row.values, values);
    Object.assign(row.clocks, columnHlcs);
    row.deleted = false;
    this.rows.set(key, row);
  }
  async applyDelete(table: string, rowId: string): Promise<void> {
    const row = this.rows.get(`${table}/${rowId}`);
    if (row) row.deleted = true;
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
}
