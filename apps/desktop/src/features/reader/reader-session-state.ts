import type { ReaderAnnotation } from "@aurascholar/reader";
import type { ReaderSessionGeneration } from "./reader-session-coordinator";

export interface ReaderSessionOwnedValue<T> {
  generation: ReaderSessionGeneration | null;
  value: T;
}

export function readReaderSessionOwnedValue<T>(
  state: ReaderSessionOwnedValue<T>,
  generation: ReaderSessionGeneration | undefined,
  fallback: T,
): T {
  return generation !== undefined && state.generation === generation ? state.value : fallback;
}

export function updateReaderSessionOwnedValue<T>(
  state: ReaderSessionOwnedValue<T>,
  generation: ReaderSessionGeneration,
  fallback: T,
  update: T | ((current: T) => T),
): ReaderSessionOwnedValue<T> {
  const current = state.generation === generation ? state.value : fallback;
  return {
    generation,
    value: typeof update === "function" ? (update as (current: T) => T)(current) : update,
  };
}

/**
 * Rolls back only the optimistic comment write that still owns the field.
 * Concurrent annotation additions, removals, and newer edits are preserved.
 */
export function rollbackReaderAnnotationContent(
  annotations: ReaderAnnotation[],
  annotationId: string,
  attemptedContent: string,
  previousContent: string | undefined,
): ReaderAnnotation[] {
  return annotations.map((annotation) =>
    annotation.id === annotationId && annotation.contentMd === attemptedContent
      ? { ...annotation, contentMd: previousContent }
      : annotation,
  );
}
