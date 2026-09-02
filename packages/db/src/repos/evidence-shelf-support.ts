import { contentUnitCanonicalVisibilitySql } from "./content-unit-visibility.js";
import type { Database } from "../database.js";
import type { ContentUnitSourceType, ContentUnitStorageRow } from "./knowledge-contract.js";

export type EvidenceShelfStatus = "staged" | "stale";

export interface EvidenceShelfItem {
  id: string;
  libraryId: string;
  projectId: string;
  workId: string | null;
  assetId: string | null;
  revisionId: string | null;
  anchorSnapshot: unknown;
  previewPayload: unknown;
  sourceContentHash: string;
  status: EvidenceShelfStatus;
  currentRevisionId: string | null;
  currentSourceContentHash: string | null;
  isStale: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface EvidenceShelfStorageRow {
  id: string;
  library_id: string;
  project_id: string;
  work_id: string | null;
  asset_id: string | null;
  revision_id: string | null;
  anchor_snapshot_json: string;
  preview_payload_json: string;
  source_content_hash: string;
  status: EvidenceShelfStatus;
  current_revision_id: string | null;
  current_source_content_hash: string | null;
  is_stale: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface EvidenceShelfSourceIdentity {
  workId: string | null;
  assetId: string | null;
  revisionId: string | null;
  sourceType?: ContentUnitSourceType;
  sourceId?: string;
  sourceContentHash?: string;
}

export interface NormalizedEvidenceShelfStage extends EvidenceShelfSourceIdentity {
  projectId: string;
  itemId?: string;
  anchorJson: string;
  previewJson: string;
  sourceContentHash: string;
}

export type EvidenceShelfCanonicalUnitRow = ContentUnitStorageRow;

export interface EvidenceShelfPreviewExpectation {
  contentUnitId: string;
  sourceType: ContentUnitSourceType;
  sourceId: string;
  text: string;
  ordinal: number;
  headingPath: unknown;
  language: string | null;
  tokenCount: number | null;
}

export const SHELF_SELECT = `SELECT shelf.id, shelf.library_id, shelf.project_id,
  shelf.work_id, shelf.asset_id, shelf.revision_id,
  shelf.anchor_snapshot_json, shelf.preview_payload_json,
  shelf.source_content_hash, shelf.status,
  asset.current_revision_id AS current_revision_id,
  (
    SELECT current_unit.content_hash
    FROM content_units current_unit
    WHERE current_unit.library_id = shelf.library_id
      AND current_unit.work_id IS shelf.work_id
      AND current_unit.asset_id IS shelf.asset_id
      AND current_unit.revision_id IS shelf.revision_id
      AND (shelf.revision_id IS NULL OR asset.current_revision_id IS shelf.revision_id)
      AND current_unit.source_type = COALESCE(
        json_extract(shelf.preview_payload_json, '$.sourceType'),
        json_extract(shelf.preview_payload_json, '$.source_type')
      )
      AND current_unit.source_id = COALESCE(
        json_extract(shelf.preview_payload_json, '$.sourceId'),
        json_extract(shelf.preview_payload_json, '$.source_id')
      )
      AND current_unit.anchor_json = shelf.anchor_snapshot_json
      AND current_unit.deleted_at IS NULL
      AND current_unit.state = 'ready'
      AND ${contentUnitCanonicalVisibilitySql({ alias: "current_unit" })}
    ORDER BY current_unit.updated_at DESC, current_unit.id ASC
    LIMIT 1
  ) AS current_source_content_hash,
  CASE WHEN
      (shelf.work_id IS NOT NULL AND work.id IS NULL)
    OR (shelf.work_id IS NOT NULL AND work.deleted_at IS NOT NULL)
    OR (shelf.asset_id IS NOT NULL AND asset.id IS NULL)
    OR (shelf.asset_id IS NOT NULL AND asset.deleted_at IS NOT NULL)
    OR (shelf.revision_id IS NOT NULL AND revision.id IS NULL)
    OR (shelf.revision_id IS NOT NULL AND revision.deleted_at IS NOT NULL)
    OR (shelf.revision_id IS NOT NULL
        AND asset.current_revision_id IS NOT shelf.revision_id)
    OR NOT (
      EXISTS (
        SELECT 1 FROM project_works membership
        JOIN works member_work ON member_work.id = membership.work_id
          AND member_work.library_id = shelf.library_id
          AND member_work.deleted_at IS NULL
        WHERE membership.project_id = shelf.project_id
          AND membership.work_id IS shelf.work_id
          AND membership.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM project_assets membership
        JOIN document_assets member_asset ON member_asset.id = membership.asset_id
          AND member_asset.library_id = shelf.library_id
          AND member_asset.deleted_at IS NULL
        WHERE membership.project_id = shelf.project_id
          AND membership.asset_id IS shelf.asset_id
          AND membership.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM project_evidence membership
        JOIN evidence_items member_evidence
          ON member_evidence.id = membership.evidence_id
          AND member_evidence.library_id = shelf.library_id
          AND member_evidence.work_id IS shelf.work_id
          AND member_evidence.asset_id IS shelf.asset_id
          AND member_evidence.revision_id IS shelf.revision_id
          AND member_evidence.source_content_hash = shelf.source_content_hash
          AND member_evidence.deleted_at IS NULL
        WHERE membership.project_id = shelf.project_id
          AND membership.deleted_at IS NULL
          AND COALESCE(
            json_extract(shelf.preview_payload_json, '$.sourceType'),
            json_extract(shelf.preview_payload_json, '$.source_type')
          ) = 'evidence'
      )
    )
    OR NOT EXISTS (
      SELECT 1 FROM content_units current_unit
      WHERE current_unit.library_id = shelf.library_id
        AND current_unit.work_id IS shelf.work_id
        AND current_unit.asset_id IS shelf.asset_id
        AND current_unit.revision_id IS shelf.revision_id
        AND current_unit.source_type = COALESCE(
          json_extract(shelf.preview_payload_json, '$.sourceType'),
          json_extract(shelf.preview_payload_json, '$.source_type')
        )
        AND current_unit.source_id = COALESCE(
          json_extract(shelf.preview_payload_json, '$.sourceId'),
          json_extract(shelf.preview_payload_json, '$.source_id')
        )
        AND current_unit.anchor_json = shelf.anchor_snapshot_json
        AND current_unit.deleted_at IS NULL
        AND current_unit.state = 'ready'
        AND ${contentUnitCanonicalVisibilitySql({ alias: "current_unit" })}
    )
    OR EXISTS (
      SELECT 1 FROM content_units changed_unit
      WHERE changed_unit.library_id = shelf.library_id
        AND changed_unit.work_id IS shelf.work_id
        AND changed_unit.asset_id IS shelf.asset_id
        AND changed_unit.revision_id IS shelf.revision_id
        AND changed_unit.source_type = COALESCE(
          json_extract(shelf.preview_payload_json, '$.sourceType'),
          json_extract(shelf.preview_payload_json, '$.source_type')
        )
        AND changed_unit.source_id = COALESCE(
          json_extract(shelf.preview_payload_json, '$.sourceId'),
          json_extract(shelf.preview_payload_json, '$.source_id')
        )
        AND changed_unit.anchor_json = shelf.anchor_snapshot_json
        AND changed_unit.content_hash <> shelf.source_content_hash
        AND changed_unit.deleted_at IS NULL
        AND changed_unit.state = 'ready'
        AND ${contentUnitCanonicalVisibilitySql({ alias: "changed_unit" })}
    ) THEN 1 ELSE 0 END AS is_stale,
  shelf.created_at, shelf.updated_at, shelf.deleted_at
  FROM evidence_shelf_items shelf
  LEFT JOIN works work ON work.id = shelf.work_id AND work.library_id = shelf.library_id
  LEFT JOIN document_assets asset
    ON asset.id = shelf.asset_id AND asset.library_id = shelf.library_id
  LEFT JOIN document_revisions revision
    ON revision.id = shelf.revision_id AND revision.asset_id = shelf.asset_id`;

export function toEvidenceShelfItem(row: EvidenceShelfStorageRow): EvidenceShelfItem {
  assertEvidenceShelfHash(row.source_content_hash);
  if (row.status !== "staged" && row.status !== "stale")
    throw new Error("Evidence shelf status is invalid");
  const isStale = Number(row.is_stale) !== 0;
  return {
    id: row.id,
    libraryId: row.library_id,
    projectId: row.project_id,
    workId: row.work_id,
    assetId: row.asset_id,
    revisionId: row.revision_id,
    anchorSnapshot: JSON.parse(row.anchor_snapshot_json) as unknown,
    previewPayload: JSON.parse(row.preview_payload_json) as unknown,
    sourceContentHash: row.source_content_hash,
    status: isStale ? "stale" : row.status,
    currentRevisionId: row.current_revision_id,
    currentSourceContentHash: row.current_source_content_hash,
    isStale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function sameEvidenceShelfSource(
  row: EvidenceShelfStorageRow,
  source: NormalizedEvidenceShelfStage,
): boolean {
  let preview: unknown;
  try {
    preview = JSON.parse(row.preview_payload_json) as unknown;
  } catch {
    return false;
  }
  if (!isEvidenceShelfRecord(preview)) return false;
  const rowSourceType = preview.sourceType ?? preview.source_type;
  const rowSourceId = preview.sourceId ?? preview.source_id;
  return (
    row.project_id === source.projectId &&
    row.work_id === source.workId &&
    row.asset_id === source.assetId &&
    row.revision_id === source.revisionId &&
    rowSourceType === source.sourceType &&
    rowSourceId === source.sourceId &&
    row.source_content_hash === source.sourceContentHash &&
    row.anchor_snapshot_json === source.anchorJson
  );
}

export function assertEvidenceShelfId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function assertEvidenceShelfHash(value: string | undefined): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Evidence shelf source content hash must be a lowercase SHA-256 value");
  }
}

export function serializeEvidenceShelfJson(value: unknown, label: string): string {
  const encoded = canonicalizeEvidenceShelfValue(value);
  if (encoded.length > 512 * 1024) throw new Error(`Evidence shelf ${label} is too large`);
  return encoded;
}

export function serializeEvidenceShelfPreview(
  value: unknown,
  expected: EvidenceShelfPreviewExpectation | undefined,
): string {
  const encoded = serializeEvidenceShelfJson(value, "preview payload");
  if (expected !== undefined) {
    const parsed = JSON.parse(encoded) as unknown;
    if (!isEvidenceShelfRecord(parsed)) {
      throw new Error("Evidence shelf preview payload must be a JSON object");
    }
    const fields: Array<keyof EvidenceShelfPreviewExpectation> = [
      "contentUnitId",
      "sourceType",
      "sourceId",
      "text",
      "ordinal",
      "headingPath",
      "language",
      "tokenCount",
    ];
    for (const field of fields) {
      if (
        !(field in parsed) ||
        canonicalizeEvidenceShelfValue(parsed[field]) !==
          canonicalizeEvidenceShelfValue(expected[field])
      ) {
        throw new Error(`Evidence shelf preview ${field} does not match the canonical ContentUnit`);
      }
    }
  }
  return encoded;
}

export function canonicalizeEvidenceShelfJson(encoded: string): string {
  return canonicalizeEvidenceShelfValue(JSON.parse(encoded));
}

export function canonicalizeEvidenceShelfValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Evidence shelf JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeEvidenceShelfValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeEvidenceShelfValue(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Evidence shelf JSON must not contain undefined or functions");
}

export function isEvidenceShelfRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function canonicalEvidenceShelfUnit(
  db: Database,
  libraryId: string,
  id: string,
): Promise<EvidenceShelfCanonicalUnitRow> {
  const rows = await db.query<EvidenceShelfCanonicalUnitRow>(
    `SELECT unit.id, unit.library_id, unit.source_type, unit.source_id,
            unit.work_id, unit.asset_id, unit.revision_id,
            unit.parent_unit_id, unit.ordinal, unit.heading_path_json, unit.anchor_json, unit.text,
            COALESCE(NULLIF(trim(unit.language), ''), NULLIF(trim(work.language), '')) AS language,
            unit.token_count, unit.content_hash, unit.extractor_profile, unit.chunk_profile, unit.state,
            unit.created_at, unit.updated_at, unit.deleted_at
     FROM content_units unit
     LEFT JOIN works work
       ON work.id = unit.work_id
      AND work.library_id = unit.library_id
      AND work.deleted_at IS NULL
     WHERE unit.id = ? AND unit.library_id = ? AND unit.deleted_at IS NULL
       AND unit.state = 'ready'
       AND ${contentUnitCanonicalVisibilitySql()}
     LIMIT 1`,
    [id, libraryId],
  );
  if (rows[0]) return rows[0];
  const any = await db.query<{ library_id: string }>(
    `SELECT library_id FROM content_units WHERE id = ? LIMIT 1`,
    [id],
  );
  if (any[0] && any[0].library_id !== libraryId) {
    throw new EvidenceShelfScopeError(id, libraryId);
  }
  throw new Error(`ContentUnit ${id} is missing, removed, or not citation-safe`);
}

export async function assertEvidenceShelfSourceActive(
  db: Database,
  libraryId: string,
  source: EvidenceShelfSourceIdentity,
): Promise<void> {
  if (source.revisionId) {
    const rows = await db.query<{
      library_id: string;
      work_id: string | null;
      asset_id: string;
      revision_id: string;
      work_deleted_at: number | null;
      asset_deleted_at: number | null;
      revision_deleted_at: number | null;
    }>(
      `SELECT asset.library_id, asset.work_id, asset.id AS asset_id,
              revision.id AS revision_id, work.deleted_at AS work_deleted_at,
              asset.deleted_at AS asset_deleted_at, revision.deleted_at AS revision_deleted_at
       FROM document_revisions revision
       JOIN document_assets asset ON asset.id = revision.asset_id
       LEFT JOIN works work ON work.id = asset.work_id
       WHERE revision.id = ? LIMIT 1`,
      [source.revisionId],
    );
    const row = rows[0];
    if (row && row.library_id !== libraryId)
      throw new EvidenceShelfScopeError(source.revisionId, libraryId);
    if (
      !row ||
      row.asset_id !== source.assetId ||
      row.work_id !== source.workId ||
      row.work_deleted_at !== null ||
      row.asset_deleted_at !== null ||
      row.revision_deleted_at !== null
    ) {
      throw new Error("Evidence shelf source is missing, removed, or outside this Library");
    }
    return;
  }
  if (source.assetId) {
    const rows = await db.query<{
      library_id: string;
      work_id: string | null;
      asset_deleted_at: number | null;
      work_deleted_at: number | null;
    }>(
      `SELECT asset.library_id, asset.work_id, asset.deleted_at AS asset_deleted_at,
              work.deleted_at AS work_deleted_at
       FROM document_assets asset LEFT JOIN works work ON work.id = asset.work_id
       WHERE asset.id = ? LIMIT 1`,
      [source.assetId],
    );
    const row = rows[0];
    if (row && row.library_id !== libraryId)
      throw new EvidenceShelfScopeError(source.assetId, libraryId);
    if (
      !row ||
      row.work_id !== source.workId ||
      row.asset_deleted_at !== null ||
      row.work_deleted_at !== null
    ) {
      throw new Error("Evidence shelf source is missing, removed, or outside this Library");
    }
    return;
  }
  const rows = await db.query<{ library_id: string; deleted_at: number | null }>(
    `SELECT library_id, deleted_at FROM works WHERE id = ? LIMIT 1`,
    [source.workId],
  );
  const row = rows[0];
  if (row && row.library_id !== libraryId)
    throw new EvidenceShelfScopeError(source.workId!, libraryId);
  if (!row || row.deleted_at !== null)
    throw new Error("Evidence shelf source is missing, removed, or outside this Library");
}

export async function assertEvidenceShelfProjectSourceMembership(
  db: Database,
  libraryId: string,
  projectId: string,
  source: EvidenceShelfSourceIdentity,
): Promise<void> {
  const rows = await db.query<{ allowed: number }>(
    `SELECT 1 AS allowed WHERE EXISTS (
       SELECT 1 FROM project_works membership
       JOIN research_projects project ON project.id = membership.project_id
         AND project.library_id = ? AND project.status = 'active' AND project.deleted_at IS NULL
       JOIN works work ON work.id = membership.work_id
         AND work.library_id = ? AND work.deleted_at IS NULL
       WHERE membership.project_id = ? AND membership.work_id IS ? AND membership.deleted_at IS NULL
     ) OR EXISTS (
       SELECT 1 FROM project_assets membership
       JOIN research_projects project ON project.id = membership.project_id
         AND project.library_id = ? AND project.status = 'active' AND project.deleted_at IS NULL
       JOIN document_assets asset ON asset.id = membership.asset_id
         AND asset.library_id = ? AND asset.deleted_at IS NULL
       WHERE membership.project_id = ? AND membership.asset_id IS ? AND membership.deleted_at IS NULL
     ) OR (? = 'evidence' AND EXISTS (
       SELECT 1 FROM project_evidence membership
       JOIN research_projects project ON project.id = membership.project_id
         AND project.library_id = ? AND project.status = 'active' AND project.deleted_at IS NULL
       JOIN evidence_items evidence ON evidence.id = membership.evidence_id
         AND evidence.library_id = ? AND evidence.deleted_at IS NULL
       WHERE membership.project_id = ? AND membership.evidence_id IS ?
         AND evidence.work_id IS ? AND evidence.asset_id IS ?
         AND evidence.revision_id IS ?
         AND evidence.source_content_hash = ?
         AND membership.deleted_at IS NULL
     )) LIMIT 1`,
    [
      libraryId,
      libraryId,
      projectId,
      source.workId,
      libraryId,
      libraryId,
      projectId,
      source.assetId,
      source.sourceType ?? null,
      libraryId,
      libraryId,
      projectId,
      source.sourceId ?? null,
      source.workId,
      source.assetId,
      source.revisionId,
      source.sourceContentHash ?? null,
    ],
  );
  if (!rows[0])
    throw new Error("Evidence shelf source is not a member of the target Research Project");
}

export class EvidenceShelfScopeError extends Error {
  constructor(
    readonly resourceId: string,
    readonly libraryId: string,
  ) {
    super(`Evidence shelf resource ${resourceId} is outside library ${libraryId}`);
    this.name = "EvidenceShelfScopeError";
  }
}
