import type { Database } from "../database.js";

/**
 * Upper bounds for the project-local Evidence Shelf list returned through IPC.
 * Keep these in the database package so the SQLite preflight and the main
 * process envelope guard share one contract without coupling the DB to
 * Electron.
 */
export const MAX_EVIDENCE_SHELF_LIST_ROWS = 1_000;
export const MAX_EVIDENCE_SHELF_LIST_BYTES = 8 * 1024 * 1024;

/**
 * Fixed JSON property/envelope allowance per stored row. The two JSON
 * snapshots dominate the estimate; scalar ids and timestamps are included in
 * the query as well. This allowance intentionally errs high so a valid list
 * can still be checked by the final exact UTF-8 serializer guard.
 */
export const MAX_EVIDENCE_SHELF_LIST_ROW_OVERHEAD_BYTES = 2_048;

export interface EvidenceShelfListBudget {
  rowCount: number;
  payloadBytes: number;
}

interface EvidenceShelfListBudgetRow {
  row_count: unknown;
  payload_bytes: unknown;
}

/**
 * Counts only active rows and estimates their serialized IPC footprint inside
 * SQLite. `TOTAL()` deliberately returns a floating-point accumulator instead
 * of SQLite's overflow-prone integer `SUM()`. Values are normalized and
 * validated before callers materialize any full shelf rows.
 */
export async function readEvidenceShelfListBudget(
  database: Database,
  libraryId: string,
  projectId: string,
): Promise<EvidenceShelfListBudget> {
  const rows = await database.query<EvidenceShelfListBudgetRow>(
    `SELECT
       COUNT(*) AS row_count,
       TOTAL(
         CAST(length(CAST(id AS BLOB)) AS REAL)
         + CAST(length(CAST(library_id AS BLOB)) AS REAL)
         + CAST(length(CAST(project_id AS BLOB)) AS REAL)
         + CAST(COALESCE(length(CAST(work_id AS BLOB)), 0) AS REAL)
         + CAST(COALESCE(length(CAST(asset_id AS BLOB)), 0) AS REAL)
         + CAST(COALESCE(length(CAST(revision_id AS BLOB)), 0) AS REAL)
         + CAST(length(CAST(anchor_snapshot_json AS BLOB)) AS REAL)
         + CAST(length(CAST(preview_payload_json AS BLOB)) AS REAL)
         + CAST(length(CAST(source_content_hash AS BLOB)) AS REAL)
         + ?
       ) AS payload_bytes
     FROM evidence_shelf_items
     WHERE library_id = ? AND project_id = ? AND deleted_at IS NULL`,
    [MAX_EVIDENCE_SHELF_LIST_ROW_OVERHEAD_BYTES, libraryId, projectId],
  );
  const row = rows[0];
  if (!row) return { rowCount: 0, payloadBytes: 0 };

  const rowCount = normalizeRowCount(row.row_count);
  const payloadBytes = normalizePayloadBytes(row.payload_bytes);
  return { rowCount, payloadBytes };
}

/** Throws the same stable errors used by the IPC command's exact guard. */
export function assertEvidenceShelfListBudget(budget: EvidenceShelfListBudget): void {
  if (
    !Number.isSafeInteger(budget.rowCount) ||
    budget.rowCount < 0 ||
    budget.rowCount > MAX_EVIDENCE_SHELF_LIST_ROWS
  ) {
    throw new Error(`Evidence shelf items are limited to ${MAX_EVIDENCE_SHELF_LIST_ROWS}`);
  }
  if (
    !Number.isFinite(budget.payloadBytes) ||
    budget.payloadBytes < 0 ||
    budget.payloadBytes > MAX_EVIDENCE_SHELF_LIST_BYTES
  ) {
    throw new Error(`Evidence shelf output is limited to ${MAX_EVIDENCE_SHELF_LIST_BYTES} bytes`);
  }
}

function normalizeRowCount(value: unknown): number {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== "number" && typeof value !== "bigint" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    // An impossible/unsafe SQLite count is itself a bound violation. Using
    // Infinity keeps the public error stable and avoids wrapping a driver
    // value in a potentially lossy integer conversion.
    return Number.POSITIVE_INFINITY;
  }
  return numeric;
}

function normalizePayloadBytes(value: unknown): number {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== "number" && typeof value !== "bigint" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric < 0) return Number.POSITIVE_INFINITY;
  // `TOTAL()` can return +Infinity for an accumulator overflow. Preserve it
  // so callers fail closed instead of treating overflow as an empty list.
  return numeric;
}
