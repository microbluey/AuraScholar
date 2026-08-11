import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadLibraryPageData,
  loadLibraryWorkRuntimeMeta,
  type LibraryPageData,
  type WorkRuntimeMeta,
} from "./library-page-data";

describe("library page data facade", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("forwards the complete bounded page request over the typed command bridge", async () => {
    const result = {
      browseSummary: {
        availableSources: ["Journal"],
        availableTags: ["causal"],
        baseTotal: 1,
        notedTotal: 0,
        readingTotal: 0,
        starredTotal: 0,
        unreadTotal: 1,
        withPdfTotal: 1,
        withoutPdfTotal: 0,
      },
      collections: [],
      limit: 30,
      offset: 30,
      total: 31,
      trashCount: 2,
      workMeta: {},
      works: [],
    } satisfies LibraryPageData;
    const input = {
      collectionId: "collection-1",
      extraFilter: "with-pdf" as const,
      filter: "reading" as const,
      focusWorkId: "work-31",
      limit: 30,
      offset: 30,
      search: "causal graphs",
      showTrash: false,
      sort: "year" as const,
      source: "Journal",
      status: "reading" as const,
      tag: "causal",
    };
    command.mockResolvedValueOnce(result);

    await expect(loadLibraryPageData(input)).resolves.toBe(result);
    expect(command).toHaveBeenCalledWith("library.getPage", input);
  });

  it("loads selected-work runtime metadata through its own typed command", async () => {
    const result = {
      annotationCount: 7,
      notePreviews: [],
      pdfCount: 1,
      pdfPreview: null,
      sentinelState: "published",
      sentinelStatus: "active",
      sentinelTaskCount: 2,
    } satisfies WorkRuntimeMeta;
    command.mockResolvedValueOnce(result);

    await expect(loadLibraryWorkRuntimeMeta("work-1", 7)).resolves.toBe(result);
    expect(command).toHaveBeenCalledWith("library.getWorkRuntimeMeta", {
      annotationCount: 7,
      workId: "work-1",
    });
  });

  it("preserves main-process command failures for the page controller", async () => {
    command.mockRejectedValueOnce(new Error("page query failed"));

    await expect(loadLibraryPageData({ limit: 30 })).rejects.toThrow("page query failed");
  });
});
