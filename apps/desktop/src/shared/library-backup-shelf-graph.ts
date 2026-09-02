import type { UserBackupTable } from "./library-backup-config";
import { EVIDENCE_SHELF_BACKUP_VERSION } from "./library-backup-shelf-constants";
import {
  aliasedPreviewValue,
  assertShelfPreviewShape,
  stableJson,
} from "./library-backup-shelf-preview";
import {
  assertShelfProjectMembership,
  pairIndex,
  type ShelfMembershipTables,
} from "./library-backup-shelf-membership";

type BackupTables = Partial<Record<UserBackupTable, Record<string, unknown>[]>>;

/**
 * Validates Shelf references before any import write. Shelf is deliberately
 * not part of WebDAV row sync, so the whole-Library backup is its only
 * cross-device transport and must reject foreign source pointers eagerly.
 */
export function validateEvidenceShelfBackupGraph(tables: BackupTables, version: number): void {
  if (version < EVIDENCE_SHELF_BACKUP_VERSION) return;

  const projects = indexRows(tables.research_projects ?? []);
  const works = indexRows(tables.works ?? []);
  const attachments = indexRows(tables.attachments ?? []);
  const assets = indexRows(tables.document_assets ?? []);
  const revisions = indexRows(tables.document_revisions ?? []);
  const annotations = indexRows(tables.annotations ?? []);
  const evidence = indexRows(tables.evidence_items ?? []);
  // Whole-Library exports always carry the three membership tables, including
  // empty arrays.  Sparse/legacy fixtures may omit them, so only enforce this
  // check when a caller explicitly supplied at least one membership table.
  // Deleted membership rows are intentionally included: a Shelf candidate
  // must remain importable after its source was removed from a Project so the
  // normal stale/relink path can decide what to do next.
  const membershipTables: ShelfMembershipTables = {
    projectAssets: Object.hasOwn(tables, "project_assets"),
    projectEvidence: Object.hasOwn(tables, "project_evidence"),
    projectWorks: Object.hasOwn(tables, "project_works"),
  };
  const projectWorkMemberships = pairIndex(tables.project_works ?? [], "project_id", "work_id");
  const projectAssetMemberships = pairIndex(tables.project_assets ?? [], "project_id", "asset_id");
  const projectEvidenceMemberships = pairIndex(
    tables.project_evidence ?? [],
    "project_id",
    "evidence_id",
  );
  const activeSemanticIds = new Set<string>();

  for (const row of tables.evidence_shelf_items ?? []) {
    requireId(row.id, "evidence_shelf_items.id", version);
    assertShelfTimestamp(row.created_at, "evidence_shelf_items.created_at", version, false, true);
    assertShelfTimestamp(row.updated_at, "evidence_shelf_items.updated_at", version, false, true);
    assertShelfTimestamp(row.deleted_at, "evidence_shelf_items.deleted_at", version, true);
    const shelfLibraryId = requireId(row.library_id, "evidence_shelf_items.library_id", version);
    const projectId = requireId(row.project_id, "evidence_shelf_items.project_id", version);
    const project = requireRow(projects, projectId, "evidence_shelf_items.project_id", version);
    assertSameLibrary(shelfLibraryId, project, "evidence_shelf_items.project_id", version);

    const workId = optionalId(row.work_id, "evidence_shelf_items.work_id", version);
    const work = workId ? requireRow(works, workId, "evidence_shelf_items.work_id", version) : null;
    if (work) assertSameLibrary(shelfLibraryId, work, "evidence_shelf_items.work_id", version);

    const assetId = optionalId(row.asset_id, "evidence_shelf_items.asset_id", version);
    const asset = assetId
      ? requireRow(assets, assetId, "evidence_shelf_items.asset_id", version)
      : null;
    if (asset) {
      assertSameLibrary(shelfLibraryId, asset, "evidence_shelf_items.asset_id", version);
      const assetWorkId = optionalId(asset.work_id, "document_assets.work_id", version);
      if (assetWorkId !== workId) {
        throw new Error(`v${version} 备份包含跨 Work 关系：evidence_shelf_items.asset_id`);
      }
    }

    const revisionId = optionalId(row.revision_id, "evidence_shelf_items.revision_id", version);
    const revision = revisionId
      ? requireRow(revisions, revisionId, "evidence_shelf_items.revision_id", version)
      : null;
    if (revision) {
      if (!asset) {
        throw new Error(`v${version} 备份包含缺失的 Asset 关系：evidence_shelf_items.revision_id`);
      }
      const revisionAssetId = requireId(revision.asset_id, "document_revisions.asset_id", version);
      if (revisionAssetId !== assetId) {
        throw new Error(`v${version} 备份包含跨 Asset 关系：evidence_shelf_items.revision_id`);
      }
    }
    if (workId === null && assetId === null && revisionId === null) {
      throw new Error(
        `v${version} 备份包含缺失的 Evidence Shelf source identity：evidence_shelf_items`,
      );
    }

    const anchor = requireJsonObject(
      row.anchor_snapshot_json,
      "evidence_shelf_items.anchor_snapshot_json",
      version,
    );
    const anchorRevisionId = optionalId(
      anchor.revisionId ?? anchor.revision_id,
      "evidence_shelf_items.anchor_snapshot_json.revisionId",
      version,
    );
    assertAliasedReferenceAgreement(
      anchor,
      "revisionId",
      "revision_id",
      "evidence_shelf_items.anchor_snapshot_json",
      version,
    );
    // A detached Shelf candidate may retain the historical anchor while its
    // durable revision pointer is null; it must be re-verified before save.
    if (revisionId !== null && anchorRevisionId !== revisionId) {
      throw new Error(
        `v${version} 备份包含跨 Revision 关系：evidence_shelf_items.anchor_snapshot_json`,
      );
    }

    const preview = requireJsonObject(
      row.preview_payload_json,
      "evidence_shelf_items.preview_payload_json",
      version,
    );
    assertShelfPreviewShape(preview, version);
    const hash = requireId(
      row.source_content_hash,
      "evidence_shelf_items.source_content_hash",
      version,
    );
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`v${version} 备份包含无效的 Evidence Shelf source_content_hash`);
    }
    requireId(
      aliasedPreviewValue(preview, "contentUnitId", "content_unit_id"),
      "evidence_shelf_items.preview_payload_json.contentUnitId",
      version,
    );
    const sourceType = requireId(
      aliasedPreviewValue(preview, "sourceType", "source_type"),
      "evidence_shelf_items.preview_payload_json.sourceType",
      version,
    );
    assertAliasedReferenceAgreement(
      preview,
      "sourceType",
      "source_type",
      "evidence_shelf_items.preview_payload_json",
      version,
    );
    const sourceId = requireId(
      aliasedPreviewValue(preview, "sourceId", "source_id"),
      "evidence_shelf_items.preview_payload_json.sourceId",
      version,
    );
    assertAliasedReferenceAgreement(
      preview,
      "sourceId",
      "source_id",
      "evidence_shelf_items.preview_payload_json",
      version,
    );
    if (sourceType === "pdf") {
      if (!revisionId || sourceId !== revisionId) {
        throw new Error(
          `v${version} 备份包含跨 Revision 关系：evidence_shelf_items.preview_payload_json.sourceId`,
        );
      }
    } else if (sourceType === "annotation") {
      const annotation = requireRow(
        annotations,
        sourceId,
        "evidence_shelf_items.preview_payload_json.sourceId",
        version,
      );
      const annotationWorkId = requireId(annotation.work_id, "annotations.work_id", version);
      const annotationWork = requireRow(works, annotationWorkId, "annotations.work_id", version);
      assertSameLibrary(
        shelfLibraryId,
        annotationWork,
        "evidence_shelf_items.preview source",
        version,
      );
      if (workId !== null && annotationWorkId !== workId) {
        throw new Error(
          `v${version} 备份包含跨 Work 关系：evidence_shelf_items.preview_payload_json.sourceId`,
        );
      }
      const annotationAttachmentId = requireId(
        annotation.attachment_id,
        "annotations.attachment_id",
        version,
      );
      const annotationAttachment = requireRow(
        attachments,
        annotationAttachmentId,
        "annotations.attachment_id",
        version,
      );
      const attachmentWorkId = requireId(
        annotationAttachment.work_id,
        "attachments.work_id",
        version,
      );
      if (attachmentWorkId !== annotationWorkId) {
        throw new Error(`v${version} 备份包含跨 Work 关系：annotations.attachment_id`);
      }
      if (assetId !== null || revisionId !== null) {
        if (revisionId !== null) {
          const revisionAttachmentId = optionalId(
            revision?.attachment_id,
            "document_revisions.attachment_id",
            version,
          );
          // Imported revisions may intentionally be detached/relink-required;
          // only an explicit, contradictory attachment is a graph violation.
          if (revisionAttachmentId !== null && revisionAttachmentId !== annotationAttachmentId) {
            throw new Error(
              `v${version} 备份包含跨 Attachment 关系：evidence_shelf_items.preview_payload_json.sourceId`,
            );
          }
        } else if (
          assetId !== null &&
          !Array.from(revisions.values()).some((candidate) => {
            const candidateAssetId = optionalId(
              candidate.asset_id,
              "document_revisions.asset_id",
              version,
            );
            if (candidateAssetId !== assetId) return false;
            const candidateAttachmentId = optionalId(
              candidate.attachment_id,
              "document_revisions.attachment_id",
              version,
            );
            return (
              candidateAttachmentId === null || candidateAttachmentId === annotationAttachmentId
            );
          })
        ) {
          throw new Error(
            `v${version} 备份包含跨 Asset 关系：evidence_shelf_items.preview_payload_json.sourceId`,
          );
        }
      }
    } else if (sourceType === "evidence") {
      const item = requireRow(
        evidence,
        sourceId,
        "evidence_shelf_items.preview_payload_json.sourceId",
        version,
      );
      assertSameLibrary(shelfLibraryId, item, "evidence_shelf_items.preview source", version);
      assertSourceRowMatchesShelf(item, workId, assetId, revisionId, hash, version);
    } else {
      throw new Error(`v${version} 备份包含不受支持的 Evidence Shelf sourceType：${sourceType}`);
    }

    assertShelfProjectMembership(
      membershipTables,
      projectWorkMemberships,
      projectAssetMemberships,
      projectEvidenceMemberships,
      projectId,
      workId,
      assetId,
      sourceType,
      sourceId,
      version,
    );

    assertOptionalPreviewReference(preview, "revisionId", revisionId, version);
    assertOptionalPreviewReference(preview, "revision_id", revisionId, version);
    assertOptionalPreviewReference(preview, "assetId", assetId, version);
    assertOptionalPreviewReference(preview, "asset_id", assetId, version);
    assertOptionalPreviewReference(preview, "workId", workId, version);
    assertOptionalPreviewReference(preview, "work_id", workId, version);

    const status = requireId(row.status, "evidence_shelf_items.status", version);
    if (status !== "staged" && status !== "stale") {
      throw new Error(`v${version} 备份包含无效的 Evidence Shelf status`);
    }

    if (row.deleted_at === null || row.deleted_at === undefined) {
      const semanticId = JSON.stringify([
        projectId,
        workId ?? "",
        assetId ?? "",
        revisionId ?? "",
        sourceType,
        sourceId,
        hash,
        stableJson(anchor),
      ]);
      if (activeSemanticIds.has(semanticId)) {
        throw new Error(
          `v${version} 备份包含重复的 Evidence Shelf 语义行：project_id+work_id+asset_id+revision_id+sourceType+sourceId+source_content_hash+anchor_snapshot_json`,
        );
      }
      activeSemanticIds.add(semanticId);
    }
  }
}

