// Sync engine: push local unsynced changes as journal segments, pull other
// devices' segments, merge with per-field LWW. Storage access goes through a
// small adapter interface so the engine is testable without a real database.
import { describeSafeError } from "@aurascholar/platform";
import type { SyncProvider } from "./provider.js";
import { HlcClock, hlcCompare, hlcFromString } from "./hlc.js";
import {
  decodeSegment,
  encodeSegment,
  parseSegmentPath,
  segmentPath,
  type ChangeEntry,
} from "./types.js";

/** What the engine needs from the local database. */
export interface SyncStorage {
  /** Local changes with seq > afterSeq, in seq order. */
  unsyncedChanges(afterSeq: number): Promise<ChangeEntry[]>;
  /** Marks local changes up to seq as pushed. */
  markPushed(uptoSeq: number, options?: MarkPushedOptions): Promise<void>;
  /** Current row's column HLC stamps, or null if the row is unknown. */
  rowClocks(table: string, rowId: string): Promise<Record<string, string> | null>;
  /** Applies winning column values (upsert semantics). */
  applyUpsert(
    table: string,
    rowId: string,
    values: Record<string, unknown>,
    columnHlcs: Record<string, string>,
  ): Promise<void>;
  applyDelete(table: string, rowId: string, hlc: string): Promise<void>;
  /** Per-remote-device cursor: highest seq already merged. */
  getCursor(deviceId: string): Promise<number>;
  setCursor(deviceId: string, seq: number): Promise<void>;
  /** Records a losing concurrent write so the user can inspect it. */
  recordConflict(conflict: ConflictRecord): Promise<void>;
  /** Last pushed local seq. */
  lastPushedSeq(): Promise<number>;
  /** Optional tombstone check for storages that support soft deletes. */
  rowDeleted?(table: string, rowId: string): Promise<boolean> | boolean;
  /** Optional compatibility guard for storage adapters that only sync known tables. */
  supportsTable?(table: string): Promise<boolean> | boolean;
  /** Optional compatibility guard for storage adapters that only sync known columns. */
  supportsColumn?(table: string, column: string): Promise<boolean> | boolean;
  /** Optional transaction wrapper for applying a remote journal segment atomically. */
  withTransaction?<T>(fn: () => Promise<T>): Promise<T>;
}

export interface MarkPushedOptions {
  /** True when this is the last uploaded segment from the current local snapshot. */
  complete?: boolean;
}

export interface ConflictRecord {
  table: string;
  rowId: string;
  column: string;
  losingValue: unknown;
  losingHlc: string;
  winningHlc: string;
}

export interface SyncResult {
  pushedEntries: number;
  pulledEntries: number;
  appliedEntries: number;
  conflicts: number;
}

const MAX_SEGMENT_ENTRIES = 500;

export class SyncEngine {
  constructor(
    private readonly provider: SyncProvider,
    private readonly storage: SyncStorage,
    private readonly deviceId: string,
    private readonly clock: HlcClock,
  ) {}

  async sync(): Promise<SyncResult> {
    const pulled = await this.pull();
    const pushed = await this.push();
    return { ...pulled, pushedEntries: pushed };
  }

  /** Uploads local unsynced changes as one or more journal segments. */
  async push(): Promise<number> {
    const after = await this.storage.lastPushedSeq();
    const changes = await this.storage.unsyncedChanges(after);
    if (changes.length === 0) return 0;
    assertValidSegmentEntries(
      `local changes for ${this.deviceId}`,
      this.deviceId,
      after + 1,
      changes[changes.length - 1]!.seq,
      changes,
    );

    for (let i = 0; i < changes.length; i += MAX_SEGMENT_ENTRIES) {
      const batch = changes.slice(i, i + MAX_SEGMENT_ENTRIES);
      const startSeq = batch[0]!.seq;
      const endSeq = batch[batch.length - 1]!.seq;
      await this.provider.put(
        segmentPath(this.deviceId, startSeq, endSeq),
        encodeSegment({ deviceId: this.deviceId, startSeq, endSeq, entries: batch }),
      );
      await this.storage.markPushed(endSeq, {
        complete: i + MAX_SEGMENT_ENTRIES >= changes.length,
      });
    }
    return changes.length;
  }

