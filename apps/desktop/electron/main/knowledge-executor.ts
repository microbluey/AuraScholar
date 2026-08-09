import {
  ContentUnitsRepo,
  appendKnowledgeChangeInTransaction,
  type Database,
  type KnowledgeJobExecutor,
  type KnowledgeJobRow,
} from "@aurascholar/db";
import {
  PDF_TEXT_EXTRACTOR_PROFILE_V1,
  buildAnnotationContentUnit,
  buildEvidenceContentUnit,
  extractPdfContentUnits,
} from "@aurascholar/knowledge";
import * as Support from "./knowledge-executor-support.js";

export * from "./knowledge-executor-support.js";

export interface KnowledgeExecutorDependencies {
  inspect<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  materializeSemanticIndex?(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<Support.ExecutionResult>;
  transaction<T>(
    commandName: string,
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T>;
  readBlob(sha256: string, signal: AbortSignal): Promise<Uint8Array>;
  openPdf(bytes: Uint8Array, signal: AbortSignal): Promise<Support.PdfDocumentLike>;
}

/**
 * Main-process implementation for the first durable Knowledge Layer stage.
 * It only materializes ContentUnits. FTS and vector consumers deliberately
 * remain separate workers, so changing retrieval backends never mutates the
 * canonical document/annotation/evidence records.
 */
export class DesktopKnowledgeJobExecutor implements KnowledgeJobExecutor {
  constructor(private readonly dependencies: KnowledgeExecutorDependencies) {}

  async execute(job: KnowledgeJobRow, signal: AbortSignal): Promise<Support.ExecutionResult> {
    Support.throwIfAborted(signal);
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
  ): Promise<Support.ExecutionResult> {
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
  ): Promise<Support.ExecutionResult> {
    const prepared = await this.dependencies.transaction(
      "knowledge.extract.prepare",
      async (database) => {
        if (await Support.isJobSuperseded(database, job))
          return { kind: "Support.skipped", reason: "superseded" } as const;
        const source = await Support.revisionSource(database, job.libraryId, job.sourceId);
        if (!source || !Support.isActiveRevision(source))
          return { kind: "retire", reason: "source-missing" } as const;
        if (!Support.matchesExpected(job, source.revision_id, source.blob_sha256)) {
          return { kind: "Support.skipped", reason: "source-changed" } as const;
        }
        if (!Support.isPdfRevision(source) || !Support.isCanonicalSha256(source.blob_sha256)) {
          await Support.setRevisionExtractionStatus(database, source.revision_id, "unsupported");
          return { kind: "unsupported", reason: "unsupported-document" } as const;
        }
        await Support.setRevisionExtractionStatus(database, source.revision_id, "running");
        return { kind: "ready", source } as const;
      },
    );

    if (prepared.kind === "Support.skipped") return Support.skipped(prepared.reason);
    if (prepared.kind === "retire")
      return this.retireIfCurrent(job, "pdf", job.sourceId, prepared.reason);
    if (prepared.kind === "unsupported")
      return Support.completed({ status: "unsupported", reason: prepared.reason });

    let document: Support.PdfDocumentLike | null = null;
    try {
      const bytes = await this.dependencies.readBlob(prepared.source.blob_sha256, signal);
      Support.throwIfAborted(signal);
      document = await this.dependencies.openPdf(bytes, signal);
      Support.throwIfAborted(signal);
      const units = await extractPdfContentUnits({
        libraryId: job.libraryId,
        revisionId: prepared.source.revision_id,
        workId: prepared.source.work_id,
        assetId: prepared.source.asset_id,
        source: Support.pdfTextSource(document),
        signal,
      });
      Support.throwIfAborted(signal);

      const persisted = await this.dependencies.transaction(
        "knowledge.extract.persist",
        async (database) => {
          if (await Support.isJobSuperseded(database, job)) return false;
          const current = await Support.revisionSource(database, job.libraryId, job.sourceId);
          if (
            !current ||
            !Support.isActiveRevision(current) ||
            !Support.sameRevisionSource(current, prepared.source)
          ) {
            return false;
          }
          if (!Support.matchesExpected(job, current.revision_id, current.blob_sha256)) return false;
          Support.throwIfAborted(signal);
          await new ContentUnitsRepo(database, job.libraryId).replaceForSource({
            sourceType: "pdf",
            sourceId: current.revision_id,
            revisionId: current.revision_id,
            units,
          });
          await Support.setRevisionExtractionStatus(
            database,
            current.revision_id,
            "ready",
            PDF_TEXT_EXTRACTOR_PROFILE_V1,
          );
          return true;
        },
      );
      return persisted
        ? Support.completed({ status: "ready", units: units.length, pages: document.numPages })
        : Support.skipped("superseded");
    } catch (error) {
      if (!signal.aborted) await this.markRevisionFailed(job, prepared.source);
      throw error;
    } finally {
      await Support.destroyPdfDocument(document);
    }
  }

  private async markRevisionFailed(
    job: KnowledgeJobRow,
    source: Support.RevisionSourceRow,
  ): Promise<void> {
    try {
      await this.dependencies.transaction("knowledge.extract.failed", async (database) => {
        if (await Support.isJobSuperseded(database, job)) return;
        const current = await Support.revisionSource(database, job.libraryId, job.sourceId);
        if (
          !current ||
          !Support.isActiveRevision(current) ||
          !Support.sameRevisionSource(current, source)
        )
          return;
        if (!Support.matchesExpected(job, current.revision_id, current.blob_sha256)) return;
        await Support.setRevisionExtractionStatus(database, current.revision_id, "failed");
      });
    } catch {
      // Preserve the original extraction error. Its durable job retry remains
      // the recovery mechanism if a secondary status write also fails.
    }
  }

  private async extractAnnotation(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<Support.ExecutionResult> {
    const source = await this.dependencies.inspect(async (database) => {
      if (await Support.isJobSuperseded(database, job)) return null;
      return Support.annotationSource(database, job.libraryId, job.sourceId);
    });
    if (!source) return Support.skipped("superseded-or-missing");
    if (!Support.isActiveAnnotation(source))
      return this.retireIfCurrent(job, "annotation", job.sourceId, "source-missing");
    if (!Support.matchesExpected(job, source.revision_id, source.revision_blob_sha256)) {
      return Support.skipped("source-changed");
    }

    const unit = await buildAnnotationContentUnit({
      libraryId: job.libraryId,
      annotationId: source.annotation_id,
      revisionId: source.revision_id,
      workId: source.work_id,
      assetId: source.asset_id,
      anchor: Support.parseJson(source.anchor_json, "Annotation anchor"),
      contentMd: source.content_md,
    });
    Support.throwIfAborted(signal);

    const persisted = await this.dependencies.transaction(
      "knowledge.annotation.persist",
      async (database) => {
        if (await Support.isJobSuperseded(database, job)) return false;
        const current = await Support.annotationSource(database, job.libraryId, job.sourceId);
        if (
          !current ||
          !Support.isActiveAnnotation(current) ||
          !Support.sameAnnotationSource(current, source)
        )
          return false;
        if (!Support.matchesExpected(job, current.revision_id, current.revision_blob_sha256))
          return false;
        Support.throwIfAborted(signal);
        await new ContentUnitsRepo(database, job.libraryId).replaceForSource({
          sourceType: "annotation",
          sourceId: current.annotation_id,
          units: [unit],
        });
        return true;
      },
    );
    return persisted
      ? Support.completed({ status: "ready", units: 1 })
      : Support.skipped("superseded");
  }

  private async extractEvidence(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<Support.ExecutionResult> {
    const source = await this.dependencies.inspect(async (database) => {
      if (await Support.isJobSuperseded(database, job)) return null;
      return Support.evidenceSource(database, job.libraryId, job.sourceId);
    });
    if (!source) return Support.skipped("superseded-or-missing");
    if (!Support.isActiveEvidence(source))
      return this.retireIfCurrent(job, "evidence", job.sourceId, "source-missing");
    if (!Support.matchesExpected(job, source.revision_id, source.source_content_hash)) {
      return Support.skipped("source-changed");
    }
    const payload = Support.parseTextEvidencePayload(source.payload_json);
    const unit = await buildEvidenceContentUnit({
      libraryId: job.libraryId,
      evidenceId: source.evidence_id,
      revisionId: source.revision_id,
      workId: source.work_id,
      assetId: source.asset_id,
      anchor: Support.parseJson(source.anchor_json, "Evidence anchor"),
      text: payload.text,
      sourceContentHash: source.source_content_hash,
    });
    Support.throwIfAborted(signal);

    const persisted = await this.dependencies.transaction(
      "knowledge.evidence.persist",
      async (database) => {
        if (await Support.isJobSuperseded(database, job)) return false;
        const current = await Support.evidenceSource(database, job.libraryId, job.sourceId);
        if (
          !current ||
          !Support.isActiveEvidence(current) ||
          !Support.sameEvidenceSource(current, source)
        )
          return false;
        if (!Support.matchesExpected(job, current.revision_id, current.source_content_hash))
          return false;
        Support.throwIfAborted(signal);
        await new ContentUnitsRepo(database, job.libraryId).replaceForSource({
          sourceType: "evidence",
          sourceId: current.evidence_id,
          units: [unit],
        });
        return true;
      },
    );
    return persisted
      ? Support.completed({ status: "ready", units: 1 })
      : Support.skipped("superseded");
  }

  private async executeRemove(job: KnowledgeJobRow): Promise<Support.ExecutionResult> {
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

  private async executeEmbed(
    job: KnowledgeJobRow,
    signal: AbortSignal,
  ): Promise<Support.ExecutionResult> {
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
  ): Promise<Support.ExecutionResult> {
    const retired = await this.dependencies.transaction(
      "knowledge.content.retire",
      async (database) => {
        if (await Support.isJobSuperseded(database, job)) return null;
        return new ContentUnitsRepo(database, job.libraryId).retireSource({ sourceType, sourceId });
      },
    );
    return retired === null
      ? Support.skipped("superseded")
      : Support.completed({ status: "retired", reason, units: retired });
  }

  private async executeReindex(job: KnowledgeJobRow): Promise<Support.ExecutionResult> {
    if (job.sourceType !== "library") {
      throw new Error(`Knowledge reindex job cannot process ${job.sourceType} sources`);
    }
    return this.dependencies.transaction("knowledge.reindex", async (database) => {
      if (await Support.isJobSuperseded(database, job)) return Support.skipped("superseded");
      if (!(await Support.hasActiveLibrary(database, job.libraryId)))
        return Support.skipped("library-missing");

      let revisions = 0;
      let annotations = 0;
      let evidence = 0;
      const revisionRows = await database.query<Support.RevisionSourceRow>(
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
          expectedContentHash: Support.isCanonicalSha256(source.blob_sha256)
            ? source.blob_sha256
            : null,
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
        const source = await Support.annotationSource(database, job.libraryId, row.id);
        if (!source || !Support.isActiveAnnotation(source)) continue;
        await appendKnowledgeChangeInTransaction(database, {
          libraryId: job.libraryId,
          sourceType: "annotation",
          sourceId: source.annotation_id,
          changeKind: "upsert",
          expectedRevisionId: source.revision_id,
          expectedContentHash: Support.isCanonicalSha256(source.revision_blob_sha256)
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
        const source = await Support.evidenceSource(database, job.libraryId, row.id);
        if (!source || !Support.isActiveEvidence(source)) continue;
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
      return Support.completed({ status: "enqueued", revisions, annotations, evidence });
    });
  }
}
