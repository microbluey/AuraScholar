// DOM-free SQLite sync adapter shared by the renderer and Electron main.
import {
  columnsForSyncedTable,
  safeSnapshotWatermark,
  type ApplyRemoteSegmentCommand,
  type ApplyRemoteSegmentResult,
  type MarkPushedOptions,
  type SyncStorage,
  type ChangeEntry,
  type ConflictRecord,
} from "@aurascholar/sync";
import type { Database } from "@aurascholar/db";

/** Tables included in row-level sync, with their synced columns. */
const SYNCED_TABLES: Record<string, string[]> = {
  works: [
    "doi",
    "title",
    "abstract",
    "year",
    "publication_date",
    "venue_name",
    "venue_type",
    "type",
    "arxiv_id",
    "openalex_id",
    "s2_id",
    "pmid",
    "fingerprint",
    "csl_json",
    "volume",
    "issue",
    "pages",
    "number_of_volumes",
    "edition",
    "section",
    "publisher",
    "place_published",
    "series_title",
    "short_title",
    "original_title",
    "issn",
    "isbn",
    "url",
    "accessed_date",
    "language",
    "call_number",
    "accession_number",
    "label",
    "database_name",
    "keywords_json",
    "reading_status",
    "starred",
    "notes_md",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  annotations: [
    "attachment_id",
    "work_id",
    "type",
    "color",
    "page_index",
    "anchor_json",
    "content_md",
    "ink_paths_json",
    "sort_key",
    "orphaned",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  flashcards: [
    "work_id",
    "front_md",
    "back_md",
    "card_type",
    "source",
    "ai_model",
    "generation_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  sentinel_tasks: [
    "work_id",
    "doi",
    "title",
    "current_state",
    "target_flags",
    "poll_interval_s",
    "next_poll_at",
    "last_polled_at",
    "error_count",
    "last_error",
    "status",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
};

const SYNC_OWNER_COLUMN = "library_id";
const SYNC_SCOPE_STATE_VERSION = "library-scope-v2";

function syncedColumnsForTable(table: string): string[] | null {
  const columns = columnsForSyncedTable(SYNCED_TABLES, table);
  return columns ? [...columns] : null;
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
    if (table === "works" || table === "sentinel_tasks") {
      return `${alias}.library_id = ?`;
    }
    if (table === "annotations" || table === "flashcards") {
      return `EXISTS (
        SELECT 1 FROM works scope_work
        WHERE scope_work.id = ${alias}.work_id AND scope_work.library_id = ?
      )`;
    }
    throw new Error(`Unsupported sync table "${table}"`);
  }

  private assertRemoteOwner(table: string, values: Record<string, unknown>): void {
    if (
      !Object.hasOwn(values, SYNC_OWNER_COLUMN) ||
      values[SYNC_OWNER_COLUMN] !== this.transportLibraryId
    ) {
      throw new Error(`Rejected cross-library sync owner for ${table}`);
    }
  }

  private assertLocalOwner(table: string, values: Record<string, unknown>): void {
    if (!Object.hasOwn(values, SYNC_OWNER_COLUMN)) return;
    if (values[SYNC_OWNER_COLUMN] !== this.libraryId) {
      throw new Error(`Rejected cross-library local sync owner for ${table}`);
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

  private async assertParentScope(
    table: string,
    rowId: string,
    values: Record<string, unknown>,
    exists: boolean,
  ): Promise<void> {
    if (table === "sentinel_tasks") {
      const hasIncomingWorkId = Object.hasOwn(values, "work_id");
      const incomingWorkId = values.work_id;
      if (
        hasIncomingWorkId &&
        incomingWorkId !== null &&
        (typeof incomingWorkId !== "string" || !incomingWorkId.trim())
      ) {
        throw new Error("Rejected invalid sentinel_tasks.work_id");
      }
      let workId = stringValue(incomingWorkId);
      if (exists && !hasIncomingWorkId) {
        const current = await this.db.query<{ work_id: string | null }>(
          `SELECT work_id FROM sentinel_tasks t
           WHERE t.id = ? AND t.library_id = ?
           LIMIT 1`,
          [rowId, this.libraryId],
        );
        workId = current[0]?.work_id ?? null;
      }
      if (!workId) return;
      const works = await this.db.query<{ id: string }>(
        `SELECT id FROM works WHERE id = ? AND library_id = ? LIMIT 1`,
        [workId, this.libraryId],
      );
      if (works.length === 0) {
        throw new Error("Rejected cross-library sentinel_tasks.work_id");
      }
      return;
    }
    if (table !== "annotations" && table !== "flashcards") return;

    let workId = stringValue(values.work_id);
    let attachmentId = table === "annotations" ? stringValue(values.attachment_id) : null;
    if (exists && (!workId || (table === "annotations" && !attachmentId))) {
      const current = await this.db.query<{ attachment_id?: string; work_id: string }>(
        `SELECT work_id${table === "annotations" ? ", attachment_id" : ""}
         FROM ${quoteIdentifier(table)} t
         WHERE t.id = ? AND ${this.scopePredicate(table, "t")}`,
        [rowId, this.libraryId],
      );
      workId ??= current[0]?.work_id ?? null;
      attachmentId ??= current[0]?.attachment_id ?? null;
    }
    if (!workId) {
      throw new Error(`Rejected unowned ${table} sync row`);
    }
    const works = await this.db.query<{ id: string }>(
      `SELECT id FROM works WHERE id = ? AND library_id = ? LIMIT 1`,
      [workId, this.libraryId],
    );
    if (works.length === 0) {
      throw new Error(`Rejected cross-library ${table}.work_id`);
    }
    if (table !== "annotations" || !attachmentId) {
      if (table === "annotations") throw new Error("Rejected unowned annotations sync row");
      return;
    }
    const attachments = await this.db.query<{ id: string }>(
      `SELECT att.id FROM attachments att
       JOIN works w ON w.id = att.work_id
       WHERE att.id = ? AND att.work_id = ? AND w.library_id = ?
       LIMIT 1`,
      [attachmentId, workId, this.libraryId],
    );
    if (attachments.length === 0) {
      throw new Error("Rejected cross-library annotations.attachment_id");
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
      const maxDatabaseSeq = Math.max(...pushedDatabaseSeqs);
      await this.db.run(
        `UPDATE sync_log SET synced_at = ?
         WHERE seq <= ? AND synced_at IS NULL AND library_id = ?`,
        [now, maxDatabaseSeq, this.libraryId],
      );
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
    const cols = Object.keys(portableValues).filter((c) => tableColumns.includes(c));
    if (cols.length === 0) return;
    const quotedTable = quoteIdentifier(table);
    const exists = await this.rowExists(table, rowId, true);
    if (!exists && (await this.rowExists(table, rowId, false))) {
      throw new Error(`Rejected cross-library sync row ${table}.${rowId}`);
    }
    await this.assertParentScope(table, rowId, portableValues, exists);
    if (exists) {
      const sets = cols.map((c) => `${quoteIdentifier(c)} = ?`).join(", ");
      await this.db.run(
        `UPDATE ${quotedTable} AS t SET ${sets}
         WHERE t.id = ? AND ${this.scopePredicate(table, "t")}`,
        [...cols.map((c) => portableValues[c] ?? null), rowId, this.libraryId],
      );
    } else if (table === "works" || table === "sentinel_tasks") {
      const placeholders = ["?", ...cols.map(() => "?"), "?"].join(", ");
      await this.db.run(
        `INSERT INTO ${quotedTable} (${["id", ...cols, SYNC_OWNER_COLUMN]
          .map(quoteIdentifier)
          .join(", ")}) VALUES (${placeholders})`,
        [rowId, ...cols.map((c) => portableValues[c] ?? null), this.libraryId],
      );
    } else {
      const placeholders = cols.map(() => "?").join(", ");
      await this.db.run(
        `INSERT INTO ${quotedTable} (${["id", ...cols]
          .map(quoteIdentifier)
          .join(", ")}) VALUES (?, ${placeholders})`,
        [rowId, ...cols.map((c) => portableValues[c] ?? null)],
      );
    }
    await this.writeRowClocks(table, rowId, portableHlcs as Record<string, string>);
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
    const rows = await this.db.query<{
      seq: number;
      entity_table: string;
      entity_id: string;
      op: "upsert" | "delete";
      values_json: string | null;
      column_hlcs_json: string | null;
      hlc: string;
      device_id: string;
    }>(
      `SELECT seq, entity_table, entity_id, op, values_json, column_hlcs_json, hlc, device_id
       FROM sync_log
       WHERE library_id = ? AND synced_at IS NULL AND values_json IS NOT NULL
      ORDER BY seq`,
      [this.libraryId],
    );
    return rows.map((row) => {
      const tableColumns = syncedColumnsForTable(row.entity_table);
      if (!tableColumns) {
        throw new Error(
          `Unsupported sync table "${row.entity_table}" in local sync log; update AuraScholar before syncing this library`,
        );
      }
      const rawValues = parseSyncLogRecord(row.seq, "values_json", row.values_json);
      this.assertLocalOwner(row.entity_table, rawValues);
      const portableValues = this.withoutOwner(rawValues);
      const rawColumnHlcs = parseSyncLogStringRecord(
        row.seq,
        "column_hlcs_json",
        row.column_hlcs_json,
      );
      const portableColumnHlcs = this.withoutOwner(rawColumnHlcs) as Record<string, string>;
      assertSupportedSyncLogColumns(
        row.seq,
        row.entity_table,
        tableColumns,
        portableValues,
        portableColumnHlcs,
      );
      if (row.op === "upsert" && Object.keys(portableValues).length === 0) {
        throw new Error(`Invalid local sync log entry ${row.seq}: upsert has no synced values`);
      }
      const values =
        row.op === "upsert"
          ? { ...portableValues, [SYNC_OWNER_COLUMN]: this.transportLibraryId }
          : portableValues;
      const columnHlcs =
        row.op === "upsert"
          ? {
              ...portableColumnHlcs,
              [SYNC_OWNER_COLUMN]: rawColumnHlcs[SYNC_OWNER_COLUMN] ?? row.hlc,
            }
          : portableColumnHlcs;
      return {
        databaseSeq: row.seq,
        entry: {
          seq: 0,
          table: row.entity_table,
          rowId: row.entity_id,
          op: row.op,
          values,
          columnHlcs,
          hlc: row.hlc,
          deviceId: this.deviceId,
        },
      };
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

function parseSyncLogRecord(
  seq: number,
  field: string,
  value: string | null,
): Record<string, unknown> {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid local sync log entry ${seq}: malformed ${field}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Invalid local sync log entry ${seq}: malformed ${field}`);
  }
  return parsed;
}

function parseStoredNumber(value: string): number {
  try {
    const parsed: unknown = JSON.parse(value);
    const number = Number(parsed);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  } catch {
    return 0;
  }
}

function parseStoredRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseStoredStringRecord(value: string): Record<string, string> | null {
  const parsed = parseStoredRecord(value);
  if (!parsed) return null;
  if (!Object.values(parsed).every((item) => typeof item === "string")) return null;
  return parsed as Record<string, string>;
}

function parseSyncLogStringRecord(
  seq: number,
  field: string,
  value: string | null,
): Record<string, string> {
  const parsed = parseSyncLogRecord(seq, field, value);
  if (!Object.values(parsed).every((item) => typeof item === "string")) {
    throw new Error(`Invalid local sync log entry ${seq}: malformed ${field}`);
  }
  return parsed as Record<string, string>;
}

function assertSupportedSyncLogColumns(
  seq: number,
  table: string,
  tableColumns: readonly string[],
  values: Record<string, unknown>,
  columnHlcs: Record<string, string>,
): void {
  const supported = new Set(tableColumns);
  const columns = new Set([...Object.keys(values), ...Object.keys(columnHlcs)]);
  for (const column of columns) {
    if (!supported.has(column)) {
      throw new Error(
        `Unsupported sync column "${table}.${column}" in local sync log entry ${seq}; update AuraScholar before syncing this library`,
      );
    }
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
