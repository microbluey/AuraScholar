import type { Database } from "../database.js";
import { newId } from "../ids.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { withDatabaseWriteLock } from "./write-lock.js";

export type DocumentAssetKind =
  | "pdf"
  | "html"
  | "docx"
  | "markdown"
  | "epub"
  | "notebook"
  | "supplement"
  | "other";

export type DocumentExtractionStatus = "pending" | "running" | "ready" | "failed" | "unsupported";
export type DocumentAvailabilityStatus = "unchecked" | "available" | "missing" | "relink-required";

export interface DocumentAssetRow {
  id: string;
  library_id: string;
  work_id: string | null;
  kind: DocumentAssetKind;
  title: string;
  current_revision_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface DocumentRevisionRow {
  id: string;
  asset_id: string;
  attachment_id: string | null;
  /** Local display ordinal. Concurrent offline revisions may share this value. */
  revision_no: number;
  mime_type: string;
  blob_sha256: string;
  byte_size: number;
  source_url: string | null;
  extractor_profile: string | null;
  extraction_status: DocumentExtractionStatus;
  availability_status: DocumentAvailabilityStatus;
  availability_checked_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface AttachmentRevisionSource extends DocumentRevisionRow {
  library_id: string;
  work_id: string;
  page_count: number | null;
  attachment_sha256: string;
  attachment_deleted_at: number | null;
  work_deleted_at: number | null;
  asset_deleted_at: number | null;
  current_revision_id: string | null;
}

export interface CreateDocumentAssetInput {
  id?: string;
  workId?: string | null;
  kind: DocumentAssetKind;
  title: string;
}

export interface CreateDocumentRevisionInput {
  id?: string;
  attachmentId?: string | null;
  mimeType: string;
  blobSha256: string;
  byteSize: number;
  sourceUrl?: string | null;
  extractorProfile?: string | null;
  extractionStatus?: DocumentExtractionStatus;
  availabilityStatus?: DocumentAvailabilityStatus;
  makeCurrent?: boolean;
  expectedCurrentRevisionId?: string | null;
}

export class DocumentAssetScopeError extends Error {
  constructor(
    readonly assetId: string,
    readonly libraryId: string,
  ) {
    super(`Document asset ${assetId} is outside library ${libraryId}`);
    this.name = "DocumentAssetScopeError";
  }
}

export class DocumentAssetsRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    assertId(libraryId, "Library id");
  }

