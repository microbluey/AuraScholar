import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type { DataCommandName, DataCommandOutput } from "../data-command-contract";

const MAX_RECORD_ID_LENGTH = 512;
export const MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS = 20_000;

export interface DataCommandDependencies {
  execute?<K extends DataCommandName>(
    commandName: K,
    operation: (
      database: Database,
    ) => DataCommandOutput<NoInfer<K>> | Promise<DataCommandOutput<NoInfer<K>>>,
  ): Promise<DataCommandOutput<K>>;
  getDeviceId?(): Promise<string>;
  transaction<K extends DataCommandName>(
    commandName: K,
    operation: (
      database: Database,
    ) => DataCommandOutput<NoInfer<K>> | Promise<DataCommandOutput<NoInfer<K>>>,
  ): Promise<DataCommandOutput<K>>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value;
}

export function requireRecordId(value: unknown, label: string): string {
  const id = requireNonEmptyString(value, label).trim();
  if (id.length > MAX_RECORD_ID_LENGTH) {
    throw new Error(`${label} is too long`);
  }
  return id;
}

export function requireNullableRecordId(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : requireRecordId(value, label);
}

export function requireUniqueRecordIds(
  value: unknown,
  label: string,
  options: { allowEmpty?: boolean; max: number },
): string[] {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
    throw new Error(`At least one ${label.toLowerCase()} is required`);
  }
  if (value.length > options.max) {
    throw new Error(`${label}s are limited to ${options.max} at a time`);
  }
  const ids = Array.from(value, (candidate, index) =>
    requireRecordId(candidate, `${label} at index ${index}`),
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label}s must be unique`);
  }
  return ids;
}

export async function assertActiveLocalLibrary(
  database: Database,
  expectedLibraryId: string,
): Promise<void> {
  const durableLibraryId = await requireLocalLibraryId(database);
  if (durableLibraryId !== expectedLibraryId) {
    throw new Error("Rejected stale or foreign Library scope");
  }
  const rows = await database.query<{ id: string }>(
    `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [expectedLibraryId],
  );
  if (rows.length !== 1) {
    throw new Error("Target Library does not exist or is deleted");
  }
}
