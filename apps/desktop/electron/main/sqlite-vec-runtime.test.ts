import { describe, expect, it, vi } from "vitest";
import { loadSqliteVecExtension, resolveSqliteVecLoadablePath } from "./sqlite-vec-runtime";

describe("sqlite-vec main-process runtime", () => {
  it("uses the unpacked native path in a packaged Electron application", () => {
    expect(
      resolveSqliteVecLoadablePath(
        "/Applications/AuraScholar.app/Contents/Resources/app.asar/node_modules/sqlite-vec-darwin-arm64/vec0.dylib",
        true,
      ),
    ).toBe(
      "/Applications/AuraScholar.app/Contents/Resources/app.asar.unpacked/node_modules/sqlite-vec-darwin-arm64/vec0.dylib",
    );
    expect(resolveSqliteVecLoadablePath("C:\\app.asar\\vec0.dll", false)).toBe(
      "C:\\app.asar\\vec0.dll",
    );
  });

  it("loads and verifies the extension without exposing a local filesystem path", async () => {
    const loadExtension = vi.fn<DatabaseLoader>();
    const queryScalar = vi.fn().mockResolvedValue("v0.1.7-alpha.10");

    await expect(
      loadSqliteVecExtension(
        { loadExtension, queryScalar },
        {
          getLoadablePath: () => "/tmp/app.asar/node_modules/sqlite-vec-darwin-arm64/vec0.dylib",
          isPackaged: true,
        },
      ),
    ).resolves.toEqual({ state: "available", version: "v0.1.7-alpha.10" });
    expect(loadExtension).toHaveBeenCalledWith(
      "/tmp/app.asar.unpacked/node_modules/sqlite-vec-darwin-arm64/vec0.dylib",
    );
    expect(queryScalar).toHaveBeenCalledWith("SELECT vec_version() AS version");
  });

  it("fails closed when the driver cannot load native extensions", async () => {
    await expect(
      loadSqliteVecExtension(
        { queryScalar: vi.fn() },
        { getLoadablePath: () => "/tmp/vec0.dylib", isPackaged: false },
      ),
    ).resolves.toEqual({ reason: "extension-loader-unavailable", state: "unavailable" });

    await expect(
      loadSqliteVecExtension(
        {
          loadExtension: async () => {
            throw new Error("/private/secret/path/vec0.dylib failed");
          },
          queryScalar: vi.fn(),
        },
        { getLoadablePath: () => "/tmp/vec0.dylib", isPackaged: false },
      ),
    ).resolves.toEqual({ reason: "extension-load-failed", state: "unavailable" });
  });
});

type DatabaseLoader = (path: string) => Promise<void>;
