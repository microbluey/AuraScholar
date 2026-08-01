import {
  documentAssetIdFromAttachment,
  documentRevisionIdFromAttachment,
  projectAssetMembershipId,
  projectEvidenceMembershipId,
  projectWorkMembershipId,
} from "@aurascholar/db";
import {
  DOCUMENT_EVIDENCE_BACKUP_TABLES,
  assertDocumentEvidenceBackupRelationships,
  remapDocumentEvidenceBackupRow,
  type DocumentEvidenceBackupTable,
} from "@aurascholar/sync";
import type { GeneratedBackupIdTable, UserBackupTable } from "./library-backup-config";

export const RESEARCH_PROJECT_BACKUP_VERSION = 3;
export const DOCUMENT_EVIDENCE_BACKUP_VERSION = 4;

const KNOWLEDGE_TABLES = DOCUMENT_EVIDENCE_BACKUP_TABLES;

type KnowledgeTable = DocumentEvidenceBackupTable;

export interface KnowledgeBackupIdMaps {
  attachments: ReadonlyMap<string, string>;
  assets: Map<string, string>;
  evidence: Map<string, string>;
  projectAssets: Map<string, string>;
  projectEvidence: Map<string, string>;
  projects: ReadonlyMap<string, string>;
  revisions: Map<string, string>;
  works: ReadonlyMap<string, string>;
}

export function knowledgeIdMaps(
  generated: Partial<Record<GeneratedBackupIdTable, Map<string, string>>>,
  works: ReadonlyMap<string, string>,
): KnowledgeBackupIdMaps {
  const map = (table: GeneratedBackupIdTable): Map<string, string> =>
    (generated[table] ??= new Map());
  return {
    attachments: map("attachments"),
    assets: map("document_assets"),
    evidence: map("evidence_items"),
    projectAssets: map("project_assets"),
    projectEvidence: map("project_evidence"),
    projects: map("research_projects"),
    revisions: map("document_revisions"),
    works,
  };
}

export function assertKnowledgeTablesMatchVersion(
  version: number,
  rawTables: Record<string, unknown>,
): void {
  if (version >= DOCUMENT_EVIDENCE_BACKUP_VERSION) return;
  const unexpected = KNOWLEDGE_TABLES.find(
    (table) => Array.isArray(rawTables[table]) && rawTables[table].length > 0,
  );
  if (unexpected) {
    throw new Error(`v${version} 备份不能包含 v4 知识表：${unexpected}`);
  }
}

export function buildProjectWorkMembershipIdMap(
  rows: readonly Record<string, unknown>[],
  projects: ReadonlyMap<string, string>,
  works: ReadonlyMap<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = stringValue(row.id);
    const sourceProjectId = stringValue(row.project_id);
    const sourceWorkId = stringValue(row.work_id);
    if (!id || !sourceProjectId || !sourceWorkId) continue;
    const projectId = projects.get(sourceProjectId) ?? sourceProjectId;
    const workId = works.get(sourceWorkId) ?? sourceWorkId;
    setRedirect(map, id, projectWorkMembershipId(projectId, workId));
  }
  return map;
}

export function validateProjectWorkMembershipIdentities(
  rows: readonly Record<string, unknown>[],
  version: number,
): void {
  const memberships = new Set<string>();
  for (const row of rows) {
    const id = stringValue(row.id);
    const projectId = stringValue(row.project_id);
    const workId = stringValue(row.work_id);
    if (!id || !projectId || !workId) continue;
    const membership = JSON.stringify([projectId, workId]);
    if (memberships.has(membership)) {
      throw new Error("备份包含重复的行标识：project_works.project_id+work_id");
    }
    memberships.add(membership);
    if (
      version >= RESEARCH_PROJECT_BACKUP_VERSION &&
      id !== projectWorkMembershipId(projectId, workId)
    ) {
      throw new Error("v3 备份包含无效的研究项目文献关系标识。");
    }
  }
}

