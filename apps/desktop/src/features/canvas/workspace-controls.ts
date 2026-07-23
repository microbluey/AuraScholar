import type { CanvasWorkspaceDocument } from "@aurascholar/core";

export interface CanvasWorkspaceOption {
  workspaceId: string;
  name: string;
  description?: string;
  updatedAt?: number;
}

export type CanvasWorkspaceActionResult = void | Promise<void>;

export type CreateCanvasWorkspace = (
  name: string,
) => CanvasWorkspaceOption | Promise<CanvasWorkspaceOption>;

export function applyCanvasWorkspaceUpdate(
  current: CanvasWorkspaceDocument | null,
  sourceWorkspaceId: string,
  updater: (document: CanvasWorkspaceDocument) => CanvasWorkspaceDocument,
): CanvasWorkspaceDocument | null {
  if (!current || current.workspaceId !== sourceWorkspaceId) return current;
  const next = updater(current);
  return next.workspaceId === sourceWorkspaceId ? next : current;
}

/** Applies persisted rename metadata without replacing edits made while the rename was in flight. */
export function mergeRenamedCanvasWorkspace(
  current: CanvasWorkspaceDocument,
  renamed: CanvasWorkspaceDocument,
): CanvasWorkspaceDocument {
  if (current.workspaceId !== renamed.workspaceId) {
    throw new Error("Cannot merge rename metadata from a different canvas workspace");
  }
  return {
    ...current,
    name: renamed.name,
    updatedAt: Math.max(current.updatedAt, renamed.updatedAt),
  };
}
