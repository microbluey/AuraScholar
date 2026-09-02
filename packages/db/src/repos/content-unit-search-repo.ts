import type { Database } from "../database.js";
import { buildFtsPrefixQuery } from "../fts.js";
import * as Content from "./content-unit-support.js";
import { appendContentUnitCanonicalVisibilityClause } from "./content-unit-visibility.js";
import * as Contract from "./knowledge-contract.js";
import * as Utils from "./knowledge-utils.js";

/**
 * Searches the derived, immutable ContentUnit corpus. The result carries the
 * original source identifiers and anchor so callers can navigate back to the
 * exact PDF/evidence/annotation location without a second lookup.
 */
export class ContentUnitSearchRepo {
  constructor(
    private readonly db: Database,
    private readonly libraryId: string,
  ) {
    Utils.assertId(libraryId, "Library id");
  }

  async search(
    input: Contract.SearchContentUnitsInput,
  ): Promise<Contract.ContentUnitSearchResult[]> {
    if (typeof input.query !== "string") throw new Error("ContentUnit query must be a string");
    const ftsQuery = buildFtsPrefixQuery(input.query, 24);
    if (!ftsQuery) return [];

    const limit = Utils.normalizeLimit(input.limit, 20, "ContentUnit search limit");
    const clauses = ["content_units_fts MATCH ?", "unit.library_id = ?", "unit.deleted_at IS NULL"];
    const params: unknown[] = [ftsQuery, this.libraryId];
    appendContentUnitCanonicalVisibilityClause(clauses);
    Content.appendContentUnitAllowedSourceIdsClause(clauses, params, input.allowedSourceIds);

    if (!input.includeContextOnly) clauses.push("unit.state = 'ready'");
    if (input.sourceTypes !== undefined) {
      if (input.sourceTypes.length === 0) return [];
      for (const sourceType of input.sourceTypes)
        Utils.assertKnownContentUnitSourceType(sourceType);
      clauses.push(`unit.source_type IN (${input.sourceTypes.map(() => "?").join(", ")})`);
      params.push(...input.sourceTypes);
    }

    Content.addContentUnitSearchIdClause(
      clauses,
      params,
      "unit.source_id",
      input.sourceId,
      "source id",
    );
    Content.addContentUnitSearchIdClause(clauses, params, "unit.work_id", input.workId, "work id");
    Content.addContentUnitSearchIdClause(
      clauses,
      params,
      "unit.asset_id",
      input.assetId,
      "asset id",
    );
    Content.addContentUnitSearchIdClause(
      clauses,
      params,
      "unit.revision_id",
      input.revisionId,
      "revision id",
    );
    params.push(limit);

    const rows = await this.db.query<Contract.ContentUnitSearchStorageRow>(
      `SELECT ${Content.CONTENT_UNIT_SELECT_COLUMNS},
              -bm25(content_units_fts) AS score,
              snippet(content_units_fts, 0, '', '', '…', 32) AS excerpt,
              work.title AS work_title
       FROM content_units_fts
       JOIN content_units unit ON unit.rowid = content_units_fts.rowid
       LEFT JOIN works work
         ON work.id = unit.work_id
        AND work.library_id = unit.library_id
        AND work.deleted_at IS NULL
       WHERE ${clauses.join(" AND ")}
       ORDER BY score DESC, unit.id ASC
       LIMIT ?`,
      params,
    );
    return rows.map(Content.toContentUnitSearchResult);
  }

  /**
   * Resolves the canonical source allowlist before a vector backend sees a
   * query. Only citation-safe ready units are included because context-only
   * units never receive vectors in a hybrid generation.
   */
  async listReadySourceIds(
    input: Omit<Contract.SearchContentUnitsInput, "limit" | "query"> = {},
  ): Promise<string[]> {
    const clauses = ["unit.library_id = ?", "unit.deleted_at IS NULL", "unit.state = 'ready'"];
    const params: unknown[] = [this.libraryId];
    appendContentUnitCanonicalVisibilityClause(clauses);
    Content.appendContentUnitScopeClauses(clauses, params, input);
    const rows = await this.db.query<{ source_id: string }>(
      `SELECT DISTINCT unit.source_id
       FROM content_units unit
       WHERE ${clauses.join(" AND ")}
       ORDER BY unit.source_id ASC`,
      params,
    );
    return rows.map((row) => row.source_id);
  }

  /**
   * Hydrates semantic-only candidates after a vector store has already
   * enforced its generation/source scope. The same canonical filters are
   * repeated here so a result cannot escape a work, asset, or source filter.
   */
  async findReadyByIds(input: {
    contentUnitIds: readonly string[];
    sourceTypes?: readonly Contract.ContentUnitSourceType[];
    allowedSourceIds?: readonly string[];
    sourceId?: string;
    workId?: string;
    assetId?: string;
    revisionId?: string;
  }): Promise<Contract.ContentUnitSearchResult[]> {
    if (!Array.isArray(input.contentUnitIds)) {
      throw new Error("ContentUnit lookup ids must be an array");
    }
    const contentUnitIds = [...new Set(input.contentUnitIds)];
    if (contentUnitIds.length === 0) return [];
    if (contentUnitIds.length > 1_000) {
      throw new Error("ContentUnit lookup is limited to 1000 ids");
    }
    for (const id of contentUnitIds) Utils.assertId(id, "ContentUnit lookup id");

    const clauses = [
      "unit.library_id = ?",
      "unit.deleted_at IS NULL",
      "unit.state = 'ready'",
      `unit.id IN (${contentUnitIds.map(() => "?").join(", ")})`,
    ];
    const params: unknown[] = [this.libraryId, ...contentUnitIds];
    appendContentUnitCanonicalVisibilityClause(clauses);
    Content.appendContentUnitScopeClauses(clauses, params, input);
    const rows = await this.db.query<Contract.ContentUnitSearchStorageRow>(
      `SELECT ${Content.CONTENT_UNIT_SELECT_COLUMNS},
              0 AS score,
              CASE
                WHEN length(unit.text) > 240 THEN substr(unit.text, 1, 239) || '…'
                ELSE unit.text
              END AS excerpt,
              work.title AS work_title
       FROM content_units unit
       LEFT JOIN works work
         ON work.id = unit.work_id
        AND work.library_id = unit.library_id
        AND work.deleted_at IS NULL
       WHERE ${clauses.join(" AND ")}`,
      params,
    );
    return rows.map(Content.toContentUnitSearchResult);
  }
}
