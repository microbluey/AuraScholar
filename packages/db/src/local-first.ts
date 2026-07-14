import type { Database } from "./database.js";
import { newId } from "./ids.js";

const LIBRARY_ID_KEY = "local.library_id";
const DEVICE_ID_KEY = "local.device_id";

export interface LocalFirstState {
  libraryId: string;
  deviceId: string;
}

export interface EnsureLocalFirstOptions {
  libraryName?: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
}

export async function ensureLocalFirstState(
  db: Database,
  options: EnsureLocalFirstOptions = {},
): Promise<LocalFirstState> {
  const now = Date.now();
  const libraryId = await getOrCreateSetting(db, LIBRARY_ID_KEY, newId);
  const deviceId = await getOrCreateSetting(db, DEVICE_ID_KEY, () => options.deviceId ?? newId());

  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'personal', ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = COALESCE(libraries.name, excluded.name), updated_at = excluded.updated_at`,
    [libraryId, options.libraryName ?? "Personal Library", now, now],
  );

  await db.run(
    `INSERT INTO devices (device_id, name, platform, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET name = excluded.name, platform = excluded.platform, last_seen_at = excluded.last_seen_at`,
    [deviceId, options.deviceName ?? "This device", options.platform ?? "unknown", now],
  );

  return { libraryId, deviceId };
}

async function getOrCreateSetting(
  db: Database,
  key: string,
  create: () => string,
): Promise<string> {
  const rows = await db.query<{ value_json: string | null }>(
    `SELECT value_json FROM settings WHERE key = ?`,
    [key],
  );
  if (rows[0]?.value_json) {
    try {
      const value = JSON.parse(rows[0].value_json);
      if (typeof value === "string" && value.trim()) return value;
    } catch {
      // Fall through and replace malformed local metadata.
    }
  }

  const value = create();
  await db.run(
    `INSERT INTO settings (key, value_json, scope, updated_at)
     VALUES (?, ?, 'local', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, scope = 'local', updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), Date.now()],
  );
  return value;
}
