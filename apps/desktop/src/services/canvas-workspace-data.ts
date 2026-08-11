import type {
  CanvasCreateWorkspaceCommandInput,
  CanvasCreateWorkspaceCommandResult,
  CanvasDeleteWorkspaceCommandInput,
  CanvasDeleteWorkspaceCommandResult,
  CanvasListWorkspacesCommandResult,
  CanvasLoadWorkspaceCommandInput,
  CanvasLoadWorkspaceCommandResult,
  CanvasRenameWorkspaceCommandInput,
  CanvasRenameWorkspaceCommandResult,
  CanvasSaveWorkspaceCommandInput,
  CanvasSaveWorkspaceCommandResult,
} from "../../electron/data-command-contract";

/** Renderer facade for durable Canvas workspace snapshots. The main process
 * derives the active local Library and owns every database transaction. */
export type CanvasWorkspaceSummaries = CanvasListWorkspacesCommandResult;
export type CanvasWorkspaceLoaded = CanvasLoadWorkspaceCommandResult;
export type CanvasWorkspaceCreated = CanvasCreateWorkspaceCommandResult;
export type CanvasWorkspaceRenamed = CanvasRenameWorkspaceCommandResult;
export type CanvasWorkspaceDeleted = CanvasDeleteWorkspaceCommandResult;
export type CanvasWorkspaceSaved = CanvasSaveWorkspaceCommandResult;

export function listCanvasWorkspaceData(): Promise<CanvasWorkspaceSummaries> {
  return window.aura.data.command("canvas.listWorkspaces", {});
}

export function loadCanvasWorkspaceData(
  input: CanvasLoadWorkspaceCommandInput,
): Promise<CanvasWorkspaceLoaded> {
  return window.aura.data.command("canvas.loadWorkspace", input);
}

export function createCanvasWorkspaceData(
  input: CanvasCreateWorkspaceCommandInput,
): Promise<CanvasWorkspaceCreated> {
  return window.aura.data.command("canvas.createWorkspace", input);
}

export function renameCanvasWorkspaceData(
  input: CanvasRenameWorkspaceCommandInput,
): Promise<CanvasWorkspaceRenamed> {
  return window.aura.data.command("canvas.renameWorkspace", input);
}

export function deleteCanvasWorkspaceData(
  input: CanvasDeleteWorkspaceCommandInput,
): Promise<CanvasWorkspaceDeleted> {
  return window.aura.data.command("canvas.deleteWorkspace", input);
}

export function saveCanvasWorkspaceData(
  input: CanvasSaveWorkspaceCommandInput,
): Promise<CanvasWorkspaceSaved> {
  return window.aura.data.command("canvas.saveWorkspace", input);
}
