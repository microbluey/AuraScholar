import type { Database } from "../database.js";
import type { DocumentAssetKind } from "./document-assets.js";
import type { EvidenceKind, EvidenceRecord } from "./evidence.js";

export type EvidenceSearchScope =
  | { kind: "library" | "inbox" }
  | { kind: "project"; projectId: string };

export type EvidenceRevisionStatus = EvidenceRecord["revisionStatus"];
export type EvidenceCanonicalStatus = EvidenceRecord["canonicalStatus"];
export type EvidenceAvailabilityStatus = EvidenceRecord["availabilityStatus"];

export interface EvidenceProjectMembershipDto {
  projectId: string;
  projectName: string;
}

export interface EvidenceInboxItemDto {
  evidence: EvidenceRecord;
  workTitle: string | null;
  authorNames: string[];
  year: number | null;
  assetTitle: string | null;
  assetKind: DocumentAssetKind | null;
  revisionNo: number | null;
  mimeType: string | null;
  attachmentId: string | null;
  pageIndex: number | null;
  projectMemberships: EvidenceProjectMembershipDto[];
}

export interface SearchEvidenceInput {
  scope: EvidenceSearchScope;
  query?: string;
  evidenceKinds?: EvidenceKind[];
  revisionStatuses?: EvidenceRevisionStatus[];
  canonicalStatuses?: EvidenceCanonicalStatus[];
  availabilityStatuses?: EvidenceAvailabilityStatus[];
  limit?: number;
  offset?: number;
}

export interface SearchEvidenceResult {
  evidence: EvidenceInboxItemDto[];
  total: number;
}

interface EvidenceInboxStorageRow {
  id: string;
  library_id: string;
  work_id: string;
  asset_id: string;
  revision_id: string;
  source_kind: EvidenceRecord["sourceKind"];
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
  availability_status: EvidenceAvailabilityStatus | null;
  work_title: string | null;
  work_year: number | null;
  author_names_json: string;
  asset_title: string | null;
  asset_kind: DocumentAssetKind | null;
  revision_no: number | null;
  mime_type: string | null;
  attachment_id: string | null;
  page_index: number | null;
  project_memberships_json: string;
}

const REVISION_STATUS_SQL =
  "CASE WHEN asset.current_revision_id = evidence.revision_id THEN 'current' ELSE 'historical' END";
const CANONICAL_STATUS_SQL = `CASE
  WHEN work.deleted_at IS NOT NULL THEN 'work-removed'
  WHEN asset.deleted_at IS NOT NULL THEN 'asset-removed'
  WHEN revision.deleted_at IS NOT NULL THEN 'revision-removed'
  ELSE 'active' END`;

