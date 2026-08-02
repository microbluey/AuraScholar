export function parseSyncLogRecord(
  seq: number,
  field: string,
  value: string | null,
): Record<string, unknown> {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid local sync log entry ${seq}: malformed ${field}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Invalid local sync log entry ${seq}: malformed ${field}`);
  }
  return parsed;
}

export function parseStoredNumber(value: string): number {
  try {
    const parsed: unknown = JSON.parse(value);
    const number = Number(parsed);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  } catch {
    return 0;
  }
}

export function parseStoredRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseStoredStringRecord(value: string): Record<string, string> | null {
  const parsed = parseStoredRecord(value);
  if (!parsed) return null;
  if (!Object.values(parsed).every((item) => typeof item === "string")) return null;
  return parsed as Record<string, string>;
}

export function parseSyncLogStringRecord(
  seq: number,
  field: string,
  value: string | null,
): Record<string, string> {
  const parsed = parseSyncLogRecord(seq, field, value);
  if (!Object.values(parsed).every((item) => typeof item === "string")) {
    throw new Error(`Invalid local sync log entry ${seq}: malformed ${field}`);
  }
  return parsed as Record<string, string>;
}

export function assertSupportedSyncLogColumns(
  seq: number,
  table: string,
  tableColumns: readonly string[],
  values: Record<string, unknown>,
  columnHlcs: Record<string, string>,
): void {
  const supported = new Set(tableColumns);
  const columns = new Set([...Object.keys(values), ...Object.keys(columnHlcs)]);
  for (const column of columns) {
    if (!supported.has(column)) {
      throw new Error(
        `Unsupported sync column "${table}.${column}" in local sync log entry ${seq}; update AuraScholar before syncing this library`,
      );
    }
  }
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
