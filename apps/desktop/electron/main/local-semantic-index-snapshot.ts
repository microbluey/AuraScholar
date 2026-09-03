import { KnowledgeIndexesRepo, type Database, type KnowledgeJobRow } from "@aurascholar/db";
import type { LibraryScopeToken } from "../library-read-command-contract";
import { assertActiveLibraryScopeToken } from "./library-scope-token";

export const STALE_INDEX_SNAPSHOT_ERROR = "Knowledge index snapshot is stale and must be rebuilt";
export const SCOPE_REJECTED_ERROR = "Rejected stale or foreign Library scope";

/** Shared marker for a source snapshot that can no longer accept derived data. */
export function staleIndexSnapshotError(): Error {
  return new Error(STALE_INDEX_SNAPSHOT_ERROR);
}

export function isStaleIndexSnapshotError(error: unknown): boolean {
  return error instanceof Error && error.message === STALE_INDEX_SNAPSHOT_ERROR;
}

export function normalizeSourceChangeSeq(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Knowledge index source change sequence must be a non-negative integer");
  }
  return value;
}

export function assertEmbedJob(job: KnowledgeJobRow): void {
  if (job.kind !== "embed" || job.sourceType !== "library" || job.sourceId !== job.libraryId) {
    throw new Error("Semantic embedding job has an invalid source scope");
  }
  if (!job.indexId?.trim())
    throw new Error("Semantic embedding job is missing an index generation");
}

export function currentTime(now: (() => number) | undefined): number {
  const value = now?.() ?? Date.now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Semantic index timestamp is invalid");
  }
  return value;
}

export function assertId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

export function isScopeRejection(error: unknown): boolean {
  return error instanceof Error && error.message === SCOPE_REJECTED_ERROR;
}

export async function assertLibraryScope(
  database: Database,
  libraryId: string,
  expectedScope?: LibraryScopeToken,
): Promise<void> {
  if (!expectedScope) return;
  if (expectedScope.libraryId !== libraryId) throw new Error(SCOPE_REJECTED_ERROR);
  await assertActiveLibraryScopeToken(database, expectedScope);
}

/** Checks both the immutable generation pin and the Library high-water mark. */
export async function assertKnowledgeIndexSnapshot(
  database: Database,
  libraryId: string,
  indexSourceChangeSeq: number,
  expectedSourceChangeSeq: number,
): Promise<void> {
  if (indexSourceChangeSeq !== expectedSourceChangeSeq) {
    throw staleIndexSnapshotError();
  }
  const latest = await new KnowledgeIndexesRepo(database, libraryId).getLatestSourceChangeSeq();
  if (latest !== expectedSourceChangeSeq) throw staleIndexSnapshotError();
}