/** Read model for the Evidence Inbox. It never resolves through an Asset's current revision. */
export class EvidenceInboxRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async search(input: SearchEvidenceInput): Promise<SearchEvidenceResult> {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const offset = Math.max(0, input.offset ?? 0);
    const { where, params } = await this.buildWhere(input);
    const countRows = await this.db.query<{ total: number }>(
      `SELECT COUNT(*) AS total ${EVIDENCE_FROM} WHERE ${where}`,
      params,
    );
    const rows = await this.db.query<EvidenceInboxStorageRow>(
      `${EVIDENCE_SELECT} ${EVIDENCE_FROM}
       WHERE ${where}
       ORDER BY evidence.updated_at DESC, evidence.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return {
      evidence: rows.map(toInboxItem),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  private async buildWhere(input: SearchEvidenceInput): Promise<{
    where: string;
    params: unknown[];
  }> {
    const clauses = [
      "evidence.library_id = ?",
      "evidence.deleted_at IS NULL",
      "work.id IS NOT NULL",
      "asset.id IS NOT NULL",
      "revision.id IS NOT NULL",
    ];
    const params: unknown[] = [this.libraryId];
    if (input.scope.kind === "project") {
      assertId(input.scope.projectId, "Research project id");
      await this.requireActiveProject(input.scope.projectId);
      clauses.push(`EXISTS (
        SELECT 1 FROM project_evidence scoped_membership
        JOIN research_projects scoped_project
          ON scoped_project.id = scoped_membership.project_id
         AND scoped_project.library_id = evidence.library_id
         AND scoped_project.status = 'active'
        WHERE scoped_membership.project_id = ?
          AND scoped_membership.evidence_id = evidence.id
          AND scoped_membership.deleted_at IS NULL
          AND scoped_project.deleted_at IS NULL
      )`);
      params.push(input.scope.projectId);
    } else if (input.scope.kind === "inbox") {
      clauses.push(`NOT EXISTS (
        SELECT 1 FROM project_evidence inbox_membership
        JOIN research_projects inbox_project
          ON inbox_project.id = inbox_membership.project_id
         AND inbox_project.library_id = evidence.library_id
         AND inbox_project.status = 'active'
        WHERE inbox_membership.evidence_id = evidence.id
          AND inbox_membership.deleted_at IS NULL
          AND inbox_project.deleted_at IS NULL
      )`);
    }

    const query = input.query?.trim();
    if (query) {
      const pattern = `%${escapeLike(query)}%`;
      clauses.push(`(
        evidence.title LIKE ? ESCAPE '\\'
        OR evidence.note_md LIKE ? ESCAPE '\\'
        OR json_extract(evidence.payload_json, '$.text') LIKE ? ESCAPE '\\'
        OR work.title LIKE ? ESCAPE '\\'
        OR asset.title LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM json_each(evidence.tags_json) tag
          WHERE CAST(tag.value AS TEXT) LIKE ? ESCAPE '\\'
        )
        OR EXISTS (
          SELECT 1 FROM work_authors searched_work_author
          JOIN authors searched_author
            ON searched_author.id = searched_work_author.author_id
           AND searched_author.library_id = evidence.library_id
           AND searched_author.deleted_at IS NULL
          WHERE searched_work_author.work_id = evidence.work_id
            AND searched_author.display_name LIKE ? ESCAPE '\\'
        )
      )`);
      params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }
    addInFilter(clauses, params, "evidence.evidence_kind", input.evidenceKinds);
    addInFilter(clauses, params, REVISION_STATUS_SQL, input.revisionStatuses);
    addInFilter(clauses, params, CANONICAL_STATUS_SQL, input.canonicalStatuses);
    addInFilter(
      clauses,
      params,
      "COALESCE(revision.availability_status, 'missing')",
      input.availabilityStatuses,
    );
    return { where: clauses.join(" AND "), params };
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
}

const EVIDENCE_FROM = `FROM evidence_items evidence
  LEFT JOIN works work
    ON work.id = evidence.work_id AND work.library_id = evidence.library_id
  LEFT JOIN document_assets asset
    ON asset.id = evidence.asset_id
   AND asset.library_id = evidence.library_id
   AND asset.work_id = evidence.work_id
  LEFT JOIN document_revisions revision
    ON revision.id = evidence.revision_id AND revision.asset_id = asset.id`;

const EVIDENCE_SELECT = `SELECT evidence.*,
  work.deleted_at AS work_deleted_at,
  asset.deleted_at AS asset_deleted_at,
  revision.deleted_at AS revision_deleted_at,
  asset.current_revision_id,
  revision.availability_status,
  work.title AS work_title,
  work.year AS work_year,
  asset.title AS asset_title,
  asset.kind AS asset_kind,
  revision.revision_no,
  revision.mime_type,
  revision.attachment_id,
  CAST(json_extract(evidence.anchor_json, '$.pageIndex') AS INTEGER) AS page_index,
  COALESCE((
    SELECT json_group_array(author_name)
    FROM (
      SELECT author.display_name AS author_name
      FROM work_authors work_author
      JOIN authors author
        ON author.id = work_author.author_id
       AND author.library_id = evidence.library_id
       AND author.deleted_at IS NULL
      WHERE work_author.work_id = evidence.work_id
      ORDER BY work_author.position ASC, author.id ASC
    ) ordered_authors
  ), '[]') AS author_names_json,
  COALESCE((
    SELECT json_group_array(json_object(
      'projectId', project_id,
      'projectName', project_name
    ))
    FROM (
      SELECT project.id AS project_id, project.name AS project_name
      FROM project_evidence membership
      JOIN research_projects project
        ON project.id = membership.project_id
       AND project.library_id = evidence.library_id
       AND project.status = 'active'
       AND project.deleted_at IS NULL
      WHERE membership.evidence_id = evidence.id
        AND membership.deleted_at IS NULL
      ORDER BY project.created_at ASC, project.id ASC
    ) ordered_projects
  ), '[]') AS project_memberships_json`;

function toInboxItem(row: EvidenceInboxStorageRow): EvidenceInboxItemDto {
  const payload = JSON.parse(row.payload_json) as { text: string };
  const anchor = JSON.parse(row.anchor_json) as Record<string, unknown>;
  return {
    evidence: {
      id: row.id,
      libraryId: row.library_id,
      workId: row.work_id,
      assetId: row.asset_id,
      revisionId: row.revision_id,
      sourceKind: row.source_kind,
      evidenceKind: row.evidence_kind,
      anchor,
      text: payload.text,
      title: row.title,
      noteMd: row.note_md,
      tags: JSON.parse(row.tags_json) as string[],
      sourceContentHash: row.source_content_hash,
      provenance: JSON.parse(row.provenance_json) as Record<string, unknown>,
      revisionStatus: row.current_revision_id === row.revision_id ? "current" : "historical",
      canonicalStatus:
        row.work_deleted_at !== null
          ? "work-removed"
          : row.asset_deleted_at !== null
            ? "asset-removed"
            : row.revision_deleted_at !== null
              ? "revision-removed"
              : "active",
      availabilityStatus: row.availability_status ?? "missing",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    },
    workTitle: row.work_title,
    authorNames: JSON.parse(row.author_names_json) as string[],
    year: row.work_year,
    assetTitle: row.asset_title,
    assetKind: row.asset_kind,
    revisionNo: row.revision_no,
    mimeType: row.mime_type,
    attachmentId: row.attachment_id,
    pageIndex: row.page_index,
    projectMemberships: JSON.parse(row.project_memberships_json) as EvidenceProjectMembershipDto[],
  };
}

function addInFilter(
  clauses: string[],
  params: unknown[],
  expression: string,
  values: readonly string[] | undefined,
): void {
  if (!values?.length) return;
  clauses.push(`${expression} IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
}