  async get(
    assetId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<DocumentAssetRow | null> {
    assertId(assetId, "Document asset id");
    const rows = await this.db.query<DocumentAssetRow>(
      `SELECT id, library_id, work_id, kind, title, current_revision_id,
              created_at, updated_at, deleted_at
       FROM document_assets
       WHERE id = ? AND library_id = ?${options.includeDeleted ? "" : " AND deleted_at IS NULL"}
       LIMIT 1`,
      [assetId, this.libraryId],
    );
    return rows[0] ?? null;
  }

  async create(input: CreateDocumentAssetInput): Promise<DocumentAssetRow> {
    return withDatabaseWriteLock(this.db, async () => {
      await this.assertActiveLibrary();
      if (input.workId) await this.assertWork(input.workId, true);
      const title = input.title.trim();
      if (!title) throw new Error("Document asset title must not be empty");
      if (!ASSET_KINDS.has(input.kind))
        throw new Error(`Unsupported document asset kind: ${input.kind}`);
      const id = input.id ?? newId();
      assertId(id, "Document asset id");
      const now = Date.now();
      await this.db.run(
        `INSERT INTO document_assets
           (id, library_id, work_id, kind, title, current_revision_id,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
        [id, this.libraryId, input.workId ?? null, input.kind, title, now, now],
      );
      const created = await this.get(id);
      if (!created) throw new Error(`Document asset ${id} was not readable after creation`);
      return created;
    });
  }

  async createRevision(
    assetId: string,
    input: CreateDocumentRevisionInput,
  ): Promise<DocumentRevisionRow> {
    assertId(assetId, "Document asset id");
    validateRevisionInput(input);
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "document_revision_create", async () => {
        const asset = await this.requireOwnedAsset(assetId, false);
        if (input.attachmentId) {
          await this.assertCompatibleAttachment(asset, input);
        }
        if (
          input.makeCurrent !== false &&
          input.expectedCurrentRevisionId !== undefined &&
          asset.current_revision_id !== input.expectedCurrentRevisionId
        ) {
          throw new Error("Document asset changed; reload it before adding a revision");
        }
        // This is a local display ordinal, not revision identity. The UUID `id`
        // remains globally unique while offline devices may both allocate the
        // same next ordinal; row sync preserves both branches.
        const next = await this.db.query<{ revision_no: number }>(
          `SELECT COALESCE(MAX(revision_no), 0) + 1 AS revision_no
           FROM document_revisions WHERE asset_id = ?`,
          [assetId],
        );
        const id = input.id ?? newId();
        assertId(id, "Document revision id");
        const now = Date.now();
        await this.db.run(
          `INSERT INTO document_revisions
             (id, asset_id, attachment_id, revision_no, mime_type, blob_sha256,
              byte_size, source_url, extractor_profile, extraction_status,
              availability_status, availability_checked_at, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
          [
            id,
            assetId,
            input.attachmentId ?? null,
            next[0]!.revision_no,
            input.mimeType.trim(),
            input.blobSha256.trim(),
            input.byteSize,
            input.sourceUrl ?? null,
            input.extractorProfile ?? null,
            input.extractionStatus ?? "pending",
            input.availabilityStatus ?? "unchecked",
            now,
            now,
          ],
        );
        if (input.makeCurrent !== false) {
          const changed = await this.db.run(
            `UPDATE document_assets
             SET current_revision_id = ?, updated_at = MAX(updated_at + 1, ?)
             WHERE id = ? AND library_id = ? AND deleted_at IS NULL
               AND current_revision_id IS ?`,
            [id, now, assetId, this.libraryId, asset.current_revision_id],
          );
          if (changed !== 1) throw new Error("Document asset changed while adding a revision");
        }
        return this.requireRevision(id, { includeDeleted: false });
      }),
    );
  }

  async resolveAttachment(
    attachmentId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<AttachmentRevisionSource | null> {
    assertId(attachmentId, "Attachment id");
    const rows = await this.db.query<AttachmentRevisionSource>(
      `SELECT revision.*, asset.library_id, asset.work_id,
              attachment.page_count, attachment.sha256 AS attachment_sha256,
              attachment.deleted_at AS attachment_deleted_at,
              work.deleted_at AS work_deleted_at,
              asset.deleted_at AS asset_deleted_at,
              asset.current_revision_id
       FROM document_revisions revision
       JOIN document_assets asset ON asset.id = revision.asset_id
       JOIN attachments attachment ON attachment.id = revision.attachment_id
       JOIN works work ON work.id = attachment.work_id AND work.id = asset.work_id
       WHERE attachment.id = ?
       LIMIT 1`,
      [attachmentId],
    );
    const source = rows[0];
    if (!source) return null;
    if (source.library_id !== this.libraryId) {
      throw new DocumentAssetScopeError(source.asset_id, this.libraryId);
    }
    if (
      !options.includeDeleted &&
      (source.work_deleted_at !== null ||
        source.asset_deleted_at !== null ||
        source.deleted_at !== null ||
        source.attachment_deleted_at !== null)
    ) {
      return null;
    }
    return source;
  }

  async setAvailability(
    revisionId: string,
    status: DocumentAvailabilityStatus,
  ): Promise<DocumentRevisionRow> {
    assertId(revisionId, "Document revision id");
    if (!AVAILABILITY_STATUSES.has(status))
      throw new Error(`Unsupported availability status: ${status}`);
    return withDatabaseWriteLock(this.db, async () => {
      const revision = await this.requireRevision(revisionId, { includeDeleted: false });
      await this.requireOwnedAsset(revision.asset_id, false);
      const now = Date.now();
      await this.db.run(
        `UPDATE document_revisions
         SET availability_status = ?, availability_checked_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [status, now, revisionId],
      );
      return this.requireRevision(revisionId, { includeDeleted: false });
    });
  }

  private async requireOwnedAsset(
    assetId: string,
    includeDeleted: boolean,
  ): Promise<DocumentAssetRow> {
    const any = await this.db.query<DocumentAssetRow>(
      `SELECT id, library_id, work_id, kind, title, current_revision_id,
              created_at, updated_at, deleted_at
       FROM document_assets WHERE id = ? LIMIT 1`,
      [assetId],
    );
    const asset = any[0];
    if (asset && asset.library_id !== this.libraryId) {
      throw new DocumentAssetScopeError(assetId, this.libraryId);
    }
    if (!asset || (!includeDeleted && asset.deleted_at !== null)) {
      throw new Error(`Document asset ${assetId} is missing or removed`);
    }
    return asset;
  }

  private async requireRevision(
    revisionId: string,
    options: { includeDeleted: boolean },
  ): Promise<DocumentRevisionRow> {
    const rows = await this.db.query<DocumentRevisionRow>(
      `SELECT id, asset_id, attachment_id, revision_no, mime_type, blob_sha256,
              byte_size, source_url, extractor_profile, extraction_status,
              availability_status, availability_checked_at, created_at, updated_at, deleted_at
       FROM document_revisions
       WHERE id = ?${options.includeDeleted ? "" : " AND deleted_at IS NULL"}
       LIMIT 1`,
      [revisionId],
    );
    if (!rows[0]) throw new Error(`Document revision ${revisionId} is missing or removed`);
    return rows[0];
  }

  private async assertCompatibleAttachment(
    asset: DocumentAssetRow,
    input: CreateDocumentRevisionInput,
  ): Promise<void> {
    const rows = await this.db.query<{
      work_id: string;
      sha256: string;
      byte_size: number;
      library_id: string;
    }>(
      `SELECT attachment.work_id, attachment.sha256, attachment.byte_size, work.library_id
       FROM attachments attachment
       JOIN works work ON work.id = attachment.work_id
       WHERE attachment.id = ? AND attachment.deleted_at IS NULL
       LIMIT 1`,
      [input.attachmentId!],
    );
    const attachment = rows[0];
    if (
      !attachment ||
      attachment.library_id !== this.libraryId ||
      attachment.work_id !== asset.work_id ||
      attachment.sha256 !== input.blobSha256 ||
      attachment.byte_size !== input.byteSize
    ) {
      throw new Error(
        `Attachment ${input.attachmentId} is not compatible with document asset ${asset.id}`,
      );
    }
  }

  private async assertActiveLibrary(): Promise<void> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [this.libraryId],
    );
    if (!rows[0]) throw new Error(`Library ${this.libraryId} is missing or removed`);
  }

  private async assertWork(workId: string, activeOnly: boolean): Promise<void> {
    assertId(workId, "Work id");
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM works
       WHERE id = ? AND library_id = ?${activeOnly ? " AND deleted_at IS NULL" : ""}
       LIMIT 1`,
      [workId, this.libraryId],
    );
    if (!rows[0]) throw new Error(`Work ${workId} is missing or removed`);
  }
}

const ASSET_KINDS = new Set<DocumentAssetKind>([
  "pdf",
  "html",
  "docx",
  "markdown",
  "epub",
  "notebook",
  "supplement",
  "other",
]);
const EXTRACTION_STATUSES = new Set<DocumentExtractionStatus>([
  "pending",
  "running",
  "ready",
  "failed",
  "unsupported",
]);
const AVAILABILITY_STATUSES = new Set<DocumentAvailabilityStatus>([
  "unchecked",
  "available",
  "missing",
  "relink-required",
]);

function validateRevisionInput(input: CreateDocumentRevisionInput): void {
  if (!input.mimeType.trim()) throw new Error("Document revision MIME type must not be empty");
  const blobSha256 = input.blobSha256.trim();
  if (!blobSha256) throw new Error("Document revision blob hash must not be empty");
  // Existing attachment bridges may contain hashes written before canonical
  // SHA-256 validation existed. New standalone revisions must be trustworthy.
  if (!input.attachmentId && !/^[0-9a-f]{64}$/.test(blobSha256)) {
    throw new Error("Document revision blob hash must be a lowercase SHA-256 value");
  }
  if (!Number.isInteger(input.byteSize) || input.byteSize < 0) {
    throw new Error("Document revision byte size must be a non-negative integer");
  }
  if (input.extractionStatus && !EXTRACTION_STATUSES.has(input.extractionStatus)) {
    throw new Error(`Unsupported extraction status: ${input.extractionStatus}`);
  }
  if (input.availabilityStatus && !AVAILABILITY_STATUSES.has(input.availabilityStatus)) {
    throw new Error(`Unsupported availability status: ${input.availabilityStatus}`);
  }
}

function assertId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string`);
}
