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

/** Storage operations needed to merge one remote segment. */
export interface RemoteSegmentMergeStorage {
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
  /** Optional tombstone check for storages that support soft deletes. */
  rowDeleted?(table: string, rowId: string): Promise<boolean> | boolean;
  /** Optional compatibility guard for storage adapters that only sync known tables. */
  supportsTable?(table: string): Promise<boolean> | boolean;
  /** Optional compatibility guard for storage adapters that only sync known columns. */
  supportsColumn?(table: string, column: string): Promise<boolean> | boolean;
  /** Optional transaction wrapper for applying a remote journal segment atomically. */
  withTransaction?<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Complete, self-contained command passed across a process boundary to merge
 * one remote journal segment. expectedCursor is a compare-and-swap guard:
 * implementations must reject rather than merge against a different cursor.
 */
export interface ApplyRemoteSegmentCommand {
  path: string;
  deviceId: string;
  startSeq: number;
  endSeq: number;
  expectedCursor: number;
  entries: ChangeEntry[];
}

export interface ApplyRemoteSegmentResult {
  pulledEntries: number;
  appliedEntries: number;
  conflicts: number;
  cursor: number;
}

export interface ApplyRemoteSegmentOptions {
  /** Lets the owner advance its local HLC after accepting remote history. */
  observeHlc?: (hlc: string) => void;
}

/** What the engine needs from the local database. */
export interface SyncStorage extends RemoteSegmentMergeStorage {
  /** Local changes with seq > afterSeq, in seq order. */
  unsyncedChanges(afterSeq: number): Promise<ChangeEntry[]>;
  /** Marks local changes up to seq as pushed. */
  markPushed(uptoSeq: number, options?: MarkPushedOptions): Promise<void>;
  /**
   * Advances the outgoing sequence cursor after the engine verifies that its
   * own journal segments already exist remotely. Unlike markPushed, this must
   * not acknowledge or remove any currently pending local rows: those rows
   * need to be projected again at sequence numbers above uptoSeq.
   */
  recoverPublishedSeq?(uptoSeq: number): Promise<void>;
  /**
   * Optional process-boundary command. Renderer adapters can forward the
   * complete segment in one call to a main-process handler. Implementations
   * must atomically validate and merge the command; handlers should call
   * applyRemoteSegment() with their transaction-owning storage adapter.
   */
  applyRemoteSegment?(command: ApplyRemoteSegmentCommand): Promise<ApplyRemoteSegmentResult>;
  /** Last pushed local seq. */
  lastPushedSeq(): Promise<number>;
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

/**
 * Validates and merges exactly one remote segment, including its cursor
 * compare-and-swap. When storage.withTransaction is available, shape/schema
 * checks, LWW writes, conflict records, and cursor advancement share that one
 * transaction. This is the reference implementation for main-process command
 * handlers as well as the legacy in-process SyncEngine fallback.
 */
export async function applyRemoteSegment(
  storage: RemoteSegmentMergeStorage,
  command: ApplyRemoteSegmentCommand,
  options: ApplyRemoteSegmentOptions = {},
): Promise<ApplyRemoteSegmentResult> {
  const merge = async (): Promise<ApplyRemoteSegmentResult> => {
    assertValidRemoteSegmentCommand(command);
    const currentCursor = await storage.getCursor(command.deviceId);
    if (currentCursor !== command.expectedCursor) {
      throw new Error(
        `Remote sync cursor changed for ${command.deviceId}: expected ${command.expectedCursor}, got ${currentCursor}`,
      );
    }
    if (command.startSeq !== currentCursor + 1) {
      throw new Error(
        `Invalid sync segment ${command.path}: expected sequence ${currentCursor + 1}, got ${command.startSeq}`,
      );
    }

    await assertSupportedSegmentShape(storage, command.path, command.entries);

    let appliedEntries = 0;
    let conflicts = 0;
    for (const entry of command.entries) {
      options.observeHlc?.(entry.hlc);
      const result = await applyRemoteEntry(storage, entry);
      appliedEntries += result.applied ? 1 : 0;
      conflicts += result.conflicts;
    }

    await storage.setCursor(command.deviceId, command.endSeq);
    const advancedCursor = await storage.getCursor(command.deviceId);
    if (advancedCursor !== command.endSeq) {
      throw new Error(
        `Sync storage failed to advance ${command.deviceId} cursor to ${command.endSeq}`,
      );
    }

    return {
      pulledEntries: command.entries.length,
      appliedEntries,
      conflicts,
      cursor: advancedCursor,
    };
  };

  return storage.withTransaction ? storage.withTransaction(merge) : merge();
}

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
    const localCursor = await this.storage.lastPushedSeq();
    const after = await this.recoverPublishedSegments(localCursor);
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

