import { parseSourceAnchor, type SourceAnchor } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import {
  projectAssetMembershipId,
  projectEvidenceMembershipId,
  projectWorkMembershipId,
} from "@aurascholar/db/ids";

export const SYNC_OWNER_COLUMN = "library_id";
export const DOCUMENT_EVIDENCE_SYNC_SCOPE_VERSION = "library-scope-v3-evidence";

const columns = (value: string): readonly string[] => Object.freeze(value.trim().split(/\s+/));

/**
 * Portable columns for Library row sync. `library_id` is carried separately as
 * the transport owner and is therefore intentionally absent here.
 *
 * Revision attachment and availability/extraction state are device-local: the
 * source blob is not part of row sync, so those fields must never claim that a
 * remote device has bytes or extracted output which only exist locally.
 */
export const SYNCED_TABLE_COLUMNS = {
  works: columns(
    "doi title abstract year publication_date venue_name venue_type type arxiv_id openalex_id " +
      "s2_id pmid fingerprint csl_json volume issue pages number_of_volumes edition section " +
      "publisher place_published series_title short_title original_title issn isbn url " +
      "accessed_date language call_number accession_number label database_name keywords_json " +
      "reading_status starred notes_md created_at updated_at deleted_at",
  ),
  research_projects: columns("name description status created_at updated_at deleted_at"),
  project_works: columns("project_id work_id role created_at updated_at deleted_at"),
  document_assets: columns(
    "work_id kind title current_revision_id created_at updated_at deleted_at",
  ),
  document_revisions: columns(
    "asset_id revision_no mime_type blob_sha256 byte_size source_url extractor_profile " +
      "created_at updated_at deleted_at",
  ),
  project_assets: columns("project_id asset_id role created_at updated_at deleted_at"),
  evidence_items: columns(
    "work_id asset_id revision_id source_kind evidence_kind anchor_json payload_kind " +
      "payload_json title note_md tags_json source_content_hash provenance_json " +
      "created_at updated_at deleted_at",
  ),
  project_evidence: columns("project_id evidence_id role created_at updated_at deleted_at"),
  annotations: columns(
    "attachment_id work_id type color page_index anchor_json content_md ink_paths_json " +
      "sort_key orphaned created_at updated_at deleted_at",
  ),
  flashcards: columns(
    "work_id front_md back_md card_type source ai_model generation_id created_at updated_at deleted_at",
  ),
  sentinel_tasks: columns(
    "work_id doi title current_state target_flags poll_interval_s next_poll_at last_polled_at " +
      "error_count last_error status created_at updated_at deleted_at",
  ),
} as const satisfies Record<string, readonly string[]>;

export type SyncedTable = keyof typeof SYNCED_TABLE_COLUMNS;

const DIRECT_LIBRARY_OWNER_TABLES = new Set<SyncedTable>([
  "works",
  "research_projects",
  "document_assets",
  "evidence_items",
  "sentinel_tasks",
]);

export const DOCUMENT_REVISION_LOCAL_ONLY_COLUMNS = [
  "attachment_id",
  "extraction_status",
  "availability_status",
  "availability_checked_at",
] as const;

export const SYNC_APPLY_ORDER: readonly SyncedTable[] = [
  "works",
  "research_projects",
  "project_works",
  "document_assets",
  "document_revisions",
  "project_assets",
  "evidence_items",
  "project_evidence",
  "annotations",
  "flashcards",
  "sentinel_tasks",
];

export function isSyncedTable(table: string): table is SyncedTable {
  return Object.hasOwn(SYNCED_TABLE_COLUMNS, table);
}

export function syncedColumnsForTable(table: string): readonly string[] | null {
  return isSyncedTable(table) ? SYNCED_TABLE_COLUMNS[table] : null;
}

export function isDirectLibraryOwnedSyncTable(table: string): table is SyncedTable {
  return isSyncedTable(table) && DIRECT_LIBRARY_OWNER_TABLES.has(table);
}