  /** Downloads and merges other devices' new journal segments. */
  async pull(): Promise<Omit<SyncResult, "pushedEntries">> {
    const objects = await this.provider.list("journal/");
    let pulledEntries = 0;
    let appliedEntries = 0;
    let conflicts = 0;

    // Group remote segments by device, skip our own.
    const byDevice = new Map<string, Array<{ path: string; startSeq: number; endSeq: number }>>();
    for (const obj of objects) {
      const parsed = parseSegmentPath(obj.path);
      if (!parsed || parsed.deviceId === this.deviceId) continue;
      const list = byDevice.get(parsed.deviceId) ?? [];
      list.push({ path: obj.path, ...parsed });
      byDevice.set(parsed.deviceId, list);
    }

    for (const [deviceId, segments] of byDevice) {
      let cursor = await this.storage.getCursor(deviceId);
      const fresh = segments
        .filter((s) => s.endSeq > cursor)
        .sort((a, b) => a.startSeq - b.startSeq);

      for (const seg of fresh) {
        if (seg.endSeq <= cursor) continue;
        if (seg.startSeq > cursor + 1) {
          throw new Error(
            `Invalid sync segment gap before ${seg.path}: expected sequence ${cursor + 1}, got ${seg.startSeq}`,
          );
        }
        const entries = decodeSegmentOrThrow(seg.path, await this.provider.get(seg.path));
        assertValidSegmentEntries(seg.path, deviceId, seg.startSeq, seg.endSeq, entries);
        await this.assertSupportedSegmentShape(seg.path, entries);
        const result = await this.withTransaction(async () => {
          let segmentPulled = 0;
          let segmentApplied = 0;
          let segmentConflicts = 0;
          for (const entry of entries) {
            if (entry.seq <= cursor) continue;
            segmentPulled++;
            const entryResult = await this.applyEntry(entry);
            segmentApplied += entryResult.applied ? 1 : 0;
            segmentConflicts += entryResult.conflicts;
          }
          await this.storage.setCursor(deviceId, Math.max(cursor, seg.endSeq));
          return {
            appliedEntries: segmentApplied,
            conflicts: segmentConflicts,
            pulledEntries: segmentPulled,
          };
        });
        pulledEntries += result.pulledEntries;
        appliedEntries += result.appliedEntries;
        conflicts += result.conflicts;
        cursor = Math.max(cursor, seg.endSeq);
      }
    }

    return { pulledEntries, appliedEntries, conflicts };
  }

  private async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.storage.withTransaction ? this.storage.withTransaction(fn) : fn();
  }

  private async assertSupportedSegmentShape(path: string, entries: ChangeEntry[]): Promise<void> {
    if (!this.storage.supportsTable && !this.storage.supportsColumn) return;
    const checked = new Map<string, boolean>();
    const checkedColumns = new Map<string, boolean>();
    for (const entry of entries) {
      if (this.storage.supportsTable) {
        let supported = checked.get(entry.table);
        if (supported === undefined) {
          supported = await this.storage.supportsTable(entry.table);
          checked.set(entry.table, supported);
        }
        if (!supported) {
          throw new Error(
            `Unsupported sync table "${entry.table}" in ${path}; update AuraScholar before syncing this library`,
          );
        }
      }

      if (!this.storage.supportsColumn) continue;
      const columns = new Set([...Object.keys(entry.values), ...Object.keys(entry.columnHlcs)]);
      for (const column of columns) {
        const key = `${entry.table}.${column}`;
        let supported = checkedColumns.get(key);
        if (supported === undefined) {
          supported = await this.storage.supportsColumn(entry.table, column);
          checkedColumns.set(key, supported);
        }
        if (!supported) {
          throw new Error(
            `Unsupported sync column "${entry.table}.${column}" in ${path}; update AuraScholar before syncing this library`,
          );
        }
      }
    }
  }

  /** Field-level LWW merge of one remote entry. */
  private async applyEntry(entry: ChangeEntry): Promise<{ applied: boolean; conflicts: number }> {
    this.clock.observe(entry.hlc);

    if (entry.op === "delete") {
      // Delete wins unless ANY local column write is newer than the delete.
      const local = await this.storage.rowClocks(entry.table, entry.rowId);
      if (local) {
        const newestLocal = Object.values(local).sort().pop() ?? "";
        if (hlcCompare(newestLocal, entry.hlc) > 0) {
          return { applied: false, conflicts: 0 }; // local edits resurrect the row
        }
      }
      await this.storage.applyDelete(entry.table, entry.rowId, entry.hlc);
      return { applied: true, conflicts: 0 };
    }

    const local = await this.storage.rowClocks(entry.table, entry.rowId);
    if (!local) {
      // New row — take everything.
      await this.storage.applyUpsert(entry.table, entry.rowId, entry.values, entry.columnHlcs);
      return { applied: true, conflicts: 0 };
    }
    if (await this.localDeleteWins(entry, local)) {
      return { applied: false, conflicts: 0 };
    }

    // Column-by-column LWW: remote wins where its HLC is greater. We record a
    // conflict only when an incoming value LOSES to a different device's local
    // value — that's the case where data would otherwise vanish silently.
    // (When remote wins, the superseded value is preserved in the local change
    // log; same-device supersession is just ordered history, not a conflict.)
    const winningValues: Record<string, unknown> = {};
    const winningHlcs: Record<string, string> = {};
    let conflicts = 0;

    for (const [col, value] of Object.entries(entry.values)) {
      const remoteHlc = entry.columnHlcs[col] ?? entry.hlc;
      const localHlc = local[col];
      if (!localHlc || hlcCompare(remoteHlc, localHlc) > 0) {
        winningValues[col] = value;
        winningHlcs[col] = remoteHlc;
      } else if (
        hlcCompare(remoteHlc, localHlc) < 0 &&
        hlcFromString(remoteHlc).deviceId !== hlcFromString(localHlc).deviceId
      ) {
        conflicts++;
        await this.storage.recordConflict({
          table: entry.table,
          rowId: entry.rowId,
          column: col,
          losingValue: value,
          losingHlc: remoteHlc,
          winningHlc: localHlc,
        });
      }
    }

    if (Object.keys(winningValues).length > 0) {
      await this.storage.applyUpsert(entry.table, entry.rowId, winningValues, winningHlcs);
      return { applied: true, conflicts };
    }
    return { applied: false, conflicts };
  }

  private async localDeleteWins(
    entry: ChangeEntry,
    local: Record<string, string>,
  ): Promise<boolean> {
    if (!this.storage.rowDeleted || !(await this.storage.rowDeleted(entry.table, entry.rowId))) {
      return false;
    }
    const localDeleteHlc = local["deleted_at"];
    if (!localDeleteHlc) return false;
    const remoteDeleteHlc = Object.prototype.hasOwnProperty.call(entry.values, "deleted_at")
      ? (entry.columnHlcs["deleted_at"] ?? entry.hlc)
      : null;
    return !remoteDeleteHlc || hlcCompare(remoteDeleteHlc, localDeleteHlc) <= 0;
  }
}

