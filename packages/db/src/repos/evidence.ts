import type { Database } from "../database.js";
import { newId, projectEvidenceMembershipId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { appendKnowledgeChangeInTransaction } from "./knowledge.js";
import {
  assertAnnotationEvidenceSource,
  matchesProvenance,
  normalizeCreateInput,
  sha256Text,
  sourceAuthorityFor,
  type NormalizedCreateTextEvidenceInput,
} from "./evidence-validation.js";
import { withDatabaseWriteLock } from "./write-lock.js";

export type EvidenceKind = "method" | "data" | "limitation" | "definition" | "context";

export interface PdfTextEvidenceAnchorInput {
  version: 1;
  kind: "pdf";
  pageIndex: number;
  quote: { exact: string; prefix?: string; suffix?: string };
  position?: { start: number; end: number };
  quads?: {
    pageIndex: number;
    rects: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  };
}

export interface CreateTextEvidenceInput {
  id?: string;
  workId: string;
  attachmentId: string;
  expectedBlobSha256: string;
  anchor: PdfTextEvidenceAnchorInput;
  text: string;
  evidenceKind: EvidenceKind;
  title?: string | null;
  noteMd?: string | null;
  tags?: string[];
  captureMethod?: "reader-selection" | "annotation";
  annotationId?: string | null;
}

export interface EvidenceRecord {
  id: string;
  libraryId: string;
  workId: string;
  assetId: string;
  revisionId: string;
  sourceKind: "document" | "annotation";
  evidenceKind: EvidenceKind;
  anchor: Record<string, unknown>;
  text: string;
  title: string | null;
  noteMd: string | null;
  tags: string[];
  sourceContentHash: string;
  provenance: Record<string, unknown>;
  revisionStatus: "current" | "historical";
  canonicalStatus: "active" | "work-removed" | "asset-removed" | "revision-removed";
  availabilityStatus: "unchecked" | "available" | "missing" | "relink-required";
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface EvidenceStorageRow {
  id: string;
  library_id: string;
  work_id: string;
  asset_id: string;
  revision_id: string;
  source_kind: "document" | "annotation";
  evidence_kind: EvidenceKind;
  anchor_json: string;
  payload_json: string;
  title: string | null;
  note_md: string | null;
  tags_json: string;
  source_content_hash: string;
  provenance_json: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  work_deleted_at: number | null;
  asset_deleted_at: number | null;
  revision_deleted_at: number | null;
  current_revision_id: string | null;
  availability_status: EvidenceRecord["availabilityStatus"];
  revision_attachment_id: string | null;
  revision_blob_sha256: string | null;
}

interface EvidenceSourceRow {
  revision_id: string;
  asset_id: string;
  work_id: string;
  library_id: string;
  blob_sha256: string;
  attachment_sha256: string;
  page_count: number | null;
  current_revision_id: string | null;
}

export class EvidenceScopeError extends Error {
  constructor(
    readonly evidenceId: string,
    readonly libraryId: string,
  ) {
    super(`Evidence ${evidenceId} is outside library ${libraryId}`);
    this.name = "EvidenceScopeError";
  }
}

export class EvidenceRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async createText(
    input: CreateTextEvidenceInput,
  ): Promise<{ evidence: EvidenceRecord; created: boolean }> {
    const normalized = normalizeCreateInput(input);
    const contentHash = await sha256Text(normalized.text);
    const id = normalized.id ?? newId();
    assertId(id, "Evidence id");
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "evidence_create", async () => {
        const existing = await this.storageRow(id);
        if (existing) {
          if (existing.library_id !== this.libraryId)
            throw new EvidenceScopeError(id, this.libraryId);
          const retryAnchorJson = JSON.stringify({
            ...normalized.anchor,
            revisionId: existing.revision_id,
          });
          const retryMatches =
            existing.deleted_at === null &&
            existing.work_id === normalized.workId &&
            existing.revision_attachment_id === normalized.attachmentId &&
            existing.revision_blob_sha256 === normalized.expectedBlobSha256 &&
            existing.source_kind ===
              (normalized.captureMethod === "annotation" ? "annotation" : "document") &&
            existing.evidence_kind === normalized.evidenceKind &&
            existing.anchor_json === retryAnchorJson &&
            existing.payload_json === JSON.stringify({ kind: "text", text: normalized.text }) &&
            existing.source_content_hash === contentHash &&
            existing.title === normalized.title &&
            existing.note_md === normalized.noteMd &&
            existing.tags_json === JSON.stringify(normalized.tags) &&
            matchesProvenance(existing.provenance_json, normalized);
          if (!retryMatches) {
            throw new Error(`Evidence ${id} already exists with different content`);
          }
          return { evidence: toEvidenceRecord(existing), created: false };
        }

        const source = await this.resolveCurrentSource(normalized);
        await assertAnnotationEvidenceSource(this.db, this.libraryId, normalized);
        const anchor = { ...normalized.anchor, revisionId: source.revision_id };
        const anchorJson = JSON.stringify(anchor);
        const payloadJson = JSON.stringify({ kind: "text", text: normalized.text });
        const tagsJson = JSON.stringify(normalized.tags);
        const provenanceJson = JSON.stringify({
          capturedAt: Date.now(),
          capturedBy: "user",
          sourceAuthority: sourceAuthorityFor(normalized),
          captureMethod: normalized.captureMethod,
          ...(normalized.annotationId ? { annotationId: normalized.annotationId } : {}),
        });

        const now = Date.now();
        await this.db.run(
          `INSERT INTO evidence_items
             (id, library_id, work_id, asset_id, revision_id, source_kind,
              evidence_kind, anchor_json, payload_kind, payload_json, title,
              note_md, tags_json, source_content_hash, provenance_json,
              created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            id,
            this.libraryId,
            normalized.workId,
            source.asset_id,
            source.revision_id,
            normalized.captureMethod === "annotation" ? "annotation" : "document",
            normalized.evidenceKind,
            anchorJson,
            payloadJson,
            normalized.title,
            normalized.noteMd,
            tagsJson,
            contentHash,
            provenanceJson,
            now,
            now,
          ],
        );
        await appendKnowledgeChangeInTransaction(this.db, {
          libraryId: this.libraryId,
          sourceType: "evidence",
          sourceId: id,
          changeKind: "upsert",
          expectedRevisionId: source.revision_id,
          expectedContentHash: contentHash,
        });
        const evidence = await this.get(id);
        if (!evidence) throw new Error(`Evidence ${id} was not readable after creation`);
        return { evidence, created: true };
      }),
    );
  }

  async get(
    evidenceId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<EvidenceRecord | null> {
    assertId(evidenceId, "Evidence id");
    const row = await this.storageRow(evidenceId);
    if (!row) return null;
    if (row.library_id !== this.libraryId) throw new EvidenceScopeError(evidenceId, this.libraryId);
    if (!options.includeDeleted && row.deleted_at !== null) return null;
    return toEvidenceRecord(row);
  }

  async list(input: {
    scope: { kind: "library" | "inbox" } | { kind: "project"; projectId: string };
    limit?: number;
    offset?: number;
  }): Promise<EvidenceRecord[]> {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const offset = Math.max(0, input.offset ?? 0);
    const params: unknown[] = [this.libraryId];
    let scopeSql = "";
    if (input.scope.kind === "project") {
      assertId(input.scope.projectId, "Research project id");
      await this.requireActiveProject(input.scope.projectId);
      scopeSql = `AND EXISTS (
        SELECT 1 FROM project_evidence membership
        WHERE membership.project_id = ? AND membership.evidence_id = evidence.id
          AND membership.deleted_at IS NULL
      )`;
      params.push(input.scope.projectId);
    } else if (input.scope.kind === "inbox") {
      scopeSql = `AND NOT EXISTS (
        SELECT 1 FROM project_evidence membership
        WHERE membership.evidence_id = evidence.id AND membership.deleted_at IS NULL
      )`;
    }
    params.push(limit, offset);
    const rows = await this.db.query<EvidenceStorageRow>(
      `${EVIDENCE_SELECT}
       WHERE evidence.library_id = ? AND evidence.deleted_at IS NULL
       ${scopeSql}
       ORDER BY evidence.updated_at DESC, evidence.id DESC
       LIMIT ? OFFSET ?`,
      params,
    );
    return rows.map(toEvidenceRecord);
  }

  async addToProject(projectId: string, evidenceId: string): Promise<boolean> {
    assertId(projectId, "Research project id");
    assertId(evidenceId, "Evidence id");
    return withDatabaseWriteLock(this.db, async () => {
      await this.requireActiveProject(projectId);
      const evidence = await this.get(evidenceId);
      if (!evidence) throw new Error(`Evidence ${evidenceId} is missing or removed`);
      await this.requireProjectSource(projectId, evidence);
      const now = Date.now();
      const changed = await this.db.run(
        `INSERT INTO project_evidence
           (id, project_id, evidence_id, role, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, 'evidence', ?, ?, NULL)
         ON CONFLICT(project_id, evidence_id) DO UPDATE SET
           role = excluded.role, deleted_at = NULL,
           updated_at = MAX(project_evidence.updated_at + 1, excluded.updated_at)
         WHERE project_evidence.deleted_at IS NOT NULL`,
        [projectEvidenceMembershipId(projectId, evidenceId), projectId, evidenceId, now, now],
      );
      return changed === 1;
    });
  }

  async removeFromProject(projectId: string, evidenceId: string): Promise<boolean> {
    assertId(projectId, "Research project id");
    assertId(evidenceId, "Evidence id");
    return withDatabaseWriteLock(this.db, async () => {
      await this.requireActiveProject(projectId);
      const evidence = await this.get(evidenceId, { includeDeleted: true });
      if (!evidence) throw new Error(`Evidence ${evidenceId} is missing`);
      const now = Date.now();
      const changed = await this.db.run(
        `UPDATE project_evidence
         SET deleted_at = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE project_id = ? AND evidence_id = ? AND deleted_at IS NULL`,
        [now, now, projectId, evidenceId],
      );
      return changed === 1;
    });
  }

  async softDelete(evidenceId: string, expectedUpdatedAt: number): Promise<void> {
    await this.changeTombstone(evidenceId, expectedUpdatedAt, false);
  }

  async restore(evidenceId: string, expectedUpdatedAt: number): Promise<void> {
    await this.changeTombstone(evidenceId, expectedUpdatedAt, true);
  }

  private async changeTombstone(
    evidenceId: string,
    expectedUpdatedAt: number,
    restore: boolean,
  ): Promise<void> {
    assertId(evidenceId, "Evidence id");
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "evidence_tombstone", async () => {
        const current = await this.get(evidenceId, { includeDeleted: true });
        if (!current || current.updatedAt !== expectedUpdatedAt) {
          throw new Error("Evidence changed; reload it before updating");
        }
        const now = Math.max(Date.now(), current.updatedAt + 1);
        const changed = await this.db.run(
          `UPDATE evidence_items SET deleted_at = ?, updated_at = ?
           WHERE id = ? AND library_id = ? AND updated_at = ?
             AND deleted_at IS ${restore ? "NOT NULL" : "NULL"}`,
          [restore ? null : now, now, evidenceId, this.libraryId, expectedUpdatedAt],
        );
        if (changed !== 1) throw new Error("Evidence changed; reload it before updating");
        await appendKnowledgeChangeInTransaction(this.db, {
          libraryId: this.libraryId,
          sourceType: "evidence",
          sourceId: evidenceId,
          changeKind: restore ? "upsert" : "delete",
          expectedRevisionId: current.revisionId,
          expectedContentHash: current.sourceContentHash,
        });
      }),
    );
  }

  private async resolveCurrentSource(
    input: NormalizedCreateTextEvidenceInput,
  ): Promise<EvidenceSourceRow> {
    const rows = await this.db.query<EvidenceSourceRow>(
      `SELECT revision.id AS revision_id, revision.asset_id, asset.work_id,
              asset.library_id, revision.blob_sha256,
              attachment.sha256 AS attachment_sha256, attachment.page_count,
              asset.current_revision_id
       FROM document_revisions revision
       JOIN document_assets asset ON asset.id = revision.asset_id
       JOIN attachments attachment ON attachment.id = revision.attachment_id
       JOIN works work
         ON work.id = attachment.work_id AND work.id = asset.work_id
       WHERE attachment.id = ? AND work.id = ?
         AND work.library_id = ?
         AND work.deleted_at IS NULL AND attachment.deleted_at IS NULL
         AND asset.deleted_at IS NULL AND revision.deleted_at IS NULL
       LIMIT 1`,
      [input.attachmentId, input.workId, this.libraryId],
    );
    const source = rows[0];
    if (!source) throw new Error("Evidence source is missing, removed, or outside this Library");
    if (
      source.blob_sha256 !== input.expectedBlobSha256 ||
      source.attachment_sha256 !== input.expectedBlobSha256
    ) {
      throw new Error("Evidence source revision changed; reopen the document before saving");
    }
    if (source.current_revision_id !== source.revision_id) {
      throw new Error("Evidence source is no longer the current document revision");
    }
    if (source.page_count !== null && input.anchor.pageIndex >= source.page_count) {
      throw new Error("Evidence anchor page is outside the source document");
    }
    return source;
  }

  private async storageRow(evidenceId: string): Promise<EvidenceStorageRow | null> {
    const rows = await this.db.query<EvidenceStorageRow>(
      `${EVIDENCE_SELECT} WHERE evidence.id = ? LIMIT 1`,
      [evidenceId],
    );
    return rows[0] ?? null;
  }

  private async requireActiveProject(projectId: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM research_projects
       WHERE id = ? AND library_id = ? AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
      [projectId, this.libraryId],
    );
    if (!rows[0]) throw new Error(`Research project ${projectId} is missing, archived, or removed`);
  }

  private async requireProjectSource(projectId: string, evidence: EvidenceRecord): Promise<void> {
    const rows = await this.db.query<{ allowed: number }>(
      `SELECT 1 AS allowed
       WHERE EXISTS (
         SELECT 1 FROM project_works
         WHERE project_id = ? AND work_id = ? AND deleted_at IS NULL
       ) OR EXISTS (
         SELECT 1 FROM project_assets
         WHERE project_id = ? AND asset_id = ? AND deleted_at IS NULL
       )
       LIMIT 1`,
      [projectId, evidence.workId, projectId, evidence.assetId],
    );
    if (!rows[0]) throw new Error("Evidence source is not a member of the target Research Project");
  }
}

const EVIDENCE_SELECT = `SELECT evidence.*, work.deleted_at AS work_deleted_at,
  asset.deleted_at AS asset_deleted_at, revision.deleted_at AS revision_deleted_at,
  asset.current_revision_id, revision.availability_status,
  revision.attachment_id AS revision_attachment_id,
  revision.blob_sha256 AS revision_blob_sha256
  FROM evidence_items evidence
  LEFT JOIN works work ON work.id = evidence.work_id
  LEFT JOIN document_assets asset ON asset.id = evidence.asset_id
  LEFT JOIN document_revisions revision ON revision.id = evidence.revision_id`;

function toEvidenceRecord(row: EvidenceStorageRow): EvidenceRecord {
  const payload = JSON.parse(row.payload_json) as { text: string };
  const canonicalStatus =
    row.work_deleted_at !== null
      ? "work-removed"
      : row.asset_deleted_at !== null
        ? "asset-removed"
        : row.revision_deleted_at !== null
          ? "revision-removed"
          : "active";
  return {
    id: row.id,
    libraryId: row.library_id,
    workId: row.work_id,
    assetId: row.asset_id,
    revisionId: row.revision_id,
    sourceKind: row.source_kind,
    evidenceKind: row.evidence_kind,
    anchor: JSON.parse(row.anchor_json) as Record<string, unknown>,
    text: payload.text,
    title: row.title,
    noteMd: row.note_md,
    tags: JSON.parse(row.tags_json) as string[],
    sourceContentHash: row.source_content_hash,
    provenance: JSON.parse(row.provenance_json) as Record<string, unknown>,
    revisionStatus: row.current_revision_id === row.revision_id ? "current" : "historical",
    canonicalStatus,
    availabilityStatus: row.availability_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
}
