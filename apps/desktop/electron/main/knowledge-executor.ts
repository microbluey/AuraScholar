import {
  ContentUnitsRepo,
  appendKnowledgeChangeInTransaction,
  type Database,
  type KnowledgeJobExecutor,
  type KnowledgeJobRow,
} from "@aurascholar/db";
import {
  PDF_TEXT_EXTRACTOR_PROFILE_V1,
  appendPdfAnchoringText,
  buildAnnotationContentUnit,
  buildEvidenceContentUnit,
  extractPdfContentUnits,
  isPdfTextItem,
} from "@aurascholar/knowledge";

const CANONICAL_SHA256 = /^[0-9a-f]{64}$/;
const PDF_MIME_TYPES = new Set(["application/pdf", "application/x-pdf"]);

export interface PdfPageLike {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
}

export interface PdfDocumentLike {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): void | Promise<void>;
}

interface RevisionSourceRow {
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

interface AnnotationSourceRow {
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

interface EvidenceSourceRow {
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

interface TextEvidencePayload {
  kind: "text";
  text: string;
}

type ExecutionResult = { progress?: unknown | null };

export interface KnowledgeExecutorDependencies {
  inspect<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  materializeSemanticIndex?(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<ExecutionResult>;
  transaction<T>(
    commandName: string,
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T>;
  readBlob(sha256: string, signal: AbortSignal): Promise<Uint8Array>;
  openPdf(bytes: Uint8Array, signal: AbortSignal): Promise<PdfDocumentLike>;
}

/**
 * Main-process implementation for the first durable Knowledge Layer stage.
 * It only materializes ContentUnits. FTS and vector consumers deliberately
 * remain separate workers, so changing retrieval backends never mutates the
 * canonical document/annotation/evidence records.
 */
export class DesktopKnowledgeJobExecutor implements KnowledgeJobExecutor {
  constructor(private readonly dependencies: KnowledgeExecutorDependencies) {}

  async execute(job: KnowledgeJobRow, signal: AbortSignal): Promise<ExecutionResult> {
    throwIfAborted(signal);
    switch (job.kind) {
      case "extract":
        return this.executeExtract(job, signal);
      case "remove":
        return this.executeRemove(job);
      case "embed":
        return this.executeEmbed(job, signal);
      case "reindex":
        return this.executeReindex(job);
      default:
        throw new Error(`Knowledge job kind ${job.kind} has no desktop executor`);
    }
  }

  private async executeExtract(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    switch (job.sourceType) {
      case "revision":
        return this.extractRevision(job, signal);
      case "annotation":
        return this.extractAnnotation(job, signal);
      case "evidence":
        return this.extractEvidence(job, signal);
      default:
        throw new Error(`Knowledge extract job cannot process ${job.sourceType} sources`);
    }
  }

  private async extractRevision(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    const prepared = await this.dependencies.transaction(
      "knowledge.extract.prepare",
      async (database) => {
        if (await isJobSuperseded(database, job))
          return { kind: "skipped", reason: "superseded" } as const;
        const source = await revisionSource(database, job.libraryId, job.sourceId);
        if (!source || !isActiveRevision(source))
          return { kind: "retire", reason: "source-missing" } as const;
        if (!matchesExpected(job, source.revision_id, source.blob_sha256)) {
          return { kind: "skipped", reason: "source-changed" } as const;
        }
        if (!isPdfRevision(source) || !isCanonicalSha256(source.blob_sha256)) {
          await setRevisionExtractionStatus(database, source.revision_id, "unsupported");
          return { kind: "unsupported", reason: "unsupported-document" } as const;
        }
        await setRevisionExtractionStatus(database, source.revision_id, "running");
        return { kind: "ready", source } as const;
      },
    );

    if (prepared.kind === "skipped") return skipped(prepared.reason);
    if (prepared.kind === "retire")
      return this.retireIfCurrent(job, "pdf", job.sourceId, prepared.reason);
    if (prepared.kind === "unsupported")
      return completed({ status: "unsupported", reason: prepared.reason });

    let document: PdfDocumentLike | null = null;
    try {
      const bytes = await this.dependencies.readBlob(prepared.source.blob_sha256, signal);
      throwIfAborted(signal);
      document = await this.dependencies.openPdf(bytes, signal);
      throwIfAborted(signal);
      const units = await extractPdfContentUnits({
        libraryId: job.libraryId,
        revisionId: prepared.source.revision_id,
        workId: prepared.source.work_id,
        assetId: prepared.source.asset_id,
        source: pdfTextSource(document),
        signal,
      });
      throwIfAborted(signal);

      const persisted = await this.dependencies.transaction(
        "knowledge.extract.persist",
        async (database) => {
          if (await isJobSuperseded(database, job)) return false;
          const current = await revisionSource(database, job.libraryId, job.sourceId);
          if (
            !current ||
            !isActiveRevision(current) ||
            !sameRevisionSource(current, prepared.source)
          ) {
            return false;
          }
          if (!matchesExpected(job, current.revision_id, current.blob_sha256)) return false;
          throwIfAborted(signal);
          await new ContentUnitsRepo(database, job.libraryId).replaceForSource({
            sourceType: "pdf",
            sourceId: current.revision_id,
            revisionId: current.revision_id,
            units,
          });
          await setRevisionExtractionStatus(
            database,
            current.revision_id,
            "ready",
            PDF_TEXT_EXTRACTOR_PROFILE_V1,
          );
          return true;
        },
      );
      return persisted
        ? completed({ status: "ready", units: units.length, pages: document.numPages })
        : skipped("superseded");
    } catch (error) {
      if (!signal.aborted) await this.markRevisionFailed(job, prepared.source);
      throw error;
    } finally {
      await destroyPdfDocument(document);
    }
  }

  private async markRevisionFailed(job: KnowledgeJobRow, source: RevisionSourceRow): Promise<void> {
    try {
      await this.dependencies.transaction("knowledge.extract.failed", async (database) => {
        if (await isJobSuperseded(database, job)) return;
        const current = await revisionSource(database, job.libraryId, job.sourceId);
        if (!current || !isActiveRevision(current) || !sameRevisionSource(current, source)) return;
        if (!matchesExpected(job, current.revision_id, current.blob_sha256)) return;
        await setRevisionExtractionStatus(database, current.revision_id, "failed");
      });
    } catch {
      // Preserve the original extraction error. Its durable job retry remains
      // the recovery mechanism if a secondary status write also fails.
    }
  }

  private async extractAnnotation(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    const source = await this.dependencies.inspect(async (database) => {
      if (await isJobSuperseded(database, job)) return null;
      return annotationSource(database, job.libraryId, job.sourceId);
    });
    if (!source) return skipped("superseded-or-missing");
    if (!isActiveAnnotation(source))
      return this.retireIfCurrent(job, "annotation", job.sourceId, "source-missing");
    if (!matchesExpected(job, source.revision_id, source.revision_blob_sha256)) {
      return skipped("source-changed");
    }

    const unit = await buildAnnotationContentUnit({
      libraryId: job.libraryId,
      annotationId: source.annotation_id,
      revisionId: source.revision_id,
      workId: source.work_id,
      assetId: source.asset_id,
      anchor: parseJson(source.anchor_json, "Annotation anchor"),
      contentMd: source.content_md,
    });
    throwIfAborted(signal);

    const persisted = await this.dependencies.transaction(
      "knowledge.annotation.persist",
      async (database) => {
        if (await isJobSuperseded(database, job)) return false;
        const current = await annotationSource(database, job.libraryId, job.sourceId);
        if (!current || !isActiveAnnotation(current) || !sameAnnotationSource(current, source))
          return false;
        if (!matchesExpected(job, current.revision_id, current.revision_blob_sha256)) return false;
        throwIfAborted(signal);
        await new ContentUnitsRepo(database, job.libraryId).replaceForSource({
          sourceType: "annotation",
          sourceId: current.annotation_id,
          units: [unit],
        });
        return true;
      },
    );
    return persisted ? completed({ status: "ready", units: 1 }) : skipped("superseded");
  }

  private async extractEvidence(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    const source = await this.dependencies.inspect(async (database) => {
      if (await isJobSuperseded(database, job)) return null;
      return evidenceSource(database, job.libraryId, job.sourceId);
    });
    if (!source) return skipped("superseded-or-missing");
    if (!isActiveEvidence(source))
      return this.retireIfCurrent(job, "evidence", job.sourceId, "source-missing");
    if (!matchesExpected(job, source.revision_id, source.source_content_hash)) {
      return skipped("source-changed");
    }
    const payload = parseTextEvidencePayload(source.payload_json);
    const unit = await buildEvidenceContentUnit({
      libraryId: job.libraryId,
      evidenceId: source.evidence_id,
      revisionId: source.revision_id,
      workId: source.work_id,
      assetId: source.asset_id,
      anchor: parseJson(source.anchor_json, "Evidence anchor"),
      text: payload.text,
      sourceContentHash: source.source_content_hash,
    });
    throwIfAborted(signal);

    const persisted = await this.dependencies.transaction(
      "knowledge.evidence.persist",
      async (database) => {
        if (await isJobSuperseded(database, job)) return false;
        const current = await evidenceSource(database, job.libraryId, job.sourceId);
        if (!current || !isActiveEvidence(current) || !sameEvidenceSource(current, source))
          return false;
        if (!matchesExpected(job, current.revision_id, current.source_content_hash)) return false;
        throwIfAborted(signal);
        await new ContentUnitsRepo(database, job.libraryId).replaceForSource({
          sourceType: "evidence",
          sourceId: current.evidence_id,
          units: [unit],
        });
        return true;
      },
    );
    return persisted ? completed({ status: "ready", units: 1 }) : skipped("superseded");
  }

  private async executeRemove(job: KnowledgeJobRow): Promise<ExecutionResult> {
    switch (job.sourceType) {
      case "revision":
        return this.retireIfCurrent(job, "pdf", job.sourceId, "removed");
      case "annotation":
        return this.retireIfCurrent(job, "annotation", job.sourceId, "removed");
      case "evidence":
        return this.retireIfCurrent(job, "evidence", job.sourceId, "removed");
      default:
        throw new Error(`Knowledge remove job cannot process ${job.sourceType} sources`);
    }
  }

  private async executeEmbed(job: KnowledgeJobRow, signal: AbortSignal): Promise<ExecutionResult> {
    const materialize = this.dependencies.materializeSemanticIndex;
    if (!materialize) {
      throw new Error("Local semantic-index materialization is unavailable");
    }
    return materialize(job, signal);
  }

  private async retireIfCurrent(
    job: KnowledgeJobRow,
    sourceType: "pdf" | "annotation" | "evidence",
    sourceId: string,
    reason: string,
  ): Promise<ExecutionResult> {
    const retired = await this.dependencies.transaction(
      "knowledge.content.retire",
      async (database) => {
        if (await isJobSuperseded(database, job)) return null;
        return new ContentUnitsRepo(database, job.libraryId).retireSource({ sourceType, sourceId });
      },
    );
    return retired === null
      ? skipped("superseded")
      : completed({ status: "retired", reason, units: retired });
  }

  private async executeReindex(job: KnowledgeJobRow): Promise<ExecutionResult> {
    if (job.sourceType !== "library") {
      throw new Error(`Knowledge reindex job cannot process ${job.sourceType} sources`);
    }
    return this.dependencies.transaction("knowledge.reindex", async (database) => {
      if (await isJobSuperseded(database, job)) return skipped("superseded");
      if (!(await hasActiveLibrary(database, job.libraryId))) return skipped("library-missing");

      let revisions = 0;
      let annotations = 0;
      let evidence = 0;
      const revisionRows = await database.query<RevisionSourceRow>(
        `SELECT revision.id AS revision_id, revision.asset_id, asset.work_id,
                asset.kind AS asset_kind, revision.mime_type, revision.blob_sha256,
                revision.byte_size, revision.deleted_at AS revision_deleted_at,
                asset.deleted_at AS asset_deleted_at, work.deleted_at AS work_deleted_at
         FROM document_revisions revision
         JOIN document_assets asset ON asset.id = revision.asset_id
         LEFT JOIN works work ON work.id = asset.work_id
         WHERE asset.library_id = ?
           AND revision.deleted_at IS NULL AND asset.deleted_at IS NULL
           AND (asset.work_id IS NULL OR (work.id IS NOT NULL AND work.deleted_at IS NULL))
           AND (asset.kind = 'pdf' OR lower(revision.mime_type) IN ('application/pdf', 'application/x-pdf'))
         ORDER BY revision.created_at ASC, revision.id ASC`,
        [job.libraryId],
      );
      for (const source of revisionRows) {
        await appendKnowledgeChangeInTransaction(database, {
          libraryId: job.libraryId,
          sourceType: "revision",
          sourceId: source.revision_id,
          changeKind: "upsert",
          expectedRevisionId: source.revision_id,
          expectedContentHash: isCanonicalSha256(source.blob_sha256) ? source.blob_sha256 : null,
        });
        revisions += 1;
      }

      const annotationIds = await database.query<{ id: string }>(
        `SELECT annotation.id
         FROM annotations annotation
         JOIN attachments attachment ON attachment.id = annotation.attachment_id
         JOIN works work ON work.id = annotation.work_id AND work.id = attachment.work_id
         WHERE work.library_id = ?
           AND annotation.deleted_at IS NULL
           AND attachment.deleted_at IS NULL
           AND work.deleted_at IS NULL
         ORDER BY annotation.created_at ASC, annotation.id ASC`,
        [job.libraryId],
      );
      for (const row of annotationIds) {
        const source = await annotationSource(database, job.libraryId, row.id);
        if (!source || !isActiveAnnotation(source)) continue;
        await appendKnowledgeChangeInTransaction(database, {
          libraryId: job.libraryId,
          sourceType: "annotation",
          sourceId: source.annotation_id,
          changeKind: "upsert",
          expectedRevisionId: source.revision_id,
          expectedContentHash: isCanonicalSha256(source.revision_blob_sha256)
            ? source.revision_blob_sha256
            : null,
        });
        annotations += 1;
      }

      const evidenceIds = await database.query<{ id: string }>(
        `SELECT id FROM evidence_items
         WHERE library_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC`,
        [job.libraryId],
      );
      for (const row of evidenceIds) {
        const source = await evidenceSource(database, job.libraryId, row.id);
        if (!source || !isActiveEvidence(source)) continue;
        await appendKnowledgeChangeInTransaction(database, {
          libraryId: job.libraryId,
          sourceType: "evidence",
          sourceId: source.evidence_id,
          changeKind: "upsert",
          expectedRevisionId: source.revision_id,
          expectedContentHash: source.source_content_hash,
        });
        evidence += 1;
      }
      return completed({ status: "enqueued", revisions, annotations, evidence });
    });
  }
}

async function revisionSource(
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

async function annotationSource(
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

async function evidenceSource(
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

function isActiveRevision(source: RevisionSourceRow): boolean {
  return (
    source.revision_deleted_at === null &&
    source.asset_deleted_at === null &&
    (source.work_id === null || source.work_deleted_at === null)
  );
}

function isPdfRevision(source: RevisionSourceRow): boolean {
  return source.asset_kind === "pdf" || PDF_MIME_TYPES.has(source.mime_type.toLowerCase());
}

function isActiveAnnotation(source: AnnotationSourceRow): source is AnnotationSourceRow & {
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

function isActiveEvidence(source: EvidenceSourceRow): boolean {
  return (
    source.evidence_deleted_at === null &&
    source.work_deleted_at === null &&
    source.asset_deleted_at === null &&
    source.joined_revision_id === source.revision_id &&
    source.revision_deleted_at === null
  );
}

function sameRevisionSource(left: RevisionSourceRow, right: RevisionSourceRow): boolean {
  return (
    left.revision_id === right.revision_id &&
    left.asset_id === right.asset_id &&
    left.work_id === right.work_id &&
    left.blob_sha256 === right.blob_sha256 &&
    left.mime_type === right.mime_type
  );
}

function sameAnnotationSource(left: AnnotationSourceRow, right: AnnotationSourceRow): boolean {
  return (
    left.annotation_id === right.annotation_id &&
    left.revision_id === right.revision_id &&
    left.revision_blob_sha256 === right.revision_blob_sha256 &&
    left.anchor_json === right.anchor_json &&
    left.content_md === right.content_md
  );
}

function sameEvidenceSource(left: EvidenceSourceRow, right: EvidenceSourceRow): boolean {
  return (
    left.evidence_id === right.evidence_id &&
    left.revision_id === right.revision_id &&
    left.anchor_json === right.anchor_json &&
    left.payload_json === right.payload_json &&
    left.source_content_hash === right.source_content_hash
  );
}

function matchesExpected(
  job: KnowledgeJobRow,
  revisionId: string | null,
  contentHash: string | null,
): boolean {
  return (
    (job.expectedRevisionId === null || job.expectedRevisionId === revisionId) &&
    (job.expectedContentHash === null || job.expectedContentHash === contentHash)
  );
}

async function isJobSuperseded(database: Database, job: KnowledgeJobRow): Promise<boolean> {
  if (job.sourceChangeSeq === null) return false;
  const rows = await database.query<{ seq: number }>(
    `SELECT seq FROM knowledge_changes
     WHERE library_id = ? AND source_type = ? AND source_id = ? AND seq > ?
     LIMIT 1`,
    [job.libraryId, job.sourceType, job.sourceId, job.sourceChangeSeq],
  );
  return rows.length > 0;
}

async function hasActiveLibrary(database: Database, libraryId: string): Promise<boolean> {
  const rows = await database.query<{ id: string }>(
    "SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [libraryId],
  );
  return rows.length > 0;
}

async function setRevisionExtractionStatus(
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

function pdfTextSource(document: PdfDocumentLike) {
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

function parseJson(value: string | null, label: string): unknown {
  if (value === null) throw new Error(`${label} is missing`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} is invalid JSON`);
  }
}

function parseTextEvidencePayload(value: string): TextEvidencePayload {
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

function isCanonicalSha256(value: string | null): value is string {
  return value !== null && CANONICAL_SHA256.test(value);
}

function completed(progress: unknown): ExecutionResult {
  return { progress };
}

function skipped(reason: string): ExecutionResult {
  return completed({ status: "skipped", reason });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error("Knowledge job execution was aborted");
  error.name = "AbortError";
  throw error;
}

async function destroyPdfDocument(document: PdfDocumentLike | null): Promise<void> {
  if (!document) return;
  try {
    await document.destroy();
  } catch {
    // A successful extraction must not be retried just because pdf.js cleanup
    // races with its own worker teardown.
  }
}
