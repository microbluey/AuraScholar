// Desktop sync wiring: WebDAV provider from settings + a SyncStorage adapter
// over the real SQLite database.
//
// Current scope (v0.4 milestone): full-library snapshot push/pull is NOT yet
// row-level — this adapter syncs the tables that matter for multi-device
// reading workflows (works, annotations, flashcards state). Blob (PDF) sync
// ships separately.
import {
  SyncEngine,
  WebDavProvider,
  HlcClock,
  columnsForSyncedTable,
  safeSnapshotWatermark,
  type MarkPushedOptions,
  type SyncStorage,
  type ChangeEntry,
  type ConflictRecord,
  type SyncResult,
} from "@aurascholar/sync";
import { newId, type Database } from "@aurascholar/db";
import { ensureLocalFirstState, type LocalFirstState } from "@aurascholar/db/local-first";
import { getDb } from "./aura-db";
import { auraHttp } from "./aura-platform";
import { isSensitiveKeyName, redactSensitiveText, redactSensitiveValue } from "./sensitive-text";
import { SECRET_KEYS, getSecret, migrateInlineSecret, withSecretTransaction } from "./secrets";
import {
  isStorageRecord,
  readLocalStorageJson,
  tryWriteLocalStorageJson,
  writeLocalStorageJson,
} from "../storage";

export interface SyncSettings {
  baseUrl: string;
  username: string;
  password: string;
}

export interface LibraryBackupTablePreview {
  name: string;
  rows: number;
}

export interface LibraryBackupPreview {
  exportedAt: string | null;
  ignoredTables: string[];
  tables: LibraryBackupTablePreview[];
  totalRows: number;
  version: number;
}

export interface LibraryBackupTableImportSummary extends LibraryBackupTablePreview {
  imported: number;
  skipped: number;
}

export interface LibraryBackupImportSummary {
  deactivatedAttachments: number;
  ignoredTables: string[];
  imported: number;
  redirectedRows: number;
  skipped: number;
  skippedRuntimeRows: number;
  tables: LibraryBackupTableImportSummary[];
  totalRows: number;
}

const SETTINGS_KEY = "sync-settings";
const LIBRARY_BACKUP_VERSION = 1;
const USER_BACKUP_TABLES = [
  "libraries",
  "settings",
  "works",
  "authors",
  "work_authors",
  "attachments",
  "collections",
  "collection_items",
  "tags",
  "work_tags",
  "annotations",
  "annotation_comments",
  "snippets",
  "flashcards",
  "flashcard_srs",
  "flashcard_reviews",
  "citations",
  "sentinel_tasks",
  "sentinel_events",
  "discovery_sites",
  "saved_searches",
  "cv_profiles",
  "ai_jobs",
  "derived_artifacts",
] as const;
const USER_BACKUP_TABLE_SET = new Set<string>(USER_BACKUP_TABLES);
const GENERATED_BACKUP_ID_TABLES = [
  "attachments",
  "collections",
  "annotations",
  "annotation_comments",
  "snippets",
  "flashcards",
  "flashcard_reviews",
  "sentinel_tasks",
  "sentinel_events",
  "discovery_sites",
  "saved_searches",
  "cv_profiles",
  "ai_jobs",
  "derived_artifacts",
] as const satisfies readonly UserBackupTable[];
const GENERATED_BACKUP_ID_TABLE_SET = new Set<UserBackupTable>(GENERATED_BACKUP_ID_TABLES);

type UserBackupTable = (typeof USER_BACKUP_TABLES)[number];
type GeneratedBackupIdTable = (typeof GENERATED_BACKUP_ID_TABLES)[number];

interface LibraryBackupFile {
  exportedAt: string | null;
  tables: Partial<Record<UserBackupTable, Record<string, unknown>[]>>;
  ignoredTables: string[];
  version: number;
}

interface TableInfoRow {
  name: string;
}

