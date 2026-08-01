import {
  isSensitiveKeyName,
  redactSensitiveText,
  redactSensitiveValue,
} from "@aurascholar/platform";
import type { UserBackupTable } from "./library-backup-config";

const VERBATIM_EVIDENCE_FIELDS = new Set([
  "anchor_json",
  "payload_json",
  "provenance_json",
  "source_content_hash",
]);

export function sanitizeBackupRows(
  table: UserBackupTable,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.flatMap((row) => {
    const sanitized = sanitizeBackupRow(table, row);
    return sanitized ? [sanitized] : [];
  });
}

export function sanitizeBackupRow(
  table: UserBackupTable,
  row: Record<string, unknown>,
): Record<string, unknown> | null {
  if (table === "settings") return sanitizeSettingsBackupRow(row);
  if (table === "evidence_items") return sanitizeEvidenceBackupRow(row);
  return sanitizePortableBackupValue(row) as Record<string, unknown>;
}

/**
 * Evidence snapshots are immutable research records. Their payload, anchor,
 * provenance, and content hash travel as one integrity unit. Backups can thus
 * contain credential-shaped source text and must be protected like the corpus.
 */
function sanitizeEvidenceBackupRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => [
      field,
      VERBATIM_EVIDENCE_FIELDS.has(field) ? value : sanitizePortableBackupValue(value, field),
    ]),
  );
}

function sanitizePortableBackupValue(value: unknown, fieldName = ""): unknown {
  if (fieldName && isSensitiveKeyName(fieldName)) return "";
  if (typeof value === "string") {
    if (fieldName.endsWith("_json")) return sanitizePortableJsonField(value);
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizePortableBackupValue(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sanitizePortableBackupValue(nested, key)]),
  );
}

function sanitizePortableJsonField(valueJson: string): string {
  try {
    return JSON.stringify(sanitizePortableBackupValue(JSON.parse(valueJson)));
  } catch {
    return redactSensitiveText(valueJson);
  }
}

function sanitizeSettingsBackupRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const key = typeof row.key === "string" ? row.key : "";
  if (!key || isSensitiveKeyName(key) || isRuntimeSettingKey(key)) return null;
  if (typeof row.value_json !== "string") return row;
  return { ...row, value_json: sanitizeSettingsValueJson(row.value_json) };
}

function sanitizeSettingsValueJson(valueJson: string): string {
  try {
    return JSON.stringify(redactSensitiveValue(JSON.parse(valueJson)));
  } catch {
    return JSON.stringify(redactSensitiveText(valueJson));
  }
}

function isRuntimeSettingKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return (
    normalized === "local.library_id" ||
    normalized === "local.device_id" ||
    normalized.startsWith("sync.")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