export function syncScopePredicate(table: string, alias: string): string {
  if (!isSyncedTable(table)) throw new Error(`Unsupported sync table "${table}"`);
  if (isDirectLibraryOwnedSyncTable(table)) return `${alias}.library_id = ?`;
  if (table === "annotations" || table === "flashcards") {
    return `EXISTS (
      SELECT 1 FROM works scope_work
      WHERE scope_work.id = ${alias}.work_id AND scope_work.library_id = ?
    )`;
  }
  if (table === "project_works") {
    return sameLibraryJoin(alias, "research_projects", "project_id", "works", "work_id");
  }
  if (table === "document_revisions") {
    return `EXISTS (
      SELECT 1 FROM document_assets scope_asset
      WHERE scope_asset.id = ${alias}.asset_id AND scope_asset.library_id = ?
    )`;
  }
  if (table === "project_assets") {
    return sameLibraryJoin(alias, "research_projects", "project_id", "document_assets", "asset_id");
  }
  return sameLibraryJoin(alias, "research_projects", "project_id", "evidence_items", "evidence_id");
}

export interface SyncApplyValuePhases {
  /** Insert/update values that are safe before DocumentRevision rows exist. */
  immediate: Record<string, unknown>;
  /** Apply only after revisions have been inserted and parent scope revalidated. */
  deferred: Record<string, unknown> | null;
}

export function partitionSyncApplyValues(
  table: string,
  values: Record<string, unknown>,
): SyncApplyValuePhases {
  if (
    table !== "document_assets" ||
    !Object.hasOwn(values, "current_revision_id") ||
    values.current_revision_id === null
  ) {
    return { immediate: values, deferred: null };
  }
  const immediate = { ...values };
  delete immediate.current_revision_id;
  return {
    immediate,
    deferred: { current_revision_id: values.current_revision_id },
  };
}

/** Local values for a remotely-created revision whose blob was not transferred. */
export function documentRevisionLocalInsertDefaults(now: number): Record<string, unknown> {
  return {
    attachment_id: null,
    extraction_status: "pending",
    availability_status: "relink-required",
    availability_checked_at: now,
  };
}

export interface AssertSyncParentScopeInput {
  db: Database;
  table: string;
  rowId: string;
  values: Record<string, unknown>;
  exists: boolean;
  libraryId: string;
}

/**
 * Validates all foreign keys against the explicit local Library. For partial
 * updates, omitted relationship columns are read from the already-scoped row.
 * Missing parents and cross-Library parents intentionally share fail-closed
 * errors: neither case may be inferred or repaired by row sync.
 */