interface BackupImportIdMaps {
  authors: Map<string, string>;
  generated: Partial<Record<GeneratedBackupIdTable, Map<string, string>>>;
  libraries: Map<string, string>;
  tags: Map<string, string>;
  targetLibraryId: string;
  works: Map<string, string>;
}

export async function loadSyncSettings(): Promise<SyncSettings | null> {
  const parsed = readLocalStorageJson<unknown>(SETTINGS_KEY, null);
  if (!isStorageRecord(parsed)) return null;

  const baseUrl =
    typeof parsed.baseUrl === "string" ? normalizeStoredSyncBaseUrl(parsed.baseUrl) : null;
  if (!baseUrl) return null;
  const username = typeof parsed.username === "string" ? parsed.username.trim() : "";
  const inlinePassword = typeof parsed.password === "string" ? parsed.password : "";

  // Migrate any inline plaintext password into the secret store.
  const migrated = await migrateInlineSecret(SECRET_KEYS.syncPassword, inlinePassword);
  if (inlinePassword && migrated.persisted) {
    tryWriteLocalStorageJson(SETTINGS_KEY, { baseUrl, username, password: "" });
  }
  const password = migrated.value || (await getSecret(SECRET_KEYS.syncPassword));
  return { baseUrl, username, password };
}

export async function saveSyncSettings(s: SyncSettings): Promise<void> {
  const normalized = normalizeSyncSettingsForStorage(s);
  const { password, ...config } = normalized;
  await withSecretTransaction([{ key: SECRET_KEYS.syncPassword, value: password }], () => {
    writeLocalStorageJson(SETTINGS_KEY, { ...config, password: "" });
  });
}

export async function getSyncIdentity(): Promise<LocalFirstState> {
  const db = await getDb();
  const deviceId = await window.aura.deviceId();
  return ensureLocalFirstState(db, {
    deviceId,
    deviceName: navigator.userAgent.includes("Mac") ? "Mac" : "Desktop",
    platform: navigator.platform || "desktop",
  });
}

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
    "status",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
};

function syncedColumnsForTable(table: string): string[] | null {
  const columns = columnsForSyncedTable(SYNCED_TABLES, table);
  return columns ? [...columns] : null;
}

function syncProviderScope(settings: SyncSettings): string {
  // Progress cursors are per remote target; passwords are intentionally excluded.
  const input = `${normalizeSyncBaseUrlForState(settings.baseUrl)}\n${settings.username.trim()}`;
  return `webdav-${hashScope(input, 0x811c9dc5)}${hashScope(input, 0x9e3779b9)}`;
}

function normalizeSyncBaseUrlForState(value: string): string {
  return normalizeSyncBaseUrlForStorage(value);
}

function normalizeSyncSettingsForStorage(settings: SyncSettings): SyncSettings {
  const baseUrl = normalizeSyncBaseUrlForStorage(settings.baseUrl);
  const username = settings.username.trim();
  if (!username || !settings.password.trim()) {
    throw new Error("请填写用户名和密码 / 应用密码。");
  }
  return { baseUrl, password: settings.password, username };
}

function normalizeStoredSyncBaseUrl(value: string): string | null {
  try {
    return normalizeSyncBaseUrlForStorage(value);
  } catch {
    return null;
  }
}

function normalizeSyncBaseUrlForStorage(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("请填写 WebDAV 地址。");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("WebDAV 地址格式不正确，请使用完整的 http:// 或 https:// 地址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("WebDAV 地址仅支持 http:// 或 https://。");
  }
  if (url.username || url.password) {
    throw new Error("WebDAV 地址不要包含用户名或密码，请填写在下方账号字段中。");
  }
  if (url.search || url.hash) {
    throw new Error("WebDAV 地址请填写目录地址，不要包含查询参数或 # 片段。");
  }
  return url.toString().replace(/\/+$/, "");
}

