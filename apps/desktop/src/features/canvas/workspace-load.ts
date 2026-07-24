import type { CanvasWorkspaceDocument } from "@aurascholar/core";

export interface CanvasWorkspaceLoadBarrier {
  flushWorkspace: (workspaceId: string) => Promise<void>;
  isCurrentRequest: () => boolean;
  previousWorkspaceId?: string;
  targetWorkspaceId: string;
}

export interface CanvasWorkspaceWriteBarrier {
  cancelPendingSave: () => void;
  getInFlightSave: () => Promise<void> | undefined;
  getLastPersisted: () => string | undefined;
  getLatestDocument: () => CanvasWorkspaceDocument | undefined;
  isRetired: () => boolean;
  persistDocument: (document: CanvasWorkspaceDocument) => Promise<void>;
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
