import { CANVAS_SCHEMA_VERSION, type CanvasWorkspaceDocument } from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import { applyCanvasWorkspaceUpdate, mergeRenamedCanvasWorkspace } from "./workspace-controls";

function workspace(name: string, updatedAt: number): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "workspace-a",
    name,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    createdAt: 1,
    updatedAt,
  };
}

describe("canvas workspace controls", () => {
  it("keeps edits made while an active workspace rename is in flight", () => {
    const current: CanvasWorkspaceDocument = {
      ...workspace("Old name", 30),
      nodes: [
        {
          id: "note-new",
          type: "idea-note",
          position: { x: 20, y: 30 },
          dimensions: { width: 280, height: 180 },
          tags: [],
          createdAt: 30,
          updatedAt: 30,
          data: { contentMarkdown: "new thought", hasEquations: false },
        },
      ],
    };
    const staleRenamedSnapshot = workspace("Renamed", 20);

    const merged = mergeRenamedCanvasWorkspace(current, staleRenamedSnapshot);

    expect(merged.name).toBe("Renamed");
    expect(merged.nodes).toEqual(current.nodes);
    expect(merged.updatedAt).toBe(30);
  });

  it("rejects an asynchronous update after the active workspace changes", () => {
    const activeWorkspace = { ...workspace("Workspace B", 40), workspaceId: "workspace-b" };

    const result = applyCanvasWorkspaceUpdate(activeWorkspace, "workspace-a", (current) => ({
      ...current,
      name: "stale AI result",
    }));

    expect(result).toBe(activeWorkspace);
    expect(result?.name).toBe("Workspace B");
  });
});
