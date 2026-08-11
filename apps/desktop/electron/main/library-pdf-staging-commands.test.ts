import { describe, expect, it, vi } from "vitest";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";

const STAGE_ID = "s".repeat(43);

describe("library PDF staging data commands", () => {
  it("routes raw bytes only to the main-owned stager without acquiring a database transaction", async () => {
    const stagePdf = vi.fn().mockResolvedValue({
      byteSize: 4,
      sha: "a".repeat(64),
      stageId: STAGE_ID,
    });
    const dependencies: DataCommandDependencies = {
      stagePdf,
      async transaction() {
        throw new Error("stage command must not acquire a database transaction");
      },
    };
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await expect(
      executeDataCommand({ input: { bytes }, name: "library.stagePdf" }, dependencies),
    ).resolves.toEqual({ byteSize: 4, sha: "a".repeat(64), stageId: STAGE_ID });
    expect(stagePdf).toHaveBeenCalledWith(bytes);
  });

  it("rejects malformed staging input before the stager is called", async () => {
    const stagePdf = vi.fn();
    const dependencies: DataCommandDependencies = {
      stagePdf,
      async transaction() {
        throw new Error("malformed staging input must not acquire a database transaction");
      },
    };

    for (const input of [null, {}, { bytes: [] }, { bytes: new Uint8Array([1]), extra: true }]) {
      await expect(
        executeDataCommand({ input, name: "library.stagePdf" }, dependencies),
      ).rejects.toThrow();
    }
    expect(stagePdf).not.toHaveBeenCalled();
  });

  it("passes an opaque release capability through without the command dispatcher opening a lease", async () => {
    const releaseStagedPdf = vi.fn().mockReturnValue(true);
    const dependencies: DataCommandDependencies = {
      releaseStagedPdf,
      async transaction() {
        throw new Error("release dispatcher must not acquire a database transaction");
      },
    };

    await expect(
      executeDataCommand(
        { input: { stageId: STAGE_ID }, name: "library.releaseStagedPdf" },
        dependencies,
      ),
    ).resolves.toEqual({ released: true });
    expect(releaseStagedPdf).toHaveBeenCalledWith(STAGE_ID);
  });
});
