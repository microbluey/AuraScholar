import { newId, type Database } from "@aurascholar/db";
import {
  assertDocumentEvidenceBackupOrder,
  assertSpatialCanvasBackupNodeGroups,
  assertSpatialCanvasBackupOrder,
  flattenSpatialCanvasBackupNodeGroups,
} from "@aurascholar/sync";
import {
  APP_GLOBAL_BACKUP_TABLES,
  BACKUP_IDENTITY_COLUMNS,
  BACKUP_SCOPE_SQL,
  DIRECT_LIBRARY_BACKUP_TABLES,
  GENERATED_BACKUP_ID_TABLES,
  SCOPED_DERIVED_SOURCE_TABLES,
  SPATIAL_CANVAS_BACKUP_TABLE_SET,
  USER_BACKUP_TABLES,
  USER_BACKUP_TABLE_SET,
  type BackupIdTable,
  type GeneratedBackupIdTable,
  type UserBackupTable,
} from "./library-backup-config";
import {
  assertKnowledgeTablesMatchVersion,
  buildProjectWorkMembershipIdMap,
  finalizeKnowledgeImportIdMaps,
  knowledgeIdMaps,
  RESEARCH_PROJECT_BACKUP_VERSION,
  validateKnowledgeBackupGraph,
  validateProjectWorkMembershipIdentities,
} from "./library-backup-evidence";
import { finalizeImportedDocumentEvidence } from "../services/library-backup-evidence";
import { sanitizeBackupRows } from "./library-backup-sanitizer";
import {
  assertEvidenceShelfTablesMatchVersion,
  EVIDENCE_SHELF_BACKUP_VERSION,
  validateEvidenceShelfBackupGraph,
} from "./library-backup-shelf";
import {
  prepareBackupRowForImport as prepareBackupRowForImportImpl,
  type BackupImportIdMaps,
} from "./library-backup-import-row";
import { createEvidenceShelfBudgetTracker } from "./library-backup-budget";

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

// v6 adds project-local Evidence Shelf snapshots; v5 saved-search and v4
// document/evidence backups remain importable.
export const LIBRARY_BACKUP_VERSION = EVIDENCE_SHELF_BACKUP_VERSION;
const EMPTY_BACKUP_ID_MAP = new Map<string, string>();
// Keep the executable import loop honest when new backup tables are added.
assertSpatialCanvasBackupOrder(USER_BACKUP_TABLES);
assertDocumentEvidenceBackupOrder(USER_BACKUP_TABLES);

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
  const dump: LibraryBackupFile["tables"] = {};
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
  validateEvidenceShelfBackupGraph(dump, LIBRARY_BACKUP_VERSION);
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

/** Imports a parsed, graph-validated backup inside the caller's transaction. */
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
  const shelfBudget = createEvidenceShelfBudgetTracker();

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
      if (table === "evidence_shelf_items") shelfBudget.add(importRow);
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

  await finalizeImportedDocumentEvidence(db, {
    assetRows: backup.tables.document_assets ?? [],
    libraryId,
    maps: knowledgeIdMaps(idMaps.generated, idMaps.works),
    version: backup.version,
  });

  // Keep an oversized Shelf import from making subsequent bounded reads fail.
  await shelfBudget.assert(db, libraryId);

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
) {
  return prepareBackupRowForImportImpl(table, row, deactivatedAt, idMaps);
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
  const works = await buildScopedUniqueIdMap(
    db,
    backup.tables.works ?? [],
    "works",
    ["doi", "arxiv_id", "openalex_id", "s2_id", "pmid", "fingerprint"],
    targetLibraryId,
  );
  const generated = await buildGeneratedBackupIdMaps(db, backup);
  generated.project_works = buildProjectWorkMembershipIdMap(
    backup.tables.project_works ?? [],
    generated.research_projects ?? EMPTY_BACKUP_ID_MAP,
    works,
  );
  finalizeKnowledgeImportIdMaps(backup.tables, knowledgeIdMaps(generated, works));
  return {
    authors: await buildScopedUniqueIdMap(
      db,
      backup.tables.authors ?? [],
      "authors",
      ["orcid"],
      targetLibraryId,
    ),
    generated,
    libraries: buildLibraryIdMap(backup, targetLibraryId),
    tags: await buildScopedUniqueIdMap(
      db,
      backup.tables.tags ?? [],
      "tags",
      ["name"],
      targetLibraryId,
    ),
    targetDefaultProjectId:
      backup.version < RESEARCH_PROJECT_BACKUP_VERSION &&
      (backup.tables.canvas_workspaces?.length ?? 0) > 0
        ? await findDefaultResearchProjectId(db, targetLibraryId)
        : null,
    targetLibraryId,
    version: backup.version,
    works,
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
    if (table === "project_works") continue;
    const map = await buildConflictingPrimaryIdMap(db, backup.tables[table] ?? [], table);
    if (map.size > 0) maps[table] = map;
  }
  return maps;
}

