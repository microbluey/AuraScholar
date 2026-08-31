import { CANVAS_SCHEMA_VERSION, type CanvasWorkspaceDocument } from "@aurascholar/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasWorkspaceSummaryDto } from "../../../electron/data-command-contract";
import {
  createCanvasWorkspace,
  deleteCanvasWorkspace,
  listCanvasWorkspaces,
  loadCanvasWorkspace,
  readLastCanvasWorkspaceId,
  rememberLastCanvasWorkspaceId,
  renameCanvasWorkspace,
  saveCanvasWorkspace,
} from "./persistence";
import { CANVAS_LAST_WORKSPACE_ID_KEY, CANVAS_STORAGE_V2_KEY } from "./model";

const { isDesktopRuntime } = vi.hoisted(() => ({ isDesktopRuntime: vi.fn() }));

vi.mock("../../services/aura-platform", () => ({ isDesktopRuntime }));

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
    isDesktopRuntime.mockReturnValue(true);
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

  it("keeps malformed desktop workspace list results closed", async () => {
    const malformed = {
      workspaces: [{ ...summary(workspace()), projectId: "project:leak" }],
    };
    command.mockResolvedValueOnce(malformed);

    await expect(listCanvasWorkspaces()).rejects.toThrow("白板列表数据格式不兼容");
    expect(command).toHaveBeenCalledWith("canvas.listWorkspaces", {});
  });

  it("keeps missing and malformed desktop workspace failures closed", async () => {
    command.mockResolvedValueOnce({ workspace: null });
    await expect(loadCanvasWorkspace("canvas:missing")).rejects.toThrow("白板不存在或已被删除");

    const malformed = {
      ...workspace(),
      viewport: { x: 0, y: 0, zoom: 0 },
    } as unknown as CanvasWorkspaceDocument;
    command.mockResolvedValueOnce({ workspace: malformed });
    await expect(loadCanvasWorkspace(malformed.workspaceId)).rejects.toThrow("数据格式不兼容");
  });

  it("keeps every desktop workspace response behind the full document decoder", async () => {
    const malformed = {
      ...workspace(),
      edges: [
        {
          createdAt: 100,
          id: "canvas-edge:missing-target",
          relationType: "supports",
          sourceId: "canvas-node:missing",
          targetId: "canvas-node:also-missing",
          updatedAt: 100,
        },
      ],
    } as unknown as CanvasWorkspaceDocument;
    command
      .mockResolvedValueOnce({ workspace: malformed })
      .mockResolvedValueOnce({ workspace: malformed })
      .mockResolvedValueOnce({ workspace: malformed });

    await expect(loadCanvasWorkspace(malformed.workspaceId)).rejects.toThrow("数据格式不兼容");
    await expect(createCanvasWorkspace("Malformed response")).rejects.toThrow("数据格式不兼容");
    await expect(
      renameCanvasWorkspace(malformed.workspaceId, "Malformed response"),
    ).rejects.toThrow("数据格式不兼容");
  });

  it("rejects malformed desktop command envelopes and mismatched workspace responses", async () => {
    const requestedId = "canvas:workspace-1";
    command
      .mockResolvedValueOnce({ extra: true, workspace: workspace() })
      .mockResolvedValueOnce({ workspace: workspace({ workspaceId: "canvas:other-load" }) })
      .mockResolvedValueOnce({ workspace: workspace({ workspaceId: "canvas:other-rename" }) });

    await expect(loadCanvasWorkspace(requestedId)).rejects.toThrow("白板响应数据格式不兼容");
    await expect(loadCanvasWorkspace(requestedId)).rejects.toThrow("返回的白板标识与请求不一致");
    await expect(renameCanvasWorkspace(requestedId, "Renamed")).rejects.toThrow(
      "返回的白板标识与请求不一致",
    );
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("checks malformed delete acknowledgements against the current workspace list", async () => {
    command
      .mockResolvedValueOnce({ deleted: 1 })
      .mockResolvedValueOnce({ workspaces: [summary(workspace())] });

    await expect(deleteCanvasWorkspace("canvas:workspace-1")).resolves.toBe(false);
    expect(command).toHaveBeenNthCalledWith(1, "canvas.deleteWorkspace", {
      workspaceId: "canvas:workspace-1",
    });
    expect(command).toHaveBeenNthCalledWith(2, "canvas.listWorkspaces", {});
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("keeps a possibly committed malformed deletion retired when verification finds it absent", async () => {
    const deletedId = "canvas:workspace-1";
    const remaining = workspace({ workspaceId: "canvas:workspace-2", name: "Remaining" });
    storage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, deletedId);
    command
      .mockResolvedValueOnce({ deleted: 1 })
      .mockResolvedValueOnce({ workspaces: [summary(remaining)] })
      .mockResolvedValueOnce({ workspaces: [summary(remaining)] });

    await expect(deleteCanvasWorkspace(deletedId)).resolves.toBe(true);
    expect(readLastCanvasWorkspaceId()).toBe(remaining.workspaceId);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps an unverifiable malformed deletion retired to prevent autosave resurrection", async () => {
    const deletedId = "canvas:workspace-1";
    command
      .mockResolvedValueOnce({ deleted: 1 })
      .mockRejectedValueOnce(new Error("verification unavailable"))
      .mockRejectedValueOnce(new Error("refresh unavailable"));

    await expect(deleteCanvasWorkspace(deletedId)).resolves.toBe(true);
    expect(command).toHaveBeenNthCalledWith(1, "canvas.deleteWorkspace", {
      workspaceId: deletedId,
    });
    expect(command).toHaveBeenNthCalledWith(2, "canvas.listWorkspaces", {});
    expect(command).toHaveBeenNthCalledWith(3, "canvas.listWorkspaces", {});
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps malformed save acknowledgements closed", async () => {
    command.mockResolvedValueOnce({ saved: false });

    await expect(saveCanvasWorkspace(workspace())).rejects.toThrow("白板响应数据格式不兼容");
    expect(command).toHaveBeenCalledWith("canvas.saveWorkspace", { document: workspace() });
    expect(dispatchEvent).not.toHaveBeenCalled();
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

  it("keeps a committed deletion successful when its workspace-list refresh is malformed", async () => {
    const deletedId = "canvas:workspace-1";
    storage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, deletedId);
    command.mockResolvedValueOnce({ deleted: true }).mockResolvedValueOnce({
      workspaces: [
        { ...summary(workspace({ workspaceId: "canvas:workspace-2" })), projectId: "leak" },
      ],
    });

    await expect(deleteCanvasWorkspace(deletedId)).resolves.toBe(true);
    expect(readLastCanvasWorkspaceId()).toBe(deletedId);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("does not request another command when the target workspace was already absent", async () => {
    command.mockResolvedValueOnce({ deleted: false });

    await expect(deleteCanvasWorkspace("canvas:missing")).resolves.toBe(false);
    expect(command).toHaveBeenCalledOnce();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("treats preview workspace ids as own null-prototype keys", async () => {
    isDesktopRuntime.mockReturnValue(false);
    const prototypeNamedWorkspace = workspace({
      name: "Prototype-safe preview",
      workspaceId: "__proto__",
    });
    storage.setItem(
      CANVAS_STORAGE_V2_KEY,
      JSON.stringify({
        activeWorkspaceId: "toString",
        version: 2,
        workspaces: { [prototypeNamedWorkspace.workspaceId]: prototypeNamedWorkspace },
      }),
    );

    expect(readLastCanvasWorkspaceId()).toBe(prototypeNamedWorkspace.workspaceId);
    await expect(loadCanvasWorkspace(prototypeNamedWorkspace.workspaceId)).resolves.toEqual(
      prototypeNamedWorkspace,
    );
    await expect(loadCanvasWorkspace("toString")).rejects.toThrow("白板不存在或已被删除");
    await expect(renameCanvasWorkspace("toString", "Wrong target")).rejects.toThrow(
      "白板不存在或已被删除",
    );
    await expect(deleteCanvasWorkspace("toString")).resolves.toBe(false);
    expect(() => rememberLastCanvasWorkspaceId("toString")).toThrow("白板不存在或已被删除");
    expect(command).not.toHaveBeenCalled();
  });

  it("does not decode malformed preview documents into local storage state", async () => {
    isDesktopRuntime.mockReturnValue(false);
    const malformed = {
      ...workspace(),
      viewport: { x: 0, y: 0, zoom: 0 },
    };
    const serialized = JSON.stringify({
      activeWorkspaceId: malformed.workspaceId,
      version: 2,
      workspaces: { [malformed.workspaceId]: malformed },
    });
    storage.setItem(CANVAS_STORAGE_V2_KEY, serialized);

    await expect(listCanvasWorkspaces()).rejects.toThrow("浏览器白板数据无法读取");
    expect(storage.getItem(CANVAS_STORAGE_V2_KEY)).toBe(serialized);
  });

  it("rejects malformed preview saves before changing local storage", async () => {
    isDesktopRuntime.mockReturnValue(false);
    const valid = workspace();
    const serialized = JSON.stringify({
      activeWorkspaceId: valid.workspaceId,
      version: 2,
      workspaces: { [valid.workspaceId]: valid },
    });
    storage.setItem(CANVAS_STORAGE_V2_KEY, serialized);
    const malformed = {
      ...valid,
      edges: [
        {
          createdAt: 100,
          id: "canvas-edge:missing-target",
          relationType: "supports",
          sourceId: "canvas-node:missing",
          targetId: "canvas-node:also-missing",
          updatedAt: 100,
        },
      ],
    } as unknown as CanvasWorkspaceDocument;

    await expect(saveCanvasWorkspace(malformed)).rejects.toThrow("数据格式不兼容");
    expect(storage.getItem(CANVAS_STORAGE_V2_KEY)).toBe(serialized);
  });
});