  /**
   * Recovers from a crash after provider.put() succeeded but before
   * markPushed(). Remote bytes are treated as immutable: validate the complete
   * contiguous tail first, then advance the local allocator without cleaning
   * pending local rows.
   */
  private async recoverPublishedSegments(localCursor: number): Promise<number> {
    // List the journal root, not only this device's child path. Scoped
    // providers use the root listing to switch atomically from a legacy
    // journal to a namespaced one. During that bootstrap we must recover this
    // device's legacy tail so the new namespace continues above its sequence
    // range instead of restarting at 1.
    const objects = await this.provider.list("journal/");
    const segments: Array<{ path: string; startSeq: number; endSeq: number }> = [];

    for (const object of objects) {
      const parsed = parseSegmentPath(object.path);
      // Providers may retain interrupted-upload temp files. Only canonical
      // segment paths can collide with paths this engine will publish.
      if (!parsed || parsed.deviceId !== this.deviceId) continue;
      if (parsed.endSeq > localCursor) {
        segments.push({ path: object.path, ...parsed });
      }
    }

    segments.sort((a, b) => a.startSeq - b.startSeq || a.endSeq - b.endSeq);
    if (segments.length === 0) return localCursor;

    let recoveredCursor = localCursor;
    for (const segment of segments) {
      const expectedSeq = recoveredCursor + 1;
      if (segment.startSeq !== expectedSeq) {
        const issue = segment.startSeq > expectedSeq ? "gap" : "overlap";
        throw new Error(
          `Invalid own sync segment ${issue} before ${segment.path}: expected sequence ${expectedSeq}, got ${segment.startSeq}`,
        );
      }

      const entries = decodeSegmentOrThrow(segment.path, await this.provider.get(segment.path));
      assertValidSegmentEntries(
        segment.path,
        this.deviceId,
        segment.startSeq,
        segment.endSeq,
        entries,
      );
      recoveredCursor = segment.endSeq;
    }

    if (!this.storage.recoverPublishedSeq) {
      throw new Error(
        `Sync storage cannot recover already-published segments through sequence ${recoveredCursor}`,
      );
    }
    await this.storage.recoverPublishedSeq(recoveredCursor);

    const advancedCursor = await this.storage.lastPushedSeq();
    if (advancedCursor < recoveredCursor) {
      throw new Error(
        `Sync storage failed to recover already-published sequence ${recoveredCursor}`,
      );
    }
    return advancedCursor;
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
        .sort((a, b) => a.startSeq - b.startSeq || a.endSeq - b.endSeq);
      assertContiguousSegmentRanges(deviceId, cursor, fresh);

      for (const seg of fresh) {
        if (seg.endSeq <= cursor) continue;
        const entries = decodeSegmentOrThrow(seg.path, await this.provider.get(seg.path));
        assertValidSegmentEntries(seg.path, deviceId, seg.startSeq, seg.endSeq, entries);
        // A process-boundary command must not be the renderer's first schema
        // check. Reject incompatible future tables/columns before IPC, while
        // applyRemoteSegment() repeats the same guard inside the transaction
        // owned by the receiving process.
        if (this.storage.applyRemoteSegment) {
          await assertSupportedSegmentShape(this.storage, seg.path, entries);
        }
        const command: ApplyRemoteSegmentCommand = {
          path: seg.path,
          deviceId,
          startSeq: seg.startSeq,
          endSeq: seg.endSeq,
          expectedCursor: cursor,
          entries,
        };
        const result = this.storage.applyRemoteSegment
          ? await this.storage.applyRemoteSegment(command)
          : await applyRemoteSegment(this.storage, command, {
              observeHlc: (hlc) => this.clock.observe(hlc),
            });
        assertValidApplyRemoteSegmentResult(seg.path, command, result);
        if (this.storage.applyRemoteSegment) {
          for (const entry of entries) this.clock.observe(entry.hlc);
        }
        pulledEntries += result.pulledEntries;
        appliedEntries += result.appliedEntries;
        conflicts += result.conflicts;
        cursor = result.cursor;
      }
    }

    return { pulledEntries, appliedEntries, conflicts };
  }
}

