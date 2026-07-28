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
  LibraryScopedSyncProvider,
  SPATIAL_CANVAS_BACKUP_TABLES,
  assertSpatialCanvasBackupNodeGroups,
  assertSpatialCanvasBackupOrder,
  columnsForSyncedTable,
  flattenSpatialCanvasBackupNodeGroups,
  remapSpatialCanvasBackupRow,
  safeSnapshotWatermark,
  type MarkPushedOptions,
  type SyncStorage,
  type ChangeEntry,
  type ConflictRecord,
  type SpatialCanvasBackupTable,
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
  sourceLibraryId: string | null;
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
const LIBRARY_BACKUP_VERSION = 2;
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
  ...SPATIAL_CANVAS_BACKUP_TABLES,
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
  ...SPATIAL_CANVAS_BACKUP_TABLES,
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
const SPATIAL_CANVAS_BACKUP_TABLE_SET = new Set<string>(SPATIAL_CANVAS_BACKUP_TABLES);
const EMPTY_BACKUP_ID_MAP = new Map<string, string>();

type UserBackupTable = (typeof USER_BACKUP_TABLES)[number];
type GeneratedBackupIdTable = (typeof GENERATED_BACKUP_ID_TABLES)[number];
type BackupIdTable = "authors" | "tags" | "works" | GeneratedBackupIdTable;

// These v17 tables are deliberately account/app scoped, not Library owned.
// They are exported once in every whole-Library backup and never owner-remapped.
const APP_GLOBAL_BACKUP_TABLES = new Set<UserBackupTable>([
  "settings",
  "discovery_sites",
  "cv_profiles",
]);
const DIRECT_LIBRARY_BACKUP_TABLES = new Set<UserBackupTable>([
  "works",
  "authors",
  "collections",
  "tags",
  "canvas_workspaces",
  "sentinel_tasks",
  "saved_searches",
  "ai_jobs",
  "derived_artifacts",
]);

