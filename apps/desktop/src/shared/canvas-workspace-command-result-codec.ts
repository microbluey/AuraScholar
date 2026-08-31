import type {
  CanvasCreateWorkspaceCommandResult,
  CanvasDeleteWorkspaceCommandResult,
  CanvasLoadWorkspaceCommandResult,
  CanvasRenameWorkspaceCommandResult,
  CanvasSaveWorkspaceCommandResult,
} from "../../electron/canvas-command-contract";
import { decodeCanvasWorkspaceDocument } from "./canvas-workspace-document-codec";

/** Validates and clones Canvas workspace command responses received over IPC. */
export function decodeCanvasWorkspaceLoadResult(value: unknown): CanvasLoadWorkspaceCommandResult {
  const result = requireExactCanvasResult(value, "Canvas workspace load result", ["workspace"]);
  return {
    workspace: result.workspace === null ? null : decodeCanvasWorkspaceDocument(result.workspace),
  };
}

export function decodeCanvasWorkspaceCreateResult(
  value: unknown,
): CanvasCreateWorkspaceCommandResult {
  return decodeCanvasWorkspaceDocumentResult(value, "Canvas workspace create result");
}

export function decodeCanvasWorkspaceRenameResult(
  value: unknown,
): CanvasRenameWorkspaceCommandResult {
  return decodeCanvasWorkspaceDocumentResult(value, "Canvas workspace rename result");
}

export function decodeCanvasWorkspaceDeleteResult(
  value: unknown,
): CanvasDeleteWorkspaceCommandResult {
  const result = requireExactCanvasResult(value, "Canvas workspace delete result", ["deleted"]);
  if (typeof result.deleted !== "boolean") {
    throw new Error("Canvas workspace delete result is invalid");
  }
  return { deleted: result.deleted };
}

export function decodeCanvasWorkspaceSaveResult(value: unknown): CanvasSaveWorkspaceCommandResult {
  const result = requireExactCanvasResult(value, "Canvas workspace save result", ["saved"]);
  if (result.saved !== true) {
    throw new Error("Canvas workspace save result is invalid");
  }
  return { saved: true };
}

function decodeCanvasWorkspaceDocumentResult(
  value: unknown,
  label: string,
): CanvasCreateWorkspaceCommandResult {
  const result = requireExactCanvasResult(value, label, ["workspace"]);
  return { workspace: decodeCanvasWorkspaceDocument(result.workspace) };
}

function requireExactCanvasResult(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
