export type SyncedTableColumns = Record<string, readonly string[]>;

export function columnsForSyncedTable(
  tables: SyncedTableColumns,
  table: string,
): readonly string[] | null {
  if (!Object.prototype.hasOwnProperty.call(tables, table)) return null;
  const columns = tables[table];
  return Array.isArray(columns) ? columns : null;
}

export function pickKnownTableRecord(
  tables: SyncedTableColumns,
  table: string,
  value: unknown,
): Record<string, unknown> | null {
  const columns = columnsForSyncedTable(tables, table);
  if (!columns) return null;
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([column]) => columns.includes(column)));
}

export function pickKnownTableStringRecord(
  tables: SyncedTableColumns,
  table: string,
  value: unknown,
): Record<string, string> | null {
  const picked = pickKnownTableRecord(tables, table, value);
  if (!picked) return null;
  return Object.fromEntries(
    Object.entries(picked).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