function assertSourceRowMatchesShelf(
  source: Record<string, unknown>,
  workId: string | null,
  assetId: string | null,
  revisionId: string | null,
  sourceContentHash: string,
  version: number,
): void {
  const sourceWorkId = requireId(source.work_id, "evidence_items.work_id", version);
  const sourceAssetId = requireId(source.asset_id, "evidence_items.asset_id", version);
  const sourceRevisionId = requireId(source.revision_id, "evidence_items.revision_id", version);
  if (workId !== null && sourceWorkId !== workId) {
    throw new Error(
      `v${version} 备份包含跨 Work 关系：evidence_shelf_items.preview_payload_json.sourceId`,
    );
  }
  if (assetId !== null && sourceAssetId !== assetId) {
    throw new Error(
      `v${version} 备份包含跨 Asset 关系：evidence_shelf_items.preview_payload_json.sourceId`,
    );
  }
  if (revisionId !== null && sourceRevisionId !== revisionId) {
    throw new Error(
      `v${version} 备份包含跨 Revision 关系：evidence_shelf_items.preview_payload_json.sourceId`,
    );
  }
  const evidenceHash = requireId(
    source.source_content_hash,
    "evidence_items.source_content_hash",
    version,
  );
  if (evidenceHash !== sourceContentHash) {
    throw new Error(
      `v${version} 备份包含不一致的 Evidence Shelf source_content_hash：evidence_shelf_items.preview_payload_json.sourceId`,
    );
  }
}