export function finalizeKnowledgeImportIdMaps(
  tables: Partial<Record<UserBackupTable, Record<string, unknown>[]>>,
  maps: KnowledgeBackupIdMaps,
): void {
  for (const row of tables.document_revisions ?? []) {
    const attachmentId = stringValue(row.attachment_id);
    const sourceAssetId = stringValue(row.asset_id);
    const sourceRevisionId = stringValue(row.id);
    if (!attachmentId || !sourceAssetId || !sourceRevisionId) continue;
    const targetAttachmentId = maps.attachments.get(attachmentId) ?? attachmentId;
    if (sourceAssetId === documentAssetIdFromAttachment(attachmentId)) {
      setRedirect(maps.assets, sourceAssetId, documentAssetIdFromAttachment(targetAttachmentId));
    }
    if (sourceRevisionId === documentRevisionIdFromAttachment(attachmentId)) {
      setRedirect(
        maps.revisions,
        sourceRevisionId,
        documentRevisionIdFromAttachment(targetAttachmentId),
      );
    }
  }

  for (const row of tables.project_assets ?? []) {
    const id = stringValue(row.id);
    const sourceProjectId = stringValue(row.project_id);
    const sourceAssetId = stringValue(row.asset_id);
    if (!id || !sourceProjectId || !sourceAssetId) continue;
    const projectId = maps.projects.get(sourceProjectId) ?? sourceProjectId;
    const assetId = maps.assets.get(sourceAssetId) ?? sourceAssetId;
    setRedirect(maps.projectAssets, id, projectAssetMembershipId(projectId, assetId));
  }
  for (const row of tables.project_evidence ?? []) {
    const id = stringValue(row.id);
    const sourceProjectId = stringValue(row.project_id);
    const sourceEvidenceId = stringValue(row.evidence_id);
    if (!id || !sourceProjectId || !sourceEvidenceId) continue;
    const projectId = maps.projects.get(sourceProjectId) ?? sourceProjectId;
    const evidenceId = maps.evidence.get(sourceEvidenceId) ?? sourceEvidenceId;
    setRedirect(maps.projectEvidence, id, projectEvidenceMembershipId(projectId, evidenceId));
  }
}

export function remapKnowledgeBackupRow(
  table: UserBackupTable,
  row: Record<string, unknown>,
  maps: KnowledgeBackupIdMaps,
  importedAt: number,
): { redirected: boolean; row: Record<string, unknown> } {
  if (!isKnowledgeTable(table)) return { redirected: false, row };
  const portable = remapDocumentEvidenceBackupRow(table, row, maps);
  let next = portable.row;
  let redirected = portable.redirected;
  const update = (field: string, value: unknown) => {
    if (next === portable.row) next = { ...portable.row };
    if (next[field] !== value) redirected = true;
    next[field] = value;
  };

  if (table === "document_assets") {
    // The circular pointer is restored only after revisions are inserted.
    if (stringValue(next.current_revision_id)) update("current_revision_id", null);
  } else if (table === "document_revisions") {
    // Backup v4 carries canonical revision identity, but it deliberately does
    // not carry extracted output or source bytes. Those states are therefore
    // re-established by the importing device instead of being trusted from
    // the source device.
    update("extraction_status", "pending");
    if (stringValue(next.attachment_id)) {
      update("availability_status", "relink-required");
      update("availability_checked_at", importedAt);
    } else {
      update("availability_status", "unchecked");
      update("availability_checked_at", null);
    }
  }
  const previousUpdatedAt = typeof next.updated_at === "number" ? next.updated_at : 0;
  update("updated_at", Math.max(previousUpdatedAt, importedAt));
  return { redirected, row: next };
}

export function documentAssetCurrentRevisionPatches(
  rows: readonly Record<string, unknown>[],
  maps: KnowledgeBackupIdMaps,
): Array<{ assetId: string; revisionId: string }> {
  return rows.flatMap((row) => {
    const sourceAssetId = stringValue(row.id);
    const sourceRevisionId = stringValue(row.current_revision_id);
    if (!sourceAssetId || !sourceRevisionId) return [];
    return [
      {
        assetId: maps.assets.get(sourceAssetId) ?? sourceAssetId,
        revisionId: maps.revisions.get(sourceRevisionId) ?? sourceRevisionId,
      },
    ];
  });
}

