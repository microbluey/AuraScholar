import type { Database } from "../database.js";

/** Retargets Library-owned knowledge roots without changing revision identity. */
export async function mergeWorkKnowledgeRecords(
  db: Database,
  libraryId: string,
  primaryWorkId: string,
  duplicateWorkId: string,
  updatedAt: number,
): Promise<void> {
  await db.run(
    `UPDATE document_revisions AS revision
     SET attachment_id = NULL,
         availability_status = 'relink-required',
         availability_checked_at = ?,
         updated_at = MAX(updated_at + 1, ?)
     WHERE revision.attachment_id IN (
       SELECT attachment.id
       FROM attachments attachment
       JOIN document_assets asset ON asset.id = revision.asset_id
       WHERE attachment.work_id = ?
         AND attachment.deleted_at IS NOT NULL
         AND asset.library_id = ?
         AND asset.work_id = ?
     )`,
    [updatedAt, updatedAt, duplicateWorkId, libraryId, duplicateWorkId],
  );

  const assetCount = await count(
    db,
    `SELECT COUNT(*) AS count FROM document_assets
     WHERE library_id = ? AND work_id = ?`,
    [libraryId, duplicateWorkId],
  );
  const movedAssets = await db.run(
    `UPDATE document_assets
     SET work_id = ?, updated_at = MAX(updated_at + 1, ?)
     WHERE library_id = ? AND work_id = ?`,
    [primaryWorkId, updatedAt, libraryId, duplicateWorkId],
  );
  assertChangedExactly(movedAssets, assetCount, "Document assets could not be merged");

  const evidenceCount = await count(
    db,
    `SELECT COUNT(*) AS count FROM evidence_items
     WHERE library_id = ? AND work_id = ?`,
    [libraryId, duplicateWorkId],
  );
  const movedEvidence = await db.run(
    `UPDATE evidence_items
     SET work_id = ?, updated_at = MAX(updated_at + 1, ?)
     WHERE library_id = ? AND work_id = ?`,
    [primaryWorkId, updatedAt, libraryId, duplicateWorkId],
  );
  assertChangedExactly(movedEvidence, evidenceCount, "Evidence could not be merged");
}

/** Removes canonical Evidence payloads before the owning Work is permanently erased. */
export async function purgeWorkKnowledgeRecords(
  db: Database,
  libraryId: string,
  workId: string,
): Promise<void> {
  const assets = await ids(
    db,
    `SELECT id FROM document_assets WHERE library_id = ? AND work_id = ?`,
    [libraryId, workId],
  );
  const revisions = await idsForParents(db, "document_revisions", "asset_id", assets);
  const evidence = await ids(
    db,
    `SELECT id FROM evidence_items WHERE library_id = ? AND work_id = ?`,
    [libraryId, workId],
  );
  const projectAssets = await idsForParents(db, "project_assets", "asset_id", assets);
  const projectEvidence = await idsForParents(db, "project_evidence", "evidence_id", evidence);

  // v29 adds an explicit shelf table. Keep this guarded because Work purge is
  // also used by legacy databases that may not have run the latest migration;
  // foreign-key cascades cover normal deletes, while this direct delete closes
  // the permanent-purge boundary even when FK enforcement is temporarily off.
  await purgeEvidenceShelfRows(db, libraryId, workId, assets, revisions);

  await deleteDerivedArtifacts(db, libraryId, "evidence_items", evidence);
  await deleteDerivedArtifacts(db, libraryId, "document_revisions", revisions);
  await deleteDerivedArtifacts(db, libraryId, "document_assets", assets);

  await deleteRowClocks(db, "project_evidence", projectEvidence);
  await deleteRowClocks(db, "project_assets", projectAssets);
  await deleteRowClocks(db, "evidence_items", evidence);
  await deleteRowClocks(db, "document_revisions", revisions);
  await deleteRowClocks(db, "document_assets", assets);

  await db.run(`DELETE FROM evidence_items WHERE library_id = ? AND work_id = ?`, [
    libraryId,
    workId,
  ]);
  await db.run(`DELETE FROM document_assets WHERE library_id = ? AND work_id = ?`, [
    libraryId,
    workId,
  ]);
}

async function purgeEvidenceShelfRows(
  db: Database,
  libraryId: string,
  workId: string,
  assetIds: string[],
  revisionIds: string[],
): Promise<void> {
  const table = await db.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'evidence_shelf_items' LIMIT 1`,
  );
  if (!table[0]) return;

  const clauses = ["work_id = ?"];
  const params: unknown[] = [libraryId, workId];
  if (assetIds.length > 0) {
    clauses.push(`asset_id IN (${assetIds.map(() => "?").join(",")})`);
    params.push(...assetIds);
  }
  if (revisionIds.length > 0) {
    clauses.push(`revision_id IN (${revisionIds.map(() => "?").join(",")})`);
    params.push(...revisionIds);
  }
  const shelfRows = await db.query<{ id: string }>(
    `SELECT id FROM evidence_shelf_items
     WHERE library_id = ? AND (${clauses.join(" OR ")})`,
    params,
  );
  if (shelfRows.length === 0) return;
  await deleteRowClocks(
    db,
    "evidence_shelf_items",
    shelfRows.map((row) => row.id),
  );
  const placeholders = shelfRows.map(() => "?").join(",");
  await db.run(
    `DELETE FROM evidence_shelf_items WHERE library_id = ? AND id IN (${placeholders})`,
    [libraryId, ...shelfRows.map((row) => row.id)],
  );
}

async function ids(db: Database, sql: string, params: unknown[]): Promise<string[]> {
  return (await db.query<{ id: string }>(sql, params)).map((row) => row.id);
}

async function idsForParents(
  db: Database,
  table: "document_revisions" | "project_assets" | "project_evidence",
  column: "asset_id" | "evidence_id",
  parentIds: string[],
): Promise<string[]> {
  if (parentIds.length === 0) return [];
  const placeholders = parentIds.map(() => "?").join(",");
  return ids(db, `SELECT id FROM ${table} WHERE ${column} IN (${placeholders})`, parentIds);
}

async function deleteRowClocks(db: Database, table: string, rowIds: string[]): Promise<void> {
  if (rowIds.length === 0) return;
  const placeholders = rowIds.map(() => "?").join(",");
  await db.run(`DELETE FROM sync_row_clocks WHERE table_name = ? AND row_id IN (${placeholders})`, [
    table,
    ...rowIds,
  ]);
}

async function deleteDerivedArtifacts(
  db: Database,
  libraryId: string,
  sourceTable: string,
  sourceIds: string[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  const placeholders = sourceIds.map(() => "?").join(",");
  await db.run(
    `DELETE FROM derived_artifacts
     WHERE library_id = ? AND source_table = ? AND source_id IN (${placeholders})`,
    [libraryId, sourceTable, ...sourceIds],
  );
}

async function count(db: Database, sql: string, params: unknown[]): Promise<number> {
  const rows = await db.query<{ count: number }>(sql, params);
  return Number(rows[0]?.count ?? 0);
}

function assertChangedExactly(changed: number, expected: number, message: string): void {
  if (changed !== expected) throw new Error(message);
}
