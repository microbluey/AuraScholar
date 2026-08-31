import { Buffer } from "node:buffer";
import { MAX_CANVAS_WORKSPACE_NAME_BYTES } from "@aurascholar/db";
import type {
  CanvasCreateWorkspaceCommandInput,
  CanvasDeleteWorkspaceCommandInput,
  CanvasListWorkspacesCommandInput,
  CanvasLoadWorkspaceCommandInput,
  CanvasRenameWorkspaceCommandInput,
  CanvasSaveWorkspaceCommandInput,
} from "../data-command-contract";
import { isRecord, requireRecordId } from "./data-command-runtime";
import { parseCanvasWorkspaceDocument } from "./canvas-workspace-document-input";

type CanvasWorkspaceCommandName =
  | "canvas.listWorkspaces"
  | "canvas.loadWorkspace"
  | "canvas.createWorkspace"
  | "canvas.renameWorkspace"
  | "canvas.deleteWorkspace"
  | "canvas.saveWorkspace";

export function parseCanvasListWorkspacesInput(value: unknown): CanvasListWorkspacesCommandInput {
  requireExactCanvasWorkspaceInput(value, "canvas.listWorkspaces", []);
  return {};
}

export function parseCanvasLoadWorkspaceInput(value: unknown): CanvasLoadWorkspaceCommandInput {
  const input = requireExactCanvasWorkspaceInput(value, "canvas.loadWorkspace", ["workspaceId"]);
  return { workspaceId: requireRecordId(input.workspaceId, "Canvas workspace id") };
}

export function parseCanvasCreateWorkspaceInput(value: unknown): CanvasCreateWorkspaceCommandInput {
  const input = requireExactCanvasWorkspaceInput(value, "canvas.createWorkspace", ["name"]);
  return { name: requireCanvasWorkspaceName(input.name) };
}

export function parseCanvasRenameWorkspaceInput(value: unknown): CanvasRenameWorkspaceCommandInput {
  const input = requireExactCanvasWorkspaceInput(value, "canvas.renameWorkspace", [
    "workspaceId",
    "name",
  ]);
  return {
    name: requireCanvasWorkspaceName(input.name),
    workspaceId: requireRecordId(input.workspaceId, "Canvas workspace id"),
  };
}

export function parseCanvasDeleteWorkspaceInput(value: unknown): CanvasDeleteWorkspaceCommandInput {
  const input = requireExactCanvasWorkspaceInput(value, "canvas.deleteWorkspace", ["workspaceId"]);
  return { workspaceId: requireRecordId(input.workspaceId, "Canvas workspace id") };
}

export function parseCanvasSaveWorkspaceInput(value: unknown): CanvasSaveWorkspaceCommandInput {
  const input = requireExactCanvasWorkspaceInput(value, "canvas.saveWorkspace", ["document"]);
  return { document: parseCanvasWorkspaceDocument(input.document) };
}

function requireExactCanvasWorkspaceInput(
  value: unknown,
  commandName: CanvasWorkspaceCommandName,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireCanvasWorkspaceName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Canvas workspace name is invalid");
  const name = value.trim();
  if (
    !name ||
    Buffer.byteLength(name, "utf8") > MAX_CANVAS_WORKSPACE_NAME_BYTES
  ) {
    throw new Error("Canvas workspace name is invalid");
  }
  return name;
}
