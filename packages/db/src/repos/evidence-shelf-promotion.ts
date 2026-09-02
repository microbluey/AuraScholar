import type { Database } from "../database.js";
import { newId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { ContentUnitsRepo, type ContentUnitRow, type ContentUnitSourceType } from "./knowledge.js";
import { DocumentAssetsRepo, type AttachmentRevisionSource } from "./document-assets.js";
import { EvidenceRepo, type EvidenceKind, type EvidenceRecord } from "./evidence.js";
import { canonicalizeEvidenceShelfValue, isEvidenceShelfRecord } from "./evidence-shelf-support.js";
import {
  normalizeEvidenceShelfPdfAnchor,
  parseEvidenceShelfPdfAnchor,
  sameEvidenceShelfPdfAnchor,
} from "./evidence-shelf-promotion-anchor.js";
import type { CanonicalEvidenceShelfPdfAnchor } from "./evidence-shelf-promotion-anchor.js";
import { withDatabaseWriteLock, type DatabaseWriteLockToken } from "./write-lock.js";
export interface PromoteEvidenceShelfInput {
  projectId: string;
  itemId: string;
  expectedUpdatedAt: number;
  evidenceKind: EvidenceKind;
  title?: string | null;
  noteMd?: string | null;
  tags?: string[];
}

export interface PromoteEvidenceShelfResult {
  created: boolean;
  evidence: EvidenceRecord;
  projectMembershipAdded: boolean;
  removedFromShelf: true;
}
const EVIDENCE_KINDS = new Set<EvidenceKind>([
  "method",
  "data",
  "limitation",
  "definition",
  "context",
]);
interface ShelfPromotionRow {
  id: string;
  project_id: string;
  work_id: string | null;
  asset_id: string | null;
  revision_id: string | null;
  anchor_snapshot_json: string;
  preview_payload_json: string;
  source_content_hash: string;
  status: "staged" | "stale";
  updated_at: number;
  deleted_at: number | null;
  current_revision_id: string | null;
}
interface AnnotationSourceRow {
  id: string;
  attachment_id: string;
  work_id: string;
  page_index: number;
  anchor_json: string | null;
  content_md: string | null;
  orphaned: number;
  annotation_deleted_at: number | null;
  attachment_deleted_at: number | null;
  work_deleted_at: number | null;
  asset_id: string;
  revision_id: string;
  blob_sha256: string;
  attachment_sha256: string;
  current_revision_id: string | null;
  asset_deleted_at: number | null;
  revision_deleted_at: number | null;
}
/**
 * Promotes one immutable Shelf snapshot. The savepoint makes this helper safe
 * for direct DB callers; desktop commands additionally place it inside their
 * coordinator transaction. No renderer preview field is used as authority.
 */
export function promoteEvidenceShelfItem(
  db: Database,
  libraryId: string,
  input: PromoteEvidenceShelfInput,
): Promise<PromoteEvidenceShelfResult> {
  return withDatabaseWriteLock(db, (lockToken) =>
    withDatabaseSavepoint(db, "evidence_shelf_promote", () =>
      promoteEvidenceShelfItemInSavepoint(db, libraryId, input, lockToken),
    ),
  );
}
async function promoteEvidenceShelfItemInSavepoint(
  db: Database,
  libraryId: string,
  input: PromoteEvidenceShelfInput,
  lockToken: DatabaseWriteLockToken,
): Promise<PromoteEvidenceShelfResult> {
  assertId(libraryId, "Library id");
  assertId(input.projectId, "Research project id");
  assertId(input.itemId, "Evidence shelf item id");
  if (!EVIDENCE_KINDS.has(input.evidenceKind)) throw new Error("Unsupported evidence kind");
  if (!Number.isSafeInteger(input.expectedUpdatedAt) || input.expectedUpdatedAt < 0) {
    throw new Error("Evidence shelf item version is invalid");
  }

  const library = await db.query<{ id: string }>(
    `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [libraryId],
  );
  if (!library[0]) throw new Error(`Library ${libraryId} is missing or removed`);

  const project = await db.query<{ id: string }>(
    `SELECT id FROM research_projects
     WHERE id = ? AND library_id = ? AND status = 'active' AND deleted_at IS NULL
     LIMIT 1`,
    [input.projectId, libraryId],
  );
  if (!project[0]) {
    throw new Error(`Research project ${input.projectId} is missing, archived, or removed`);
  }

  const shelf = await loadShelfRow(db, libraryId, input);
  if (!shelf) throw new Error(`Evidence shelf item ${input.itemId} is missing or removed`);
  if (shelf.deleted_at !== null) {
    throw new Error("Evidence shelf item is already removed; reload the Shelf");
  }
  if (shelf.updated_at !== input.expectedUpdatedAt) {
    throw new Error("Evidence shelf item changed; reload it before saving");
  }
  if (shelf.status !== "staged") {
    throw new Error("Evidence shelf item is stale; re-verify the source before saving");
  }
  const preview = parsePreview(shelf.preview_payload_json);
  // A new document/annotation Evidence must bind to the current revision,
  // while an already-created Evidence snapshot may intentionally remain
  // historical. Reusing that snapshot must never silently redirect it to the
  // Asset's newer revision.
  if (
    preview.sourceType !== "evidence" &&
    shelf.revision_id !== null &&
    shelf.current_revision_id !== shelf.revision_id
  ) {
    throw new Error("Evidence shelf item is stale; re-verify the source before saving");
  }
  if (!shelf.revision_id) {
    throw new Error("Evidence shelf source is not bound to a document revision");
  }
  const shelfAnchor = parseEvidenceShelfPdfAnchor(
    parseJsonObject(shelf.anchor_snapshot_json, "Evidence shelf anchor"),
    shelf.revision_id,
  );
  const unit = await resolveCanonicalUnit(db, libraryId, shelf, preview, shelfAnchor);

  let saved: { evidence: EvidenceRecord; created: boolean };
  if (preview.sourceType === "pdf") {
    saved = await promotePdf(db, libraryId, shelf, unit, shelfAnchor, input, lockToken);
  } else if (preview.sourceType === "annotation") {
    saved = await promoteAnnotation(
      db,
      libraryId,
      shelf,
      unit,
      shelfAnchor,
      preview.sourceId,
      input,
      lockToken,
    );
  } else {
    saved = await reuseEvidence(db, libraryId, shelf, unit, shelfAnchor, preview.sourceId);
  }

  const projectMembershipAdded = await new EvidenceRepo(db, libraryId).addToProject(
    input.projectId,
    saved.evidence.id,
    lockToken,
  );
  const now = Math.max(Date.now(), shelf.updated_at + 1);
  const changed = await db.run(
    `UPDATE evidence_shelf_items
     SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND library_id = ? AND project_id = ?
       AND deleted_at IS NULL AND updated_at = ?`,
    [now, now, shelf.id, libraryId, input.projectId, input.expectedUpdatedAt],
  );
  if (changed !== 1) throw new Error("Evidence shelf item changed; reload it before saving");
  return {
    created: saved.created,
    evidence: saved.evidence,
    projectMembershipAdded,
    removedFromShelf: true,
  };
}
async function loadShelfRow(
  db: Database,
  libraryId: string,
  input: PromoteEvidenceShelfInput,
): Promise<ShelfPromotionRow | null> {
  const rows = await db.query<ShelfPromotionRow>(
    `SELECT shelf.id, shelf.project_id, shelf.work_id, shelf.asset_id, shelf.revision_id,
            anchor_snapshot_json, preview_payload_json, source_content_hash,
            status, shelf.updated_at, shelf.deleted_at,
            asset.current_revision_id
     FROM evidence_shelf_items shelf
     LEFT JOIN document_assets asset
       ON asset.id = shelf.asset_id AND asset.library_id = ?
     WHERE shelf.id = ? AND shelf.library_id = ? AND shelf.project_id = ?
     LIMIT 1`,
    [libraryId, input.itemId, libraryId, input.projectId],
  );
  return rows[0] ?? null;
}
async function resolveCanonicalUnit(
  db: Database,
  libraryId: string,
  shelf: ShelfPromotionRow,
  preview: PromotionPreview,
  shelfAnchor: CanonicalEvidenceShelfPdfAnchor,
): Promise<ContentUnitRow> {
  const units = await new ContentUnitsRepo(db, libraryId).listForSource(
    preview.sourceType,
    preview.sourceId,
    { revisionId: shelf.revision_id },
  );
  const matches = units.filter(
    (unit) =>
      unit.state === "ready" &&
      unit.workId === shelf.work_id &&
      unit.assetId === shelf.asset_id &&
      unit.revisionId === shelf.revision_id &&
      unit.contentHash === shelf.source_content_hash &&
      (() => {
        const normalized = normalizeEvidenceShelfPdfAnchor(unit.anchor, shelf.revision_id!, {
          allowLegacyBinding: preview.sourceType === "annotation",
        });
        return normalized !== null && sameJson(normalized, shelfAnchor);
      })(),
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new Error("Evidence shelf source is missing, stale, or not citation-safe");
  }
  throw new Error("Evidence shelf source has multiple canonical ContentUnits");
}
async function promotePdf(
  db: Database,
  libraryId: string,
  shelf: ShelfPromotionRow,
  unit: ContentUnitRow,
  shelfAnchor: CanonicalEvidenceShelfPdfAnchor,
  input: PromoteEvidenceShelfInput,
  lockToken: DatabaseWriteLockToken,
): Promise<{ evidence: EvidenceRecord; created: boolean }> {
  if (!shelf.work_id || !shelf.asset_id || !shelf.revision_id) {
    throw new Error("PDF Evidence requires a bound Work, Asset, and Revision");
  }
  if (unit.sourceId !== shelf.revision_id) {
    throw new Error("PDF Evidence source identity is inconsistent");
  }
  const anchor = parseEvidenceShelfPdfAnchor(shelfAnchor, shelf.revision_id);
  if (unit.text !== anchor.quote.exact) {
    throw new Error("PDF Evidence text does not match its canonical anchor");
  }
  const source = await resolveActiveRevision(db, libraryId, shelf);
  return new EvidenceRepo(db, libraryId).createText(
    {
      id: newId(),
      workId: source.work_id,
      attachmentId: source.attachment_id!,
      expectedBlobSha256: source.blob_sha256,
      anchor,
      text: unit.text,
      evidenceKind: input.evidenceKind,
      title: input.title,
      noteMd: input.noteMd,
      tags: input.tags,
      captureMethod: "reader-selection",
    },
    lockToken,
  );
}
async function promoteAnnotation(
  db: Database,
  libraryId: string,
  shelf: ShelfPromotionRow,
  unit: ContentUnitRow,
  shelfAnchor: CanonicalEvidenceShelfPdfAnchor,
  annotationId: string,
  input: PromoteEvidenceShelfInput,
  lockToken: DatabaseWriteLockToken,
): Promise<{ evidence: EvidenceRecord; created: boolean }> {
  if (!shelf.work_id || !shelf.asset_id || !shelf.revision_id) {
    throw new Error("Annotation Evidence requires a bound Work, Asset, and Revision");
  }
  const source = await loadAnnotationSource(db, libraryId, annotationId, shelf.revision_id);
  if (
    !source ||
    source.work_id !== shelf.work_id ||
    source.asset_id !== shelf.asset_id ||
    source.revision_id !== shelf.revision_id ||
    source.orphaned !== 0 ||
    source.annotation_deleted_at !== null ||
    source.attachment_deleted_at !== null ||
    source.work_deleted_at !== null ||
    source.asset_deleted_at !== null ||
    source.revision_deleted_at !== null ||
    source.current_revision_id !== source.revision_id ||
    source.blob_sha256 !== source.attachment_sha256 ||
    !source.anchor_json
  ) {
    throw new Error("Annotation Evidence source is missing, removed, or unresolved");
  }
  const annotationAnchor = parseEvidenceShelfPdfAnchor(
    parseJsonObject(source.anchor_json, "Annotation anchor"),
    shelf.revision_id,
    { allowLegacyBinding: true },
  );
  const anchor = parseEvidenceShelfPdfAnchor(shelfAnchor, shelf.revision_id);
  if (!sameEvidenceShelfPdfAnchor(annotationAnchor, anchor, shelf.revision_id)) {
    throw new Error("Annotation Evidence source does not match the canonical anchor");
  }
  if (unit.text !== anchor.quote.exact && !unit.text.startsWith(`${anchor.quote.exact}\n\n`)) {
    throw new Error("Annotation ContentUnit does not preserve its canonical quote");
  }
  return new EvidenceRepo(db, libraryId).createText(
    {
      id: newId(),
      workId: source.work_id,
      attachmentId: source.attachment_id,
      expectedBlobSha256: source.blob_sha256,
      anchor,
      text: anchor.quote.exact,
      evidenceKind: input.evidenceKind,
      title: input.title,
      noteMd: input.noteMd === undefined ? source.content_md : input.noteMd,
      tags: input.tags,
      captureMethod: "annotation",
      annotationId,
    },
    lockToken,
  );
}
async function reuseEvidence(
  db: Database,
  libraryId: string,
  shelf: ShelfPromotionRow,
  unit: ContentUnitRow,
  shelfAnchor: CanonicalEvidenceShelfPdfAnchor,
  evidenceId: string,
): Promise<{ evidence: EvidenceRecord; created: false }> {
  const evidence = await new EvidenceRepo(db, libraryId).get(evidenceId);
  if (
    !evidence ||
    evidence.canonicalStatus !== "active" ||
    evidence.workId !== shelf.work_id ||
    evidence.assetId !== shelf.asset_id ||
    evidence.revisionId !== shelf.revision_id ||
    evidence.sourceContentHash !== shelf.source_content_hash ||
    unit.text !== evidence.text ||
    !sameEvidenceShelfPdfAnchor(evidence.anchor, shelfAnchor, shelf.revision_id!)
  ) {
    throw new Error("Evidence Shelf source Evidence is missing, changed, or outside this Library");
  }
  return { evidence, created: false };
}
async function resolveActiveRevision(
  db: Database,
  libraryId: string,
  shelf: ShelfPromotionRow,
): Promise<AttachmentRevisionSource> {
  const source = shelf.revision_id
    ? await new DocumentAssetsRepo(db, libraryId).resolveRevision(shelf.revision_id)
    : null;
  if (
    !source ||
    source.work_id !== shelf.work_id ||
    source.asset_id !== shelf.asset_id ||
    source.id !== shelf.revision_id ||
    source.current_revision_id !== source.id ||
    source.attachment_id === null ||
    source.blob_sha256 !== source.attachment_sha256 ||
    source.work_deleted_at !== null ||
    source.asset_deleted_at !== null ||
    source.deleted_at !== null ||
    source.attachment_deleted_at !== null
  ) {
    throw new Error("Evidence source is missing, removed, or no longer the current revision");
  }
  return source;
}
async function loadAnnotationSource(
  db: Database,
  libraryId: string,
  annotationId: string,
  revisionId: string,
): Promise<AnnotationSourceRow | null> {
  const rows = await db.query<AnnotationSourceRow>(
    `SELECT annotation.id, annotation.attachment_id, annotation.work_id,
            annotation.page_index, annotation.anchor_json, annotation.content_md,
            annotation.orphaned, annotation.deleted_at AS annotation_deleted_at,
            attachment.deleted_at AS attachment_deleted_at,
            work.deleted_at AS work_deleted_at,
            asset.id AS asset_id, revision.id AS revision_id,
            revision.blob_sha256, attachment.sha256 AS attachment_sha256,
            asset.current_revision_id,
            asset.deleted_at AS asset_deleted_at,
            revision.deleted_at AS revision_deleted_at
     FROM annotations annotation
     JOIN attachments attachment ON attachment.id = annotation.attachment_id
     JOIN works work
       ON work.id = annotation.work_id AND work.id = attachment.work_id
     JOIN document_revisions revision
       ON revision.attachment_id = attachment.id
     JOIN document_assets asset
       ON asset.id = revision.asset_id AND asset.work_id = work.id
     WHERE annotation.id = ? AND work.library_id = ? AND revision.id = ?
     LIMIT 1`,
    [annotationId, libraryId, revisionId],
  );
  return rows[0] ?? null;
}
interface PromotionPreview {
  sourceType: ContentUnitSourceType;
  sourceId: string;
}
function parsePreview(encoded: string): PromotionPreview {
  const value = parseJsonObject(encoded, "Evidence shelf preview");
  const sourceType = value.sourceType ?? value.source_type;
  const sourceId = value.sourceId ?? value.source_id;
  if (
    value.sourceType !== undefined &&
    value.source_type !== undefined &&
    value.sourceType !== value.source_type
  ) {
    throw new Error("Evidence shelf preview source type aliases disagree");
  }
  if (
    value.sourceId !== undefined &&
    value.source_id !== undefined &&
    value.sourceId !== value.source_id
  ) {
    throw new Error("Evidence shelf preview source id aliases disagree");
  }
  if (
    (sourceType !== "pdf" && sourceType !== "annotation" && sourceType !== "evidence") ||
    typeof sourceId !== "string" ||
    sourceId.trim() === ""
  ) {
    throw new Error("Evidence shelf preview has an invalid source identity");
  }
  return { sourceType, sourceId: sourceId.trim() };
}
function parseJsonObject(encoded: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(encoded) as unknown;
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (!isEvidenceShelfRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}
function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeEvidenceShelfValue(left) === canonicalizeEvidenceShelfValue(right);
  } catch {
    return false;
  }
}
function assertId(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}
