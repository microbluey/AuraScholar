import {
  type AppendKnowledgeChangeInput,
  type EnqueueKnowledgeJobInput,
  type KnowledgeChangeKind,
  type KnowledgeChangeRow,
  type KnowledgeChangeSourceType,
  type KnowledgeChangeStorageRow,
  type KnowledgeJobKind,
  type KnowledgeJobRow,
  type KnowledgeJobStorageRow,
} from "./knowledge-contract.js";
import {
  assertId,
  assertKnownChangeKind,
  assertKnownChangeSourceType,
  assertKnownJobKind,
  normalizeNow,
  normalizeOptionalHash,
  normalizeOptionalId,
  safeJson,
  serializeJson,
} from "./knowledge-utils.js";

/** Exponential retry backoff, capped at one hour to retain eventual recovery. */
export function knowledgeJobRetryDelayMs(attempts: number): number {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error("attempts must be a positive integer");
  }
  return Math.min(60_000 * 2 ** Math.min(attempts - 1, 10), 60 * 60_000);
}

/** Keeps durable diagnostics actionable without retaining an unbounded stack or payload. */
export function summarizeKnowledgeJobError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (safeJson(error) ?? "Unknown knowledge job failure");
  const compact = raw.replace(/\s+/g, " ").trim();
  return (compact || "Unknown knowledge job failure").slice(0, 2_000);
}

export interface NormalizedChangeInput {
  libraryId: string;
  sourceType: KnowledgeChangeSourceType;
  sourceId: string;
  changeKind: KnowledgeChangeKind;
  expectedRevisionId: string | null;
  expectedContentHash: string | null;
  createdAt: number;
}

export interface NormalizedEnqueueKnowledgeJobInput {
  kind: KnowledgeJobKind;
  sourceType: KnowledgeChangeSourceType;
  sourceId: string;
  expectedRevisionId: string | null;
  expectedContentHash: string | null;
  indexId: string | null;
  sourceChangeSeq: number | null;
  dedupeKey: string;
  maxAttempts: number;
  availableAt: number;
  progressJson: string | null;
}

export const KNOWLEDGE_JOB_COLUMNS = `id, library_id, kind, source_type, source_id,
  expected_revision_id, expected_content_hash, index_id, source_change_seq,
  dedupe_key, status, attempts, max_attempts, available_at, lease_owner,
  lease_expires_at, progress_json, error, created_at, updated_at`;

export function normalizeChangeInput(input: AppendKnowledgeChangeInput): NormalizedChangeInput {
  assertId(input.libraryId, "Library id");
  assertKnownChangeSourceType(input.sourceType);
  assertId(input.sourceId, "Knowledge change source id");
  assertKnownChangeKind(input.changeKind);
  const expectedRevisionId = normalizeOptionalId(input.expectedRevisionId, "Expected revision id");
  const expectedContentHash = normalizeOptionalHash(
    input.expectedContentHash,
    "Expected content hash",
  );
  const createdAt = normalizeNow(input.createdAt);
  return {
    libraryId: input.libraryId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    changeKind: input.changeKind,
    expectedRevisionId,
    expectedContentHash,
    createdAt,
  };
}

export function normalizeEnqueueInput(
  input: EnqueueKnowledgeJobInput,
): NormalizedEnqueueKnowledgeJobInput {
  assertKnownJobKind(input.kind);
  assertKnownChangeSourceType(input.sourceType);
  assertId(input.sourceId, "Knowledge job source id");
  const expectedRevisionId = normalizeOptionalId(input.expectedRevisionId, "Expected revision id");
  const expectedContentHash = normalizeOptionalHash(
    input.expectedContentHash,
    "Expected content hash",
  );
  const indexId = normalizeOptionalId(input.indexId, "Knowledge index id");
  const sourceChangeSeq = input.sourceChangeSeq ?? null;
  if (
    sourceChangeSeq !== null &&
    (!Number.isSafeInteger(sourceChangeSeq) || sourceChangeSeq <= 0)
  ) {
    throw new Error("sourceChangeSeq must be a positive integer or null");
  }
  const dedupeKey = (input.dedupeKey ?? makeDefaultDedupeKey(input)).trim();
  if (!dedupeKey || dedupeKey.length > 1_024) {
    throw new Error("Knowledge job dedupe key must be a non-empty string up to 1024 characters");
  }
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0 || maxAttempts > 100) {
    throw new Error("maxAttempts must be an integer between 1 and 100");
  }
  return {
    kind: input.kind,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    expectedRevisionId,
    expectedContentHash,
    indexId,
    sourceChangeSeq,
    dedupeKey,
    maxAttempts,
    availableAt: normalizeNow(input.availableAt),
    progressJson: serializeJson(input.progress, "Knowledge job progress"),
  };
}

export function makeDefaultDedupeKey(input: EnqueueKnowledgeJobInput): string {
  return [
    input.kind,
    input.sourceType,
    input.sourceId,
    input.expectedRevisionId ?? "",
    input.expectedContentHash ?? "",
    input.indexId ?? "",
  ].join("|");
}

export function jobKindForChange(changeKind: KnowledgeChangeKind): KnowledgeJobKind {
  switch (changeKind) {
    case "delete":
      return "remove";
    case "reindex":
      return "reindex";
    case "upsert":
      return "extract";
  }
}

export function toKnowledgeChangeRow(row: KnowledgeChangeStorageRow): KnowledgeChangeRow {
  return {
    seq: row.seq,
    libraryId: row.library_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    changeKind: row.change_kind,
    expectedRevisionId: row.expected_revision_id,
    expectedContentHash: row.expected_content_hash,
    createdAt: row.created_at,
  };
}

export function toKnowledgeJobRow(row: KnowledgeJobStorageRow): KnowledgeJobRow {
  return {
    id: row.id,
    libraryId: row.library_id,
    kind: row.kind,
    sourceType: row.source_type,
    sourceId: row.source_id,
    expectedRevisionId: row.expected_revision_id,
    expectedContentHash: row.expected_content_hash,
    indexId: row.index_id,
    sourceChangeSeq: row.source_change_seq,
    dedupeKey: row.dedupe_key,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    progress: row.progress_json === null ? null : (JSON.parse(row.progress_json) as unknown),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
