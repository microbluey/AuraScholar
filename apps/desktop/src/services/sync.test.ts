import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportLibraryJson,
  importLibraryBackupJson,
  loadSyncSettings,
  runSync,
  saveSyncSettings,
} from "./sync";

interface MemoryLocalStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function memoryLocalStorage(values: Record<string, string> = {}): MemoryLocalStorage {
  const entries = new Map(Object.entries(values));
  return {
    getItem: (key) => entries.get(key) ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

describe("renderer sync command gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      aura: { data: { command } },
      localStorage: memoryLocalStorage(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adopts a valid legacy setting and removes localStorage only after success", async () => {
    const localStorage = memoryLocalStorage({
      "sync-settings": JSON.stringify({
        baseUrl: "https://dav.example.test/legacy///",
        password: "legacy-password",
        username: "alice",
      }),
    });
    vi.stubGlobal("window", { aura: { data: { command } }, localStorage });
    command.mockResolvedValue({
      baseUrl: "https://dav.example.test/legacy",
      hasPassword: true,
      username: "alice",
    });

    await expect(loadSyncSettings()).resolves.toEqual({
      baseUrl: "https://dav.example.test/legacy",
      hasPassword: true,
      username: "alice",
    });
    expect(command).toHaveBeenCalledWith("sync.adoptLegacySettings", {
      baseUrl: "https://dav.example.test/legacy",
      inlinePassword: "legacy-password",
      username: "alice",
    });
    expect(localStorage.getItem("sync-settings")).toBeNull();
  });

  it("keeps the legacy value when adoption fails", async () => {
    const raw = JSON.stringify({
      baseUrl: "https://dav.example.test/legacy",
      password: "legacy-password",
      username: "alice",
    });
    const localStorage = memoryLocalStorage({ "sync-settings": raw });
    vi.stubGlobal("window", { aura: { data: { command } }, localStorage });
    command.mockRejectedValue(new Error("main store unavailable"));

    await expect(loadSyncSettings()).rejects.toThrow("main store unavailable");
    expect(localStorage.getItem("sync-settings")).toBe(raw);
  });

  it("uses typed main commands without exposing a scope, segment, or stored password", async () => {
    command.mockImplementation(async (name: string) => {
      if (name === "sync.getSettings") {
        return {
          baseUrl: "https://dav.example.test/current",
          hasPassword: true,
          username: "alice",
        };
      }
      if (name === "sync.run") {
        return { appliedEntries: 0, conflicts: 0, pulledEntries: 0, pushedEntries: 0 };
      }
      if (name === "library.exportBackup") return { backupText: '{"version":4}' };
      if (name === "library.importBackup") return { imported: 1 };
      return {
        baseUrl: "https://dav.example.test/current",
        hasPassword: true,
        username: "alice",
      };
    });

    await expect(loadSyncSettings()).resolves.toEqual({
      baseUrl: "https://dav.example.test/current",
      hasPassword: true,
      username: "alice",
    });
    await saveSyncSettings({
      baseUrl: "https://dav.example.test/current",
      username: "alice",
    });
    await expect(runSync()).resolves.toEqual({
      appliedEntries: 0,
      conflicts: 0,
      pulledEntries: 0,
      pushedEntries: 0,
    });
    await expect(exportLibraryJson().then((blob) => blob.text())).resolves.toBe('{"version":4}');
    await expect(importLibraryBackupJson('{"version":4}')).resolves.toEqual({ imported: 1 });

    expect(command.mock.calls).toEqual([
      ["sync.getSettings", {}],
      ["sync.saveSettings", { baseUrl: "https://dav.example.test/current", username: "alice" }],
      ["sync.run", {}],
      ["library.exportBackup", {}],
      ["library.importBackup", { backupText: '{"version":4}' }],
    ]);
    expect(JSON.stringify(command.mock.calls)).not.toContain("applyRemoteSegment");
    expect(JSON.stringify(command.mock.calls)).not.toContain("libraryId");
    expect(JSON.stringify(command.mock.calls)).not.toContain("password");
  });
});
