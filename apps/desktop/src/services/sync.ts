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
  type SyncStorage,
  type ChangeEntry,
  type ConflictRecord,
  type SyncResult,
} from "@aurascholar/sync";
import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState, type LocalFirstState } from "@aurascholar/db/local-first";
import { getDb } from "./aura-db";
import { auraHttp } from "./aura-platform";
import { SECRET_KEYS, getSecret, migrateInlineSecret, setSecret } from "./secrets";
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

const SETTINGS_KEY = "sync-settings";

export async function loadSyncSettings(): Promise<SyncSettings | null> {
  const parsed = readLocalStorageJson<unknown>(SETTINGS_KEY, null);
  if (!isStorageRecord(parsed)) return null;

  const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl : "";
  if (!baseUrl) return null;
  const username = typeof parsed.username === "string" ? parsed.username : "";
  const inlinePassword = typeof parsed.password === "string" ? parsed.password : "";

  // Migrate any inline plaintext password into the secret store.
  const migrated = await migrateInlineSecret(SECRET_KEYS.syncPassword, inlinePassword);
  if (inlinePassword) {
    tryWriteLocalStorageJson(SETTINGS_KEY, { baseUrl, username, password: "" });
  }
  const password = migrated || (await getSecret(SECRET_KEYS.syncPassword));
  return { baseUrl, username, password };
}

export async function saveSyncSettings(s: SyncSettings): Promise<void> {
  const { password, ...config } = s;
  writeLocalStorageJson(SETTINGS_KEY, { ...config, password: "" });
  await setSecret(SECRET_KEYS.syncPassword, password);
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

class SqliteSyncStorage implements SyncStorage {
  constructor(
    private readonly db: Database,
    private readonly deviceId: string,
    private readonly libraryId: string,
  ) {}

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
    for (const [table, cols] of Object.entries(SYNCED_TABLES)) {
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT id, ${cols.join(", ")} FROM ${table} WHERE updated_at > ?`,
        [since],
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
      [`sync.${this.libraryId}.last_pushed_at`],
    );
    return rows[0] ? Number(JSON.parse(rows[0].value_json)) : 0;
  }

  async markPushed(uptoSeq: number): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `INSERT INTO settings (key, value_json, scope, updated_at) VALUES (?, ?, 'local', ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, scope = 'local', updated_at = excluded.updated_at`,
      [`sync.${this.libraryId}.last_pushed_at`, JSON.stringify(now), now],
    );
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

  async rowClocks(table: string, rowId: string): Promise<Record<string, string> | null> {
    const stored = await this.db.query<{ column_hlcs_json: string }>(
      `SELECT column_hlcs_json FROM sync_row_clocks WHERE table_name = ? AND row_id = ?`,
      [table, rowId],
    );
    if (stored[0]) return JSON.parse(stored[0].column_hlcs_json) as Record<string, string>;

    const cols = SYNCED_TABLES[table];
    if (!cols) return null;
    const rows = await this.db.query<{ updated_at: number }>(
      `SELECT updated_at FROM ${table} WHERE id = ?`,
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
    const cols = Object.keys(values).filter((c) => SYNCED_TABLES[table]?.includes(c));
    if (cols.length === 0) return;
    const exists = await this.db.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [
      rowId,
    ]);
    if (exists.length > 0) {
      const sets = cols.map((c) => `${c} = ?`).join(", ");
      await this.db.run(`UPDATE ${table} SET ${sets} WHERE id = ?`, [
        ...cols.map((c) => values[c] ?? null),
        rowId,
      ]);
    } else {
      const placeholders = cols.map(() => "?").join(", ");
      await this.db.run(
        `INSERT INTO ${table} (id, ${cols.join(", ")}) VALUES (?, ${placeholders})`,
        [rowId, ...cols.map((c) => values[c] ?? null)],
      );
    }
    await this.writeRowClocks(table, rowId, columnHlcs);
  }

  async applyDelete(table: string, rowId: string, hlc: string): Promise<void> {
    if (!SYNCED_TABLES[table]) return;
    await this.db.run(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`, [Date.now(), rowId]);
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
    return rows.map((row) => ({
      seq: row.seq,
      table: row.entity_table,
      rowId: row.entity_id,
      op: row.op,
      values: row.values_json ? (JSON.parse(row.values_json) as Record<string, unknown>) : {},
      columnHlcs: row.column_hlcs_json
        ? (JSON.parse(row.column_hlcs_json) as Record<string, string>)
        : {},
      hlc: row.hlc,
      deviceId: row.device_id,
    }));
  }

  private async writeRowClocks(
    table: string,
    rowId: string,
    columnHlcs: Record<string, string>,
  ): Promise<void> {
    const current = (await this.rowClocks(table, rowId)) ?? {};
    const merged = { ...current, ...columnHlcs };
    await this.db.run(
      `INSERT INTO sync_row_clocks (table_name, row_id, library_id, column_hlcs_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(table_name, row_id) DO UPDATE SET library_id = excluded.library_id, column_hlcs_json = excluded.column_hlcs_json, updated_at = excluded.updated_at`,
      [table, rowId, this.libraryId, JSON.stringify(merged), Date.now()],
    );
  }

  private localStateProviderId(): string {
    return `webdav:${this.libraryId}:local`;
  }

  private remoteStateProviderId(deviceId: string): string {
    return `webdav:${this.libraryId}:${deviceId}`;
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
    new SqliteSyncStorage(db, deviceId, libraryId),
    deviceId,
    new HlcClock(deviceId),
  );
  return engine.sync();
}

/** Full-library JSON export (works/annotations/flashcards/sentinel + settings). */
export async function exportLibraryJson(): Promise<Blob> {
  const db = await getDb();
  const dump: Record<string, unknown[]> = {};
  for (const table of [
    ...Object.keys(SYNCED_TABLES),
    "authors",
    "work_authors",
    "attachments",
    "collections",
    "collection_items",
    "tags",
    "work_tags",
    "annotation_comments",
    "flashcard_srs",
    "flashcard_reviews",
    "sentinel_events",
    "cv_profiles",
  ]) {
    dump[table] = await db.query(`SELECT * FROM ${table}`);
  }
  return new Blob(
    [JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tables: dump }, null, 2)],
    { type: "application/json" },
  );
}
