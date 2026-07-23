import { CANVAS_SCHEMA_VERSION, type CanvasWorkspaceDocument } from "@aurascholar/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { CANVAS_LAST_WORKSPACE_ID_KEY, CANVAS_STORAGE_KEY, CANVAS_STORAGE_V2_KEY } from "./model";

vi.mock("../../services/aura-platform", () => ({ isDesktopRuntime: () => false }));

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

function legacyWorkspace(): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "canvas:legacy",
    name: "既有研究白板",
    description: "必须在迁移后保留",
    viewport: { x: 32, y: -18, zoom: 0.8 },
    nodes: [],
    edges: [],
    createdAt: 100,
    updatedAt: 200,
  };
}

beforeEach(() => {
  const localStorage = new MemoryStorage();
  vi.stubGlobal("window", {
    localStorage,
    dispatchEvent: vi.fn(),
  });
});

describe("browser preview canvas persistence", () => {
  it("migrates the v1 document into the v2 multi-workspace envelope without data loss", async () => {
    const legacy = legacyWorkspace();
    window.localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(legacy));

    await expect(listCanvasWorkspaces()).resolves.toEqual([
      {
        schemaVersion: legacy.schemaVersion,
        workspaceId: legacy.workspaceId,
        name: legacy.name,
        description: legacy.description,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
      },
    ]);
    await expect(loadCanvasWorkspace(legacy.workspaceId)).resolves.toEqual(legacy);
    expect(readLastCanvasWorkspaceId()).toBe(legacy.workspaceId);

    const migrated = JSON.parse(window.localStorage.getItem(CANVAS_STORAGE_V2_KEY) ?? "null") as {
      activeWorkspaceId: string;
      version: number;
      workspaces: Record<string, CanvasWorkspaceDocument>;
    };
    expect(migrated.version).toBe(2);
    expect(migrated.activeWorkspaceId).toBe(legacy.workspaceId);
    expect(migrated.workspaces[legacy.workspaceId]).toEqual(legacy);
  });

  it("rejects corrupt v2 storage without overwriting it or falling back to v1", async () => {
    const corruptV2 = JSON.stringify({
      version: 2,
      activeWorkspaceId: "canvas:broken",
      workspaces: [],
    });
    window.localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(legacyWorkspace()));
    window.localStorage.setItem(CANVAS_STORAGE_V2_KEY, corruptV2);

    await expect(listCanvasWorkspaces()).rejects.toThrow("浏览器白板数据无法读取");
    await expect(loadCanvasWorkspace("canvas:legacy")).rejects.toThrow("浏览器白板数据无法读取");
    expect(window.localStorage.getItem(CANVAS_STORAGE_V2_KEY)).toBe(corruptV2);
  });

  it("creates, renames, selects, saves, and deletes isolated workspaces", async () => {
    const [initial] = await listCanvasWorkspaces();
    expect(initial).toBeDefined();
    const initialDocument = await loadCanvasWorkspace(initial!.workspaceId);

    const created = await createCanvasWorkspace("  方法论比较  ");
    expect(created.name).toBe("方法论比较");
    expect(readLastCanvasWorkspaceId()).toBe(created.workspaceId);
    expect(window.localStorage.getItem(CANVAS_LAST_WORKSPACE_ID_KEY)).toBe(created.workspaceId);

    const renamed = await renameCanvasWorkspace(created.workspaceId, "  因果推断  ");
    expect(renamed.name).toBe("因果推断");
    await expect(renameCanvasWorkspace(created.workspaceId, "  ")).rejects.toThrow(
      "白板名称不能为空",
    );

    rememberLastCanvasWorkspaceId(initial!.workspaceId);
    expect(readLastCanvasWorkspaceId()).toBe(initial!.workspaceId);

    await saveCanvasWorkspace({
      ...renamed,
      description: "第二个白板的独立数据",
      viewport: { x: 120, y: -45, zoom: 1.25 },
    });
    await expect(loadCanvasWorkspace(created.workspaceId)).resolves.toMatchObject({
      description: "第二个白板的独立数据",
      viewport: { x: 120, y: -45, zoom: 1.25 },
    });
    await expect(loadCanvasWorkspace(initial!.workspaceId)).resolves.toEqual(initialDocument);
    expect(await listCanvasWorkspaces()).toHaveLength(2);

    await expect(deleteCanvasWorkspace(created.workspaceId)).resolves.toBe(true);
    await expect(loadCanvasWorkspace(created.workspaceId)).rejects.toThrow("白板不存在");
    await expect(deleteCanvasWorkspace(initial!.workspaceId)).rejects.toThrow(
      "至少需要保留一个白板",
    );
  });

  it("falls back to the newest remaining workspace when the active workspace is deleted", async () => {
    const [initial] = await listCanvasWorkspaces();
    const older = await createCanvasWorkspace("旧项目");
    const newer = await createCanvasWorkspace("新项目");
    await saveCanvasWorkspace({ ...newer, updatedAt: newer.updatedAt + 10_000 });

    rememberLastCanvasWorkspaceId(older.workspaceId);
    expect(readLastCanvasWorkspaceId()).toBe(older.workspaceId);

    await expect(deleteCanvasWorkspace(older.workspaceId)).resolves.toBe(true);
    expect(readLastCanvasWorkspaceId()).toBe(newer.workspaceId);
    expect(window.localStorage.getItem(CANVAS_LAST_WORKSPACE_ID_KEY)).toBe(newer.workspaceId);
    await expect(loadCanvasWorkspace(newer.workspaceId)).resolves.toMatchObject({
      name: "新项目",
    });
    await expect(loadCanvasWorkspace(initial!.workspaceId)).resolves.toBeDefined();
  });

  it("keeps the remembered workspace when a different workspace is deleted", async () => {
    const [initial] = await listCanvasWorkspaces();
    const removable = await createCanvasWorkspace("临时白板");
    rememberLastCanvasWorkspaceId(initial!.workspaceId);

    await expect(deleteCanvasWorkspace(removable.workspaceId)).resolves.toBe(true);
    expect(readLastCanvasWorkspaceId()).toBe(initial!.workspaceId);
  });

  it("rejects invalid workspace identifiers and leaves storage unchanged", async () => {
    const before = await listCanvasWorkspaces();

    await expect(loadCanvasWorkspace("missing-workspace")).rejects.toThrow("白板不存在");
    await expect(renameCanvasWorkspace("missing-workspace", "新名称")).rejects.toThrow(
      "白板不存在",
    );
    await expect(createCanvasWorkspace("  ")).rejects.toThrow("白板名称不能为空");
    expect(await deleteCanvasWorkspace("missing-workspace")).toBe(false);
    expect(() => rememberLastCanvasWorkspaceId("missing-workspace")).toThrow("白板不存在");

    await expect(listCanvasWorkspaces()).resolves.toEqual(before);
  });
});
