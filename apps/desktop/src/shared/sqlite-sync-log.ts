import type { ChangeEntry } from "@aurascholar/sync";
import { SYNC_OWNER_COLUMN, syncedColumnsForTable } from "../services/document-evidence-sync-scope";
import {
  assertSupportedSyncLogColumns,
  parseSyncLogRecord,
  parseSyncLogStringRecord,
} from "./sqlite-sync-values";

/** Raw rows retained by the pre-v17 and current sync_log schemas. */
export interface LocalSyncLogRow {
  seq: number;
  entity_table: string;
  entity_id: string;
  op: string;
  values_json: string | null;
  column_hlcs_json: string | null;
  hlc: string;
  device_id: string;
}

export interface LocalSyncLogProjectionOptions {
  libraryId: string;
  transportLibraryId: string;
  deviceId: string;
  assertDeleteScope: (table: string, rowId: string) => Promise<void>;
}

/**
 * Project durable local log rows into transport entries. A nullable values_json
 * is valid only for a delete: old schemas recorded tombstones without a
 * payload, while an upsert still needs a materializable row or snapshot.
 */
export async function projectLocalSyncLogRows(
  rows: readonly LocalSyncLogRow[],
  options: LocalSyncLogProjectionOptions,
): Promise<Array<{ databaseSeq: number; entry: ChangeEntry }>> {
  const entries: Array<{ databaseSeq: number; entry: ChangeEntry }> = [];
  for (const row of rows) {
    const tableColumns = syncedColumnsForTable(row.entity_table);
    if (!tableColumns) {
      throw new Error(
        `Unsupported sync table "${row.entity_table}" in local sync log; update AuraScholar before syncing this library`,
      );
    }
    if (row.op !== "upsert" && row.op !== "delete") {
      throw new Error(`Invalid local sync log entry ${row.seq}: unsupported operation`);
    }
    const rawValues = parseSyncLogRecord(row.seq, "values_json", row.values_json);
    assertLocalOwner(row.entity_table, rawValues, options.libraryId);
    if (row.op === "delete") {
      await options.assertDeleteScope(row.entity_table, row.entity_id);
    }
    const portableValues = withoutOwner(rawValues);
    const rawColumnHlcs = parseSyncLogStringRecord(
      row.seq,
      "column_hlcs_json",
      row.column_hlcs_json,
    );
    const portableColumnHlcs = withoutOwner(rawColumnHlcs) as Record<string, string>;
    assertSupportedSyncLogColumns(
      row.seq,
      row.entity_table,
      tableColumns,
      portableValues,
      portableColumnHlcs,
    );
    if (row.op === "upsert" && Object.keys(portableValues).length === 0) {
      throw new Error(`Invalid local sync log entry ${row.seq}: upsert has no synced values`);
    }
    const values =
      row.op === "upsert"
        ? { ...portableValues, [SYNC_OWNER_COLUMN]: options.transportLibraryId }
        : portableValues;
    const columnHlcs =
      row.op === "upsert"
        ? {
            ...portableColumnHlcs,
            [SYNC_OWNER_COLUMN]: rawColumnHlcs[SYNC_OWNER_COLUMN] ?? row.hlc,
          }
        : portableColumnHlcs;
    entries.push({
      databaseSeq: row.seq,
      entry: {
        seq: 0,
        table: row.entity_table,
        rowId: row.entity_id,
        op: row.op,
        values,
        columnHlcs,
        hlc: row.hlc,
        deviceId: options.deviceId,
      },
    });
  }
  return entries;
}

function assertLocalOwner(table: string, values: Record<string, unknown>, libraryId: string): void {
  if (Object.hasOwn(values, SYNC_OWNER_COLUMN) && values[SYNC_OWNER_COLUMN] !== libraryId) {
    throw new Error(`Rejected cross-library local sync owner for ${table}`);
  }
}

function withoutOwner<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  if (!Object.hasOwn(value, SYNC_OWNER_COLUMN)) return value;
  const { [SYNC_OWNER_COLUMN]: _owner, ...rest } = value;
  return rest;
}
