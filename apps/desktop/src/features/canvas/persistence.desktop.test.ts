import { CANVAS_SCHEMA_VERSION, type CanvasWorkspaceDocument } from "@aurascholar/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasWorkspaceSummaryDto } from "../../../electron/data-command-contract";
import {
  createCanvasWorkspace,
  deleteCanvasWorkspace,
  listCanvasWorkspaces,
  loadCanvasWorkspace,
  readLastCanvasWorkspaceId,
  renameCanvasWorkspace,
  saveCanvasWorkspace,
} from "./persistence";
import { CANVAS_LAST_WORKSPACE_ID_KEY } from "./model";

vi.mock("../../services/aura-platform", () => ({ isDesktopRuntime: () => true }));

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

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

function summary(document: CanvasWorkspaceDocument): CanvasWorkspaceSummaryDto {
  return {
    schemaVersion: document.schemaVersion,
    workspaceId: document.workspaceId,
    name: document.name,
    ...(document.description === undefined ? {} : { description: document.description }),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

describe("desktop Canvas workspace persistence", () => {
  const command = vi.fn();
  const dispatchEvent = vi.fn();
  let storage: MemoryStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        aura: { data: { command } },
        dispatchEvent,
        localStorage: storage,
      },
    });
  });

  it("uses the scoped facade for list, load, create, rename, and autosave", async () => {
    const initial = workspace();
    const created = workspace({ name: "New canvas", workspaceId: "canvas:workspace-2" });
    const renamed = workspace({ ...created, name: "Renamed canvas", updatedAt: 101 });
    command
      .mockResolvedValueOnce({ workspaces: [summary(initial)] })
      .mockResolvedValueOnce({ workspace: initial })
      .mockResolvedValueOnce({ workspace: created })
      .mockResolvedValueOnce({ workspace: renamed })
      .mockResolvedValueOnce({ saved: true });

    await expect(listCanvasWorkspaces()).resolves.toEqual([summary(initial)]);
    await expect(loadCanvasWorkspace(` ${initial.workspaceId} `)).resolves.toEqual(initial);
    await expect(createCanvasWorkspace("  New canvas  ")).resolves.toEqual(created);
    await expect(
      renameCanvasWorkspace(` ${created.workspaceId} `, "  Renamed canvas  "),
    ).resolves.toEqual(renamed);
    await expect(saveCanvasWorkspace(renamed)).resolves.toBeUndefined();

    expect(command).toHaveBeenNthCalledWith(1, "canvas.listWorkspaces", {});
    expect(command).toHaveBeenNthCalledWith(2, "canvas.loadWorkspace", {
      workspaceId: initial.workspaceId,
    });
    expect(command).toHaveBeenNthCalledWith(3, "canvas.createWorkspace", { name: "New canvas" });
    expect(command).toHaveBeenNthCalledWith(4, "canvas.renameWorkspace", {
      name: "Renamed canvas",
      workspaceId: created.workspaceId,
    });
    expect(command).toHaveBeenNthCalledWith(5, "canvas.saveWorkspace", { document: renamed });
    expect(storage.getItem(CANVAS_LAST_WORKSPACE_ID_KEY)).toBe(created.workspaceId);
    expect(dispatchEvent).toHaveBeenCalledTimes(3);
  });

  it("keeps missing and malformed desktop workspace failures closed", async () => {
    command.mockResolvedValueOnce({ workspace: null });
    await expect(loadCanvasWorkspace("canvas:missing")).rejects.toThrow("白板不存在或已被删除");

    const malformed = {
      ...workspace(),
      nodes: [
        {
          id: "bad-node",
          type: "idea-note",
          position: { x: 0, y: 0 },
          dimensions: { width: 200, height: 100 },
          tags: [],
          createdAt: 100,
          updatedAt: 100,
          data: { contentMarkdown: "missing required hasEquations" },
        },
      ],
    } as unknown as CanvasWorkspaceDocument;
    command.mockResolvedValueOnce({ workspace: malformed });
    await expect(loadCanvasWorkspace(malformed.workspaceId)).rejects.toThrow("数据格式不兼容");
  });

  it("does not turn a committed deletion into a rejected autosave restore", async () => {
    const deletedId = "canvas:workspace-1";
    const remaining = workspace({ workspaceId: "canvas:workspace-2", name: "Remaining" });
    storage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, deletedId);
    command
      .mockResolvedValueOnce({ deleted: true })
      .mockResolvedValueOnce({ workspaces: [summary(remaining)] });

    await expect(deleteCanvasWorkspace(deletedId)).resolves.toBe(true);
    expect(readLastCanvasWorkspaceId()).toBe(remaining.workspaceId);
    expect(command).toHaveBeenNthCalledWith(1, "canvas.deleteWorkspace", {
      workspaceId: deletedId,
    });
    expect(command).toHaveBeenNthCalledWith(2, "canvas.listWorkspaces", {});
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps post-commit synchronization and failed saves from changing mutation outcomes", async () => {
    const deletedId = "canvas:workspace-1";
    storage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, deletedId);
    command
      .mockResolvedValueOnce({ deleted: true })
      .mockRejectedValueOnce(new Error("refresh failed"));

    await expect(deleteCanvasWorkspace(deletedId)).resolves.toBe(true);
    expect(readLastCanvasWorkspaceId()).toBe(deletedId);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    const failure = new Error("save rejected by active-library scope");
    command.mockRejectedValueOnce(failure);
    await expect(saveCanvasWorkspace(workspace())).rejects.toBe(failure);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("does not request another command when the target workspace was already absent", async () => {
    command.mockResolvedValueOnce({ deleted: false });

    await expect(deleteCanvasWorkspace("canvas:missing")).resolves.toBe(false);
    expect(command).toHaveBeenCalledOnce();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
