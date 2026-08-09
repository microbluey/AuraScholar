import type { Database, KnowledgeJobRow } from "@aurascholar/db";
import { appendPdfAnchoringText, isPdfTextItem } from "@aurascholar/knowledge";

export const CANONICAL_SHA256 = /^[0-9a-f]{64}$/;
export const PDF_MIME_TYPES = new Set(["application/pdf", "application/x-pdf"]);

export interface PdfPageLike {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
}

export interface PdfDocumentLike {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): void | Promise<void>;
}

export interface RevisionSourceRow {
  revision_id: string;
  asset_id: string;
  work_id: string | null;
  asset_kind: string;
  mime_type: string;
  blob_sha256: string;
  byte_size: number;
  revision_deleted_at: number | null;
  asset_deleted_at: number | null;
  work_deleted_at: number | null;
}

export interface AnnotationSourceRow {
  annotation_id: string;
  anchor_json: string | null;
  content_md: string | null;
  annotation_deleted_at: number | null;
  attachment_deleted_at: number | null;
  work_id: string;
  work_deleted_at: number | null;
  asset_id: string | null;
  asset_deleted_at: number | null;
  revision_id: string | null;
  revision_blob_sha256: string | null;
  revision_deleted_at: number | null;
}

export interface EvidenceSourceRow {
  evidence_id: string;
  work_id: string;
  asset_id: string;
  revision_id: string;
  anchor_json: string;
  payload_json: string;
  source_content_hash: string;
  evidence_deleted_at: number | null;
  work_deleted_at: number | null;
  asset_deleted_at: number | null;
  joined_revision_id: string | null;
  revision_deleted_at: number | null;
}

export interface TextEvidencePayload {
  kind: "text";
  text: string;
}

export type ExecutionResult = { progress?: unknown | null };

export async function revisionSource(
  database: Database,
  libraryId: string,
  revisionId: string,
): Promise<RevisionSourceRow | null> {
  const rows = await database.query<RevisionSourceRow>(
    `SELECT revision.id AS revision_id, revision.asset_id, asset.work_id,
            asset.kind AS asset_kind, revision.mime_type, revision.blob_sha256,
            revision.byte_size, revision.deleted_at AS revision_deleted_at,
            asset.deleted_at AS asset_deleted_at, work.deleted_at AS work_deleted_at
     FROM document_revisions revision
     JOIN document_assets asset ON asset.id = revision.asset_id
     LEFT JOIN works work ON work.id = asset.work_id
     WHERE revision.id = ? AND asset.library_id = ?
     LIMIT 1`,
    [revisionId, libraryId],
  );
  return rows[0] ?? null;
}

export async function annotationSource(
  database: Database,
  libraryId: string,
  annotationId: string,
): Promise<AnnotationSourceRow | null> {
  const rows = await database.query<AnnotationSourceRow>(
    `SELECT annotation.id AS annotation_id, annotation.anchor_json, annotation.content_md,
            annotation.deleted_at AS annotation_deleted_at,
            attachment.deleted_at AS attachment_deleted_at,
            work.id AS work_id, work.deleted_at AS work_deleted_at,
            asset.id AS asset_id, asset.deleted_at AS asset_deleted_at,
            revision.id AS revision_id, revision.blob_sha256 AS revision_blob_sha256,
            revision.deleted_at AS revision_deleted_at
     FROM annotations annotation
     JOIN attachments attachment ON attachment.id = annotation.attachment_id
     JOIN works work ON work.id = annotation.work_id AND work.id = attachment.work_id
     LEFT JOIN document_revisions revision ON revision.id = (
       SELECT candidate.id
       FROM document_revisions candidate
       JOIN document_assets candidate_asset ON candidate_asset.id = candidate.asset_id
       WHERE candidate.attachment_id = attachment.id
         AND candidate_asset.library_id = work.library_id
         AND candidate_asset.current_revision_id = candidate.id
       ORDER BY candidate.created_at DESC, candidate.id DESC
       LIMIT 1
     )
     LEFT JOIN document_assets asset ON asset.id = revision.asset_id
     WHERE annotation.id = ? AND work.library_id = ?
     LIMIT 1`,
    [annotationId, libraryId],
  );
  return rows[0] ?? null;
}

export async function evidenceSource(
  database: Database,
  libraryId: string,
  evidenceId: string,
): Promise<EvidenceSourceRow | null> {
  const rows = await database.query<EvidenceSourceRow>(
    `SELECT evidence.id AS evidence_id, evidence.work_id, evidence.asset_id, evidence.revision_id,
            evidence.anchor_json, evidence.payload_json, evidence.source_content_hash,
            evidence.deleted_at AS evidence_deleted_at,
            work.deleted_at AS work_deleted_at, asset.deleted_at AS asset_deleted_at,
            revision.id AS joined_revision_id, revision.deleted_at AS revision_deleted_at
     FROM evidence_items evidence
     LEFT JOIN works work ON work.id = evidence.work_id
     LEFT JOIN document_assets asset ON asset.id = evidence.asset_id
     LEFT JOIN document_revisions revision ON revision.id = evidence.revision_id
     WHERE evidence.id = ? AND evidence.library_id = ?
     LIMIT 1`,
    [evidenceId, libraryId],
  );
  return rows[0] ?? null;
}

export function isActiveRevision(source: RevisionSourceRow): boolean {
  return (
    source.revision_deleted_at === null &&
    source.asset_deleted_at === null &&
    (source.work_id === null || source.work_deleted_at === null)
  );
}

