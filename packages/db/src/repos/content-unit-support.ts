import {
  CONTENT_UNIT_STATES,
  type ContentUnit,
  type ContentUnitRow,
  type ContentUnitSearchResult,
  type ContentUnitSearchStorageRow,
  type ContentUnitSourceType,
  type ContentUnitStorageRow,
} from "./knowledge-contract.js";
import { assertId, assertKnownContentUnitSourceType, serializeJson } from "./knowledge-utils.js";

export const CONTENT_UNIT_COLUMNS = `id, library_id, source_type, source_id, work_id, asset_id,
  revision_id, parent_unit_id, ordinal, heading_path_json, anchor_json, text, language,
  token_count, content_hash, extractor_profile, chunk_profile, state,
  created_at, updated_at, deleted_at`;

export const CONTENT_UNIT_SELECT_COLUMNS = CONTENT_UNIT_COLUMNS.split(",")
  .map((column) => {
    const name = column.trim();
    // ContentUnits can carry an explicit language label, while older units
    // inherit the current Work metadata at retrieval time. This keeps a
    // language correction useful immediately without changing unit identity
    // or forcing a vector rebuild.
    if (name === "language") {
      return "COALESCE(NULLIF(trim(unit.language), ''), NULLIF(trim(work.language), '')) AS language";
    }
    return `unit.${name}`;
  })
  .join(", ");

export function appendContentUnitScopeClauses(
  clauses: string[],
  params: unknown[],
  input: {
    allowedSourceIds?: readonly string[];
    sourceTypes?: readonly ContentUnitSourceType[];
    sourceId?: string;
    workId?: string;
    assetId?: string;
    revisionId?: string;
  },
): void {
  appendContentUnitAllowedSourceIdsClause(clauses, params, input.allowedSourceIds);
  if (input.sourceTypes !== undefined) {
    if (input.sourceTypes.length === 0) {
      clauses.push("0 = 1");
    } else {
      for (const sourceType of input.sourceTypes) assertKnownContentUnitSourceType(sourceType);
      clauses.push(`unit.source_type IN (${input.sourceTypes.map(() => "?").join(", ")})`);
      params.push(...input.sourceTypes);
    }
  }
  addContentUnitSearchIdClause(clauses, params, "unit.source_id", input.sourceId, "source id");
  addContentUnitSearchIdClause(clauses, params, "unit.work_id", input.workId, "work id");
  addContentUnitSearchIdClause(clauses, params, "unit.asset_id", input.assetId, "asset id");
  addContentUnitSearchIdClause(
    clauses,
    params,
    "unit.revision_id",
    input.revisionId,
    "revision id",
  );
}

/**
 * Appends the generation joins shared by pinned FTS and hydration queries.
 *
 * The caller must place the returned joins after `content_units unit` has
 * been introduced and must keep the returned parameters ahead of any
 * placeholders that occur later in the query.  Binding the index identity in
 * the JOIN (rather than interpolating it) makes a missing, retired, or
 * cross-Library generation fail closed with an empty result set.
 */
export function appendContentUnitPinnedIndexJoins(
  joins: string[],
  params: unknown[],
  indexId: string | undefined,
  libraryId: string,
): void {
  if (indexId === undefined) return;
  assertId(indexId, "Knowledge index id");
  joins.push(`
       JOIN knowledge_indexes pinned_index
         ON pinned_index.id = ?
        AND pinned_index.library_id = ?
        AND pinned_index.library_id = unit.library_id
        AND pinned_index.status = 'active'
        AND pinned_index.mode IN ('fulltext', 'hybrid')
       JOIN knowledge_index_entries pinned_entry
         ON pinned_entry.index_id = pinned_index.id
        AND pinned_entry.content_unit_id = unit.id
        AND pinned_entry.status = 'ready'
        AND pinned_entry.content_hash = unit.content_hash`);
  params.push(indexId, libraryId);
}

/**
 * Applies a main-process-resolved source snapshot without expanding one SQL
 * bind parameter per source. SQLite's JSON1 table-valued function keeps the
 * query bounded even for a larger Library while the caller still owns the
 * immutable allowlist captured for this operation.
 */
