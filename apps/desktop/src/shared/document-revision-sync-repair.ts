export interface DocumentRevisionBridgeRepairInput {
  assetId: string;
  libraryId: string;
  targetWorkId: unknown;
  checkedAt?: number;
}

export interface DocumentRevisionBridgeRepairStatement {
  sql: string;
  params: unknown[];
}

/** Builds the local-only bridge repair paired with a synced asset retarget. */
export function documentRevisionBridgeRepairStatement(
  input: DocumentRevisionBridgeRepairInput,
): DocumentRevisionBridgeRepairStatement {
  if (
    input.targetWorkId !== null &&
    (typeof input.targetWorkId !== "string" || !input.targetWorkId.trim())
  ) {
    throw new Error("Invalid document asset bridge repair target Work");
  }
  const workId = input.targetWorkId;
  return {
    sql: `UPDATE document_revisions AS revision
     SET attachment_id = NULL,
         availability_status = 'relink-required',
         availability_checked_at = ?
     WHERE revision.asset_id = ?
       AND revision.attachment_id IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM document_assets asset
         JOIN attachments attachment ON attachment.id = revision.attachment_id
         WHERE asset.id = revision.asset_id
           AND asset.library_id = ?
           AND (? IS NULL OR attachment.work_id <> ?)
       )`,
    params: [input.checkedAt ?? Date.now(), input.assetId, input.libraryId, workId, workId],
  };
}