export function isPdfRevision(source: RevisionSourceRow): boolean {
  return source.asset_kind === "pdf" || PDF_MIME_TYPES.has(source.mime_type.toLowerCase());
}

export function isActiveAnnotation(source: AnnotationSourceRow): source is AnnotationSourceRow & {
  asset_id: string;
  revision_id: string;
  revision_blob_sha256: string;
} {
  return (
    source.annotation_deleted_at === null &&
    source.attachment_deleted_at === null &&
    source.work_deleted_at === null &&
    source.asset_id !== null &&
    source.asset_deleted_at === null &&
    source.revision_id !== null &&
    source.revision_deleted_at === null &&
    source.revision_blob_sha256 !== null
  );
}

export function isActiveEvidence(source: EvidenceSourceRow): boolean {
  return (
    source.evidence_deleted_at === null &&
    source.work_deleted_at === null &&
    source.asset_deleted_at === null &&
    source.joined_revision_id === source.revision_id &&
    source.revision_deleted_at === null
  );
}

export function sameRevisionSource(left: RevisionSourceRow, right: RevisionSourceRow): boolean {
  return (
    left.revision_id === right.revision_id &&
    left.asset_id === right.asset_id &&
    left.work_id === right.work_id &&
    left.blob_sha256 === right.blob_sha256 &&
    left.mime_type === right.mime_type
  );
}

export function sameAnnotationSource(
  left: AnnotationSourceRow,
  right: AnnotationSourceRow,
): boolean {
  return (
    left.annotation_id === right.annotation_id &&
    left.revision_id === right.revision_id &&
    left.revision_blob_sha256 === right.revision_blob_sha256 &&
    left.anchor_json === right.anchor_json &&
    left.content_md === right.content_md
  );
}

export function sameEvidenceSource(left: EvidenceSourceRow, right: EvidenceSourceRow): boolean {
  return (
    left.evidence_id === right.evidence_id &&
    left.revision_id === right.revision_id &&
    left.anchor_json === right.anchor_json &&
    left.payload_json === right.payload_json &&
    left.source_content_hash === right.source_content_hash
  );
}

export function matchesExpected(
  job: KnowledgeJobRow,
  revisionId: string | null,
  contentHash: string | null,
): boolean {
  return (
    (job.expectedRevisionId === null || job.expectedRevisionId === revisionId) &&
    (job.expectedContentHash === null || job.expectedContentHash === contentHash)
  );
}

export async function isJobSuperseded(database: Database, job: KnowledgeJobRow): Promise<boolean> {
  if (job.sourceChangeSeq === null) return false;
  const rows = await database.query<{ seq: number }>(
    `SELECT seq FROM knowledge_changes
     WHERE library_id = ? AND source_type = ? AND source_id = ? AND seq > ?
     LIMIT 1`,
    [job.libraryId, job.sourceType, job.sourceId, job.sourceChangeSeq],
  );
  return rows.length > 0;
}

export async function hasActiveLibrary(database: Database, libraryId: string): Promise<boolean> {
  const rows = await database.query<{ id: string }>(
    "SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [libraryId],
  );
  return rows.length > 0;
}

export async function setRevisionExtractionStatus(
  database: Database,
  revisionId: string,
  status: "running" | "ready" | "failed" | "unsupported",
  extractorProfile?: string,
): Promise<void> {
  const now = Date.now();
  await database.run(
    `UPDATE document_revisions
     SET extraction_status = ?,
         extractor_profile = COALESCE(?, extractor_profile),
         updated_at = MAX(updated_at + 1, ?)
     WHERE id = ? AND deleted_at IS NULL`,
    [status, extractorProfile ?? null, now, revisionId],
  );
}

export function pdfTextSource(document: PdfDocumentLike) {
  return {
    pageCount: document.numPages,
    async getPageText(pageIndex: number, signal?: AbortSignal) {
      throwIfAborted(signal);
      const page = await document.getPage(pageIndex + 1);
      throwIfAborted(signal);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!isPdfTextItem(item)) continue;
        text = appendPdfAnchoringText(text, item);
      }
      throwIfAborted(signal);
      return { pageIndex, text };
    },
  };
}

export function parseJson(value: string | null, label: string): unknown {
  if (value === null) throw new Error(`${label} is missing`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} is invalid JSON`);
  }
}

export function parseTextEvidencePayload(value: string): TextEvidencePayload {
  const payload = parseJson(value, "Evidence payload");
  const candidate =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as { kind?: unknown; text?: unknown })
      : null;
  if (candidate === null || candidate.kind !== "text" || typeof candidate.text !== "string") {
    throw new Error("Evidence payload is not a text payload");
  }
  return payload as TextEvidencePayload;
}

export function isCanonicalSha256(value: string | null): value is string {
  return value !== null && CANONICAL_SHA256.test(value);
}

export function completed(progress: unknown): ExecutionResult {
  return { progress };
}

export function skipped(reason: string): ExecutionResult {
  return completed({ status: "skipped", reason });
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error("Knowledge job execution was aborted");
  error.name = "AbortError";
  throw error;
}

export async function destroyPdfDocument(document: PdfDocumentLike | null): Promise<void> {
  if (!document) return;
  try {
    await document.destroy();
  } catch {
    // A successful extraction must not be retried just because pdf.js cleanup
    // races with its own worker teardown.
  }
}
