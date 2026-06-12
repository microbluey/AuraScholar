// Desktop sync wiring: WebDAV provider from settings + a SyncStorage adapter
// over the real SQLite database.
//
// Current scope (v0.4 milestone): full-library snapshot push/pull is NOT yet
// row-level — this adapter syncs the tables that matter for multi-device
// reading workflows (works, annotations, flashcards state). Blob (PDF) sync
// ships separately.
import { SyncEngine, WebDavProvider, HlcClock, type SyncStorage, type ChangeEntry, type ConflictRecord, type SyncResult } from "@aurascholar/sync";
import type { Database } from "@aurascholar/db";
import { getDb } from "./tauri-db";
import { tauriHttp } from "./tauri-platform";

export interface SyncSettings {
  baseUrl: string;
  username: string;
  password: string;
}

const SETTINGS_KEY = "sync-settings";
const DEVICE_KEY = "device-id";

export function loadSyncSettings(): SyncSettings | null {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SyncSettings;
    return s.baseUrl ? s : null;
  } catch {
    return null;
  }
}

export function saveSyncSettings(s: SyncSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** Tables included in row-level sync, with their synced columns. */
const SYNCED_TABLES: Record<string, string[]> = {
  works: ["doi", "title", "abstract", "year", "publication_date", "venue_name", "venue_type", "type", "arxiv_id", "openalex_id", "pmid", "fingerprint", "csl_json", "reading_status", "starred", "notes_md", "created_at", "updated_at", "deleted_at"],
  annotations: ["attachment_id", "work_id", "type", "color", "page_index", "anchor_json", "content_md", "ink_paths_json", "sort_key", "orphaned", "created_at", "updated_at", "deleted_at"],
  flashcards: ["work_id", "front_md", "back_md", "card_type", "source", "ai_model", "generation_id", "created_at", "updated_at", "deleted_at"],
  sentinel_tasks: ["work_id", "doi", "title", "current_state", "target_flags", "poll_interval_s", "next_poll_at", "last_polled_at", "error_count", "status", "created_at", "updated_at", "deleted_at"],
};

class SqliteSyncStorage implements SyncStorage {
  constructor(
    private readonly db: Database,
    private readonly deviceId: string,
  ) {}

  /**
   * The app's repos don't write sync_log yet (P4 follow-up: route all writes
   * through a logging layer). Until then, push derives entries by snapshotting
   * rows updated since the last push — one entry per row, whole-row values,
   * updated_at as the HLC wall component.
   */
  async unsyncedChanges(afterSeq: number): Promise<ChangeEntry[]> {
    const entries: ChangeEntry[] = [];
    let seq = afterSeq;
    const since = await this.lastPushedAt();
    for (const [table, cols] of Object.entries(SYNCED_TABLES)) {
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT id, ${cols.join(", ")} FROM ${table} WHERE updated_at > ?`,
        [since],
      );
      for (const row of rows) {
        const { id, ...values } = row;
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
      `SELECT value_json FROM settings WHERE key = 'sync.last_pushed_at'`,
    );
    return rows[0] ? Number(JSON.parse(rows[0].value_json)) : 0;
  }

  async markPushed(): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO settings (key, value_json) VALUES ('sync.last_pushed_at', ?)`,
      [JSON.stringify(Date.now())],
    );
  }

  async lastPushedSeq(): Promise<number> {
    return 0; // seq is derived per push; dedup happens via updated_at watermark
  }

  async rowClocks(table: string, rowId: string): Promise<Record<string, string> | null> {
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
      await this.db.run(`INSERT INTO ${table} (id, ${cols.join(", ")}) VALUES (?, ${placeholders})`, [
        rowId,
        ...cols.map((c) => values[c] ?? null),
      ]);
    }
  }

  async applyDelete(table: string, rowId: string): Promise<void> {
    if (!SYNCED_TABLES[table]) return;
    await this.db.run(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`, [Date.now(), rowId]);
  }

  async getCursor(deviceId: string): Promise<number> {
    const rows = await this.db.query<{ last_pulled_cursor: string | null }>(
      `SELECT last_pulled_cursor FROM sync_state WHERE provider_id = ?`,
      [`webdav:${deviceId}`],
    );
    return rows[0]?.last_pulled_cursor ? Number(rows[0].last_pulled_cursor) : 0;
  }

  async setCursor(deviceId: string, seq: number): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO sync_state (provider_id, last_pushed_seq, last_pulled_cursor) VALUES (?, 0, ?)`,
      [`webdav:${deviceId}`, String(seq)],
    );
  }

  async recordConflict(conflict: ConflictRecord): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)`,
      [`sync.conflict.${conflict.table}.${conflict.rowId}.${conflict.column}`, JSON.stringify(conflict)],
    );
  }
}

export async function runSync(): Promise<SyncResult> {
  const settings = loadSyncSettings();
  if (!settings) throw new Error("请先配置 WebDAV 同步(地址、用户名、密码)");
  const db = await getDb();
  const deviceId = getDeviceId();
  const provider = new WebDavProvider({
    http: tauriHttp,
    baseUrl: settings.baseUrl,
    username: settings.username,
    password: settings.password,
  });
  await provider.ping();
  const engine = new SyncEngine(provider, new SqliteSyncStorage(db, deviceId), deviceId, new HlcClock(deviceId));
  return engine.sync();
}

/** Full-library JSON export (works/annotations/flashcards/sentinel + settings). */
export async function exportLibraryJson(): Promise<Blob> {
  const db = await getDb();
  const dump: Record<string, unknown[]> = {};
  for (const table of [...Object.keys(SYNCED_TABLES), "authors", "work_authors", "attachments", "collections", "collection_items", "tags", "work_tags", "annotation_comments", "flashcard_srs", "flashcard_reviews", "sentinel_events", "cv_profiles"]) {
    dump[table] = await db.query(`SELECT * FROM ${table}`);
  }
  return new Blob(
    [JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tables: dump }, null, 2)],
    { type: "application/json" },
  );
}