function hashScope(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

class SqliteSyncStorage implements SyncStorage {
  private pendingSnapshotPushedAt: number | null = null;

  constructor(
    private readonly db: Database,
    private readonly deviceId: string,
    private readonly libraryId: string,
    private readonly providerScope: string,
  ) {}

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

  /**
   * The app's repos don't write sync_log yet (P4 follow-up: route all writes
   * through a logging layer). Until then, push derives entries by snapshotting
   * rows updated since the last push — one entry per row, whole-row values,
   * updated_at as the HLC wall component.
   */
  async unsyncedChanges(afterSeq: number): Promise<ChangeEntry[]> {
    const logged = await this.loggedChanges(afterSeq);
    const entries: ChangeEntry[] = [...logged];
    const loggedRows = new Set(logged.map((entry) => `${entry.table}:${entry.rowId}`));
    let seq = Math.max(afterSeq, ...logged.map((entry) => entry.seq));
    const since = await this.lastPushedAt();
    const snapshotUpperBound = safeSnapshotWatermark();
    this.pendingSnapshotPushedAt = Math.max(since, snapshotUpperBound);
    for (const [table, cols] of Object.entries(SYNCED_TABLES)) {
      const quotedTable = quoteIdentifier(table);
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT id, ${cols.map(quoteIdentifier).join(", ")}
         FROM ${quotedTable}
         WHERE updated_at > ? AND updated_at <= ?`,
        [since, snapshotUpperBound],
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

  private async lastPushedAt(): Promise<number> {
    const rows = await this.db.query<{ value_json: string }>(
      `SELECT value_json FROM settings WHERE key = ?`,
      [this.lastPushedAtKey()],
    );
    return rows[0] ? parseStoredNumber(rows[0].value_json) : 0;
  }

  async markPushed(uptoSeq: number, options: MarkPushedOptions = {}): Promise<void> {
    const now = Date.now();
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
    await this.db.run(
      `UPDATE sync_log SET synced_at = ?
       WHERE seq <= ? AND synced_at IS NULL AND (library_id = ? OR library_id IS NULL)`,
      [now, uptoSeq, this.libraryId],
    );
    await this.db.run(
      `INSERT INTO sync_state (provider_id, library_id, last_pushed_seq, last_pulled_cursor)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(provider_id) DO UPDATE SET library_id = excluded.library_id, last_pushed_seq = excluded.last_pushed_seq`,
      [this.localStateProviderId(), this.libraryId, uptoSeq],
    );
  }

  async lastPushedSeq(): Promise<number> {
    const rows = await this.db.query<{ last_pushed_seq: number }>(
      `SELECT last_pushed_seq FROM sync_state WHERE provider_id = ?`,
      [this.localStateProviderId()],
    );
    return rows[0]?.last_pushed_seq ?? 0;
  }

  supportsTable(table: string): boolean {
    return Boolean(syncedColumnsForTable(table));
  }

  supportsColumn(table: string, column: string): boolean {
    return Boolean(syncedColumnsForTable(table)?.includes(column));
  }

  async rowDeleted(table: string, rowId: string): Promise<boolean> {
    const cols = syncedColumnsForTable(table);
    if (!cols?.includes("deleted_at")) return false;
    const quotedTable = quoteIdentifier(table);
    const rows = await this.db.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM ${quotedTable} WHERE id = ?`,
      [rowId],
    );
    if (rows[0]) return rows[0].deleted_at != null;
    const clocks = await this.db.query<{ column_hlcs_json: string }>(
      `SELECT column_hlcs_json FROM sync_row_clocks WHERE table_name = ? AND row_id = ?`,
      [table, rowId],
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
      `SELECT column_hlcs_json FROM sync_row_clocks WHERE table_name = ? AND row_id = ?`,
      [table, rowId],
    );
    if (stored[0]) {
      const parsed = parseStoredStringRecord(stored[0].column_hlcs_json);
      if (parsed) return parsed;
    }

    const quotedTable = quoteIdentifier(table);
    const rows = await this.db.query<{ updated_at: number }>(
      `SELECT updated_at FROM ${quotedTable} WHERE id = ?`,
      [rowId],
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
    const cols = Object.keys(values).filter((c) => tableColumns.includes(c));
    if (cols.length === 0) return;
    const quotedTable = quoteIdentifier(table);
    const exists = await this.db.query<{ id: string }>(
      `SELECT id FROM ${quotedTable} WHERE id = ?`,
      [rowId],
    );
    if (exists.length > 0) {
      const sets = cols.map((c) => `${quoteIdentifier(c)} = ?`).join(", ");
      await this.db.run(`UPDATE ${quotedTable} SET ${sets} WHERE id = ?`, [
        ...cols.map((c) => values[c] ?? null),
        rowId,
      ]);
    } else {
      const placeholders = cols.map(() => "?").join(", ");
      await this.db.run(
        `INSERT INTO ${quotedTable} (${["id", ...cols]
          .map(quoteIdentifier)
          .join(", ")}) VALUES (?, ${placeholders})`,
        [rowId, ...cols.map((c) => values[c] ?? null)],
      );
    }
    await this.writeRowClocks(table, rowId, columnHlcs);
  }

  async applyDelete(table: string, rowId: string, hlc: string): Promise<void> {
    const tableColumns = syncedColumnsForTable(table);
    if (!tableColumns?.includes("deleted_at")) return;
    const quotedTable = quoteIdentifier(table);
    await this.db.run(`UPDATE ${quotedTable} SET deleted_at = ? WHERE id = ?`, [Date.now(), rowId]);
    await this.writeRowClocks(table, rowId, { deleted_at: hlc });
  }

  async getCursor(deviceId: string): Promise<number> {
    const rows = await this.db.query<{ last_pulled_cursor: string | null }>(
      `SELECT last_pulled_cursor FROM sync_state WHERE provider_id = ?`,
      [this.remoteStateProviderId(deviceId)],
    );
    return rows[0]?.last_pulled_cursor ? Number(rows[0].last_pulled_cursor) : 0;
  }

  async setCursor(deviceId: string, seq: number): Promise<void> {
    await this.db.run(
      `INSERT INTO sync_state (provider_id, library_id, last_pushed_seq, last_pulled_cursor)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(provider_id) DO UPDATE SET library_id = excluded.library_id, last_pulled_cursor = excluded.last_pulled_cursor`,
      [this.remoteStateProviderId(deviceId), this.libraryId, String(seq)],
    );
  }

  async recordConflict(conflict: ConflictRecord): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `INSERT INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, scope = 'local', updated_at = excluded.updated_at`,
      [
        `sync.conflict.${conflict.table}.${conflict.rowId}.${conflict.column}`,
        JSON.stringify(conflict),
        now,
      ],
    );
  }

  private async loggedChanges(afterSeq: number): Promise<ChangeEntry[]> {
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
       WHERE seq > ? AND (library_id = ? OR library_id IS NULL) AND values_json IS NOT NULL
      ORDER BY seq`,
      [afterSeq, this.libraryId],
    );
    return rows.map((row) => {
      const tableColumns = syncedColumnsForTable(row.entity_table);
      if (!tableColumns) {
        throw new Error(
          `Unsupported sync table "${row.entity_table}" in local sync log; update AuraScholar before syncing this library`,
        );
      }
      const values = parseSyncLogRecord(row.seq, "values_json", row.values_json);
      const columnHlcs = parseSyncLogStringRecord(
        row.seq,
        "column_hlcs_json",
        row.column_hlcs_json,
      );
      assertSupportedSyncLogColumns(row.seq, row.entity_table, tableColumns, values, columnHlcs);
      if (row.op === "upsert" && Object.keys(values).length === 0) {
        throw new Error(`Invalid local sync log entry ${row.seq}: upsert has no synced values`);
      }
      return {
        seq: row.seq,
        table: row.entity_table,
        rowId: row.entity_id,
        op: row.op,
        values,
        columnHlcs,
        hlc: row.hlc,
        deviceId: row.device_id,
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
    await this.db.run(
      `INSERT INTO sync_row_clocks (table_name, row_id, library_id, column_hlcs_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(table_name, row_id) DO UPDATE SET library_id = excluded.library_id, column_hlcs_json = excluded.column_hlcs_json, updated_at = excluded.updated_at`,
      [table, rowId, this.libraryId, JSON.stringify(merged), Date.now()],
    );
  }

  private lastPushedAtKey(): string {
    return `sync.${this.libraryId}.${this.providerScope}.last_pushed_at`;
  }

  private localStateProviderId(): string {
    return `webdav:${this.providerScope}:${this.libraryId}:local`;
  }

  private remoteStateProviderId(deviceId: string): string {
    return `webdav:${this.providerScope}:${this.libraryId}:${deviceId}`;
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

export async function runSync(): Promise<SyncResult> {
  const settings = await loadSyncSettings();
  if (!settings) throw new Error("请先配置 WebDAV 同步(地址、用户名、密码)");
  const db = await getDb();
  const { deviceId, libraryId } = await getSyncIdentity();
  const provider = new WebDavProvider({
    http: auraHttp,
    baseUrl: settings.baseUrl,
    username: settings.username,
    password: settings.password,
  });
  await provider.ping();
  const engine = new SyncEngine(
    provider,
    new SqliteSyncStorage(db, deviceId, libraryId, syncProviderScope(settings)),
    deviceId,
    new HlcClock(deviceId),
  );
  return engine.sync();
}

/** User-data JSON export. Secrets and PDF/blob files are intentionally excluded. */
export async function exportLibraryJson(): Promise<Blob> {
  const db = await getDb();
  const dump: Record<string, unknown[]> = {};
  for (const table of USER_BACKUP_TABLES) {
    const rows = await db.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
    dump[table] = sanitizeBackupRows(table, rows);
  }
  return new Blob(
    [
      JSON.stringify(
        { version: LIBRARY_BACKUP_VERSION, exportedAt: new Date().toISOString(), tables: dump },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
}

export function previewLibraryBackupJson(text: string): LibraryBackupPreview {
  const backup = parseLibraryBackupJson(text);
  const tables = USER_BACKUP_TABLES.flatMap((name) => {
    const rows = backup.tables[name]?.length ?? 0;
    return rows > 0 ? [{ name, rows }] : [];
  });
  return {
    exportedAt: backup.exportedAt,
    ignoredTables: backup.ignoredTables,
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.rows, 0),
    version: backup.version,
  };
}

export async function importLibraryBackupJson(text: string): Promise<LibraryBackupImportSummary> {
  const backup = parseLibraryBackupJson(text);
  const db = await getDb();
  const { libraryId } = await getSyncIdentity();
  const tableColumns = new Map<UserBackupTable, string[]>();
  const summaryTables: LibraryBackupTableImportSummary[] = [];
  const idMaps = await buildBackupImportIdMaps(db, backup, libraryId);
  const deactivatedAt = Date.now();
  let deactivatedAttachments = 0;
  let imported = 0;
  let redirectedRows = 0;
  let skipped = 0;
  let skippedRuntimeRows = 0;

  await db.exec("BEGIN");
  try {
    for (const table of USER_BACKUP_TABLES) {
      const rows = backup.tables[table] ?? [];
      if (rows.length === 0) continue;
      const columns = await currentTableColumns(db, table, tableColumns);
      let tableImported = 0;
      let tableSkipped = 0;
      for (const row of rows) {
        const {
          row: importRow,
          deactivatedAttachment,
          redirectedRow,
          skippedRuntimeRow,
        } = prepareBackupRowForImport(table, row, deactivatedAt, idMaps);
        if (!importRow) {
          tableSkipped += 1;
          if (skippedRuntimeRow) skippedRuntimeRows += 1;
          continue;
        }
        const insertColumns = columns.filter((column) => Object.hasOwn(importRow, column));
        if (insertColumns.length === 0) {
          tableSkipped += 1;
          continue;
        }
        const placeholders = insertColumns.map(() => "?").join(", ");
        const changes = await db.run(
          `INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${insertColumns
            .map(quoteIdentifier)
            .join(", ")}) VALUES (${placeholders})`,
          insertColumns.map((column) => importRow[column] ?? null),
        );
        if (changes > 0) {
          tableImported += changes;
          if (deactivatedAttachment) deactivatedAttachments += changes;
          if (redirectedRow) redirectedRows += changes;
        } else {
          tableSkipped += 1;
        }
      }
      imported += tableImported;
      skipped += tableSkipped;
      summaryTables.push({
        name: table,
        rows: rows.length,
        imported: tableImported,
        skipped: tableSkipped,
      });
    }
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }

  return {
    deactivatedAttachments,
    ignoredTables: backup.ignoredTables,
    imported,
    redirectedRows,
    skipped,
    skippedRuntimeRows,
    tables: summaryTables,
    totalRows: imported + skipped,
  };
}

function prepareBackupRowForImport(
  table: UserBackupTable,
  row: Record<string, unknown>,
  deactivatedAt: number,
  idMaps: BackupImportIdMaps,
): {
  deactivatedAttachment: boolean;
  redirectedRow: boolean;
  row: Record<string, unknown> | null;
  skippedRuntimeRow: boolean;
} {
  const sanitized = sanitizeBackupRow(table, row);
  if (!sanitized) {
    return {
      deactivatedAttachment: false,
      redirectedRow: false,
      row: null,
      skippedRuntimeRow: false,
    };
  }
  let next: Record<string, unknown> = sanitized;
  let redirectedRow = false;
  const update = (field: string, value: string) => {
    if (next === sanitized) next = { ...sanitized };
    next[field] = value;
  };
  const remap = (field: string, map: Map<string, string>) => {
    const current = typeof next[field] === "string" ? next[field] : null;
    if (!current) return;
    const mapped = map.get(current);
    if (mapped && mapped !== current) {
      update(field, mapped);
      redirectedRow = true;
    }
  };
  const remapGenerated = (field: string, mappedTable: GeneratedBackupIdTable) => {
    remap(field, idMaps.generated[mappedTable] ?? new Map());
  };
  const remapLibraryId = (field: string) => {
    const current = typeof next[field] === "string" ? next[field] : null;
    if (!current) return;
    const mapped = idMaps.libraries.get(current) ?? idMaps.targetLibraryId;
    if (mapped !== current) {
      update(field, mapped);
      redirectedRow = true;
    }
  };

  if (table === "libraries") remapLibraryId("id");
  if (table === "works") remap("id", idMaps.works);
  if (table === "authors") remap("id", idMaps.authors);
  if (table === "tags") remap("id", idMaps.tags);
  if (GENERATED_BACKUP_ID_TABLE_SET.has(table)) {
    remapGenerated("id", table as GeneratedBackupIdTable);
  }

  remapLibraryId("library_id");
  remap("work_id", idMaps.works);
  remap("citing_work_id", idMaps.works);
  remap("cited_work_id", idMaps.works);
  remap("author_id", idMaps.authors);
  remap("tag_id", idMaps.tags);
  remapGenerated("collection_id", "collections");
  remapGenerated("attachment_id", "attachments");
  remapGenerated("annotation_id", "annotations");
  remapGenerated("flashcard_id", "flashcards");
  remapGenerated("task_id", "sentinel_tasks");
  if (next.source_table === "works") remap("source_id", idMaps.works);
  if (
    typeof next.source_table === "string" &&
    GENERATED_BACKUP_ID_TABLE_SET.has(next.source_table as UserBackupTable)
  ) {
    remapGenerated("source_id", next.source_table as GeneratedBackupIdTable);
  }

  if (table === "ai_jobs" && !isPortableAiJobStatus(next.status)) {
    return { deactivatedAttachment: false, redirectedRow, row: null, skippedRuntimeRow: true };
  }

  if (table !== "attachments" || next.deleted_at != null) {
    return { deactivatedAttachment: false, redirectedRow, row: next, skippedRuntimeRow: false };
  }
  if (next === sanitized) next = { ...sanitized };
  next.deleted_at = deactivatedAt;
  next.updated_at =
    typeof sanitized.updated_at === "number"
      ? Math.max(sanitized.updated_at, deactivatedAt)
      : deactivatedAt;
  return {
    deactivatedAttachment: true,
    redirectedRow,
    row: next,
    skippedRuntimeRow: false,
  };
}

function isPortableAiJobStatus(status: unknown): boolean {
  return status === "done" || status === "error";
}

function sanitizeBackupRows(
  table: UserBackupTable,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.flatMap((row) => {
    const sanitized = sanitizeBackupRow(table, row);
    return sanitized ? [sanitized] : [];
  });
}

function sanitizeBackupRow(
  table: UserBackupTable,
  row: Record<string, unknown>,
): Record<string, unknown> | null {
  if (table === "settings") return sanitizeSettingsBackupRow(row);
  return sanitizePortableBackupRow(row);
}

function sanitizePortableBackupRow(row: Record<string, unknown>): Record<string, unknown> {
  return sanitizePortableBackupValue(row) as Record<string, unknown>;
}

function sanitizePortableBackupValue(value: unknown, fieldName = ""): unknown {
  if (fieldName && isSensitiveKeyName(fieldName)) return "";
  if (typeof value === "string") {
    if (fieldName.endsWith("_json")) return sanitizePortableJsonField(value);
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePortableBackupValue(item));
  if (!isStorageRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sanitizePortableBackupValue(nested, key)]),
  );
}

function sanitizePortableJsonField(valueJson: string): string {
  try {
    return JSON.stringify(sanitizePortableBackupValue(JSON.parse(valueJson)));
  } catch {
    return redactSensitiveText(valueJson);
  }
}

function sanitizeSettingsBackupRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const key = typeof row.key === "string" ? row.key : "";
  if (!key || isSensitiveSettingKey(key) || isRuntimeSettingKey(key)) return null;
  if (typeof row.value_json !== "string") return row;
  return {
    ...row,
    value_json: sanitizeSettingsValueJson(row.value_json),
  };
}

function sanitizeSettingsValueJson(valueJson: string): string {
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(valueJson)));
  } catch {
    return JSON.stringify(redactSensitiveText(valueJson));
  }
}

function isSensitiveSettingKey(key: string): boolean {
  return isSensitiveKeyName(key);
}

function isRuntimeSettingKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return (
    normalized === "local.library_id" ||
    normalized === "local.device_id" ||
    normalized.startsWith("sync.")
  );
}

async function buildBackupImportIdMaps(
  db: Database,
  backup: LibraryBackupFile,
  targetLibraryId: string,
): Promise<BackupImportIdMaps> {
  return {
    authors: await buildSimpleUniqueIdMap(db, backup.tables.authors ?? [], "authors", ["orcid"]),
    generated: await buildGeneratedBackupIdMaps(db, backup),
    libraries: buildLibraryIdMap(backup.tables.libraries ?? [], targetLibraryId),
    tags: await buildSimpleUniqueIdMap(db, backup.tables.tags ?? [], "tags", ["name"]),
    targetLibraryId,
    works: await buildWorkIdMap(db, backup.tables.works ?? []),
  };
}

function buildLibraryIdMap(
  rows: Record<string, unknown>[],
  targetLibraryId: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = stringValue(row.id);
    if (id) map.set(id, targetLibraryId);
  }
  return map;
}

async function buildGeneratedBackupIdMaps(
  db: Database,
  backup: LibraryBackupFile,
): Promise<BackupImportIdMaps["generated"]> {
  const maps: BackupImportIdMaps["generated"] = {};
  for (const table of GENERATED_BACKUP_ID_TABLES) {
    const map = await buildConflictingPrimaryIdMap(db, backup.tables[table] ?? [], table);
    if (map.size > 0) maps[table] = map;
  }
  return maps;
}

async function buildConflictingPrimaryIdMap(
  db: Database,
  rows: Record<string, unknown>[],
  table: GeneratedBackupIdTable,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const reservedIds = new Set(rows.map((row) => stringValue(row.id)).filter(Boolean) as string[]);
  const allocatedIds = new Set<string>();
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id || map.has(id)) continue;
    const byId = await existingId(db, table, "id", id);
    if (!byId) continue;
    const replacement = await newBackupImportId(db, table, reservedIds, allocatedIds);
    map.set(id, replacement);
    allocatedIds.add(replacement);
  }
  return map;
}

async function newBackupImportId(
  db: Database,
  table: GeneratedBackupIdTable,
  reservedIds: Set<string>,
  allocatedIds: Set<string>,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = newId();
    if (reservedIds.has(id) || allocatedIds.has(id)) continue;
    if (await existingId(db, table, "id", id)) continue;
    return id;
  }
  throw new Error(`无法为 ${table} 生成不冲突的备份导入 ID。`);
}

async function buildWorkIdMap(
  db: Database,
  rows: Record<string, unknown>[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const byId = await existingId(db, "works", "id", id);
    if (byId) {
      map.set(id, byId);
      continue;
    }
    const stableFields = ["doi", "arxiv_id", "openalex_id", "s2_id", "pmid", "fingerprint"];
    for (const field of stableFields) {
      const value = stringValue(row[field]);
      if (!value) continue;
      const existing = await existingId(db, "works", field, value);
      if (existing) {
        map.set(id, existing);
        break;
      }
    }
  }
  return map;
}

async function buildSimpleUniqueIdMap(
  db: Database,
  rows: Record<string, unknown>[],
  table: "authors" | "tags",
  uniqueFields: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const byId = await existingId(db, table, "id", id);
    if (byId) {
      map.set(id, byId);
      continue;
    }
    for (const field of uniqueFields) {
      const value = stringValue(row[field]);
      if (!value) continue;
      const existing = await existingId(db, table, field, value);
      if (existing) {
        map.set(id, existing);
        break;
      }
    }
  }
  return map;
}

async function existingId(
  db: Database,
  table: "authors" | "tags" | "works" | GeneratedBackupIdTable,
  column: string,
  value: string,
): Promise<string | null> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} = ? LIMIT 1`,
    [value],
  );
  return rows[0]?.id ?? null;
}

