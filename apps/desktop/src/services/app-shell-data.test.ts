import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLibraryShellStats, type LibraryShellStats } from "./app-shell-data";

describe("app shell data facade", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("loads one scoped App Shell snapshot through the typed command bridge", async () => {
    const result = {
      annotations: 7,
      canvasNodes: 9,
      collections: [
        {
          count: 3,
          id: "collection-1",
          name: "Methods",
          parentId: null,
          sortOrder: 1,
        },
      ],
      snippets: 4,
      total: 12,
      trash: 2,
    } satisfies LibraryShellStats;
    command.mockResolvedValueOnce(result);

    await expect(loadLibraryShellStats()).resolves.toBe(result);
    expect(command).toHaveBeenCalledWith("library.getShellStats", {});
  });

  it("preserves main-process shell read failures for the refresh boundary", async () => {
    const failure = new Error("read failed");
    command.mockRejectedValueOnce(failure);

    await expect(loadLibraryShellStats()).rejects.toBe(failure);
  });
});
