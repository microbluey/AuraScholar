import type { Database } from "../database.js";
import { withDatabaseSavepoint } from "../savepoint.js";
import { withDatabaseWriteLock } from "./write-lock.js";
import * as Content from "./content-unit-support.js";
import * as Contract from "./knowledge-contract.js";
import * as Utils from "./knowledge-utils.js";

export class ContentUnitsRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    Utils.assertId(libraryId, "Library id");
  }

  async get(
    contentUnitId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<Contract.ContentUnitRow | null> {
    Utils.assertId(contentUnitId, "ContentUnit id");
    const rows = await this.db.query<Contract.ContentUnitStorageRow>(
      `SELECT ${Content.CONTENT_UNIT_COLUMNS}
       FROM content_units
       WHERE id = ? AND library_id = ?${options.includeDeleted ? "" : " AND deleted_at IS NULL"}
       LIMIT 1`,
      [contentUnitId, this.libraryId],
    );
    return rows[0] ? Content.toContentUnitRow(rows[0]) : null;
  }

  async listForSource(
    sourceType: Contract.ContentUnitSourceType,
    sourceId: string,
    options: { revisionId?: string | null; includeDeleted?: boolean } = {},
  ): Promise<Contract.ContentUnitRow[]> {
    Utils.assertKnownContentUnitSourceType(sourceType);
    Utils.assertId(sourceId, "ContentUnit source id");
    const clauses = ["library_id = ?", "source_type = ?", "source_id = ?"];
    const params: unknown[] = [this.libraryId, sourceType, sourceId];
    if (options.revisionId !== undefined) {
      clauses.push("revision_id IS ?");
      params.push(options.revisionId);
    }
    if (!options.includeDeleted) clauses.push("deleted_at IS NULL");
    const rows = await this.db.query<Contract.ContentUnitStorageRow>(
      `SELECT ${Content.CONTENT_UNIT_COLUMNS}
       FROM content_units
       WHERE ${clauses.join(" AND ")}
       ORDER BY ordinal ASC, id ASC`,
      params,
    );
    return rows.map(Content.toContentUnitRow);
  }

  /**
   * Counts the live corpus without opening the FTS table. `ready` is the
   * citation-safe subset that a semantic index should include by default.
   */
  async getIndexStats(): Promise<Contract.ContentUnitIndexStats> {
    const rows = await this.db.query<Contract.ContentUnitIndexStatsStorageRow>(
      // Keep effective-language precedence aligned with ContentUnit search
      // hydration. This makes metadata corrections visible in the planner
      // without rebuilding a semantic index.
      `WITH active_units AS (
         SELECT unit.source_type,
                unit.state,
                COALESCE(NULLIF(trim(unit.language), ''), NULLIF(trim(work.language), '')) AS effective_language
           FROM content_units unit
           LEFT JOIN works work
             ON work.id = unit.work_id
            AND work.library_id = unit.library_id
            AND work.deleted_at IS NULL
          WHERE unit.library_id = ? AND unit.deleted_at IS NULL
       ),
       normalized_units AS (
         SELECT source_type,
                state,
                effective_language,
                lower(replace(effective_language, '_', '-')) AS normalized_language
           FROM active_units
       ),
       categorized_units AS (
         SELECT source_type,
                state,
                CASE
                  WHEN effective_language IS NULL THEN 'missing'
                  WHEN normalized_language = 'zh'
                    OR normalized_language LIKE 'zh-%'
                    OR normalized_language IN ('cmn', 'chi', 'zho', 'chinese', '中文', '汉语', '華語', '华语', '简体中文', '繁体中文')
                    THEN 'zh'
                  WHEN normalized_language = 'en'
                    OR normalized_language LIKE 'en-%'
                    OR normalized_language IN ('eng', 'english', '英语', '英文')
                    THEN 'en'
                  ELSE 'other'
                END AS language_category
           FROM normalized_units
       )
       SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN state = 'ready' THEN 1 ELSE 0 END), 0) AS ready,
              COALESCE(SUM(CASE WHEN state = 'context-only' THEN 1 ELSE 0 END), 0) AS context_only,
              COALESCE(SUM(CASE WHEN source_type = 'pdf' THEN 1 ELSE 0 END), 0) AS pdf_count,
              COALESCE(SUM(CASE WHEN source_type = 'annotation' THEN 1 ELSE 0 END), 0) AS annotation_count,
              COALESCE(SUM(CASE WHEN source_type = 'evidence' THEN 1 ELSE 0 END), 0) AS evidence_count,
              COALESCE(SUM(CASE WHEN state = 'ready' AND language_category = 'zh' THEN 1 ELSE 0 END), 0) AS zh_language_count,
              COALESCE(SUM(CASE WHEN state = 'ready' AND language_category = 'en' THEN 1 ELSE 0 END), 0) AS en_language_count,
              COALESCE(SUM(CASE WHEN state = 'ready' AND language_category = 'other' THEN 1 ELSE 0 END), 0) AS other_language_count,
              COALESCE(SUM(CASE WHEN state = 'ready' AND language_category = 'missing' THEN 1 ELSE 0 END), 0) AS missing_language_count
         FROM categorized_units`,
      [this.libraryId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error("ContentUnit index statistics query returned no row");
    }
    return {
      total: Content.toContentUnitCount(row.total, "total ContentUnits"),
      ready: Content.toContentUnitCount(row.ready, "ready ContentUnits"),
      contextOnly: Content.toContentUnitCount(row.context_only, "context-only ContentUnits"),
      sourceCounts: {
        pdf: Content.toContentUnitCount(row.pdf_count, "PDF ContentUnits"),
        annotation: Content.toContentUnitCount(row.annotation_count, "annotation ContentUnits"),
        evidence: Content.toContentUnitCount(row.evidence_count, "Evidence ContentUnits"),
      },
      languageCoverage: {
        zh: Content.toContentUnitCount(row.zh_language_count, "Chinese-labelled ContentUnits"),
        en: Content.toContentUnitCount(row.en_language_count, "English-labelled ContentUnits"),
        other: Content.toContentUnitCount(row.other_language_count, "other-language ContentUnits"),
        missing: Content.toContentUnitCount(row.missing_language_count, "unlabelled ContentUnits"),
      },
    };
  }

  /** Restores matching deterministic ContentUnits without overwriting their immutable payload. */
  async upsertMany(units: readonly Contract.ContentUnit[]): Promise<Contract.ContentUnit[]> {
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "content_units_upsert", async () => {
        await Utils.assertActiveLibrary(this.db, this.libraryId);
        await this.upsertManyInTransaction(units);
        return [...units];
      }),
    );
  }

  /**
   * Upserts an extractor result and retires any no-longer-emitted units for the
   * same source/revision in the same durable write.
   */
  async replaceForSource(
    input: Contract.ReplaceContentUnitsInput,
  ): Promise<Contract.ContentUnit[]> {
    Utils.assertKnownContentUnitSourceType(input.sourceType);
    Utils.assertId(input.sourceId, "ContentUnit source id");
    if (input.revisionId !== undefined && input.revisionId !== null) {
      Utils.assertId(input.revisionId, "ContentUnit revision id");
    }
    for (const unit of input.units) {
      Content.assertContentUnit(unit, this.libraryId);
      if (unit.sourceType !== input.sourceType || unit.sourceId !== input.sourceId) {
        throw new Error("Replacement ContentUnits must belong to the requested source");
      }
      if (input.revisionId !== undefined && unit.revisionId !== input.revisionId) {
        throw new Error("Replacement ContentUnits must belong to the requested revision");
      }
    }
    return withDatabaseWriteLock(this.db, () =>
      withDatabaseSavepoint(this.db, "content_units_replace", async () => {
        await Utils.assertActiveLibrary(this.db, this.libraryId);
        await this.upsertManyInTransaction(input.units);
        const existing = await this.listForSourceInTransaction(
          input.sourceType,
          input.sourceId,
          input.revisionId,
        );
        const liveIds = new Set(input.units.map((unit) => unit.id));
        const now = Date.now();
        for (const unit of existing) {
          if (liveIds.has(unit.id)) continue;
          await this.db.run(
            `UPDATE content_units
             SET deleted_at = ?, updated_at = MAX(updated_at + 1, ?)
             WHERE id = ? AND library_id = ? AND deleted_at IS NULL`,
            [now, now, unit.id, this.libraryId],
          );
        }
        return [...input.units];
      }),
    );
  }

  async retireSource(input: {
    sourceType: Contract.ContentUnitSourceType;
    sourceId: string;
    revisionId?: string | null;
    now?: number;
  }): Promise<number> {
    Utils.assertKnownContentUnitSourceType(input.sourceType);
    Utils.assertId(input.sourceId, "ContentUnit source id");
    if (input.revisionId !== undefined && input.revisionId !== null) {
      Utils.assertId(input.revisionId, "ContentUnit revision id");
    }
    const now = Utils.normalizeNow(input.now);
    const revisionClause = input.revisionId === undefined ? "" : " AND revision_id IS ?";
    const params: unknown[] = [now, now, this.libraryId, input.sourceType, input.sourceId];
    if (input.revisionId !== undefined) params.push(input.revisionId);
    return withDatabaseWriteLock(this.db, () =>
      this.db.run(
        `UPDATE content_units
         SET deleted_at = ?, updated_at = MAX(updated_at + 1, ?)
         WHERE library_id = ? AND source_type = ? AND source_id = ?
           AND deleted_at IS NULL${revisionClause}`,
        params,
      ),
    );
  }

  private async upsertManyInTransaction(units: readonly Contract.ContentUnit[]): Promise<void> {
    const ordered = Content.orderContentUnitsForInsert(units);
    for (const unit of ordered) {
      Content.assertContentUnit(unit, this.libraryId);
      const existing = await this.db.query<Contract.ContentUnitStorageRow>(
        `SELECT ${Content.CONTENT_UNIT_COLUMNS}
         FROM content_units WHERE id = ? LIMIT 1`,
        [unit.id],
      );
      const stored = existing[0];
      if (stored) {
        if (stored.library_id !== this.libraryId) {
          throw new Error(`ContentUnit ${unit.id} is outside this Library`);
        }
        if (!Content.matchesContentUnit(stored, unit)) {
          throw new Error(`ContentUnit ${unit.id} already exists with different immutable content`);
        }
        await this.db.run(
          `UPDATE content_units
           SET deleted_at = NULL, updated_at = MAX(updated_at + 1, ?)
           WHERE id = ? AND library_id = ?`,
          [Date.now(), unit.id, this.libraryId],
        );
        continue;
      }
      const now = Date.now();
      await this.db.run(
        `INSERT INTO content_units
           (id, library_id, source_type, source_id, work_id, asset_id, revision_id,
            parent_unit_id, ordinal, heading_path_json, anchor_json, text, language,
            token_count, content_hash, extractor_profile, chunk_profile, state,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          unit.id,
          unit.libraryId,
          unit.sourceType,
          unit.sourceId,
          unit.workId,
          unit.assetId,
          unit.revisionId,
          unit.parentUnitId,
          unit.ordinal,
          Utils.serializeJson(unit.headingPath, "ContentUnit heading path"),
          Utils.serializeJson(unit.anchor, "ContentUnit anchor"),
          unit.text,
          unit.language,
          unit.tokenCount,
          unit.contentHash,
          unit.extractorProfile,
          unit.chunkProfile,
          unit.state,
          now,
          now,
        ],
      );
    }
  }

  private async listForSourceInTransaction(
    sourceType: Contract.ContentUnitSourceType,
    sourceId: string,
    revisionId: string | null | undefined,
  ): Promise<Contract.ContentUnitRow[]> {
    const revisionClause = revisionId === undefined ? "" : " AND revision_id IS ?";
    const params: unknown[] = [this.libraryId, sourceType, sourceId];
    if (revisionId !== undefined) params.push(revisionId);
    const rows = await this.db.query<Contract.ContentUnitStorageRow>(
      `SELECT ${Content.CONTENT_UNIT_COLUMNS}
       FROM content_units
       WHERE library_id = ? AND source_type = ? AND source_id = ?
         AND deleted_at IS NULL${revisionClause}
       ORDER BY ordinal ASC, id ASC`,
      params,
    );
    return rows.map(Content.toContentUnitRow);
  }
}
