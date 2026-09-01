// DOM-free SQLite sync adapter shared by the renderer and Electron main.
import {
  hlcCompare,
  safeSnapshotWatermark,
  type ApplyRemoteSegmentCommand,
  type ApplyRemoteSegmentResult,
  type MarkPushedOptions,
  type SyncStorage,
  type ChangeEntry,
  type ConflictRecord,
} from "@aurascholar/sync";
import type { Database } from "@aurascholar/db";
import {
  assertSyncParentScope,
  DOCUMENT_EVIDENCE_SYNC_SCOPE_VERSION as SYNC_SCOPE_STATE_VERSION,
  documentRevisionLocalInsertDefaults,
  isDirectLibraryOwnedSyncTable,
  partitionSyncApplyValues,
  SYNC_OWNER_COLUMN,
  SYNCED_TABLE_COLUMNS as SYNCED_TABLES,
  syncedColumnsForTable,
  syncScopePredicate,
} from "../services/document-evidence-sync-scope";
import { documentRevisionBridgeRepairStatement } from "./document-revision-sync-repair";
import { projectLocalSyncLogRows, type LocalSyncLogRow } from "./sqlite-sync-log";
import {
  parseStoredNumber,
  parseStoredRecord,
  parseStoredStringRecord,
  quoteIdentifier,
} from "./sqlite-sync-values";

interface DeferredCurrentRevisionIntent {
  version: 1;
  revisionId: string;
  intentHlc: string;
  expectedCurrentRevisionId: string | null;
}

interface ParsedDeferredCurrentRevisionIntent {
  revisionId: string;
  intentHlc: string | null;
  expectedCurrentRevisionId?: string | null;
}

function supportsSyncedColumn(table: string, column: string): boolean {
  return column === SYNC_OWNER_COLUMN
    ? Boolean(syncedColumnsForTable(table))
    : Boolean(syncedColumnsForTable(table)?.includes(column));
}

export interface SqliteSyncStorageOptions {
  applyRemoteSegment?: (command: ApplyRemoteSegmentCommand) => Promise<ApplyRemoteSegmentResult>;
}

export class SqliteSyncStorage implements SyncStorage {
  readonly applyRemoteSegment?: (
    command: ApplyRemoteSegmentCommand,
  ) => Promise<ApplyRemoteSegmentResult>;

  private pendingSnapshotPushedAt: number | null = null;
  private pendingLoggedSeqs: Array<{ databaseSeq: number; transportSeq: number }> = [];

