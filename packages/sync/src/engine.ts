// Sync engine: push local unsynced changes as journal segments, pull other
// devices' segments, merge with per-field LWW. Storage access goes through a
// small adapter interface so the engine is testable without a real database.
import type { SyncProvider } from "./provider";
import { HlcClock, hlcCompare, hlcFromString } from "./hlc";
import {
  decodeSegment,
  encodeSegment,
  parseSegmentPath,
  segmentPath,
  type ChangeEntry,
} from "./types";

/** What the engine needs from the local database. */
export interface SyncStorage {
  /** Local changes with seq > afterSeq, in seq order. */
  unsyncedChanges(afterSeq: number): Promise<ChangeEntry[]>;
  /** Marks local changes up to seq as pushed. */
  markPushed(uptoSeq: number): Promise<void>;
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

    for (let i = 0; i < changes.length; i += MAX_SEGMENT_ENTRIES) {
      const batch = changes.slice(i, i + MAX_SEGMENT_ENTRIES);
      const startSeq = batch[0]!.seq;
      const endSeq = batch[batch.length - 1]!.seq;
      await this.provider.put(
        segmentPath(this.deviceId, startSeq, endSeq),
        encodeSegment({ deviceId: this.deviceId, startSeq, endSeq, entries: batch }),
      );
      await this.storage.markPushed(endSeq);
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
      const cursor = await this.storage.getCursor(deviceId);
      const fresh = segments
        .filter((s) => s.endSeq > cursor)
        .sort((a, b) => a.startSeq - b.startSeq);

      for (const seg of fresh) {
        const entries = decodeSegment(await this.provider.get(seg.path));
        for (const entry of entries) {
          if (entry.seq <= cursor) continue;
          pulledEntries++;
          const result = await this.applyEntry(entry);
          appliedEntries += result.applied ? 1 : 0;
          conflicts += result.conflicts;
        }
        await this.storage.setCursor(deviceId, seg.endSeq);
      }
    }

    return { pulledEntries, appliedEntries, conflicts };
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
}
