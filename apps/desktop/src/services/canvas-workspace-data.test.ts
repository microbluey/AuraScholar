import { CANVAS_SCHEMA_VERSION, type CanvasWorkspaceDocument } from "@aurascholar/core";
import type { CanvasWorkspaceSummary } from "@aurascholar/db/repos/canvas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCanvasWorkspaceData,
  deleteCanvasWorkspaceData,
  listCanvasWorkspaceData,
  loadCanvasWorkspaceData,
  renameCanvasWorkspaceData,
  saveCanvasWorkspaceData,
  type CanvasWorkspaceCreated,
  type CanvasWorkspaceDeleted,
  type CanvasWorkspaceLoaded,
  type CanvasWorkspaceRenamed,
  type CanvasWorkspaceSaved,
  type CanvasWorkspaceSummaries,
} from "./canvas-workspace-data";

function workspace(overrides: Partial<CanvasWorkspaceDocument> = {}): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "canvas:workspace-1",
    name: "Research canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function summary(overrides: Partial<CanvasWorkspaceSummary> = {}): CanvasWorkspaceSummary {
  const document = workspace();
  return {
    schemaVersion: document.schemaVersion,
    workspaceId: document.workspaceId,
    name: document.name,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    ...overrides,
  };
}

describe("Canvas workspace data facade", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("lists and loads active-library workspaces through typed commands", async () => {
    const listed = { workspaces: [summary()] } satisfies CanvasWorkspaceSummaries;
    const loaded = { workspace: workspace() } satisfies CanvasWorkspaceLoaded;
    command.mockResolvedValueOnce(listed).mockResolvedValueOnce(loaded);

    await expect(listCanvasWorkspaceData()).resolves.toBe(listed);
    await expect(loadCanvasWorkspaceData({ workspaceId: "canvas:workspace-1" })).resolves.toBe(
      loaded,
    );
    expect(command).toHaveBeenNthCalledWith(1, "canvas.listWorkspaces", {});
    expect(command).toHaveBeenNthCalledWith(2, "canvas.loadWorkspace", {
      workspaceId: "canvas:workspace-1",
    });
  });

  it("sends workspace mutations without a renderer-selected Library id", async () => {
    const document = workspace();
    const created = { workspace: document } satisfies CanvasWorkspaceCreated;
    const renamed = {
      workspace: { ...document, name: "Renamed" },
    } satisfies CanvasWorkspaceRenamed;
    const deleted = { deleted: true } satisfies CanvasWorkspaceDeleted;
    const saved = { saved: true } satisfies CanvasWorkspaceSaved;
    command
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce(renamed)
      .mockResolvedValueOnce(deleted)
      .mockResolvedValueOnce(saved);

    await expect(createCanvasWorkspaceData({ name: "Research canvas" })).resolves.toBe(created);
    await expect(
      renameCanvasWorkspaceData({ name: "Renamed", workspaceId: document.workspaceId }),
    ).resolves.toBe(renamed);
    await expect(deleteCanvasWorkspaceData({ workspaceId: document.workspaceId })).resolves.toBe(
      deleted,
    );
    await expect(saveCanvasWorkspaceData({ document })).resolves.toBe(saved);

    expect(command).toHaveBeenNthCalledWith(1, "canvas.createWorkspace", {
      name: "Research canvas",
    });
    expect(command).toHaveBeenNthCalledWith(2, "canvas.renameWorkspace", {
      name: "Renamed",
      workspaceId: document.workspaceId,
    });
    expect(command).toHaveBeenNthCalledWith(3, "canvas.deleteWorkspace", {
      workspaceId: document.workspaceId,
    });
    expect(command).toHaveBeenNthCalledWith(4, "canvas.saveWorkspace", { document });
  });

  it("preserves main-process persistence failures", async () => {
    const failure = new Error("scoped Canvas save failed");
    command.mockRejectedValueOnce(failure);

    await expect(saveCanvasWorkspaceData({ document: workspace() })).rejects.toBe(failure);
  });
});
