import { remapSpatialCanvasBackupRow, type SpatialCanvasBackupTable } from "@aurascholar/sync";
import {
  DIRECT_LIBRARY_BACKUP_TABLES,
  GENERATED_BACKUP_ID_TABLE_SET,
  SPATIAL_CANVAS_BACKUP_TABLE_SET,
  type GeneratedBackupIdTable,
  type UserBackupTable,
} from "./library-backup-config";
import {
  knowledgeIdMaps,
  remapKnowledgeBackupRow,
  RESEARCH_PROJECT_BACKUP_VERSION,
} from "./library-backup-evidence";
import { sanitizeBackupRow } from "./library-backup-sanitizer";
import {
  canonicalizeEvidenceShelfAnchorJson,
  canonicalizeEvidenceShelfPreviewJson,
  remapEvidenceShelfBackupRow,
  type EvidenceShelfBackupIdMaps,
} from "./library-backup-shelf";

const EMPTY_BACKUP_ID_MAP = new Map<string, string>();

export interface BackupImportIdMaps {
  authors: Map<string, string>;
  generated: Partial<Record<GeneratedBackupIdTable, Map<string, string>>>;
  libraries: Map<string, string>;
  tags: Map<string, string>;
  targetDefaultProjectId: string | null;
  targetLibraryId: string;
  works: Map<string, string>;
  version: number;
}

export interface PreparedBackupRow {
  deactivatedAttachment: boolean;
  redirectedRow: boolean;
  row: Record<string, unknown> | null;
  skippedRuntimeRow: boolean;
}

/**
 * Sanitizes one row and redirects all durable foreign keys before insertion.
 * Keeping this mutation-heavy path out of the backup orchestration module makes
 * the transaction loop easier to audit while preserving its result contract.
 */
export function prepareBackupRowForImport(
  table: UserBackupTable,
  row: Record<string, unknown>,
  deactivatedAt: number,
  idMaps: BackupImportIdMaps,
): PreparedBackupRow {
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
      throw new Error(`v${idMaps.version} 备份包含未知的 Library owner：${table}.${field}`);
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

  const knowledgeRemap = remapKnowledgeBackupRow(
    table,
    next,
    knowledgeIdMaps(idMaps.generated, idMaps.works),
    deactivatedAt,
  );
  if (knowledgeRemap.redirected) {
    next = knowledgeRemap.row;
    redirectedRow = true;
  }

  // Shelf rows carry source ids inside their immutable anchor/preview JSON.
  // Remap those before the generic scalar FK pass so the helper still sees
  // source-side identifiers and can update the embedded values atomically.
  const shelfRemap = remapEvidenceShelfBackupRow(table, next, shelfIdMaps(idMaps));
  if (shelfRemap.redirected) {
    next = shelfRemap.row;
    redirectedRow = true;
  }
  if (table === "evidence_shelf_items") {
    const anchorJson = canonicalizeEvidenceShelfAnchorJson(next.anchor_snapshot_json);
    const previewJson = canonicalizeEvidenceShelfPreviewJson(next.preview_payload_json);
    if (anchorJson !== next.anchor_snapshot_json) {
      update("anchor_snapshot_json", anchorJson);
      redirectedRow = true;
    }
    if (previewJson !== next.preview_payload_json) {
      update("preview_payload_json", previewJson);
      redirectedRow = true;
    }
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
  remapGenerated("project_id", "research_projects");
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

  if (
    table === "canvas_workspaces" &&
    !stringValue(next.project_id) &&
    idMaps.version < RESEARCH_PROJECT_BACKUP_VERSION
  ) {
    if (!idMaps.targetDefaultProjectId) {
      throw new Error("无法导入旧版白板：目标 Library 缺少默认研究项目。");
    }
    update("project_id", idMaps.targetDefaultProjectId);
    redirectedRow = true;
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

function shelfIdMaps(idMaps: BackupImportIdMaps): EvidenceShelfBackupIdMaps {
  return {
    annotations: idMaps.generated.annotations ?? EMPTY_BACKUP_ID_MAP,
    assets: idMaps.generated.document_assets ?? EMPTY_BACKUP_ID_MAP,
    evidence: idMaps.generated.evidence_items ?? EMPTY_BACKUP_ID_MAP,
    projects: idMaps.generated.research_projects ?? EMPTY_BACKUP_ID_MAP,
    revisions: idMaps.generated.document_revisions ?? EMPTY_BACKUP_ID_MAP,
    shelfItems: idMaps.generated.evidence_shelf_items ?? EMPTY_BACKUP_ID_MAP,
    works: idMaps.works,
  };
}

function isPortableAiJobStatus(status: unknown): boolean {
  return status === "done" || status === "error";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
