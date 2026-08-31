import { CANVAS_SCHEMA_VERSION } from "@aurascholar/core";
import {
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES as DB_MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES as DB_MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_BYTES as DB_MAX_CANVAS_WORKSPACE_LIST_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_ROWS as DB_MAX_CANVAS_WORKSPACE_LIST_ROWS,
  MAX_CANVAS_WORKSPACE_NAME_BYTES as DB_MAX_CANVAS_WORKSPACE_NAME_BYTES,
} from "@aurascholar/db";
import { describe, expect, it } from "vitest";
import type { CanvasWorkspaceSummaryDto } from "../../electron/canvas-command-contract";
import {
  decodeCanvasWorkspaceListResult,
  decodeCanvasWorkspaceSummaries,
} from "./canvas-workspace-summary-codec";
import {
  MAX_CANVAS_RECORD_ID_BYTES,
  MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_BYTES,
  MAX_CANVAS_WORKSPACE_LIST_ROWS,
  MAX_CANVAS_WORKSPACE_NAME_BYTES,
} from "./canvas-workspace-document-limits";

function summary(overrides: Partial<CanvasWorkspaceSummaryDto> = {}): CanvasWorkspaceSummaryDto {
  return {
    createdAt: 1,
    description: "Optional workspace description",
    name: "Research canvas",
    schemaVersion: CANVAS_SCHEMA_VERSION,
    updatedAt: 2,
    workspaceId: "canvas:summary-1",
    ...overrides,
  };
}

describe("Canvas workspace summary codec", () => {
  it("preserves a valid list result while cloning its envelope and summaries", () => {
    const source = { workspaces: [summary()] };
    const decoded = decodeCanvasWorkspaceListResult(source);

    expect(decoded).toEqual(source);
    expect(decoded).not.toBe(source);
    expect(decoded.workspaces).not.toBe(source.workspaces);
    expect(decoded.workspaces[0]).not.toBe(source.workspaces[0]);
  });

  it("preserves the absence of an optional description", () => {
    const workspace = summary();
    delete workspace.description;

    const decoded = decodeCanvasWorkspaceListResult({ workspaces: [workspace] });

    expect(decoded.workspaces[0]).toEqual(workspace);
    expect(decoded.workspaces[0]).not.toHaveProperty("description");
  });

  it("requires an exact list envelope and exact summary shape", () => {
    expect(() => decodeCanvasWorkspaceListResult({ extra: true, workspaces: [summary()] })).toThrow(
      "Canvas workspace list is invalid",
    );
    expect(() => decodeCanvasWorkspaceListResult({})).toThrow("Canvas workspace list is invalid");
    expect(() =>
      decodeCanvasWorkspaceListResult({
        workspaces: [{ ...summary(), projectId: "project:must-not-cross-ipc" }],
      }),
    ).toThrow("Canvas workspace at index 0 is invalid");
  });

  it("rejects empty, sparse, and oversized workspace collections before decoding entries", () => {
    expect(() => decodeCanvasWorkspaceSummaries([])).toThrow(
      `Canvas workspaces are limited to ${MAX_CANVAS_WORKSPACE_LIST_ROWS}`,
    );

    const sparse = Array<CanvasWorkspaceSummaryDto>(1);
    expect(() => decodeCanvasWorkspaceSummaries(sparse)).toThrow(
      `Canvas workspaces are limited to ${MAX_CANVAS_WORKSPACE_LIST_ROWS}`,
    );

    const oversized = Array.from({ length: MAX_CANVAS_WORKSPACE_LIST_ROWS + 1 }, () => ({}));
    expect(() => decodeCanvasWorkspaceSummaries(oversized)).toThrow(
      `Canvas workspaces are limited to ${MAX_CANVAS_WORKSPACE_LIST_ROWS}`,
    );
  });

  it("uses UTF-8 byte budgets for workspace names and ids", () => {
    const exactByteLimit = "文".repeat(170) + "ab";
    expect(() =>
      decodeCanvasWorkspaceListResult({
        workspaces: [summary({ name: exactByteLimit, workspaceId: exactByteLimit })],
      }),
    ).not.toThrow();

    expect(() =>
      decodeCanvasWorkspaceListResult({
        workspaces: [summary({ name: "文".repeat(171) })],
      }),
    ).toThrow("Canvas workspace name is invalid");
    expect(() =>
      decodeCanvasWorkspaceListResult({
        workspaces: [summary({ workspaceId: "文".repeat(171) })],
      }),
    ).toThrow("Canvas workspace id at index 0 is too long");

    expect(() =>
      decodeCanvasWorkspaceListResult({
        workspaces: [
          summary({
            description: "文".repeat(Math.floor(MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES / 3) + 1),
          }),
        ],
      }),
    ).toThrow("Canvas workspace description at index 0 is invalid");
  });

  it.each([
    ["an incompatible schema version", () => summary({ schemaVersion: CANVAS_SCHEMA_VERSION + 1 })],
    ["a blank workspace name", () => summary({ name: " \t " })],
    ["a negative created timestamp", () => summary({ createdAt: -1 })],
    ["an unsafe updated timestamp", () => summary({ updatedAt: Number.MAX_SAFE_INTEGER + 1 })],
  ])("rejects %s", (_label, createInvalidSummary) => {
    expect(() => decodeCanvasWorkspaceSummaries([createInvalidSummary()])).toThrow();
  });

  it("rejects non-array lists and blank workspace ids", () => {
    expect(() => decodeCanvasWorkspaceListResult({ workspaces: {} })).toThrow(
      `Canvas workspaces are limited to ${MAX_CANVAS_WORKSPACE_LIST_ROWS}`,
    );
    expect(() => decodeCanvasWorkspaceSummaries([summary({ workspaceId: " \t " })])).toThrow(
      "Canvas workspace id at index 0 is required",
    );
  });

  it("rejects duplicate workspace ids", () => {
    expect(() =>
      decodeCanvasWorkspaceSummaries([
        summary({ workspaceId: "canvas:duplicate" }),
        summary({ workspaceId: "canvas:duplicate" }),
      ]),
    ).toThrow("Duplicate canvas workspace id canvas:duplicate");
  });

  it("rejects a structurally valid list whose serialized payload exceeds the shared budget", () => {
    const descriptions = "x".repeat(MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES);
    const workspaces = Array.from({ length: 129 }, (_, index) =>
      summary({ description: descriptions, workspaceId: `canvas:large-${index}` }),
    );

    expect(() => decodeCanvasWorkspaceListResult({ workspaces })).toThrow(
      `Canvas workspace list is limited to ${MAX_CANVAS_WORKSPACE_LIST_BYTES} bytes`,
    );
  });

  it("keeps renderer list limits aligned with bounded database reads", () => {
    expect({
      description: MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
      listBytes: MAX_CANVAS_WORKSPACE_LIST_BYTES,
      listRows: MAX_CANVAS_WORKSPACE_LIST_ROWS,
      name: MAX_CANVAS_WORKSPACE_NAME_BYTES,
      recordId: MAX_CANVAS_RECORD_ID_BYTES,
    }).toEqual({
      description: DB_MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES,
      listBytes: DB_MAX_CANVAS_WORKSPACE_LIST_BYTES,
      listRows: DB_MAX_CANVAS_WORKSPACE_LIST_ROWS,
      name: DB_MAX_CANVAS_WORKSPACE_NAME_BYTES,
      recordId: DB_MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES,
    });
  });
});
