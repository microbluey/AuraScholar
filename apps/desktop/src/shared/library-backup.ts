import { newId, type Database } from "@aurascholar/db";
import {
  isSensitiveKeyName,
  redactSensitiveText,
  redactSensitiveValue,
} from "@aurascholar/platform";
import {
  SPATIAL_CANVAS_BACKUP_TABLES,
  assertSpatialCanvasBackupNodeGroups,
  assertSpatialCanvasBackupOrder,
  flattenSpatialCanvasBackupNodeGroups,
  remapSpatialCanvasBackupRow,
  type SpatialCanvasBackupTable,
} from "@aurascholar/sync";

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

export const LIBRARY_BACKUP_VERSION = 2;

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

/**
 * Parsed and fully validated backup payload. Callers should treat this as an
 * opaque value produced only by {@link parseLibraryBackupJson}.
 */
export interface LibraryBackupFile {
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

/**
 * Creates a portable JSON backup for one logical Library.
 *
 * This intentionally returns a string rather than a Blob so it can run in
 * either the renderer or Electron main process.
 */
export async function exportLibraryBackupJsonFromDatabase(
  db: Database,
  libraryId: string,
): Promise<string> {
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
  return JSON.stringify(
    {
      version: LIBRARY_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      sourceLibraryId: libraryId,
      tables: dump,
    },
    null,
    2,
  );
}

export function previewParsedLibraryBackup(backup: LibraryBackupFile): LibraryBackupPreview {
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

export function previewLibraryBackupJson(text: string): LibraryBackupPreview {
  return previewParsedLibraryBackup(parseLibraryBackupJson(text));
}

/**
 * Imports a payload that has already passed parse/graph validation.
 *
 * This is the transaction core: the caller must invoke it inside one exclusive
 * database transaction. Target validation, ID-map construction, conflict
 * checks, and every write occur here, without opening or closing a transaction.
 */
export async function importParsedLibraryBackupIntoDatabase(
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
      const insertMode = SPATIAL_CANVAS_BACKUP_TABLE_SET.has(table) ? "INSERT" : "INSERT OR IGNORE";
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
        await assertSkippedBackupRowIsInTargetLibrary(db, table, importRow, idMaps.targetLibraryId);
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
  if (!isRecord(value)) return value;
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
  if (!key || isSensitiveKeyName(key) || isRuntimeSettingKey(key)) return null;
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

/**
 * Parses and validates a backup without touching the database. Main-process
 * callers can perform this work before entering a write coordinator.
 */
export function parseLibraryBackupJson(text: string): LibraryBackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("备份文件不是有效的 JSON。");
  }
  if (!isRecord(parsed)) throw new Error("备份文件格式不正确。");
  const version = typeof parsed.version === "number" ? parsed.version : 0;
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("备份文件版本缺失或不受支持。");
  }
  if (version > LIBRARY_BACKUP_VERSION) {
    throw new Error(
      `备份文件版本 ${version} 高于当前支持的版本 ${LIBRARY_BACKUP_VERSION}，请先升级 AuraScholar 后再导入。`,
    );
  }
  if (!isRecord(parsed.tables)) throw new Error("备份文件缺少 tables 数据。");
  const tables: LibraryBackupFile["tables"] = {};
  const ignoredTables: string[] = [];
  for (const [name, value] of Object.entries(parsed.tables)) {
    if (!USER_BACKUP_TABLE_SET.has(name) || !Array.isArray(value)) {
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
