import { beforeEach, describe, expect, it, vi } from "vitest";

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
    for (let index = 0; index < 5; index += 1) {
      command.mockResolvedValueOnce({ libraryId: "library-1" });
      command.mockResolvedValueOnce(undefined);
    }
    command.mockResolvedValueOnce({ libraryId: "library-1" });
    command.mockResolvedValueOnce(mergeResult);

    await setLibraryWorkStarred("work-1", true);
    await setLibraryWorkReadingStatus("work-1", "reading");
    await trashLibraryWorks(["work-1", "work-2"]);
    await restoreLibraryWorks(["work-2"]);
    await purgeLibraryWorks(["work-3"]);
    const result = await mergeLibraryWorks("work-1", ["work-2", "work-3"]);

    expect(command.mock.calls).toEqual([
      ["library.getScope", {}],
      ["library.setWorkStarred", { libraryId: "library-1", starred: true, workId: "work-1" }],
      ["library.getScope", {}],
      [
        "library.setWorkReadingStatus",
        { libraryId: "library-1", status: "reading", workId: "work-1" },
      ],
      ["library.getScope", {}],
      ["library.trashWorks", { libraryId: "library-1", workIds: ["work-1", "work-2"] }],
      ["library.getScope", {}],
      ["library.restoreWorks", { libraryId: "library-1", workIds: ["work-2"] }],
      ["library.getScope", {}],
      ["library.purgeDeletedWorks", { libraryId: "library-1", workIds: ["work-3"] }],
      ["library.getScope", {}],
      [
        "library.mergeWorks",
        {
          duplicateIds: ["work-2", "work-3"],
          libraryId: "library-1",
          primaryId: "work-1",
        },
      ],
    ]);
    expect(result).toBe(mergeResult);
  });

  it("propagates command failures to the page controller", async () => {
    command.mockResolvedValueOnce({ libraryId: "library-1" });
    command.mockRejectedValueOnce(new Error("command failed"));

    await expect(trashLibraryWorks(["work-1"])).rejects.toThrow("command failed");
  });
});