const BACKUP_SCOPE_SQL: Partial<Record<UserBackupTable, string>> = {
  works: `SELECT t.* FROM works t WHERE t.library_id = ?`,
  authors: `SELECT t.* FROM authors t WHERE t.library_id = ?`,
  work_authors: `SELECT t.* FROM work_authors t
    JOIN works w ON w.id = t.work_id
    JOIN authors a ON a.id = t.author_id
    WHERE w.library_id = ? AND a.library_id = ?`,
  attachments: `SELECT t.* FROM attachments t
    JOIN works w ON w.id = t.work_id
    WHERE w.library_id = ?`,
  collections: `SELECT t.* FROM collections t WHERE t.library_id = ?`,
  collection_items: `SELECT t.* FROM collection_items t
    JOIN collections c ON c.id = t.collection_id
    JOIN works w ON w.id = t.work_id
    WHERE c.library_id = ? AND w.library_id = ?`,
  tags: `SELECT t.* FROM tags t WHERE t.library_id = ?`,
  work_tags: `SELECT t.* FROM work_tags t
    JOIN works w ON w.id = t.work_id
    JOIN tags tag ON tag.id = t.tag_id
    WHERE w.library_id = ? AND tag.library_id = ?`,
  annotations: `SELECT t.* FROM annotations t
    JOIN works w ON w.id = t.work_id
    JOIN attachments att ON att.id = t.attachment_id AND att.work_id = w.id
    WHERE w.library_id = ?`,
  annotation_comments: `SELECT t.* FROM annotation_comments t
    JOIN annotations ann ON ann.id = t.annotation_id
    JOIN works w ON w.id = ann.work_id
    WHERE w.library_id = ?`,
  snippets: `SELECT t.* FROM snippets t
    JOIN works w ON w.id = t.work_id
    WHERE w.library_id = ?`,
  canvas_workspaces: `SELECT t.* FROM canvas_workspaces t WHERE t.library_id = ?`,
  canvas_nodes: `SELECT t.* FROM canvas_nodes t
    JOIN canvas_workspaces cw ON cw.id = t.workspace_id
    WHERE cw.library_id = ?`,
  canvas_edges: `SELECT t.* FROM canvas_edges t
    JOIN canvas_workspaces cw ON cw.id = t.workspace_id
    WHERE cw.library_id = ?`,
  flashcards: `SELECT t.* FROM flashcards t
    JOIN works w ON w.id = t.work_id
    WHERE w.library_id = ?`,
  flashcard_srs: `SELECT t.* FROM flashcard_srs t
    JOIN flashcards f ON f.id = t.flashcard_id
    JOIN works w ON w.id = f.work_id
    WHERE w.library_id = ?`,
  flashcard_reviews: `SELECT t.* FROM flashcard_reviews t
    JOIN flashcards f ON f.id = t.flashcard_id
    JOIN works w ON w.id = f.work_id
    WHERE w.library_id = ?`,
  citations: `SELECT t.* FROM citations t
    JOIN works citing ON citing.id = t.citing_work_id
    JOIN works cited ON cited.id = t.cited_work_id
    WHERE citing.library_id = ? AND cited.library_id = ?`,
  sentinel_tasks: `SELECT t.* FROM sentinel_tasks t WHERE t.library_id = ?`,
  sentinel_events: `SELECT t.* FROM sentinel_events t
    JOIN sentinel_tasks st ON st.id = t.task_id
    WHERE st.library_id = ?`,
  saved_searches: `SELECT t.* FROM saved_searches t WHERE t.library_id = ?`,
  ai_jobs: `SELECT t.* FROM ai_jobs t WHERE t.library_id = ?`,
  derived_artifacts: `SELECT t.* FROM derived_artifacts t WHERE t.library_id = ?`,
};
const BACKUP_IDENTITY_COLUMNS: Record<UserBackupTable, readonly string[]> = {
  libraries: ["id"],
  settings: ["key"],
  works: ["id"],
  authors: ["id"],
  work_authors: ["work_id", "author_id"],
  attachments: ["id"],
  collections: ["id"],
  collection_items: ["collection_id", "work_id"],
  tags: ["id"],
  work_tags: ["work_id", "tag_id"],
  annotations: ["id"],
  annotation_comments: ["id"],
  snippets: ["id"],
  canvas_workspaces: ["id"],
  canvas_nodes: ["id"],
  canvas_edges: ["id"],
  flashcards: ["id"],
  flashcard_srs: ["flashcard_id"],
  flashcard_reviews: ["id"],
  citations: ["citing_work_id", "cited_work_id"],
  sentinel_tasks: ["id"],
  sentinel_events: ["id"],
  discovery_sites: ["id"],
  saved_searches: ["id"],
  cv_profiles: ["id"],
  ai_jobs: ["id"],
  derived_artifacts: ["id"],
};

// Keep the executable import loop honest when new backup tables are added.
assertSpatialCanvasBackupOrder(USER_BACKUP_TABLES);

interface LibraryBackupFile {
  exportedAt: string | null;
  ignoredTables: string[];
  sourceLibraryId: string | null;
  tables: Partial<Record<UserBackupTable, Record<string, unknown>[]>>;
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
  version: number;
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

export class SqliteSyncStorage implements SyncStorage {
  private pendingSnapshotPushedAt: number | null = null;
  private pendingLoggedSeqs: Array<{ databaseSeq: number; transportSeq: number }> = [];

