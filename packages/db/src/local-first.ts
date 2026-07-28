import type { Database } from "./database.js";
import { newId } from "./ids.js";

export const LOCAL_LIBRARY_ID_KEY = "local.library_id";
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

type LocalFirstIdentityDatabase = Pick<Database, "query" | "run">;

/**
 * Resolve the durable local Library identity used to own all Library-scoped
 * rows. Migrations call this before adding NOT NULL ownership columns, while
 * normal startup calls it again; both paths must converge on the same id.
 */
export async function ensureLocalLibraryIdentity(
  db: LocalFirstIdentityDatabase,
  options: Pick<EnsureLocalFirstOptions, "libraryName"> = {},
): Promise<string> {
  const now = Date.now();
  const rows = await db.query<{ value_json: string | null }>(
    `SELECT value_json FROM settings WHERE key = ?`,
    [LOCAL_LIBRARY_ID_KEY],
  );

  let libraryId: string | undefined;
  if (rows[0]?.value_json) {
    try {
      const value = JSON.parse(rows[0].value_json);
      if (typeof value === "string" && value.trim()) libraryId = value;
    } catch {
      // A malformed local setting is replaced below with a deterministic
      // existing Library (when available) or a newly generated id.
    }
  }

  if (!libraryId) {
    const existing = await db.query<{ id: string }>(
      `SELECT id
       FROM libraries
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    );
    libraryId = existing[0]?.id ?? newId();
  }

  await db.run(
    `INSERT INTO libraries (id, name, kind, created_at, updated_at, deleted_at)
     VALUES (?, ?, 'personal', ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
    [libraryId, options.libraryName ?? "Personal Library", now, now],
  );

  await db.run(
    `INSERT INTO settings (key, value_json, scope, updated_at)
     VALUES (?, ?, 'local', ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       scope = 'local',
       updated_at = excluded.updated_at`,
    [LOCAL_LIBRARY_ID_KEY, JSON.stringify(libraryId), now],
  );

  return libraryId;
}

/**
 * Read the active local Library identity without repairing or mutating state.
 * Runtime repositories use this fail-closed path so a missing/deleted Library
 * can never silently redirect a write into a newly created ownership scope.
 */
export async function requireLocalLibraryId(db: LocalFirstIdentityDatabase): Promise<string> {
  const rows = await db.query<{ value_json: string | null }>(
    `SELECT value_json FROM settings WHERE key = ?`,
    [LOCAL_LIBRARY_ID_KEY],
  );

  let libraryId: string;
  try {
    const value = JSON.parse(rows[0]?.value_json ?? "");
    if (typeof value !== "string" || !value.trim()) throw new Error("empty Library id");
    libraryId = value;
  } catch {
    throw new Error("Local Library identity is missing or malformed");
  }

  const libraries = await db.query<{ id: string }>(
    `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [libraryId],
  );
  if (!libraries[0]) {
    throw new Error(`Local Library identity is not active: ${libraryId}`);
  }

  return libraryId;
}

export async function ensureLocalFirstState(
  db: Database,
  options: EnsureLocalFirstOptions = {},
): Promise<LocalFirstState> {
  const now = Date.now();
  const libraryId = await ensureLocalLibraryIdentity(db, options);
  const deviceId = await getOrCreateSetting(db, DEVICE_ID_KEY, () => options.deviceId ?? newId());

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
