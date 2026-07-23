import { CANVAS_SCHEMA_VERSION, type CanvasWorkspaceDocument } from "@aurascholar/core";
import { describe, expect, it } from "vitest";
import {
  applyCanvasWorkspaceUpdate,
  mergeRenamedCanvasWorkspace,
  planCanvasWorkspaceDeletion,
} from "./workspace-controls";

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

  it("protects the last workspace and ignores a stale delete target", () => {
    const onlyWorkspace = [{ workspaceId: "workspace-a", name: "Only" }];

    expect(planCanvasWorkspaceDeletion(onlyWorkspace, "workspace-a", "workspace-a")).toMatchObject({
      canDelete: false,
      deletingActiveWorkspace: true,
      nextActiveWorkspaceId: null,
      remainingWorkspaces: [],
      targetExists: true,
    });
    expect(
      planCanvasWorkspaceDeletion(onlyWorkspace, "workspace-a", "missing-workspace"),
    ).toMatchObject({
      canDelete: false,
      deletingActiveWorkspace: false,
      nextActiveWorkspaceId: "workspace-a",
      remainingWorkspaces: onlyWorkspace,
      targetExists: false,
    });
  });

  it("redirects an active deletion to the first remaining workspace in list order", () => {
    const workspaces = [
      { workspaceId: "workspace-newest", name: "Newest" },
      { workspaceId: "workspace-active", name: "Active" },
      { workspaceId: "workspace-oldest", name: "Oldest" },
    ];

    expect(planCanvasWorkspaceDeletion(workspaces, "workspace-active", "workspace-active")).toEqual(
      {
        canDelete: true,
        deletingActiveWorkspace: true,
        nextActiveWorkspaceId: "workspace-newest",
        remainingWorkspaces: [workspaces[0], workspaces[2]],
        targetExists: true,
      },
    );
  });

  it("keeps the current route when a different workspace is deleted", () => {
    const workspaces = [
      { workspaceId: "workspace-active", name: "Active" },
      { workspaceId: "workspace-remove", name: "Remove" },
      { workspaceId: "workspace-third", name: "Third" },
    ];

    expect(planCanvasWorkspaceDeletion(workspaces, "workspace-active", "workspace-remove")).toEqual(
      {
        canDelete: true,
        deletingActiveWorkspace: false,
        nextActiveWorkspaceId: "workspace-active",
        remainingWorkspaces: [workspaces[0], workspaces[2]],
        targetExists: true,
      },
    );
  });
});