export function appendContentUnitAllowedSourceIdsClause(
  clauses: string[],
  params: unknown[],
  sourceIds: readonly string[] | undefined,
): void {
  if (sourceIds === undefined) return;
  if (!Array.isArray(sourceIds)) throw new Error("ContentUnit source snapshot must be an array");
  const normalized = [...new Set(sourceIds)];
  for (const sourceId of normalized) {
    assertId(sourceId, "ContentUnit allowed source id");
    if (sourceId.length > 512 || containsControlCharacter(sourceId)) {
      throw new Error("ContentUnit allowed source id is invalid");
    }
  }
  if (normalized.length === 0) {
    clauses.push("0 = 1");
    return;
  }
  const encoded = JSON.stringify(normalized);
  if (encoded.length > 8 * 1024 * 1024) {
    throw new Error("ContentUnit source snapshot is too large");
  }
  clauses.push("unit.source_id IN (SELECT value FROM json_each(?))");
  params.push(encoded);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function toContentUnitCount(value: number | bigint, label: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid ${label} count`);
  }
  return count;
}

export function toContentUnitRow(row: ContentUnitStorageRow): ContentUnitRow {
  return {
    id: row.id,
    libraryId: row.library_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    workId: row.work_id,
    assetId: row.asset_id,
    revisionId: row.revision_id,
    parentUnitId: row.parent_unit_id,
    ordinal: row.ordinal,
    headingPath:
      row.heading_path_json === null ? null : (JSON.parse(row.heading_path_json) as string[]),
    anchor: JSON.parse(row.anchor_json) as ContentUnit["anchor"],
    text: row.text,
    language: row.language,
    tokenCount: row.token_count,
    contentHash: row.content_hash,
    extractorProfile: row.extractor_profile,
    chunkProfile: row.chunk_profile,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export function toContentUnitSearchResult(
  row: ContentUnitSearchStorageRow,
): ContentUnitSearchResult {
  return {
    ...toContentUnitRow(row),
    score: Number(row.score),
    excerpt: row.excerpt,
    workTitle: row.work_title ?? null,
  };
}

export function addContentUnitSearchIdClause(
  clauses: string[],
  params: unknown[],
  column: string,
  value: string | undefined,
  label: string,
): void {
  if (value === undefined) return;
  assertId(value, `ContentUnit ${label}`);
  clauses.push(`${column} = ?`);
  params.push(value);
}

export function orderContentUnitsForInsert(units: readonly ContentUnit[]): ContentUnit[] {
  const byId = new Map<string, ContentUnit>();
  for (const unit of units) {
    if (byId.has(unit.id)) throw new Error(`ContentUnit ${unit.id} was submitted more than once`);
    byId.set(unit.id, unit);
  }
  const ordered: ContentUnit[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (unit: ContentUnit) => {
    if (visited.has(unit.id)) return;
    if (visiting.has(unit.id)) throw new Error("ContentUnit parents must not form a cycle");
    visiting.add(unit.id);
    if (unit.parentUnitId) {
      const parent = byId.get(unit.parentUnitId);
      if (parent) visit(parent);
    }
    visiting.delete(unit.id);
    visited.add(unit.id);
    ordered.push(unit);
  };
  for (const unit of units) visit(unit);
  return ordered;
}

export function assertContentUnit(unit: ContentUnit, libraryId: string): void {
  assertId(unit.id, "ContentUnit id");
  if (unit.libraryId !== libraryId) throw new Error("ContentUnit belongs to a different Library");
  assertKnownContentUnitSourceType(unit.sourceType);
  assertId(unit.sourceId, "ContentUnit source id");
  if (!Number.isSafeInteger(unit.ordinal) || unit.ordinal < 0) {
    throw new Error("ContentUnit ordinal must be a non-negative integer");
  }
  if (!unit.text.trim()) throw new Error("ContentUnit text must not be empty");
  if (!/^[0-9a-f]{64}$/.test(unit.contentHash)) {
    throw new Error("ContentUnit content hash must be a lowercase SHA-256 value");
  }
  assertId(unit.extractorProfile, "ContentUnit extractor profile");
  assertId(unit.chunkProfile, "ContentUnit chunk profile");
  if (!CONTENT_UNIT_STATES.includes(unit.state)) {
    throw new Error(`Unsupported ContentUnit state: ${unit.state}`);
  }
}

export function matchesContentUnit(row: ContentUnitStorageRow, unit: ContentUnit): boolean {
  return (
    row.library_id === unit.libraryId &&
    row.source_type === unit.sourceType &&
    row.source_id === unit.sourceId &&
    row.work_id === unit.workId &&
    row.asset_id === unit.assetId &&
    row.revision_id === unit.revisionId &&
    row.parent_unit_id === unit.parentUnitId &&
    row.ordinal === unit.ordinal &&
    row.heading_path_json === serializeJson(unit.headingPath, "ContentUnit heading path") &&
    row.anchor_json === serializeJson(unit.anchor, "ContentUnit anchor") &&
    row.text === unit.text &&
    row.language === unit.language &&
    row.token_count === unit.tokenCount &&
    row.content_hash === unit.contentHash &&
    row.extractor_profile === unit.extractorProfile &&
    row.chunk_profile === unit.chunkProfile &&
    row.state === unit.state
  );
}
