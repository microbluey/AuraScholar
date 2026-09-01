import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveLibraryCommandScope,
  getActiveLibraryCommandScopeToken,
} from "./library-command-scope";

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

  it("decodes the main-owned opaque scope token", async () => {
    command.mockResolvedValueOnce({ libraryId: "library-1", scopeToken: "scope-1" });

    await expect(getActiveLibraryCommandScopeToken()).resolves.toEqual({
      libraryId: "library-1",
      scopeToken: "scope-1",
    });
  });

  it("fails closed on malformed scope-token responses", async () => {
    for (const value of [
      { libraryId: "library-1" },
      { libraryId: "library-1", scopeToken: "" },
      { libraryId: "library-1", scopeToken: "x".repeat(129) },
      { libraryId: "界".repeat(171), scopeToken: "scope-1" },
      { libraryId: "library-1", scopeToken: "界".repeat(65) },
      { libraryId: "library-1", scopeToken: "scope-1", extra: true },
    ]) {
      command.mockResolvedValueOnce(value);
      await expect(getActiveLibraryCommandScopeToken()).rejects.toThrow(
        "Library scope result is invalid",
      );
    }
  });
});
