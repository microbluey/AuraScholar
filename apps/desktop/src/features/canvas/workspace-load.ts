import type { CanvasWorkspaceDocument } from "@aurascholar/core";

export interface CanvasWorkspaceLoadBarrier {
  flushWorkspace: (workspaceId: string) => Promise<void>;
  isCurrentRequest: () => boolean;
  previousWorkspaceId?: string;
  targetWorkspaceId: string;
}

export interface CanvasWorkspaceCollectionBarrier {
  flushWorkspace: (workspaceId: string) => Promise<void>;
  workspaceIds: Iterable<string>;
}

export interface CanvasWorkspaceNavigationBarrier {
  flushWorkspace: (workspaceId: string) => Promise<void>;
  navigate: () => void;
  workspaceId?: string;
}

export interface CanvasWorkspaceWriteBarrier {
  cancelPendingSave: () => void;
  getInFlightSave: () => Promise<void> | undefined;
  getLastPersisted: () => string | undefined;
  getLatestDocument: () => CanvasWorkspaceDocument | undefined;
  isRetired: () => boolean;
  persistDocument: (document: CanvasWorkspaceDocument) => Promise<void>;
}

export interface GuardedCanvasWorkspaceWrite {
  getLatestDocument: () => CanvasWorkspaceDocument | undefined;
  isRetired: () => boolean;
  persist: (document: CanvasWorkspaceDocument) => Promise<void>;
  snapshot: CanvasWorkspaceDocument;
}

/**
 * Executes a queued write only while its exact snapshot is still the latest
 * document for the workspace. This keeps an optimistic transaction that was
 * rolled back from being written later by an already queued save.
 */
export async function persistCurrentCanvasWorkspaceSnapshot({
  getLatestDocument,
  isRetired,
  persist,
  snapshot,
}: GuardedCanvasWorkspaceWrite): Promise<"persisted" | "superseded"> {
  if (isRetired() || getLatestDocument() !== snapshot) return "superseded";
  await persist(snapshot);
  return isRetired() || getLatestDocument() !== snapshot ? "superseded" : "persisted";
}

/**
 * Drains every write that can affect a workspace, then persists the latest
 * snapshot if an older in-flight save changed the stored version.
 */
export async function flushLatestCanvasWorkspace({
  cancelPendingSave,
  getInFlightSave,
  getLastPersisted,
  getLatestDocument,
  isRetired,
  persistDocument,
}: CanvasWorkspaceWriteBarrier): Promise<void> {
  for (;;) {
    cancelPendingSave();
    const inFlightSave = getInFlightSave();
    if (isRetired()) {
      await inFlightSave?.catch(() => undefined);
      return;
    }
    if (inFlightSave) {
      await inFlightSave;
      continue;
    }

    const latest = getLatestDocument();
    if (!latest || getLastPersisted() === JSON.stringify(latest)) return;
    await persistDocument(latest);
  }
}

/**
 * Flushes every live workspace without allowing one rejected write to leave
 * another workspace running unnoticed in the background.
 */
export async function flushCanvasWorkspaceCollection({
  flushWorkspace,
  workspaceIds,
}: CanvasWorkspaceCollectionBarrier): Promise<void> {
  const uniqueWorkspaceIds = [...new Set(workspaceIds)].filter(Boolean);
  const results = await Promise.allSettled(
    uniqueWorkspaceIds.map((workspaceId) => flushWorkspace(workspaceId)),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, `${failures.length} 个白板保存失败`);
}

/** Keeps an explicit Canvas route change behind the active workspace write. */
export async function navigateAfterCanvasWorkspaceFlush({
  flushWorkspace,
  navigate,
  workspaceId,
}: CanvasWorkspaceNavigationBarrier): Promise<void> {
  if (workspaceId) await flushWorkspace(workspaceId);
  navigate();
}

/**
 * Serializes a workspace load behind any writes that can affect it.
 *
 * The target flush is required even when it matches the previously active
 * workspace: during a fast A → B → A route sequence, the first transition may
 * still be saving A while the final transition is preparing to read it.
 */
export async function waitForCanvasWorkspaceLoad({
  flushWorkspace,
  isCurrentRequest,
  previousWorkspaceId,
  targetWorkspaceId,
}: CanvasWorkspaceLoadBarrier): Promise<boolean> {
  if (previousWorkspaceId && previousWorkspaceId !== targetWorkspaceId) {
    await flushWorkspace(previousWorkspaceId);
    if (!isCurrentRequest()) return false;
  }

  await flushWorkspace(targetWorkspaceId);
  return isCurrentRequest();
}
