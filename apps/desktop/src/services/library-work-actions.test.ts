import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLibraryDb: vi.fn(),
}));

vi.mock("./aura-db", () => ({
  getLibraryDb: mocks.getLibraryDb,
}));

import {
  mergeLibraryWorks,
  purgeLibraryWorks,
  restoreLibraryWorks,
  setLibraryWorkReadingStatus,
  setLibraryWorkStarred,
  trashLibraryWorks,
} from "./library-work-actions";

describe("library work actions", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLibraryDb.mockResolvedValue({ libraryId: "library-1" });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("forwards the active Library scope and typed command payloads", async () => {
    const mergeResult = {
      merged: 2,
      movedAttachments: 1,
      primaryId: "work-1",
    };
    command.mockResolvedValueOnce(undefined);
    command.mockResolvedValueOnce(undefined);
    command.mockResolvedValueOnce(undefined);
    command.mockResolvedValueOnce(undefined);
    command.mockResolvedValueOnce(undefined);
    command.mockResolvedValueOnce(mergeResult);

    await setLibraryWorkStarred("work-1", true);
    await setLibraryWorkReadingStatus("work-1", "reading");
    await trashLibraryWorks(["work-1", "work-2"]);
    await restoreLibraryWorks(["work-2"]);
    await purgeLibraryWorks(["work-3"]);
    const result = await mergeLibraryWorks("work-1", ["work-2", "work-3"]);

    expect(command.mock.calls).toEqual([
      ["library.setWorkStarred", { libraryId: "library-1", starred: true, workId: "work-1" }],
      [
        "library.setWorkReadingStatus",
        { libraryId: "library-1", status: "reading", workId: "work-1" },
      ],
      ["library.trashWorks", { libraryId: "library-1", workIds: ["work-1", "work-2"] }],
      ["library.restoreWorks", { libraryId: "library-1", workIds: ["work-2"] }],
      ["library.purgeDeletedWorks", { libraryId: "library-1", workIds: ["work-3"] }],
      [
        "library.mergeWorks",
        {
          duplicateIds: ["work-2", "work-3"],
          libraryId: "library-1",
          primaryId: "work-1",
        },
      ],
    ]);
    expect(mocks.getLibraryDb).toHaveBeenCalledTimes(6);
    expect(result).toBe(mergeResult);
  });

  it("propagates command failures to the page controller", async () => {
    command.mockRejectedValueOnce(new Error("command failed"));

    await expect(trashLibraryWorks(["work-1"])).rejects.toThrow("command failed");
  });
});