function assertOptionalPreviewReference(
  preview: Record<string, unknown>,
  field: string,
  expected: string | null,
  version: number,
): void {
  if (!hasOwn(preview, field)) return;
  const actual = optionalId(
    preview[field],
    `evidence_shelf_items.preview_payload_json.${field}`,
    version,
  );
  if (actual !== expected) {
    throw new Error(
      `v${version} 备份包含不一致的 Shelf 引用：evidence_shelf_items.preview_payload_json.${field}`,
    );
  }
}

function assertShelfTimestamp(
  value: unknown,
  field: string,
  version: number,
  nullable = false,
  required = false,
): void {
  if (value === undefined) {
    if (!required) return;
    throw new Error(`v${version} 备份缺少 Evidence Shelf 时间字段：${field}`);
  }
  if (nullable && value === null) return;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`v${version} 备份包含无效的 Evidence Shelf 时间字段：${field}`);
  }
}

function indexRows(rows: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = stringValue(row.id);
    if (id) result.set(id, row);
  }
  return result;
}

function requireRow(
  rows: ReadonlyMap<string, Record<string, unknown>>,
  id: string,
  relation: string,
  version: number,
): Record<string, unknown> {
  const row = rows.get(id);
  if (!row) throw new Error(`v${version} 备份包含跨 Library 关系：${relation}`);
  return row;
}

