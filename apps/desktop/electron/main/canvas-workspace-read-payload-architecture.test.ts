import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Canvas workspace read payload boundary", () => {
  it("preflights bounded DB reads and guards every full workspace IPC envelope", () => {
    const workspaceCommands = source("electron/main/canvas-workspace-commands.ts");
    const canvasRepo = source("../../packages/db/src/repos/canvas.ts");
    const bounds = source("../../packages/db/src/repos/canvas-workspace-bounds.ts");
    const readQueries = source("../../packages/db/src/repos/canvas-workspace-read.ts");
    const workspaceContract = source("electron/canvas-command-contract.ts");

    for (const limit of [
      "MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES",
      "MAX_CANVAS_WORKSPACE_LIST_ROWS",
      "MAX_CANVAS_WORKSPACE_LIST_BYTES",
      "MAX_CANVAS_WORKSPACE_NAME_BYTES",
      "MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES",
      "MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES",
      "MAX_CANVAS_NODES",
      "MAX_CANVAS_EDGES",
      "MAX_CANVAS_NODE_TAGS",
      "MAX_CANVAS_NODE_TAG_BYTES",
      "MAX_CANVAS_EDGE_LABEL_BYTES",
      "MAX_CANVAS_JSON_TEXT_BYTES",
    ]) {
      expect(bounds).toContain(`export const ${limit}`);
    }
    for (const limit of [
      "MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES",
      "MAX_CANVAS_WORKSPACE_LIST_ROWS",
      "MAX_CANVAS_WORKSPACE_LIST_BYTES",
      "MAX_CANVAS_WORKSPACE_NAME_BYTES",
      "MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES",
      "MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES",
      "MAX_CANVAS_NODES",
      "MAX_CANVAS_EDGES",
      "MAX_CANVAS_EDGE_LABEL_BYTES",
      "MAX_CANVAS_JSON_TEXT_BYTES",
      "MAX_CANVAS_NODE_TAGS_JSON_BYTES",
      "MAX_CANVAS_EDGE_STYLE_JSON_BYTES",
    ]) {
      expect(readQueries).toContain(limit);
    }

    expect(readQueries).toContain("listBoundedCanvasWorkspaceSummaries");
    expect(readQueries).toContain("loadBoundedCanvasWorkspaceDocument");
    expect(readQueries).toContain("COUNT(");
    expect(readQueries).toContain("length(CAST(");
    expect(readQueries).toContain("AS BLOB))");
    expect(readQueries).toContain("MAX_CANVAS_WORKSPACE_LIST_ROWS + 1");
    expect(readQueries).toContain("MAX_CANVAS_NODES + 1");
    expect(readQueries).toContain("MAX_CANVAS_EDGES + 1");
    expect(readQueries).toContain("LIMIT ?");
    expect(readQueries).not.toMatch(/SELECT\s+(?:[A-Za-z_][\w]*\.)?\*/);
    expect(readQueries).toContain("WHERE library_id = ?");

    expect(canvasRepo).toContain("listBoundedCanvasWorkspaceSummaries");
    expect(canvasRepo).toContain("loadBoundedCanvasWorkspaceDocument");
    expect(workspaceContract).toContain("export interface CanvasWorkspaceSummaryDto");
    expect(workspaceContract).toContain("workspaces: CanvasWorkspaceSummaryDto[]");

    expect(workspaceCommands).toMatch(
      /import\s*\{[^}]*MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES[^}]*\}\s*from "@aurascholar\/db";/,
    );
    expect(workspaceCommands).toContain(
      "MAX_CANVAS_WORKSPACE_ENVELOPE_ALLOWANCE_BYTES = 64 * 1024",
    );
    expect(workspaceCommands).toMatch(
      /MAX_CANVAS_WORKSPACE_OUTPUT_BYTES\s*=\s*MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES\s*\+\s*MAX_CANVAS_WORKSPACE_ENVELOPE_ALLOWANCE_BYTES/,
    );
    expect(workspaceCommands).toContain("requireBoundedCanvasWorkspaceOutput");
    expect(workspaceCommands).toContain('Buffer.byteLength(serialized, "utf8")');
    expect(workspaceCommands).toContain("toCanvasWorkspaceSummaryDto");
    for (const commandName of [
      "canvas.listWorkspaces",
      "canvas.loadWorkspace",
      "canvas.createWorkspace",
      "canvas.renameWorkspace",
    ]) {
      const caseStart = workspaceCommands.indexOf(`case "${commandName}"`);
      const nextCase = workspaceCommands.indexOf("case ", caseStart + 1);
      const caseSource = workspaceCommands.slice(caseStart, nextCase === -1 ? undefined : nextCase);
      expect(caseStart).toBeGreaterThanOrEqual(0);
      expect(caseSource).toContain("requireBoundedCanvasWorkspaceOutput");
    }
  });
});