export async function assertSyncParentScope(input: AssertSyncParentScopeInput): Promise<void> {
  const { db, table, rowId, values, exists, libraryId } = input;
  if (!isSyncedTable(table)) throw new Error(`Unsupported sync table "${table}"`);
  if (table === "works" || table === "research_projects") return;

  const relationFields = relationFieldsForTable(table);
  const current = exists
    ? await currentRelations(db, table, rowId, relationFields, libraryId)
    : null;
  if (exists && !current) throw new Error(`Rejected unowned ${table} sync row`);
  const relation = (field: string, optional = false): string | null => {
    const value = Object.hasOwn(values, field) ? values[field] : current?.[field];
    if (optional && value === null) return null;
    const id = stringValue(value);
    if (!id && !optional) throw new Error(`Rejected missing ${table}.${field}`);
    if (!id && value !== null && value !== undefined) {
      throw new Error(`Rejected invalid ${table}.${field}`);
    }
    return id;
  };

  if (table === "sentinel_tasks") {
    const workId = relation("work_id", true);
    if (workId) await requireWork(db, workId, libraryId, `${table}.work_id`);
    return;
  }
  if (table === "annotations" || table === "flashcards") {
    const workId = relation("work_id")!;
    await requireWork(db, workId, libraryId, `${table}.work_id`);
    if (table === "annotations") {
      const attachmentId = relation("attachment_id")!;
      await requireAttachment(db, attachmentId, workId, libraryId);
    }
    return;
  }
  if (table === "project_works") {
    const projectId = relation("project_id")!;
    const workId = relation("work_id")!;
    assertMembershipIdentity(table, rowId, projectWorkMembershipId(projectId, workId));
    await requireProject(db, projectId, libraryId, `${table}.project_id`);
    await requireWork(db, workId, libraryId, `${table}.work_id`);
    return;
  }
  if (table === "document_assets") {
    const workId = relation("work_id", true);
    if (workId) await requireWork(db, workId, libraryId, `${table}.work_id`);
    const revisionId = relation("current_revision_id", true);
    if (revisionId) await requireAssetRevision(db, rowId, revisionId, libraryId);
    return;
  }
  if (table === "document_revisions") {
    await requireAsset(db, relation("asset_id")!, libraryId, `${table}.asset_id`);
    return;
  }
  if (table === "project_assets") {
    const projectId = relation("project_id")!;
    const assetId = relation("asset_id")!;
    assertMembershipIdentity(table, rowId, projectAssetMembershipId(projectId, assetId));
    await requireProject(db, projectId, libraryId, `${table}.project_id`);
    await requireAsset(db, assetId, libraryId, `${table}.asset_id`);
    return;
  }
  if (table === "project_evidence") {
    const projectId = relation("project_id")!;
    const evidenceId = relation("evidence_id")!;
    assertMembershipIdentity(table, rowId, projectEvidenceMembershipId(projectId, evidenceId));
    await requireProject(db, projectId, libraryId, `${table}.project_id`);
    await requireEvidence(db, evidenceId, libraryId, `${table}.evidence_id`);
    return;
  }
  const revisionId = relation("revision_id")!;
  await requireEvidenceSource(
    db,
    relation("work_id")!,
    relation("asset_id")!,
    revisionId,
    libraryId,
  );
  assertEvidenceAnchor(
    Object.hasOwn(values, "anchor_json") ? values.anchor_json : current?.anchor_json,
    revisionId,
  );
}

function relationFieldsForTable(table: SyncedTable): readonly string[] {
  if (table === "sentinel_tasks" || table === "flashcards") return ["work_id"];
  if (table === "annotations") return ["work_id", "attachment_id"];
  if (table === "project_works") return ["project_id", "work_id"];
  if (table === "document_assets") return ["work_id", "current_revision_id"];
  if (table === "document_revisions") return ["asset_id"];
  if (table === "project_assets") return ["project_id", "asset_id"];
  if (table === "project_evidence") return ["project_id", "evidence_id"];
  if (table === "evidence_items") {
    return ["work_id", "asset_id", "revision_id", "anchor_json"];
  }
  return [];
}

async function currentRelations(
  db: Database,
  table: SyncedTable,
  rowId: string,
  fields: readonly string[],
  libraryId: string,
): Promise<Record<string, unknown> | null> {
  if (fields.length === 0) return {};
  const rows = await db.query<Record<string, unknown>>(
    `SELECT ${fields.map(quoteIdentifier).join(", ")}
     FROM ${quoteIdentifier(table)} t
     WHERE t.id = ? AND ${syncScopePredicate(table, "t")}
     LIMIT 1`,
    [rowId, libraryId],
  );
  return rows[0] ?? null;
}

async function requireWork(
  db: Database,
  workId: string,
  libraryId: string,
  relation: string,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM works WHERE id = ? AND library_id = ? LIMIT 1`,
    [workId, libraryId],
  );
  if (!rows[0]) throw new Error(`Rejected cross-library ${relation} or missing parent`);
}

async function requireAsset(
  db: Database,
  assetId: string,
  libraryId: string,
  relation: string,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM document_assets WHERE id = ? AND library_id = ? LIMIT 1`,
    [assetId, libraryId],
  );
  if (!rows[0]) throw new Error(`Rejected cross-library ${relation} or missing parent`);
}

async function requireProject(
  db: Database,
  projectId: string,
  libraryId: string,
  relation: string,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM research_projects WHERE id = ? AND library_id = ? LIMIT 1`,
    [projectId, libraryId],
  );
  if (!rows[0]) throw new Error(`Rejected cross-library ${relation} or missing parent`);
}

async function requireEvidence(
  db: Database,
  evidenceId: string,
  libraryId: string,
  relation: string,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM evidence_items WHERE id = ? AND library_id = ? LIMIT 1`,
    [evidenceId, libraryId],
  );
  if (!rows[0]) throw new Error(`Rejected cross-library ${relation} or missing parent`);
}

