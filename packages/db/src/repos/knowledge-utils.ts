import type { Database } from "../database.js";
import {
  CONTENT_UNIT_SOURCE_TYPES,
  KNOWLEDGE_CHANGE_KINDS,
  KNOWLEDGE_CHANGE_SOURCE_TYPES,
  KNOWLEDGE_JOB_KINDS,
  KNOWLEDGE_JOB_STATUSES,
  type ContentUnitSourceType,
  type KnowledgeChangeKind,
  type KnowledgeChangeSourceType,
  type KnowledgeJobKind,
  type KnowledgeJobStatus,
} from "./knowledge-contract.js";

export function serializeJson(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("value is not JSON serializable");
    return encoded;
  } catch {
    throw new Error(`${label} must be JSON serializable`);
  }
}

export function safeJson(value: unknown): string | null {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? null : encoded;
  } catch {
    return null;
  }
}

export async function assertActiveLibrary(db: Database, libraryId: string): Promise<void> {
  const libraries = await db.query<{ id: string }>(
    `SELECT id FROM libraries WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [libraryId],
  );
  if (!libraries[0]) throw new Error(`Library ${libraryId} is missing or removed`);
}

export function normalizeOptionalId(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  assertId(value, label);
  return value;
}

export function normalizeOptionalHash(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value`);
  }
  return value;
}

export function normalizeNow(value: number | undefined): number {
  const now = value ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("now must be a non-negative integer");
  return now;
}

export function normalizeLeaseMs(value: number | undefined): number {
  const leaseMs = value ?? 60_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60_000) {
    throw new Error("leaseMs must be an integer between 1000 and 86400000");
  }
  return leaseMs;
}

export function normalizeLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error(`${label} must be an integer between 1 and 1000`);
  }
  return limit;
}

export function assertId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function assertOwner(value: string): void {
  assertId(value, "Knowledge job lease owner");
  if (value.length > 512)
    throw new Error("Knowledge job lease owner must be at most 512 characters");
}

export function assertKnownChangeSourceType(
  value: string,
): asserts value is KnowledgeChangeSourceType {
  if (!KNOWLEDGE_CHANGE_SOURCE_TYPES.includes(value as KnowledgeChangeSourceType)) {
    throw new Error(`Unsupported Knowledge change source type: ${value}`);
  }
}

export function assertKnownChangeKind(value: string): asserts value is KnowledgeChangeKind {
  if (!KNOWLEDGE_CHANGE_KINDS.includes(value as KnowledgeChangeKind)) {
    throw new Error(`Unsupported Knowledge change kind: ${value}`);
  }
}

export function assertKnownJobKind(value: string): asserts value is KnowledgeJobKind {
  if (!KNOWLEDGE_JOB_KINDS.includes(value as KnowledgeJobKind)) {
    throw new Error(`Unsupported Knowledge job kind: ${value}`);
  }
}

export function assertKnownStatus(value: string): asserts value is KnowledgeJobStatus {
  if (!KNOWLEDGE_JOB_STATUSES.includes(value as KnowledgeJobStatus)) {
    throw new Error(`Unsupported Knowledge job status: ${value}`);
  }
}

export function assertKnownContentUnitSourceType(
  value: string,
): asserts value is ContentUnitSourceType {
  if (!CONTENT_UNIT_SOURCE_TYPES.includes(value as ContentUnitSourceType)) {
    throw new Error(`Unsupported ContentUnit source type: ${value}`);
  }
}