export function validateKnowledgeBackupGraph(
  tables: Partial<Record<UserBackupTable, Record<string, unknown>[]>>,
  version: number,
  tableIds: (table: UserBackupTable) => Set<string>,
): void {
  if (version < DOCUMENT_EVIDENCE_BACKUP_VERSION) return;
  const assets = tableIds("document_assets");
  const revisions = tableIds("document_revisions");
  const attachments = tableIds("attachments");
  const works = tableIds("works");
  const projects = tableIds("research_projects");
  const evidence = tableIds("evidence_items");
  const revisionAssets = new Map<string, string>();

  for (const row of tables.document_revisions ?? []) {
    const id = requireReference(row, "id", "document_revisions");
    const assetId = requireKnown(row, "asset_id", "document_revisions", assets);
    const attachmentId = stringValue(row.attachment_id);
    if (attachmentId && !attachments.has(attachmentId)) {
      throw new Error("v4 备份包含跨 Library 关系：document_revisions.attachment_id");
    }
    revisionAssets.set(id, assetId);
  }
  for (const row of tables.document_assets ?? []) {
    requireKnown(row, "work_id", "document_assets", works, false);
    const currentRevisionId = stringValue(row.current_revision_id);
    const assetId = requireReference(row, "id", "document_assets");
    if (
      currentRevisionId &&
      (!revisions.has(currentRevisionId) || revisionAssets.get(currentRevisionId) !== assetId)
    ) {
      throw new Error("v4 备份包含跨 Asset 关系：document_assets.current_revision_id");
    }
  }
  validateMemberships(
    tables.project_assets ?? [],
    "asset_id",
    assets,
    projects,
    (projectId, assetId) => projectAssetMembershipId(projectId, assetId),
  );
  for (const row of tables.evidence_items ?? []) {
    requireKnown(row, "work_id", "evidence_items", works);
    const assetId = requireKnown(row, "asset_id", "evidence_items", assets);
    const revisionId = requireKnown(row, "revision_id", "evidence_items", revisions);
    if (revisionAssets.get(revisionId) !== assetId) {
      throw new Error("v4 备份包含跨 Asset 关系：evidence_items.revision_id");
    }
    assertAnchorRevision(row.anchor_json, revisionId);
  }
  validateMemberships(
    tables.project_evidence ?? [],
    "evidence_id",
    evidence,
    projects,
    (projectId, evidenceId) => projectEvidenceMembershipId(projectId, evidenceId),
  );
  assertDocumentEvidenceBackupRelationships({
    attachments: tables.attachments ?? [],
    document_assets: tables.document_assets ?? [],
    document_revisions: tables.document_revisions ?? [],
    evidence_items: tables.evidence_items ?? [],
    project_assets: tables.project_assets ?? [],
    project_evidence: tables.project_evidence ?? [],
    research_projects: tables.research_projects ?? [],
    works: tables.works ?? [],
  });
}

function validateMemberships(
  rows: readonly Record<string, unknown>[],
  targetField: "asset_id" | "evidence_id",
  targets: Set<string>,
  projects: Set<string>,
  expectedId: (projectId: string, targetId: string) => string,
): void {
  const pairs = new Set<string>();
  for (const row of rows) {
    const id = requireReference(
      row,
      "id",
      targetField === "asset_id" ? "project_assets" : "project_evidence",
    );
    const projectId = requireKnown(row, "project_id", "project membership", projects);
    const targetId = requireKnown(row, targetField, "project membership", targets);
    const pair = JSON.stringify([projectId, targetId]);
    if (pairs.has(pair)) throw new Error(`v4 备份包含重复的项目知识关系：${targetField}`);
    pairs.add(pair);
    if (id !== expectedId(projectId, targetId)) {
      throw new Error(`v4 备份包含无效的项目知识关系标识：${targetField}`);
    }
  }
}

function assertAnchorRevision(value: unknown, revisionId: string): void {
  remapDocumentEvidenceBackupRow(
    "evidence_items",
    { id: "validation", revision_id: revisionId, anchor_json: value },
    {
      assets: EMPTY_ID_MAP,
      attachments: EMPTY_ID_MAP,
      evidence: EMPTY_ID_MAP,
      projectAssets: EMPTY_ID_MAP,
      projectEvidence: EMPTY_ID_MAP,
      projects: EMPTY_ID_MAP,
      revisions: EMPTY_ID_MAP,
      works: EMPTY_ID_MAP,
    },
  );
}

function requireKnown(
  row: Record<string, unknown>,
  field: string,
  table: string,
  known: Set<string>,
  required = true,
): string {
  const value = stringValue(row[field]);
  if (!value && !required) return "";
  if (!value || !known.has(value)) throw new Error(`v4 备份包含跨 Library 关系：${table}.${field}`);
  return value;
}

function requireReference(row: Record<string, unknown>, field: string, table: string): string {
  const value = stringValue(row[field]);
  if (!value) throw new Error(`v4 备份包含缺失关系：${table}.${field}`);
  return value;
}

function setRedirect(map: Map<string, string>, source: string, target: string): void {
  if (source === target) map.delete(source);
  else map.set(source, target);
}

function isKnowledgeTable(table: UserBackupTable): table is KnowledgeTable {
  return (KNOWLEDGE_TABLES as readonly string[]).includes(table);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const EMPTY_ID_MAP = new Map<string, string>();