  constructor(
    private readonly db: Database,
    private readonly deviceId: string,
    private readonly libraryId: string,
    private readonly providerScope: string,
    private readonly transportLibraryId: string = libraryId,
    options: SqliteSyncStorageOptions = {},
  ) {
    if (!libraryId.trim()) throw new Error("Local Library id is required for sync");
    if (!transportLibraryId.trim()) throw new Error("Remote Library scope is required for sync");
    this.applyRemoteSegment = options.applyRemoteSegment;
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const savepoint = `sync_pull_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await this.db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = await fn();
      await this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try {
        await this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      } finally {
        try {
          await this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        } catch {
          // Ignore cleanup errors so the original sync failure reaches the UI.
        }
      }
      throw error;
    }
  }

  private scopePredicate(table: string, alias: string): string {
    return syncScopePredicate(table, alias);
  }

  private assertRemoteOwner(table: string, values: Record<string, unknown>): void {
    if (
      !Object.hasOwn(values, SYNC_OWNER_COLUMN) ||
      values[SYNC_OWNER_COLUMN] !== this.transportLibraryId
    ) {
      throw new Error(`Rejected cross-library sync owner for ${table}`);
    }
  }

  private withoutOwner<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
    if (!Object.hasOwn(value, SYNC_OWNER_COLUMN)) return value;
    const { [SYNC_OWNER_COLUMN]: _owner, ...rest } = value;
    return rest;
  }

  private async rowExists(table: string, rowId: string, scoped: boolean): Promise<boolean> {
    const quotedTable = quoteIdentifier(table);
    const where = scoped ? ` AND ${this.scopePredicate(table, "t")}` : "";
    const rows = await this.db.query<{ id: string }>(
      `SELECT t.id FROM ${quotedTable} t WHERE t.id = ?${where} LIMIT 1`,
      scoped ? [rowId, this.libraryId] : [rowId],
    );
    return rows.length > 0;
  }

  /**
   * A delete log may outlive the row (and its row clocks) after physical
   * purge, so the scoped sync_log owner is the only durable ownership signal
   * in that case. If an identically-keyed row still exists in another Library,
   * never project the tombstone onto a peer.
   */
  private async assertLocalDeleteScope(table: string, rowId: string): Promise<void> {
    if (!rowId.trim()) {
      throw new Error("Invalid local sync log entry: delete is missing a row id");
    }
    if (
      !(await this.rowExists(table, rowId, true)) &&
      (await this.rowExists(table, rowId, false))
    ) {
      throw new Error(`Rejected cross-library sync row ${table}.${rowId}`);
    }
  }

  /**
   * The app's repos don't write sync_log yet (P4 follow-up: route all writes
   * through a logging layer). Until then, push derives entries by snapshotting
   * rows updated since the last push — one entry per row, whole-row values,
   * updated_at as the HLC wall component.
   */
  async unsyncedChanges(afterSeq: number): Promise<ChangeEntry[]> {
    const logged = await this.loggedChanges();
    for (const item of logged) {
      if (item.entry.op === "upsert") {
        item.entry = await this.materializeLoggedUpsert(item.entry);
      }
    }
    const entries: ChangeEntry[] = [];
    const loggedRows = new Set(logged.map(({ entry }) => `${entry.table}:${entry.rowId}`));
    this.pendingLoggedSeqs = [];
    let seq = afterSeq;
    for (const { databaseSeq, entry } of logged) {
      const transportSeq = ++seq;
      entries.push({ ...entry, seq: transportSeq, deviceId: this.deviceId });
      this.pendingLoggedSeqs.push({ databaseSeq, transportSeq });
    }
    const since = await this.lastPushedAt();
    const snapshotUpperBound = safeSnapshotWatermark();
    this.pendingSnapshotPushedAt = Math.max(since, snapshotUpperBound);
    for (const [table, cols] of Object.entries(SYNCED_TABLES)) {
      const quotedTable = quoteIdentifier(table);
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT t.id, ? AS ${quoteIdentifier(SYNC_OWNER_COLUMN)},
                ${cols.map((column) => `t.${quoteIdentifier(column)}`).join(", ")}
         FROM ${quotedTable} t
         WHERE ${this.scopePredicate(table, "t")}
           AND t.updated_at > ? AND t.updated_at <= ?`,
        [this.transportLibraryId, this.libraryId, since, snapshotUpperBound],
      );
      for (const row of rows) {
        const { id, ...values } = row;
        const rowKey = `${table}:${String(id)}`;
        if (loggedRows.has(rowKey)) continue;
        const updatedAt = Number(values["updated_at"] ?? Date.now());
        const hlc = `${String(updatedAt).padStart(15, "0")}-000000-${this.deviceId}`;
        const columnHlcs: Record<string, string> = {};
        for (const col of Object.keys(values)) columnHlcs[col] = hlc;
        entries.push({
          seq: ++seq,
          table,
          rowId: String(id),
          op: "upsert",
          values,
          columnHlcs,
          hlc,
          deviceId: this.deviceId,
        });
      }
    }
    return entries;
  }

  private async materializeLoggedUpsert(entry: ChangeEntry): Promise<ChangeEntry> {
    const columns = syncedColumnsForTable(entry.table);
    if (!columns) throw new Error(`Unsupported sync table "${entry.table}"`);
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT ? AS ${quoteIdentifier(SYNC_OWNER_COLUMN)},
              ${columns.map((column) => `t.${quoteIdentifier(column)}`).join(", ")}
       FROM ${quoteIdentifier(entry.table)} t
       WHERE t.id = ? AND ${this.scopePredicate(entry.table, "t")}
       LIMIT 1`,
      [this.transportLibraryId, entry.rowId, this.libraryId],
    );
    const values = rows[0];
    if (!values) {
      throw new Error(`Invalid local sync log entry for missing row ${entry.table}.${entry.rowId}`);
    }
    const updatedAt = Number(values.updated_at ?? Date.now());
    const snapshotHlc = `${String(updatedAt).padStart(15, "0")}-000000-${this.deviceId}`;
    const columnHlcs = Object.fromEntries(
      Object.keys(values).map((column) => [column, entry.columnHlcs[column] ?? snapshotHlc]),
    );
    return {
      ...entry,
      values,
      columnHlcs,
      hlc: entry.hlc > snapshotHlc ? entry.hlc : snapshotHlc,
    };
  }

  private async lastPushedAt(): Promise<number> {
    const rows = await this.db.query<{ value_json: string }>(
      `SELECT value_json FROM settings WHERE key = ?`,
      [this.lastPushedAtKey()],
    );
    return rows[0] ? parseStoredNumber(rows[0].value_json) : 0;
  }

  async markPushed(uptoSeq: number, options: MarkPushedOptions = {}): Promise<void> {
    const now = Date.now();
    // Persist the remote journal position first. Once a segment has been
    // published, reusing its transport sequence after a crash can create
    // overlapping remote ranges and make another device skip the newer entry.
    // Advancing this cursor before the local cleanup is safe: if a later write
    // fails, the still-unsynced rows are projected onto strictly higher
    // transport sequences on the next run.
    await this.advancePublishedSeq(uptoSeq);
    if (options.complete && this.pendingSnapshotPushedAt != null) {
      const current = await this.lastPushedAt();
      const nextPushedAt = Math.max(current, this.pendingSnapshotPushedAt);
      await this.db.run(
        `INSERT INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, scope = 'local', updated_at = excluded.updated_at`,
        [this.lastPushedAtKey(), JSON.stringify(nextPushedAt), now],
      );
      this.pendingSnapshotPushedAt = null;
    }
    const pushedDatabaseSeqs = this.pendingLoggedSeqs
      .filter(({ transportSeq }) => transportSeq <= uptoSeq)
      .map(({ databaseSeq }) => databaseSeq);
    if (pushedDatabaseSeqs.length > 0) {
      // A legacy NULL upsert is intentionally not projected. Ack only the
      // rows that were actually published, rather than marking every older
      // database sequence in the gap as synced.
      for (let start = 0; start < pushedDatabaseSeqs.length; start += 500) {
        const batch = pushedDatabaseSeqs.slice(start, start + 500);
        const placeholders = batch.map(() => "?").join(",");
        await this.db.run(
          `UPDATE sync_log SET synced_at = ?
           WHERE synced_at IS NULL AND library_id = ? AND seq IN (${placeholders})`,
          [now, this.libraryId, ...batch],
        );
      }
      this.pendingLoggedSeqs = this.pendingLoggedSeqs.filter(
        ({ transportSeq }) => transportSeq > uptoSeq,
      );
    }
  }

  /**
   * Recover a journal segment that was durably published before the previous
   * process stopped. Pending snapshot/log rows deliberately remain untouched;
   * unsyncedChanges() will project them above this recovered transport cursor.
   */
  async recoverPublishedSeq(uptoSeq: number): Promise<void> {
    await this.advancePublishedSeq(uptoSeq);
  }

  async lastPushedSeq(): Promise<number> {
    const rows = await this.db.query<{ last_pushed_seq: number }>(
      `SELECT last_pushed_seq FROM sync_state WHERE provider_id = ? AND library_id = ?`,
      [this.localStateProviderId(), this.libraryId],
    );
    return rows[0]?.last_pushed_seq ?? 0;
  }

  supportsTable(table: string): boolean {
    return Boolean(syncedColumnsForTable(table));
  }

  supportsColumn(table: string, column: string): boolean {
    return supportsSyncedColumn(table, column);
  }

  async rowDeleted(table: string, rowId: string): Promise<boolean> {
    const cols = syncedColumnsForTable(table);
    if (!cols?.includes("deleted_at")) return false;
    const quotedTable = quoteIdentifier(table);
    const rows = await this.db.query<{ deleted_at: number | null }>(
      `SELECT t.deleted_at FROM ${quotedTable} t
       WHERE t.id = ? AND ${this.scopePredicate(table, "t")}`,
      [rowId, this.libraryId],
    );
    if (rows[0]) return rows[0].deleted_at != null;
    const clocks = await this.db.query<{ column_hlcs_json: string }>(
      `SELECT column_hlcs_json FROM sync_row_clocks
       WHERE library_id = ? AND table_name = ? AND row_id = ?`,
      [this.libraryId, table, rowId],
    );
    if (!clocks[0]) return false;
    const parsed = parseStoredRecord(clocks[0].column_hlcs_json);
    if (!parsed) return false;
    return typeof parsed["deleted_at"] === "string";
  }

  async rowClocks(table: string, rowId: string): Promise<Record<string, string> | null> {
    const cols = syncedColumnsForTable(table);
    if (!cols) return null;
    const stored = await this.db.query<{ column_hlcs_json: string }>(
      `SELECT column_hlcs_json FROM sync_row_clocks
       WHERE library_id = ? AND table_name = ? AND row_id = ?`,
      [this.libraryId, table, rowId],
    );
    if (stored[0]) {
      const parsed = parseStoredStringRecord(stored[0].column_hlcs_json);
      if (parsed) return parsed;
    }

    const quotedTable = quoteIdentifier(table);
    const rows = await this.db.query<{ updated_at: number }>(
      `SELECT t.updated_at FROM ${quotedTable} t
       WHERE t.id = ? AND ${this.scopePredicate(table, "t")}`,
      [rowId, this.libraryId],
    );
    if (!rows[0]) return null;
    const hlc = `${String(rows[0].updated_at).padStart(15, "0")}-000000-${this.deviceId}`;
    const clocks: Record<string, string> = {};
    for (const col of cols) clocks[col] = hlc;
    return clocks;
  }

  async applyUpsert(
    table: string,
    rowId: string,
    values: Record<string, unknown>,
    columnHlcs: Record<string, string>,
  ): Promise<void> {
    const tableColumns = syncedColumnsForTable(table);
    if (!tableColumns) return;
    this.assertRemoteOwner(table, values);
    const portableValues = this.withoutOwner(values);
    const portableHlcs = this.withoutOwner(columnHlcs);
    const syncedValues = Object.fromEntries(
      Object.entries(portableValues).filter(([column]) => tableColumns.includes(column)),
    );
    const hasCurrentRevisionIntent =
      table === "document_assets" && Object.hasOwn(syncedValues, "current_revision_id");
    const desiredCurrentRevision = syncedValues.current_revision_id;
    const { immediate, deferred } = partitionSyncApplyValues(table, syncedValues);
    const cols = Object.keys(immediate);
    if (cols.length === 0 && !hasCurrentRevisionIntent) return;
    const quotedTable = quoteIdentifier(table);
    const exists = await this.rowExists(table, rowId, true);
    if (!exists && (await this.rowExists(table, rowId, false))) {
      throw new Error(`Rejected cross-library sync row ${table}.${rowId}`);
    }
    await assertSyncParentScope({
      db: this.db,
      table,
      rowId,
      values: immediate,
      exists,
      libraryId: this.libraryId,
    });
    if (exists && table === "document_assets" && Object.hasOwn(immediate, "work_id")) {
      const repair = documentRevisionBridgeRepairStatement({
        assetId: rowId,
        libraryId: this.libraryId,
        targetWorkId: immediate.work_id,
      });
      await this.db.run(repair.sql, repair.params);
    }
    if (exists && cols.length > 0) {
      const sets = cols.map((c) => `${quoteIdentifier(c)} = ?`).join(", ");
      await this.db.run(
        `UPDATE ${quotedTable} AS t SET ${sets}
         WHERE t.id = ? AND ${this.scopePredicate(table, "t")}`,
        [...cols.map((c) => immediate[c] ?? null), rowId, this.libraryId],
      );
    } else if (!exists && isDirectLibraryOwnedSyncTable(table)) {
      const localDefaults =
        table === "document_revisions" ? documentRevisionLocalInsertDefaults(Date.now()) : {};
      const insertValues = { ...immediate, ...localDefaults };
      const insertColumns = Object.keys(insertValues);
      const placeholders = ["?", ...insertColumns.map(() => "?"), "?"].join(", ");
      await this.db.run(
        `INSERT INTO ${quotedTable} (${["id", ...insertColumns, SYNC_OWNER_COLUMN]
          .map(quoteIdentifier)
          .join(", ")}) VALUES (${placeholders})`,
        [rowId, ...insertColumns.map((c) => insertValues[c] ?? null), this.libraryId],
      );
    } else if (!exists) {
      const localDefaults =
        table === "document_revisions" ? documentRevisionLocalInsertDefaults(Date.now()) : {};
      const insertValues = { ...immediate, ...localDefaults };
      const insertColumns = Object.keys(insertValues);
      const placeholders = insertColumns.map(() => "?").join(", ");
      await this.db.run(
        `INSERT INTO ${quotedTable} (${["id", ...insertColumns]
          .map(quoteIdentifier)
          .join(", ")}) VALUES (?, ${placeholders})`,
        [rowId, ...insertColumns.map((c) => insertValues[c] ?? null)],
      );
    }
    if (hasCurrentRevisionIntent) {
      await this.applyOrDeferCurrentRevision(
        rowId,
        desiredCurrentRevision,
        deferred !== null,
        portableHlcs.current_revision_id,
      );
    }
    if (table === "document_revisions") {
      await this.resolveDeferredCurrentRevisionForRevision(rowId);
    }
    await this.writeRowClocks(table, rowId, portableHlcs as Record<string, string>);
  }

  private async applyOrDeferCurrentRevision(
    assetId: string,
    revisionId: unknown,
    requiresRevision: boolean,
    intentHlc: unknown,
  ): Promise<void> {
    if (!requiresRevision) {
      if (revisionId !== null) {
        throw new Error("Rejected invalid document_assets.current_revision_id");
      }
      await this.clearDeferredCurrentRevision(assetId);
      return;
    }
    if (typeof revisionId !== "string" || !revisionId.trim()) {
      throw new Error("Rejected invalid document_assets.current_revision_id");
    }
    if (typeof intentHlc !== "string" || !intentHlc.trim()) {
      throw new Error("Rejected missing document_assets.current_revision_id HLC");
    }
    const matching = await this.db.query<{ id: string }>(
      `SELECT revision.id FROM document_revisions revision
       JOIN document_assets asset ON asset.id = revision.asset_id
       WHERE revision.id = ? AND revision.asset_id = ? AND asset.library_id = ?
       LIMIT 1`,
      [revisionId, assetId, this.libraryId],
    );
    if (matching[0]) {
      await this.setCurrentRevision(assetId, revisionId);
      await this.clearDeferredCurrentRevision(assetId);
      return;
    }
    const foreign = await this.db.query<{ id: string }>(
      `SELECT id FROM document_revisions WHERE id = ? LIMIT 1`,
      [revisionId],
    );
    if (foreign[0]) {
      throw new Error("Rejected cross-library document_assets.current_revision_id");
    }
    const assets = await this.db.query<{ current_revision_id: string | null }>(
      `SELECT current_revision_id FROM document_assets
       WHERE id = ? AND library_id = ? LIMIT 1`,
      [assetId, this.libraryId],
    );
    if (!assets[0]) throw new Error("Deferred current revision asset is unavailable");
    const pending: DeferredCurrentRevisionIntent = {
      version: 1,
      revisionId,
      intentHlc,
      expectedCurrentRevisionId: assets[0].current_revision_id,
    };
    await this.db.run(
      `INSERT INTO settings (key, value_json, scope, updated_at)
       VALUES (?, ?, 'local', ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         scope = 'local',
         updated_at = excluded.updated_at`,
      [this.deferredCurrentRevisionKey(assetId), JSON.stringify(pending), Date.now()],
    );
  }

  private async resolveDeferredCurrentRevisionForRevision(revisionId: string): Promise<void> {
    const revisions = await this.db.query<{ asset_id: string }>(
      `SELECT revision.asset_id FROM document_revisions revision
       JOIN document_assets asset ON asset.id = revision.asset_id
       WHERE revision.id = ? AND asset.library_id = ? LIMIT 1`,
      [revisionId, this.libraryId],
    );
    const assetId = revisions[0]?.asset_id;
    if (!assetId) return;
    const pending = await this.db.query<{ value_json: string }>(
      `SELECT value_json FROM settings WHERE key = ? LIMIT 1`,
      [this.deferredCurrentRevisionKey(assetId)],
    );
    if (!pending[0]) return;
    let rawPending: unknown;
    try {
      rawPending = JSON.parse(pending[0].value_json);
    } catch {
      await this.clearDeferredCurrentRevision(assetId);
      return;
    }
    const intent = parseDeferredCurrentRevisionIntent(rawPending);
    if (!intent) {
      await this.clearDeferredCurrentRevision(assetId);
      return;
    }
    if (intent.revisionId !== revisionId) return;
    const assets = await this.db.query<{
      current_revision_id: string | null;
    }>(
      `SELECT current_revision_id FROM document_assets
       WHERE id = ? AND library_id = ? LIMIT 1`,
      [assetId, this.libraryId],
    );
    const asset = assets[0];
    if (!asset) throw new Error("Deferred current revision asset is unavailable");

    if (intent.intentHlc !== null) {
      const clocks = await this.rowClocks("document_assets", assetId);
      const currentClock = clocks?.current_revision_id;
      if (currentClock && hlcCompare(currentClock, intent.intentHlc) > 0) {
        await this.clearDeferredCurrentRevision(assetId);
        return;
      }
    }

    // The persisted expected value is a compare-and-swap guard across pull
    // segments and adapter restarts. A local selection made after the remote
    // intent was deferred must not be overwritten when its revision arrives.
    const expected = intent.expectedCurrentRevisionId;
    if (expected === undefined && asset.current_revision_id !== null) {
      await this.clearDeferredCurrentRevision(assetId);
      return;
    }
    const changed = await this.setCurrentRevisionIfUnchanged(assetId, revisionId, expected ?? null);
    await this.clearDeferredCurrentRevision(assetId);
    if (!changed) return;
  }

  private async setCurrentRevision(assetId: string, revisionId: string): Promise<void> {
    const changed = await this.db.run(
      `UPDATE document_assets AS asset SET current_revision_id = ?
       WHERE asset.id = ? AND asset.library_id = ?`,
      [revisionId, assetId, this.libraryId],
    );
    if (changed !== 1) throw new Error("Deferred current revision asset is unavailable");
  }

  private async setCurrentRevisionIfUnchanged(
    assetId: string,
    revisionId: string,
    expectedCurrentRevisionId: string | null,
  ): Promise<boolean> {
    const changed = await this.db.run(
      `UPDATE document_assets AS asset SET current_revision_id = ?
       WHERE asset.id = ? AND asset.library_id = ?
         AND asset.current_revision_id IS ?`,
      [revisionId, assetId, this.libraryId, expectedCurrentRevisionId],
    );
    if (changed === 1) return true;
    const exists = await this.rowExists("document_assets", assetId, true);
    if (!exists) throw new Error("Deferred current revision asset is unavailable");
    return false;
  }

  private async clearDeferredCurrentRevision(assetId: string): Promise<void> {
    await this.db.run(`DELETE FROM settings WHERE key = ?`, [
      this.deferredCurrentRevisionKey(assetId),
    ]);
  }

  private deferredCurrentRevisionKey(assetId: string): string {
    return `sync.${this.libraryId}.${this.providerScope}.${SYNC_SCOPE_STATE_VERSION}.pending-current-revision.${assetId}`;
  }

  async applyDelete(table: string, rowId: string, hlc: string): Promise<void> {
    const tableColumns = syncedColumnsForTable(table);
    if (!tableColumns?.includes("deleted_at")) return;
    const quotedTable = quoteIdentifier(table);
    const exists = await this.rowExists(table, rowId, true);
    if (!exists && (await this.rowExists(table, rowId, false))) {
      throw new Error(`Rejected cross-library sync row ${table}.${rowId}`);
    }
    if (exists) {
      await this.db.run(
        `UPDATE ${quotedTable} AS t SET deleted_at = ?
         WHERE t.id = ? AND ${this.scopePredicate(table, "t")}`,
        [Date.now(), rowId, this.libraryId],
      );
    }
    await this.writeRowClocks(table, rowId, { deleted_at: hlc });
  }

  async getCursor(deviceId: string): Promise<number> {
    const rows = await this.db.query<{ last_pulled_cursor: string | null }>(
      `SELECT last_pulled_cursor FROM sync_state WHERE provider_id = ? AND library_id = ?`,
      [this.remoteStateProviderId(deviceId), this.libraryId],
    );
    return rows[0]?.last_pulled_cursor ? Number(rows[0].last_pulled_cursor) : 0;
  }

  async setCursor(deviceId: string, seq: number): Promise<void> {
    await this.db.run(
      `INSERT INTO sync_state (provider_id, library_id, last_pushed_seq, last_pulled_cursor)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(library_id, provider_id)
       DO UPDATE SET last_pulled_cursor = excluded.last_pulled_cursor`,
      [this.remoteStateProviderId(deviceId), this.libraryId, String(seq)],
    );
  }

  async recordConflict(conflict: ConflictRecord): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `INSERT INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, scope = 'local', updated_at = excluded.updated_at`,
      [
        `sync.conflict.${this.libraryId}.${conflict.table}.${conflict.rowId}.${conflict.column}`,
        JSON.stringify(conflict),
        now,
      ],
    );
  }

  private async loggedChanges(): Promise<Array<{ databaseSeq: number; entry: ChangeEntry }>> {
    const rows = await this.db.query<LocalSyncLogRow>(
      `SELECT seq, entity_table, entity_id, op, values_json, column_hlcs_json, hlc, device_id
       FROM sync_log
       WHERE library_id = ? AND synced_at IS NULL
         AND (op <> 'upsert' OR values_json IS NOT NULL)
      ORDER BY seq`,
      [this.libraryId],
    );
    return projectLocalSyncLogRows(rows, {
      libraryId: this.libraryId,
      transportLibraryId: this.transportLibraryId,
      deviceId: this.deviceId,
      assertDeleteScope: (table, rowId) => this.assertLocalDeleteScope(table, rowId),
    });
  }

  private async writeRowClocks(
    table: string,
    rowId: string,
    columnHlcs: Record<string, string>,
  ): Promise<void> {
    if (!syncedColumnsForTable(table)) return;
    const current = (await this.rowClocks(table, rowId)) ?? {};
    const merged = { ...current, ...columnHlcs };
    const updatedAt = Date.now();
    const changed = await this.db.run(
      `UPDATE sync_row_clocks
       SET column_hlcs_json = ?, updated_at = ?
       WHERE library_id = ? AND table_name = ? AND row_id = ?`,
      [JSON.stringify(merged), updatedAt, this.libraryId, table, rowId],
    );
    if (changed === 0) {
      await this.db.run(
        `INSERT INTO sync_row_clocks
           (table_name, row_id, library_id, column_hlcs_json, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [table, rowId, this.libraryId, JSON.stringify(merged), updatedAt],
      );
    }
  }

  private lastPushedAtKey(): string {
    return `sync.${this.libraryId}.${this.providerScope}.${SYNC_SCOPE_STATE_VERSION}.last_pushed_at`;
  }

  private async advancePublishedSeq(uptoSeq: number): Promise<void> {
    await this.db.run(
      `INSERT INTO sync_state (provider_id, library_id, last_pushed_seq, last_pulled_cursor)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(library_id, provider_id)
       DO UPDATE SET last_pushed_seq = MAX(sync_state.last_pushed_seq, excluded.last_pushed_seq)`,
      [this.localStateProviderId(), this.libraryId, uptoSeq],
    );
  }

  private localStateProviderId(): string {
    return `webdav:${this.providerScope}:${this.libraryId}:${SYNC_SCOPE_STATE_VERSION}:local`;
  }

  private remoteStateProviderId(deviceId: string): string {
    return `webdav:${this.providerScope}:${this.libraryId}:${SYNC_SCOPE_STATE_VERSION}:${deviceId}`;
  }
}

function parseDeferredCurrentRevisionIntent(
  value: unknown,
): ParsedDeferredCurrentRevisionIntent | null {
  // Compatibility with pending state written by the first v3 implementation.
  // It did not persist a CAS baseline, so only a still-null pointer is safe to
  // resolve (enforced by the caller via `expectedCurrentRevisionId` undefined).
  if (typeof value === "string" && value.trim()) {
    return {
      revisionId: value,
      intentHlc: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.revisionId !== "string" ||
    !candidate.revisionId.trim() ||
    typeof candidate.intentHlc !== "string" ||
    !candidate.intentHlc.trim() ||
    (candidate.expectedCurrentRevisionId !== null &&
      typeof candidate.expectedCurrentRevisionId !== "string")
  ) {
    return null;
  }
  return {
    revisionId: candidate.revisionId,
    intentHlc: candidate.intentHlc,
    expectedCurrentRevisionId: candidate.expectedCurrentRevisionId,
  };
}