async function findDefaultResearchProjectId(
  db: Database,
  libraryId: string,
): Promise<string | null> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM research_projects
     WHERE library_id = ? AND status = 'active' AND deleted_at IS NULL
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    [libraryId],
  );
  return rows[0]?.id ?? null;
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
  assertKnowledgeTablesMatchVersion(version, parsed.tables);
  assertEvidenceShelfTablesMatchVersion(version, parsed.tables);
  const tables: LibraryBackupFile["tables"] = {};
  const ignoredTables: string[] = [];
  for (const [name, value] of Object.entries(parsed.tables)) {
    if (name === "evidence_shelf_items" && !Array.isArray(value)) {
      throw new Error("evidence_shelf_items 备份表必须是数组。");
    }
    if (!USER_BACKUP_TABLE_SET.has(name) || !Array.isArray(value)) {
      ignoredTables.push(name);
      continue;
    }
    if (name === "evidence_shelf_items" && value.some((row) => !isRecord(row))) {
      throw new Error("evidence_shelf_items 备份包含无效的非对象行。");
    }
    tables[name as UserBackupTable] = value.filter(isRecord);
  }
  if (tables.canvas_nodes) {
    tables.canvas_nodes = flattenSpatialCanvasBackupNodeGroups(tables.canvas_nodes);
  }
  assertSpatialCanvasBackupNodeGroups(tables.canvas_nodes ?? []);
  validateBackupIdentities(tables);
  validateProjectWorkMembershipIdentities(tables.project_works ?? [], version);
  const sourceLibraryId =
    version >= 2
      ? stringValue(parsed.sourceLibraryId)
      : inferLegacyBackupLibraryId(tables.libraries ?? []);
  if (version >= 2) {
    if (!sourceLibraryId) {
      throw new Error("备份文件缺少 sourceLibraryId。");
    }
    validateScopedBackupOwnership(tables, sourceLibraryId, version);
  }
  validateBackupRelationships(tables, version);
  validateEvidenceShelfBackupGraph(tables, version);
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

function validateScopedBackupOwnership(
  tables: LibraryBackupFile["tables"],
  sourceLibraryId: string,
  version: number,
): void {
  const libraryRows = tables.libraries ?? [];
  if (libraryRows.length !== 1 || stringValue(libraryRows[0]?.id) !== sourceLibraryId) {
    throw new Error(`v${version} 备份必须且只能包含 sourceLibraryId 对应的 Library。`);
  }
  for (const table of DIRECT_LIBRARY_BACKUP_TABLES) {
    for (const row of tables[table] ?? []) {
      if (stringValue(row.library_id) !== sourceLibraryId) {
        throw new Error(`v${version} 备份包含混合或缺失的 Library owner：${table}`);
      }
    }
  }
}

function validateBackupRelationships(tables: LibraryBackupFile["tables"], version: number): void {
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
        throw new Error(`v${version} 备份包含缺失的 Library 关系：${table}.${field}`);
      }
      if (!targetIds.has(value)) {
        throw new Error(`v${version} 备份包含跨 Library 关系：${table}.${field}`);
      }
    }
  };

  assertReference("work_authors", "work_id", "works");
  assertReference("work_authors", "author_id", "authors");
  assertReference("project_works", "project_id", "research_projects");
  assertReference("project_works", "work_id", "works");
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
  assertReference(
    "canvas_workspaces",
    "project_id",
    "research_projects",
    version >= RESEARCH_PROJECT_BACKUP_VERSION,
  );
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

  for (const row of tables.derived_artifacts ?? []) {
    const sourceTable = stringValue(row.source_table);
    const sourceId = stringValue(row.source_id);
    if (!sourceTable || !sourceId) {
      throw new Error("备份包含缺失的 Library 关系：derived_artifacts.source_id");
    }
    if (
      SCOPED_DERIVED_SOURCE_TABLES.has(sourceTable as UserBackupTable) &&
      !tableIds(sourceTable as UserBackupTable).has(sourceId)
    ) {
      throw new Error("备份包含跨 Library 关系：derived_artifacts.source_id");
    }
  }

  validateCanvasNodeDataReferences(tables, tableIds);
  validateKnowledgeBackupGraph(tables, version, tableIds);
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
