import { CANVAS_SCHEMA_VERSION, type CanvasWorkspaceDocument } from "@aurascholar/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canvasUtf8ByteLength,
  MAX_CANVAS_JSON_TEXT_BYTES,
  MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
} from "../../shared/canvas-workspace-document-limits";
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
import {
  MAX_CANVAS_PREVIEW_ENVELOPE_BYTES,
  MAX_CANVAS_PREVIEW_WORKSPACES,
} from "./preview-storage-limits";

vi.mock("../../services/aura-platform", () => ({ isDesktopRuntime: () => false }));

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  private failingSetKey: string | null = null;

  failNextSetFor(key: string): void {
    this.failingSetKey = key;
  }

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
    if (this.failingSetKey === key) {
      this.failingSetKey = null;
      throw new Error(`forced storage failure for ${key}`);
    }
    this.values.set(key, value);
  }
}

let memoryStorage: MemoryStorage;

function legacyWorkspace(
  overrides: Partial<CanvasWorkspaceDocument> = {},
): CanvasWorkspaceDocument {
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
    ...overrides,
  };
}

function previewEnvelopeRaw(
  workspaces: Record<string, unknown>,
  activeWorkspaceId: string,
): string {
  return JSON.stringify({ activeWorkspaceId, version: 2, workspaces });
}

function padPreviewRawToBytes(raw: string, bytes: number): string {
  const padding = bytes - canvasUtf8ByteLength(raw);
  if (padding < 0) throw new Error("Preview test fixture exceeds its target byte size");
  return `${raw}${" ".repeat(padding)}`;
}