function decodeSegmentOrThrow(path: string, data: Uint8Array): ChangeEntry[] {
  try {
    return decodeSegment(data);
  } catch (error) {
    const detail = describeSafeError(error);
    throw new Error(`Invalid sync segment ${path}: unreadable JSON (${detail})`, { cause: error });
  }
}

function assertValidSegmentEntries(
  path: string,
  deviceId: string,
  startSeq: number,
  endSeq: number,
  entries: ChangeEntry[],
): void {
  if (
    !Number.isSafeInteger(startSeq) ||
    !Number.isSafeInteger(endSeq) ||
    startSeq < 1 ||
    endSeq < 1 ||
    startSeq > endSeq
  ) {
    throw new Error(`Invalid sync segment ${path}: bad sequence range`);
  }
  if (entries.length === 0) {
    throw new Error(`Invalid sync segment ${path}: empty segment`);
  }

  let previousSeq = startSeq - 1;
  for (const entry of entries) {
    assertValidSegmentEntry(path, deviceId, startSeq, endSeq, previousSeq, entry);
    previousSeq = entry.seq;
  }

  if (entries[0]!.seq !== startSeq || entries[entries.length - 1]!.seq !== endSeq) {
    throw new Error(`Invalid sync segment ${path}: sequence range does not match entries`);
  }
}

function assertValidSegmentEntry(
  path: string,
  deviceId: string,
  startSeq: number,
  endSeq: number,
  previousSeq: number,
  entry: ChangeEntry,
): void {
  if (!isRecord(entry)) throw new Error(`Invalid sync segment ${path}: malformed entry`);
  if (entry.deviceId !== deviceId) {
    throw new Error(
      `Invalid sync segment ${path}: entry ${entry.seq} belongs to ${entry.deviceId}, not ${deviceId}`,
    );
  }
  if (
    !Number.isSafeInteger(entry.seq) ||
    entry.seq < startSeq ||
    entry.seq > endSeq ||
    entry.seq !== previousSeq + 1
  ) {
    throw new Error(`Invalid sync segment ${path}: non-contiguous entry sequence`);
  }
  if (entry.op !== "upsert" && entry.op !== "delete") {
    throw new Error(`Invalid sync segment ${path}: unsupported operation`);
  }
  if (!entry.table || typeof entry.table !== "string") {
    throw new Error(`Invalid sync segment ${path}: missing table`);
  }
  if (!entry.rowId || typeof entry.rowId !== "string") {
    throw new Error(`Invalid sync segment ${path}: missing row id`);
  }
  if (!isHlcString(entry.hlc)) {
    throw new Error(`Invalid sync segment ${path}: malformed HLC`);
  }
  if (!isRecord(entry.values) || !isStringRecord(entry.columnHlcs)) {
    throw new Error(`Invalid sync segment ${path}: malformed values`);
  }
  if (!Object.values(entry.columnHlcs).every(isHlcString)) {
    throw new Error(`Invalid sync segment ${path}: malformed column HLC`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isHlcString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{15})-(\d{6})-(.+)$/);
  return Boolean(match && Number.isSafeInteger(Number(match[1])) && match[3]);
}
