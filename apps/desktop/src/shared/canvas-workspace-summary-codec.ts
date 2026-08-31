import { CANVAS_SCHEMA_VERSION } from "@aurascholar/core";
import type {
  CanvasListWorkspacesCommandResult,
  CanvasWorkspaceSummaryDto,
} from "../../electron/canvas-command-contract";
import {
  canvasUtf8ByteLength,
  MAX_CANVAS_RECORD_ID_BYTES,
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_ROWS,
  MAX_CANVAS_WORKSPACE_NAME_BYTES,
} from "./canvas-workspace-document-limits";

/** Validates and clones the bounded Canvas workspace-list IPC response. */
export function decodeCanvasWorkspaceListResult(value: unknown): CanvasListWorkspacesCommandResult {
  const result = requireExactCanvasObject(value, "Canvas workspace list", ["workspaces"]);
  return { workspaces: decodeCanvasWorkspaceSummaries(result.workspaces) };
}

export function decodeCanvasWorkspaceSummaries(value: unknown): CanvasWorkspaceSummaryDto[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_CANVAS_WORKSPACE_LIST_ROWS ||
    !isDenseArray(value)
  ) {
    throw new Error(`Canvas workspaces are limited to ${MAX_CANVAS_WORKSPACE_LIST_ROWS}`);
  }
  const summaries = value.map((summary, index) => requireCanvasWorkspaceSummary(summary, index));
  const workspaceIds = new Set<string>();
  for (const summary of summaries) {
    if (workspaceIds.has(summary.workspaceId)) {
      throw new Error(`Duplicate canvas workspace id ${summary.workspaceId}`);
    }
    workspaceIds.add(summary.workspaceId);
  }
  assertCanvasWorkspaceListPayloadSize(summaries);
  return summaries;
}

function requireCanvasWorkspaceSummary(value: unknown, index: number): CanvasWorkspaceSummaryDto {
  const summary = requireExactCanvasObject(
    value,
    `Canvas workspace at index ${index}`,
    ["schemaVersion", "workspaceId", "name", "createdAt", "updatedAt"],
    ["description"],
  );
  if (summary.schemaVersion !== CANVAS_SCHEMA_VERSION) {
    throw new Error(`Canvas schema version must be ${CANVAS_SCHEMA_VERSION}`);
  }
  return {
    createdAt: requireCanvasTimestamp(summary.createdAt, `Canvas workspace ${index} createdAt`),
    name: requireCanvasWorkspaceName(summary.name),
    schemaVersion: CANVAS_SCHEMA_VERSION,
    updatedAt: requireCanvasTimestamp(summary.updatedAt, `Canvas workspace ${index} updatedAt`),
    workspaceId: requireCanvasRecordId(
      summary.workspaceId,
      `Canvas workspace id at index ${index}`,
    ),
    ...(summary.description === undefined
      ? {}
      : {
          description: requireCanvasText(
            summary.description,
            `Canvas workspace description at index ${index}`,
            MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
          ),
        }),
  };
}

function requireCanvasWorkspaceName(value: unknown): string {
  const name = requireCanvasText(value, "Canvas workspace name", MAX_CANVAS_WORKSPACE_NAME_BYTES);
  if (!name.trim()) throw new Error("Canvas workspace name is required");
  return name;
}

function assertCanvasWorkspaceListPayloadSize(summaries: CanvasWorkspaceSummaryDto[]): void {
  const serialized = JSON.stringify(summaries);
  if (canvasUtf8ByteLength(serialized) > MAX_CANVAS_WORKSPACE_LIST_BYTES) {
    throw new Error(`Canvas workspace list is limited to ${MAX_CANVAS_WORKSPACE_LIST_BYTES} bytes`);
  }
}

function requireExactCanvasObject(
  value: unknown,
  label: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  const allowedFields = [...requiredFields, ...optionalFields];
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowedFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireCanvasRecordId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  const id = value.trim();
  if (canvasUtf8ByteLength(id) > MAX_CANVAS_RECORD_ID_BYTES) {
    throw new Error(`${label} is too long`);
  }
  return id;
}

function requireCanvasTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireCanvasText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || canvasUtf8ByteLength(value) > maxBytes) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}