function largePreviewWorkspace(workspaceId: string): CanvasWorkspaceDocument {
  const markdown = "x".repeat(MAX_CANVAS_JSON_TEXT_BYTES);
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId,
    name: "Large preview workspace",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: Array.from({ length: 6 }, (_, index) => ({
      id: `${workspaceId}:note-${index}`,
      type: "idea-note" as const,
      position: { x: index, y: 0 },
      dimensions: { width: 320, height: 200 },
      tags: [],
      createdAt: index,
      updatedAt: index,
      data: { contentMarkdown: markdown, hasEquations: false },
    })),
    edges: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  memoryStorage = new MemoryStorage();
  vi.stubGlobal("window", {
    localStorage: memoryStorage,
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

  it("accepts a valid v2 raw value at the exact preview storage byte limit", async () => {
    const workspace = legacyWorkspace();
    const raw = padPreviewRawToBytes(
      previewEnvelopeRaw({ [workspace.workspaceId]: workspace }, workspace.workspaceId),
      MAX_CANVAS_PREVIEW_ENVELOPE_BYTES,
    );
    expect(canvasUtf8ByteLength(raw)).toBe(MAX_CANVAS_PREVIEW_ENVELOPE_BYTES);
    window.localStorage.setItem(CANVAS_STORAGE_V2_KEY, raw);

    await expect(listCanvasWorkspaces()).resolves.toEqual([
      expect.objectContaining({ workspaceId: workspace.workspaceId }),
    ]);
  });

  it("rejects an oversized Unicode v2 raw value before parsing or falling back", async () => {
    const oversized = "你".repeat(Math.floor(MAX_CANVAS_PREVIEW_ENVELOPE_BYTES / 3) + 1);
    const legacyRaw = JSON.stringify(legacyWorkspace());
    window.localStorage.setItem(CANVAS_STORAGE_KEY, legacyRaw);
    window.localStorage.setItem(CANVAS_STORAGE_V2_KEY, oversized);
    window.localStorage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, "canvas:sentinel");
    const parse = vi.spyOn(JSON, "parse");

    await expect(listCanvasWorkspaces()).rejects.toThrow("浏览器白板数据无法读取");
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(window.localStorage.getItem(CANVAS_STORAGE_V2_KEY)).toBe(oversized);
    expect(window.localStorage.getItem(CANVAS_STORAGE_KEY)).toBe(legacyRaw);
    expect(window.localStorage.getItem(CANVAS_LAST_WORKSPACE_ID_KEY)).toBe("canvas:sentinel");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it("rejects too many v2 workspaces before decoding individual documents", async () => {
    const workspaces = Object.fromEntries(
      Array.from({ length: MAX_CANVAS_PREVIEW_WORKSPACES + 1 }, (_, index) => [
        `canvas:workspace-${index}`,
        {},
      ]),
    );
    const raw = previewEnvelopeRaw(workspaces, "canvas:workspace-0");
    window.localStorage.setItem(CANVAS_STORAGE_V2_KEY, raw);
    window.localStorage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, "canvas:sentinel");

    await expect(listCanvasWorkspaces()).rejects.toThrow("最多只能保存");
    expect(window.localStorage.getItem(CANVAS_STORAGE_V2_KEY)).toBe(raw);
    expect(window.localStorage.getItem(CANVAS_LAST_WORKSPACE_ID_KEY)).toBe("canvas:sentinel");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it("keeps create and save atomic once the preview workspace limit is reached", async () => {
    const workspaces = Object.fromEntries(
      Array.from({ length: MAX_CANVAS_PREVIEW_WORKSPACES }, (_, index) => {
        const workspaceId = `canvas:workspace-${index}`;
        return [workspaceId, legacyWorkspace({ workspaceId })];
      }),
    );
    window.localStorage.setItem(
      CANVAS_STORAGE_V2_KEY,
      previewEnvelopeRaw(workspaces, "canvas:workspace-0"),
    );
    window.localStorage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, "canvas:sentinel");
    await expect(listCanvasWorkspaces()).resolves.toHaveLength(MAX_CANVAS_PREVIEW_WORKSPACES);
    const snapshot = window.localStorage.getItem(CANVAS_STORAGE_V2_KEY);
    vi.mocked(window.dispatchEvent).mockClear();

    await expect(createCanvasWorkspace("One too many")).rejects.toThrow("最多只能保存");
    await expect(
      saveCanvasWorkspace(legacyWorkspace({ workspaceId: "canvas:workspace-new" })),
    ).rejects.toThrow("最多只能保存");
    expect(window.localStorage.getItem(CANVAS_STORAGE_V2_KEY)).toBe(snapshot);
    expect(window.localStorage.getItem(CANVAS_LAST_WORKSPACE_ID_KEY)).toBe("canvas:sentinel");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it("preflights the complete preview envelope before an aggregate-overflow save", async () => {
    const first = largePreviewWorkspace("canvas:large-one");
    const second = largePreviewWorkspace("canvas:large-two");
    const third = largePreviewWorkspace("canvas:large-three");
    expect(canvasUtf8ByteLength(JSON.stringify(first))).toBeLessThanOrEqual(
      MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES,
    );
    window.localStorage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, "canvas:sentinel");

    await saveCanvasWorkspace(first);
    await saveCanvasWorkspace(second);
    const snapshot = window.localStorage.getItem(CANVAS_STORAGE_V2_KEY);
    vi.mocked(window.dispatchEvent).mockClear();

    await expect(saveCanvasWorkspace(third)).rejects.toThrow("Canvas preview storage is limited");
    expect(window.localStorage.getItem(CANVAS_STORAGE_V2_KEY)).toBe(snapshot);
    expect(window.localStorage.getItem(CANVAS_LAST_WORKSPACE_ID_KEY)).toBe("canvas:sentinel");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
    expect(JSON.parse(snapshot ?? "{}").workspaces[third.workspaceId]).toBeUndefined();
  });

  it("fails closed for empty v2 and v1 values instead of overwriting existing storage", async () => {
    const legacyRaw = JSON.stringify(legacyWorkspace());
    window.localStorage.setItem(CANVAS_STORAGE_KEY, legacyRaw);
    window.localStorage.setItem(CANVAS_STORAGE_V2_KEY, "");

    await expect(listCanvasWorkspaces()).rejects.toThrow("浏览器白板数据无法读取");
    expect(window.localStorage.getItem(CANVAS_STORAGE_V2_KEY)).toBe("");
    expect(window.localStorage.getItem(CANVAS_STORAGE_KEY)).toBe(legacyRaw);

    memoryStorage.clear();
    window.localStorage.setItem(CANVAS_STORAGE_KEY, "");
    await expect(listCanvasWorkspaces()).rejects.toThrow("浏览器白板数据无法读取");
    expect(window.localStorage.getItem(CANVAS_STORAGE_V2_KEY)).toBeNull();
    expect(window.localStorage.getItem(CANVAS_STORAGE_KEY)).toBe("");
  });

  it("does not migrate an oversized legacy raw value into a new default workspace", async () => {
    const oversized = "你".repeat(Math.floor(MAX_CANVAS_PREVIEW_ENVELOPE_BYTES / 3) + 1);
    window.localStorage.setItem(CANVAS_STORAGE_KEY, oversized);
    window.localStorage.setItem(CANVAS_LAST_WORKSPACE_ID_KEY, "canvas:sentinel");
    const parse = vi.spyOn(JSON, "parse");

    await expect(listCanvasWorkspaces()).rejects.toThrow("浏览器白板数据无法读取");
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(window.localStorage.getItem(CANVAS_STORAGE_KEY)).toBe(oversized);
    expect(window.localStorage.getItem(CANVAS_STORAGE_V2_KEY)).toBeNull();
    expect(window.localStorage.getItem(CANVAS_LAST_WORKSPACE_ID_KEY)).toBe("canvas:sentinel");
    expect(window.dispatchEvent).not.toHaveBeenCalled();
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

  it("does not reject or recreate a workspace when auxiliary state fails after deletion commits", async () => {
    const [initial] = await listCanvasWorkspaces();
    const removable = await createCanvasWorkspace("提交后故障测试");
    vi.mocked(window.dispatchEvent).mockClear();
    memoryStorage.failNextSetFor(CANVAS_LAST_WORKSPACE_ID_KEY);

    await expect(deleteCanvasWorkspace(removable.workspaceId)).resolves.toBe(true);
    await expect(loadCanvasWorkspace(removable.workspaceId)).rejects.toThrow("白板不存在");
    await expect(listCanvasWorkspaces()).resolves.toEqual([
      expect.objectContaining({ workspaceId: initial!.workspaceId }),
    ]);
    expect(window.dispatchEvent).toHaveBeenCalled();
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
