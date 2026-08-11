import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addLibraryTagToWorks,
  createLibraryCollection,
  createLibraryTag,
  deleteLibraryCollection,
  deleteLibraryTag,
  listLibraryTags,
  moveLibraryCollection,
  renameLibraryCollection,
  renameLibraryTag,
  restoreLibraryCollection,
  restoreLibraryTag,
  setLibraryTagColor,
  setWorksLibraryCollection,
} from "./library-organization";

describe("Library organization command gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    command.mockImplementation(async (name: string) => {
      if (name === "library.getScope") return { libraryId: "library-1" };
      if (name === "library.listTags") {
        return {
          tags: [{ color: "blue", count: 2, id: "tag-1", name: "Evidence" }],
        };
      }
      if (name === "library.createCollection") return { collectionId: "collection-1" };
      if (name === "library.deleteCollection") return { workIds: ["work-1"] };
      if (name === "library.restoreCollection") {
        return { restoredWorkIds: ["work-1"], skippedWorkIds: [] };
      }
      if (name === "library.setWorksCollection") return { updated: 2 };
      if (name === "library.createTag" || name === "library.renameTag") {
        return { tagId: "tag-1", updated: 1 };
      }
      if (name === "library.deleteTag") return { workIds: ["work-2"] };
      if (name === "library.restoreTag") return { tagId: "tag-1", updated: 3 };
      if (name === "library.addTagToWorks") return { tagId: "tag-2", updated: 2 };
      return { updated: 1 };
    });
  });

  it("lists tag summaries through the typed command bridge", async () => {
    await expect(listLibraryTags()).resolves.toEqual([
      { color: "blue", count: 2, id: "tag-1", name: "Evidence" },
    ]);
    expect(command).toHaveBeenCalledWith("library.listTags", {});
  });

  it("derives a typed scope before every organization mutation", async () => {
    await expect(createLibraryCollection("Methods")).resolves.toBe("collection-1");
    await expect(renameLibraryCollection("collection-1", "Methods 2")).resolves.toBeUndefined();
    await expect(moveLibraryCollection("collection-1", null, 2)).resolves.toBeUndefined();
    await expect(deleteLibraryCollection("collection-1")).resolves.toEqual({ workIds: ["work-1"] });
    await expect(restoreLibraryCollection("collection-1", ["work-1"])).resolves.toEqual({
      restoredWorkIds: ["work-1"],
      skippedWorkIds: [],
    });
    await expect(setWorksLibraryCollection(["work-1", "work-2"], "collection-1")).resolves.toBe(2);
    await expect(createLibraryTag("Evidence", "blue")).resolves.toBe("tag-1");
    await expect(renameLibraryTag("tag-1", "Evidence 2")).resolves.toBe("tag-1");
    await expect(setLibraryTagColor("tag-1", null)).resolves.toBeUndefined();
    await expect(deleteLibraryTag("tag-1")).resolves.toEqual({ workIds: ["work-2"] });
    await expect(restoreLibraryTag("tag-1", ["work-2"])).resolves.toBe(3);
    await expect(addLibraryTagToWorks(["work-1", "work-2"], "Review")).resolves.toEqual({
      tagId: "tag-2",
      updated: 2,
    });

    expect(command.mock.calls).toEqual([
      ["library.getScope", {}],
      ["library.createCollection", { libraryId: "library-1", name: "Methods", parentId: null }],
      ["library.getScope", {}],
      [
        "library.renameCollection",
        { collectionId: "collection-1", libraryId: "library-1", name: "Methods 2" },
      ],
      ["library.getScope", {}],
      [
        "library.moveCollection",
        { collectionId: "collection-1", libraryId: "library-1", parentId: null, position: 2 },
      ],
      ["library.getScope", {}],
      ["library.deleteCollection", { collectionId: "collection-1", libraryId: "library-1" }],
      ["library.getScope", {}],
      [
        "library.restoreCollection",
        { collectionId: "collection-1", libraryId: "library-1", workIds: ["work-1"] },
      ],
      ["library.getScope", {}],
      [
        "library.setWorksCollection",
        { collectionId: "collection-1", libraryId: "library-1", workIds: ["work-1", "work-2"] },
      ],
      ["library.getScope", {}],
      ["library.createTag", { color: "blue", libraryId: "library-1", name: "Evidence" }],
      ["library.getScope", {}],
      ["library.renameTag", { libraryId: "library-1", name: "Evidence 2", tagId: "tag-1" }],
      ["library.getScope", {}],
      ["library.setTagColor", { color: null, libraryId: "library-1", tagId: "tag-1" }],
      ["library.getScope", {}],
      ["library.deleteTag", { libraryId: "library-1", tagId: "tag-1" }],
      ["library.getScope", {}],
      ["library.restoreTag", { libraryId: "library-1", tagId: "tag-1", workIds: ["work-2"] }],
      ["library.getScope", {}],
      [
        "library.addTagToWorks",
        { libraryId: "library-1", name: "Review", workIds: ["work-1", "work-2"] },
      ],
    ]);
  });

  it("stops before a mutation when typed scope discovery fails", async () => {
    command.mockReset();
    command.mockRejectedValueOnce(new Error("scope unavailable"));

    await expect(createLibraryTag("Evidence")).rejects.toThrow("scope unavailable");
    expect(command).toHaveBeenCalledWith("library.getScope", {});
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("preserves tag-list read failures for the manager retry boundary", async () => {
    command.mockReset();
    command.mockRejectedValueOnce(new Error("tags unavailable"));

    await expect(listLibraryTags()).rejects.toThrow("tags unavailable");
  });
});
