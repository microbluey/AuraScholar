import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveLibraryCommandScope } from "./library-command-scope";

describe("Library command scope facade", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("derives the active Library through the typed command bridge", async () => {
    command.mockResolvedValueOnce({ libraryId: "library-1" });

    await expect(getActiveLibraryCommandScope()).resolves.toBe("library-1");
    expect(command).toHaveBeenCalledWith("library.getScope", {});
  });

  it("preserves scope discovery failures for mutation callers", async () => {
    command.mockRejectedValueOnce(new Error("scope unavailable"));

    await expect(getActiveLibraryCommandScope()).rejects.toThrow("scope unavailable");
  });
});
