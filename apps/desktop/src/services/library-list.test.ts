import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listWorks,
  searchWorksByMetadata,
  type LibraryListWork,
  type LibraryMetadataSearchWork,
} from "./library-list";

describe("library list data facade", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("loads a bounded recent-work DTO through the typed command bridge", async () => {
    const work = {
      abstract: null,
      authorNames: ["Ada Lovelace"],
      createdAt: 2_000,
      doi: "10.1000/example",
      id: "work-1",
      readingStatus: "reading",
      starred: true,
      title: "Scoped work",
      venueName: "Journal",
      year: 2026,
    } satisfies LibraryListWork;
    command.mockResolvedValueOnce({ works: [work] });

    await expect(listWorks(500)).resolves.toEqual([work]);
    expect(command).toHaveBeenCalledWith("library.listWorks", { limit: 500 });
  });

  it("keeps an omitted list limit out of the IPC request", async () => {
    command.mockResolvedValueOnce({ works: [] });

    await expect(listWorks()).resolves.toEqual([]);
    expect(command).toHaveBeenCalledWith("library.listWorks", {});
  });

  it("searches metadata through its separate command and preserves failures", async () => {
    const work = {
      abstract: "Searchable abstract",
      authorNames: ["Katherine Johnson"],
      createdAt: 1_000,
      doi: null,
      id: "work-2",
      readingStatus: "unread",
      starred: false,
      tagNames: ["Methods"],
      title: "Searchable work",
      venueName: null,
      year: null,
    } satisfies LibraryMetadataSearchWork;
    command.mockResolvedValueOnce({ works: [work] });

    await expect(searchWorksByMetadata("Katherine", 40)).resolves.toEqual([work]);
    expect(command).toHaveBeenCalledWith("library.searchWorksByMetadata", {
      limit: 40,
      search: "Katherine",
    });

    command.mockRejectedValueOnce(new Error("metadata unavailable"));
    await expect(searchWorksByMetadata("Methods")).rejects.toThrow("metadata unavailable");
  });
});