function parseLibraryBackupJson(text: string): LibraryBackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效的 JSON。");
  }
  if (!isRecord(parsed)) throw new Error("备份文件格式不正确。");
  const version = typeof parsed.version === "number" ? parsed.version : 0;
  if (!Number.isSafeInteger(version)) throw new Error("备份文件版本缺失或不受支持。");
  if (version < 1) throw new Error("备份文件版本缺失或不受支持。");
  if (version > LIBRARY_BACKUP_VERSION) {
    throw new Error(
      `备份文件版本 ${version} 高于当前支持的版本 ${LIBRARY_BACKUP_VERSION}，请先升级 AuraScholar 后再导入。`,
    );
  }
  if (!isRecord(parsed.tables)) throw new Error("备份文件缺少 tables 数据。");
  const tables: LibraryBackupFile["tables"] = {};
  const ignoredTables: string[] = [];
  for (const [name, value] of Object.entries(parsed.tables)) {
    if (!USER_BACKUP_TABLE_SET.has(name)) {
      ignoredTables.push(name);
      continue;
    }
    if (!Array.isArray(value)) {
      ignoredTables.push(name);
      continue;
    }
    tables[name as UserBackupTable] = value.filter(isRecord);
  }
  return {
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : null,
    ignoredTables,
    tables,
    version,
  };
}

async function currentTableColumns(
  db: Database,
  table: UserBackupTable,
  cache: Map<UserBackupTable, string[]>,
): Promise<string[]> {
  const cached = cache.get(table);
  if (cached) return cached;
  const rows = await db.query<TableInfoRow>(`PRAGMA table_info(${quoteIdentifier(table)})`);
  const columns = rows.map((row) => row.name).filter(Boolean);
  cache.set(table, columns);
  return columns;
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