  constructor(
    private readonly db: Database,
    private readonly deviceId: string,
    private readonly libraryId: string,
    private readonly providerScope: string,
    private readonly transportLibraryId: string = libraryId,
  ) {
    if (!libraryId.trim()) throw new Error("Local Library id is required for sync");
    if (!transportLibraryId.trim()) throw new Error("Remote Library scope is required for sync");
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
    if (!Object.hasOwn(values, SYNC_OWNER_COLUMN)) return;
    if (values[SYNC_OWNER_COLUMN] !== this.transportLibraryId) {
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

export async function runSync(): Promise<SyncResult> {
  const settings = await loadSyncSettings();
  if (!settings) throw new Error("请先配置 WebDAV 同步(地址、用户名、密码)");
  const db = await getDb();
  const { deviceId, libraryId } = await getSyncIdentity();
  const providerScope = syncProviderScope(settings);
  // The same normalized WebDAV target is one logical remote Library. Local
  // database Library ids intentionally remain device-local and are mapped at
  // the storage boundary instead of being used as a cross-device namespace.
  const transportLibraryId = `remote:${providerScope}`;
  const remoteProvider = new WebDavProvider({
    http: auraHttp,
    baseUrl: settings.baseUrl,
    username: settings.username,
    password: settings.password,
  });
  await remoteProvider.ping();
  const provider = new LibraryScopedSyncProvider(remoteProvider, transportLibraryId, {
    legacyReadFallback: true,
  });
  const engine = new SyncEngine(
    provider,
    new SqliteSyncStorage(db, deviceId, libraryId, providerScope, transportLibraryId),
    deviceId,
    new HlcClock(deviceId),
  );
  const result = await engine.sync();
  await provider.markBootstrapComplete();
  return result;
}

/** User-data JSON export. Secrets and PDF/blob files are intentionally excluded. */
export async function exportLibraryJson(): Promise<Blob> {
  const db = await getDb();
  const { libraryId } = await getSyncIdentity();
  return exportLibraryJsonFromDatabase(db, libraryId);
}

/** Testable, explicit-scope boundary for exporting one logical Library. */
export async function exportLibraryJsonFromDatabase(
  db: Database,
  libraryId: string,
): Promise<Blob> {
  const dump: Record<string, unknown[]> = {};
  for (const table of USER_BACKUP_TABLES) {
    let rows: Record<string, unknown>[];
    if (table === "libraries") {
      rows = await db.query<Record<string, unknown>>(
        `SELECT * FROM libraries WHERE id = ? AND deleted_at IS NULL`,
        [libraryId],
      );
      if (rows.length !== 1) {
        throw new Error("无法导出：目标 Library 不存在或已删除。");
      }
    } else if (APP_GLOBAL_BACKUP_TABLES.has(table)) {
      rows = await db.query<Record<string, unknown>>(`SELECT * FROM ${quoteIdentifier(table)}`);
    } else {
      const sql = BACKUP_SCOPE_SQL[table];
      if (!sql) throw new Error(`Backup scope is not defined for table ${table}`);
      const params = Array.from(sql.matchAll(/\?/g), () => libraryId);
      rows = await db.query<Record<string, unknown>>(sql, params);
    }
    dump[table] = sanitizeBackupRows(table, rows);
  }
  return new Blob(
    [
      JSON.stringify(
        {
          version: LIBRARY_BACKUP_VERSION,
          exportedAt: new Date().toISOString(),
          sourceLibraryId: libraryId,
          tables: dump,
        },
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
    sourceLibraryId: backup.sourceLibraryId,
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.rows, 0),
    version: backup.version,
  };
}

export async function importLibraryBackupJson(text: string): Promise<LibraryBackupImportSummary> {
  const backup = parseLibraryBackupJson(text);
  const db = await getDb();
  const { libraryId } = await getSyncIdentity();
  return importParsedLibraryBackup(db, backup, libraryId);
}

/**
 * Deterministic database boundary used by the desktop import flow and its
 * transaction-level regression tests.
 */
export async function importLibraryBackupJsonIntoDatabase(
  text: string,
  db: Database,
  libraryId: string,
): Promise<LibraryBackupImportSummary> {
  return importParsedLibraryBackup(db, parseLibraryBackupJson(text), libraryId);
}

async function importParsedLibraryBackup(
  db: Database,
  backup: LibraryBackupFile,
  libraryId: string,
): Promise<LibraryBackupImportSummary> {
  const tableColumns = new Map<UserBackupTable, string[]>();
  const summaryTables: LibraryBackupTableImportSummary[] = [];
  const deactivatedAt = Date.now();
  let deactivatedAttachments = 0;
  let imported = 0;
  let redirectedRows = 0;
  let skipped = 0;
  let skippedRuntimeRows = 0;

  await db.exec("BEGIN");
  try {
    const idMaps = await buildBackupImportIdMaps(db, backup, libraryId);
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
        const insertMode = SPATIAL_CANVAS_BACKUP_TABLE_SET.has(table)
          ? "INSERT"
          : "INSERT OR IGNORE";
        const changes = await db.run(
          `${insertMode} INTO ${quoteIdentifier(table)} (${insertColumns
            .map(quoteIdentifier)
            .join(", ")}) VALUES (${placeholders})`,
          insertColumns.map((column) => importRow[column] ?? null),
        );
        if (changes > 0) {
          tableImported += changes;
          if (deactivatedAttachment) deactivatedAttachments += changes;
          if (redirectedRow) redirectedRows += changes;
        } else {
          await assertSkippedBackupRowIsInTargetLibrary(
            db,
            table,
            importRow,
            idMaps.targetLibraryId,
          );
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
    const mapped = idMaps.libraries.get(current);
    if (!mapped && idMaps.version >= 2) {
      throw new Error(`v2 备份包含未知的 Library owner：${table}.${field}`);
    }
    const target = mapped ?? idMaps.targetLibraryId;
    if (target !== current) {
      update(field, target);
      redirectedRow = true;
    }
  };

  if (SPATIAL_CANVAS_BACKUP_TABLE_SET.has(table)) {
    const canvasRemap = remapSpatialCanvasBackupRow(table as SpatialCanvasBackupTable, next, {
      annotations: idMaps.generated.annotations ?? EMPTY_BACKUP_ID_MAP,
      attachments: idMaps.generated.attachments ?? EMPTY_BACKUP_ID_MAP,
      edges: idMaps.generated.canvas_edges ?? EMPTY_BACKUP_ID_MAP,
      nodes: idMaps.generated.canvas_nodes ?? EMPTY_BACKUP_ID_MAP,
      works: idMaps.works,
      workspaces: idMaps.generated.canvas_workspaces ?? EMPTY_BACKUP_ID_MAP,
    });
    if (canvasRemap.redirected) {
      next = canvasRemap.row;
      redirectedRow = true;
    }
  }

  if (table === "libraries") remapLibraryId("id");
  if (table === "works") remap("id", idMaps.works);
  if (table === "authors") remap("id", idMaps.authors);
  if (table === "tags") remap("id", idMaps.tags);
  if (GENERATED_BACKUP_ID_TABLE_SET.has(table) && !SPATIAL_CANVAS_BACKUP_TABLE_SET.has(table)) {
    remapGenerated("id", table as GeneratedBackupIdTable);
  }

  remapLibraryId("library_id");
  if (DIRECT_LIBRARY_BACKUP_TABLES.has(table) && next.library_id !== idMaps.targetLibraryId) {
    update("library_id", idMaps.targetLibraryId);
    redirectedRow = true;
  }
  remap("work_id", idMaps.works);
  remap("citing_work_id", idMaps.works);
  remap("cited_work_id", idMaps.works);
  remap("author_id", idMaps.authors);
  remap("tag_id", idMaps.tags);
  remapGenerated("collection_id", "collections");
  remapGenerated("parent_id", "collections");
  remapGenerated("attachment_id", "attachments");
  remapGenerated("annotation_id", "annotations");
  remapGenerated("flashcard_id", "flashcards");
  remapGenerated("task_id", "sentinel_tasks");
  if (next.source_table === "works") remap("source_id", idMaps.works);
  if (next.source_table === "authors") remap("source_id", idMaps.authors);
  if (next.source_table === "tags") remap("source_id", idMaps.tags);
  if (next.source_table === "libraries") remap("source_id", idMaps.libraries);
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
  const target = await db.query<{ id: string }>(
    `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [targetLibraryId],
  );
  if (target.length !== 1) {
    throw new Error("无法导入：目标 Library 不存在或已删除。");
  }
  return {
    authors: await buildScopedUniqueIdMap(
      db,
      backup.tables.authors ?? [],
      "authors",
      ["orcid"],
      targetLibraryId,
    ),
    generated: await buildGeneratedBackupIdMaps(db, backup),
    libraries: buildLibraryIdMap(backup, targetLibraryId),
    tags: await buildScopedUniqueIdMap(
      db,
      backup.tables.tags ?? [],
      "tags",
      ["name"],
      targetLibraryId,
    ),
    targetLibraryId,
    version: backup.version,
    works: await buildScopedUniqueIdMap(
      db,
      backup.tables.works ?? [],
      "works",
      ["doi", "arxiv_id", "openalex_id", "s2_id", "pmid", "fingerprint"],
      targetLibraryId,
    ),
  };
}

function buildLibraryIdMap(
  backup: LibraryBackupFile,
  targetLibraryId: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of backup.tables.libraries ?? []) {
    const id = stringValue(row.id);
    if (id) map.set(id, targetLibraryId);
  }
  if (backup.sourceLibraryId) map.set(backup.sourceLibraryId, targetLibraryId);
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
  table: BackupIdTable,
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

async function buildScopedUniqueIdMap(
  db: Database,
  rows: Record<string, unknown>[],
  table: "authors" | "tags" | "works",
  uniqueFields: readonly string[],
  targetLibraryId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const reservedIds = new Set(rows.map((row) => stringValue(row.id)).filter(Boolean) as string[]);
  const allocatedIds = new Set<string>();
  for (const row of rows) {
    const id = stringValue(row.id);
    if (!id) continue;
    const byId = await existingScopedId(db, table, "id", id, targetLibraryId);
    if (byId) {
      map.set(id, byId);
      continue;
    }
    let matchedTargetId: string | null = null;
    for (const field of uniqueFields) {
      const value = stringValue(row[field]);
      if (!value) continue;
      const existing = await existingScopedId(db, table, field, value, targetLibraryId);
      if (existing) {
        map.set(id, existing);
        matchedTargetId = existing;
        break;
      }
    }
    if (matchedTargetId) continue;
    if (await existingId(db, table, "id", id)) {
      const replacement = await newBackupImportId(db, table, reservedIds, allocatedIds);
      map.set(id, replacement);
      allocatedIds.add(replacement);
    }
  }
  return map;
}

async function existingId(
  db: Database,
  table: BackupIdTable,
  column: string,
  value: string,
): Promise<string | null> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} = ? LIMIT 1`,
    [value],
  );
  return rows[0]?.id ?? null;
}

async function existingScopedId(
  db: Database,
  table: "authors" | "tags" | "works",
  column: string,
  value: string,
  libraryId: string,
): Promise<string | null> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM ${quoteIdentifier(table)}
     WHERE ${quoteIdentifier(column)} = ? AND library_id = ?
     LIMIT 1`,
    [value, libraryId],
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
  if (tables.canvas_nodes) {
    tables.canvas_nodes = flattenSpatialCanvasBackupNodeGroups(tables.canvas_nodes);
  }
  assertSpatialCanvasBackupNodeGroups(tables.canvas_nodes ?? []);
  validateBackupIdentities(tables);
  const sourceLibraryId =
    version >= 2
      ? stringValue(parsed.sourceLibraryId)
      : inferLegacyBackupLibraryId(tables.libraries ?? []);
  if (version >= 2) {
    if (!sourceLibraryId) {
      throw new Error("备份文件缺少 sourceLibraryId。");
    }
    validateV2BackupOwnership(tables, sourceLibraryId);
  }
  validateBackupRelationships(tables);
  return {
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : null,
    ignoredTables,
    sourceLibraryId,
    tables,
    version,
  };
}

function validateBackupIdentities(tables: LibraryBackupFile["tables"]): void {
  for (const table of USER_BACKUP_TABLES) {
    const identityColumns = BACKUP_IDENTITY_COLUMNS[table];
    const identities = new Set<string>();
    for (const row of tables[table] ?? []) {
      const identityValues = identityColumns.map((column) => stringValue(row[column]));
      const missingColumnIndex = identityValues.findIndex((value) => value === null);
      if (missingColumnIndex >= 0) {
        throw new Error(
          `备份包含缺失或无效的行标识：${table}.${identityColumns[missingColumnIndex]}`,
        );
      }
      const identity = JSON.stringify(identityValues);
      if (identities.has(identity)) {
        throw new Error(`备份包含重复的行标识：${table}.${identityColumns.join("+")}`);
      }
      identities.add(identity);
    }
  }
}

function inferLegacyBackupLibraryId(rows: readonly Record<string, unknown>[]): string | null {
  const ids = new Set(rows.map((row) => stringValue(row.id)).filter(Boolean) as string[]);
  return ids.size === 1 ? [...ids][0]! : null;
}

function validateV2BackupOwnership(
  tables: LibraryBackupFile["tables"],
  sourceLibraryId: string,
): void {
  const libraryRows = tables.libraries ?? [];
  if (libraryRows.length !== 1 || stringValue(libraryRows[0]?.id) !== sourceLibraryId) {
    throw new Error("v2 备份必须且只能包含 sourceLibraryId 对应的 Library。");
  }
  for (const table of DIRECT_LIBRARY_BACKUP_TABLES) {
    for (const row of tables[table] ?? []) {
      if (stringValue(row.library_id) !== sourceLibraryId) {
        throw new Error(`v2 备份包含混合或缺失的 Library owner：${table}`);
      }
    }
  }
}

function validateBackupRelationships(tables: LibraryBackupFile["tables"]): void {
  const ids = new Map<UserBackupTable, Set<string>>();
  const tableIds = (table: UserBackupTable): Set<string> => {
    const cached = ids.get(table);
    if (cached) return cached;
    const next = new Set(
      (tables[table] ?? []).map((row) => stringValue(row.id)).filter(Boolean) as string[],
    );
    ids.set(table, next);
    return next;
  };
  const assertReference = (
    table: UserBackupTable,
    field: string,
    targetTable: UserBackupTable,
    required = true,
  ) => {
    const targetIds = tableIds(targetTable);
    for (const row of tables[table] ?? []) {
      const value = stringValue(row[field]);
      if (!value) {
        if (!required) continue;
        throw new Error(`v2 备份包含缺失的 Library 关系：${table}.${field}`);
      }
      if (!targetIds.has(value)) {
        throw new Error(`v2 备份包含跨 Library 关系：${table}.${field}`);
      }
    }
  };

  assertReference("work_authors", "work_id", "works");
  assertReference("work_authors", "author_id", "authors");
  assertReference("attachments", "work_id", "works");
  assertReference("collections", "parent_id", "collections", false);
  assertReference("collection_items", "collection_id", "collections");
  assertReference("collection_items", "work_id", "works");
  assertReference("work_tags", "work_id", "works");
  assertReference("work_tags", "tag_id", "tags");
  assertReference("annotations", "work_id", "works");
  assertReference("annotations", "attachment_id", "attachments");
  assertReference("annotation_comments", "annotation_id", "annotations");
  assertReference("snippets", "work_id", "works");
  assertReference("canvas_nodes", "workspace_id", "canvas_workspaces");
  assertReference("canvas_nodes", "work_id", "works", false);
  assertReference("canvas_nodes", "group_id", "canvas_nodes", false);
  assertReference("canvas_edges", "workspace_id", "canvas_workspaces");
  assertReference("canvas_edges", "source_id", "canvas_nodes");
  assertReference("canvas_edges", "target_id", "canvas_nodes");
  assertReference("flashcards", "work_id", "works");
  assertReference("flashcard_srs", "flashcard_id", "flashcards");
  assertReference("flashcard_reviews", "flashcard_id", "flashcards");
  assertReference("citations", "citing_work_id", "works");
  assertReference("citations", "cited_work_id", "works");
  assertReference("sentinel_tasks", "work_id", "works", false);
  assertReference("sentinel_events", "task_id", "sentinel_tasks");
  assertReference("ai_jobs", "work_id", "works", false);

  const scopedDerivedSources = new Set<UserBackupTable>([
    "libraries",
    "works",
    "authors",
    "attachments",
    "collections",
    "tags",
    "annotations",
    "annotation_comments",
    "snippets",
    "canvas_workspaces",
    "canvas_nodes",
    "canvas_edges",
    "flashcards",
    "flashcard_reviews",
    "sentinel_tasks",
    "sentinel_events",
    "saved_searches",
    "ai_jobs",
    "derived_artifacts",
  ]);
  for (const row of tables.derived_artifacts ?? []) {
    const sourceTable = stringValue(row.source_table);
    const sourceId = stringValue(row.source_id);
    if (!sourceTable || !sourceId) {
      throw new Error("备份包含缺失的 Library 关系：derived_artifacts.source_id");
    }
    if (
      scopedDerivedSources.has(sourceTable as UserBackupTable) &&
      !tableIds(sourceTable as UserBackupTable).has(sourceId)
    ) {
      throw new Error("备份包含跨 Library 关系：derived_artifacts.source_id");
    }
  }

  validateCanvasNodeDataReferences(tables, tableIds);
}

function validateCanvasNodeDataReferences(
  tables: LibraryBackupFile["tables"],
  tableIds: (table: UserBackupTable) => Set<string>,
): void {
  const nodeRows = tables.canvas_nodes ?? [];
  const works = tableIds("works");
  const attachments = tableIds("attachments");
  const annotations = tableIds("annotations");
  const nodes = tableIds("canvas_nodes");
  const nodeWorkspaces = new Map(
    nodeRows.flatMap((row) => {
      const id = stringValue(row.id);
      const workspaceId = stringValue(row.workspace_id);
      return id && workspaceId ? [[id, workspaceId] as const] : [];
    }),
  );

  for (const row of nodeRows) {
    if (typeof row.data_json !== "string") {
      throw new Error("Spatial Canvas backup node has invalid data_json");
    }
    let data: unknown;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      throw new Error("Spatial Canvas backup node has malformed data_json");
    }
    if (!isRecord(data)) throw new Error("Spatial Canvas backup node has invalid data_json");

    const nodeId = stringValue(row.id);
    const workspaceId = nodeId ? nodeWorkspaces.get(nodeId) : undefined;
    if (row.type === "paper" || row.type === "excerpt") {
      const workId = stringValue(data.workId);
      if (!workId || !works.has(workId) || stringValue(row.work_id) !== workId) {
        throw new Error("备份包含跨 Library 关系：canvas_nodes.data_json.workId");
      }
    }
    if (row.type === "excerpt") {
      const annotationId = stringValue(data.annotationId);
      const attachmentId = stringValue(data.attachmentId);
      if (annotationId && !annotations.has(annotationId)) {
        throw new Error("备份包含跨 Library 关系：canvas_nodes.data_json.annotationId");
      }
      if (attachmentId && !attachments.has(attachmentId)) {
        throw new Error("备份包含跨 Library 关系：canvas_nodes.data_json.attachmentId");
      }
    }
    if (row.type === "ai-synth" && data.sourceNodeIds !== undefined) {
      if (
        !Array.isArray(data.sourceNodeIds) ||
        !data.sourceNodeIds.every((id) => typeof id === "string")
      ) {
        throw new Error("Spatial Canvas AI synthesis node has invalid sourceNodeIds");
      }
      for (const sourceNodeId of data.sourceNodeIds) {
        if (!nodes.has(sourceNodeId) || nodeWorkspaces.get(sourceNodeId) !== workspaceId) {
          throw new Error("备份包含跨 Library 关系：canvas_nodes.data_json.sourceNodeIds");
        }
      }
    }
  }
}

async function assertSkippedBackupRowIsInTargetLibrary(
  db: Database,
  table: UserBackupTable,
  row: Record<string, unknown>,
  targetLibraryId: string,
): Promise<void> {
  if (APP_GLOBAL_BACKUP_TABLES.has(table)) return;
  if (table === "libraries") {
    const id = stringValue(row.id);
    if (id !== targetLibraryId) {
      throw new Error("备份导入遇到跨 Library 主键冲突：libraries.id");
    }
    const target = await db.query<{ id: string }>(
      `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [targetLibraryId],
    );
    if (!target[0]) throw new Error("备份导入目标 Library 已失效。");
    return;
  }

  const scopeSql = BACKUP_SCOPE_SQL[table];
  if (!scopeSql) throw new Error(`Backup scope is not defined for table ${table}`);
  const identityColumns = BACKUP_IDENTITY_COLUMNS[table];
  const identityValues = identityColumns.map((column) => row[column]);
  if (identityValues.some((value) => value === null || value === undefined || value === "")) {
    throw new Error(`备份导入无法验证冲突行：${table}`);
  }
  const libraryParams = Array.from(scopeSql.matchAll(/\?/g), () => targetLibraryId);
  const safeRows = await db.query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM (${scopeSql}) scoped
     WHERE ${identityColumns.map((column) => `scoped.${quoteIdentifier(column)} = ?`).join(" AND ")}
     LIMIT 1`,
    [...libraryParams, ...identityValues],
  );
  if (!safeRows[0]) {
    throw new Error(`备份导入遇到跨 Library 主键或唯一键冲突：${table}`);
  }
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