async function requireAttachment(
  db: Database,
  attachmentId: string,
  workId: string,
  libraryId: string,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `SELECT attachment.id FROM attachments attachment
     JOIN works work ON work.id = attachment.work_id
     WHERE attachment.id = ? AND attachment.work_id = ? AND work.library_id = ?
     LIMIT 1`,
    [attachmentId, workId, libraryId],
  );
  if (!rows[0]) {
    throw new Error("Rejected cross-library annotations.attachment_id or missing parent");
  }
}

async function requireAssetRevision(
  db: Database,
  assetId: string,
  revisionId: string,
  libraryId: string,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `SELECT revision.id FROM document_revisions revision
     JOIN document_assets asset ON asset.id = revision.asset_id
     WHERE revision.id = ? AND revision.asset_id = ? AND asset.library_id = ?
     LIMIT 1`,
    [revisionId, assetId, libraryId],
  );
  if (!rows[0]) {
    throw new Error(
      "Rejected cross-library document_assets.current_revision_id or missing/cross-asset revision",
    );
  }
}

async function requireEvidenceSource(
  db: Database,
  workId: string,
  assetId: string,
  revisionId: string,
  libraryId: string,
): Promise<void> {
  await requireWork(db, workId, libraryId, "evidence_items.work_id");
  await requireAsset(db, assetId, libraryId, "evidence_items.asset_id");
  const revisions = await db.query<{ id: string }>(
    `SELECT revision.id FROM document_revisions revision
     JOIN document_assets asset ON asset.id = revision.asset_id
     WHERE revision.id = ? AND revision.asset_id = ? AND asset.library_id = ? LIMIT 1`,
    [revisionId, assetId, libraryId],
  );
  if (!revisions[0]) {
    throw new Error("Rejected cross-library evidence_items.revision_id or missing parent");
  }
  const assets = await db.query<{ work_id: string | null }>(
    `SELECT work_id FROM document_assets WHERE id = ? AND library_id = ? LIMIT 1`,
    [assetId, libraryId],
  );
  if (assets[0]?.work_id !== workId) {
    throw new Error("Rejected cross-library evidence_items.work_id (asset Work mismatch)");
  }
}

function assertEvidenceAnchor(anchorJson: unknown, revisionId: string): void {
  if (typeof anchorJson !== "string") {
    throw new Error("Rejected invalid evidence_items.anchor_json");
  }
  let rawAnchor: unknown;
  try {
    rawAnchor = JSON.parse(anchorJson) as unknown;
  } catch {
    throw new Error("Rejected invalid evidence_items.anchor_json");
  }
  let anchor: SourceAnchor;
  try {
    anchor = parseSourceAnchor(rawAnchor);
  } catch {
    throw new Error("Rejected invalid evidence_items.anchor_json");
  }
  if (!isRevisionBoundAnchor(anchor)) {
    throw new Error("Rejected evidence anchor that is not revision-bound");
  }
  if (anchor.revisionId !== revisionId) {
    throw new Error("Rejected evidence anchor bound to another revision");
  }
}

function assertMembershipIdentity(table: string, rowId: string, expectedId: string): void {
  if (rowId !== expectedId) {
    throw new Error(`Rejected invalid ${table} deterministic row id`);
  }
}

function isRevisionBoundAnchor(
  anchor: SourceAnchor,
): anchor is Extract<SourceAnchor, { revisionId: string }> {
  return "revisionId" in anchor;
}

function sameLibraryJoin(
  alias: string,
  leftTable: string,
  leftField: string,
  rightTable: string,
  rightField: string,
): string {
  return `EXISTS (
    SELECT 1 FROM ${leftTable} scope_left
    JOIN ${rightTable} scope_right ON scope_right.library_id = scope_left.library_id
    WHERE scope_left.id = ${alias}.${leftField}
      AND scope_right.id = ${alias}.${rightField}
      AND scope_left.library_id = ?
  )`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