async function assertSupportedSegmentShape(
  storage: RemoteSegmentMergeStorage,
  path: string,
  entries: ChangeEntry[],
): Promise<void> {
  if (!storage.supportsTable && !storage.supportsColumn) return;
  const checked = new Map<string, boolean>();
  const checkedColumns = new Map<string, boolean>();
  for (const entry of entries) {
    if (storage.supportsTable) {
      let supported = checked.get(entry.table);
      if (supported === undefined) {
        supported = await storage.supportsTable(entry.table);
        checked.set(entry.table, supported);
      }
      if (!supported) {
        throw new Error(
          `Unsupported sync table "${entry.table}" in ${path}; update AuraScholar before syncing this library`,
        );
      }
    }

    if (!storage.supportsColumn) continue;
    const columns = new Set([...Object.keys(entry.values), ...Object.keys(entry.columnHlcs)]);
    for (const column of columns) {
      const key = `${entry.table}.${column}`;
      let supported = checkedColumns.get(key);
      if (supported === undefined) {
        supported = await storage.supportsColumn(entry.table, column);
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
async function applyRemoteEntry(
  storage: RemoteSegmentMergeStorage,
  entry: ChangeEntry,
): Promise<{ applied: boolean; conflicts: number }> {
  if (entry.op === "delete") {
    // Delete wins unless ANY local column write is newer than the delete.
    const local = await storage.rowClocks(entry.table, entry.rowId);
    if (local) {
      const newestLocal = Object.values(local).sort().pop() ?? "";
      if (hlcCompare(newestLocal, entry.hlc) > 0) {
        return { applied: false, conflicts: 0 }; // local edits resurrect the row
      }
    }
    await storage.applyDelete(entry.table, entry.rowId, entry.hlc);
    return { applied: true, conflicts: 0 };
  }

  const local = await storage.rowClocks(entry.table, entry.rowId);
  if (!local) {
    // New row — take everything.
    await storage.applyUpsert(entry.table, entry.rowId, entry.values, entry.columnHlcs);
    return { applied: true, conflicts: 0 };
  }
  if (await localDeleteWins(storage, entry, local)) {
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
      await storage.recordConflict({
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
    await storage.applyUpsert(entry.table, entry.rowId, winningValues, winningHlcs);
    return { applied: true, conflicts };
  }
  return { applied: false, conflicts };
}

async function localDeleteWins(
  storage: RemoteSegmentMergeStorage,
  entry: ChangeEntry,
  local: Record<string, string>,
): Promise<boolean> {
  if (!storage.rowDeleted || !(await storage.rowDeleted(entry.table, entry.rowId))) {
    return false;
  }
  const localDeleteHlc = local["deleted_at"];
  if (!localDeleteHlc) return false;
  const remoteDeleteHlc = Object.prototype.hasOwnProperty.call(entry.values, "deleted_at")
    ? (entry.columnHlcs["deleted_at"] ?? entry.hlc)
    : null;
  return !remoteDeleteHlc || hlcCompare(remoteDeleteHlc, localDeleteHlc) <= 0;
}

function assertValidRemoteSegmentCommand(command: ApplyRemoteSegmentCommand): void {
  if (!isRecord(command)) {
    throw new Error("Invalid remote sync segment command: malformed command");
  }
  if (typeof command.path !== "string" || !command.path) {
    throw new Error("Invalid remote sync segment command: missing path");
  }
  if (typeof command.deviceId !== "string" || !command.deviceId) {
    throw new Error(`Invalid sync segment ${command.path}: missing device`);
  }
  if (
    !Number.isSafeInteger(command.expectedCursor) ||
    command.expectedCursor < 0 ||
    command.expectedCursor >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`Invalid sync segment ${command.path}: bad expected cursor`);
  }
  if (!Array.isArray(command.entries)) {
    throw new Error(`Invalid sync segment ${command.path}: malformed entries`);
  }

  const parsed = parseSegmentPath(command.path);
  if (
    !parsed ||
    parsed.deviceId !== command.deviceId ||
    parsed.startSeq !== command.startSeq ||
    parsed.endSeq !== command.endSeq
  ) {
    throw new Error(`Invalid sync segment ${command.path}: command metadata does not match path`);
  }
  assertValidSegmentEntries(
    command.path,
    command.deviceId,
    command.startSeq,
    command.endSeq,
    command.entries,
  );
}

function assertValidApplyRemoteSegmentResult(
  path: string,
  command: ApplyRemoteSegmentCommand,
  result: ApplyRemoteSegmentResult,
): void {
  if (
    !isRecord(result) ||
    !Number.isSafeInteger(result.pulledEntries) ||
    !Number.isSafeInteger(result.appliedEntries) ||
    !Number.isSafeInteger(result.conflicts) ||
    !Number.isSafeInteger(result.cursor) ||
    result.pulledEntries !== command.entries.length ||
    result.appliedEntries < 0 ||
    result.appliedEntries > result.pulledEntries ||
    result.conflicts < 0 ||
    result.cursor !== command.endSeq
  ) {
    throw new Error(`Invalid sync segment result for ${path}`);
  }
}

function assertContiguousSegmentRanges(
  deviceId: string,
  cursor: number,
  segments: Array<{ path: string; startSeq: number; endSeq: number }>,
): void {
  let expectedSeq = cursor + 1;
  for (const segment of segments) {
    if (
      !Number.isSafeInteger(segment.startSeq) ||
      !Number.isSafeInteger(segment.endSeq) ||
      segment.startSeq < 1 ||
      segment.endSeq < 1 ||
      segment.startSeq > segment.endSeq
    ) {
      throw new Error(`Invalid sync segment ${segment.path}: bad sequence range`);
    }
    if (segment.startSeq !== expectedSeq) {
      const issue = segment.startSeq > expectedSeq ? "gap" : "overlap";
      throw new Error(
        `Invalid sync segment ${issue} before ${segment.path}: expected sequence ${expectedSeq}, got ${segment.startSeq} for ${deviceId}`,
      );
    }
    expectedSeq = segment.endSeq + 1;
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
  if (Object.values(entry.columnHlcs).some((columnHlc) => hlcCompare(columnHlc, entry.hlc) > 0)) {
    throw new Error(`Invalid sync segment ${path}: column HLC exceeds entry HLC`);
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