function assertSameLibrary(
  shelfLibraryId: string,
  row: Record<string, unknown>,
  relation: string,
  version: number,
): void {
  const libraryId = stringValue(row.library_id);
  if (libraryId !== shelfLibraryId) {
    throw new Error(`v${version} 备份包含跨 Library 关系：${relation}`);
  }
}

function requireJsonObject(
  value: unknown,
  field: string,
  version: number,
): Record<string, unknown> {
  if (typeof value !== "string" || value.length > 512 * 1024) {
    throw new Error(`v${version} 备份包含无效的 JSON：${field}`);
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to the stable field-specific error below.
  }
  throw new Error(`v${version} 备份包含无效的 JSON：${field}`);
}

function assertAliasedReferenceAgreement(
  value: Record<string, unknown>,
  camelField: string,
  snakeField: string,
  relation: string,
  version: number,
): void {
  if (!hasOwn(value, camelField) || !hasOwn(value, snakeField)) return;
  const camel = stringValue(value[camelField]);
  const snake = stringValue(value[snakeField]);
  if (camel === null || snake === null || camel !== snake) {
    throw new Error(`v${version} 备份包含不一致的 Shelf 引用：${relation}`);
  }
}

function requireId(value: unknown, field: string, version: number): string {
  const id = stringValue(value);
  if (!id || id.length > 512) {
    throw new Error(`v${version} 备份包含缺失或过长的 Library 关系：${field}`);
  }
  return id;
}

function optionalId(value: unknown, field: string, version: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requireId(value, field, version);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.hasOwn(value, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
