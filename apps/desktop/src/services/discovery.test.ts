import type { DiscoveryResult } from "@aurascholar/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markLibraryStatus, searchDiscoveryDetailed } from "./discovery";

const command = vi.fn();

const result: DiscoveryResult = {
  id: "crossref:10.1000/paper:0",
  score: 10,
  source: "crossref",
  work: {
    authors: [],
    doi: "10.1000/paper",
    source: "crossref",
    title: "Discovery paper",
    year: 2026,
  },
};

describe("discovery library status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { aura: { data: { command } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a typed active-work status without a PDF to full-text availability", async () => {
    command.mockResolvedValueOnce({ statuses: [{ hasPdf: false, workId: "work-1" }] });

    await expect(markLibraryStatus([result])).resolves.toEqual([
      expect.objectContaining({
        inLibrary: true,
        libraryWorkId: "work-1",
        needsFulltext: true,
      }),
    ]);
    expect(command).toHaveBeenCalledWith("discovery.getLibraryStatus", {
      probes: [expect.objectContaining({ doi: "10.1000/paper" })],
    });
  });

  it("runs public-source search through the cancellable semantic main command", async () => {
    command.mockResolvedValueOnce({
      report: {
        cursors: { openalex: { hasMore: false, page: 1 } },
        results: [],
        sources: { openalex: { count: 0, source: "openalex", status: "empty" } },
      },
    });

    await expect(
      searchDiscoveryDetailed({ text: "semantic command search" }, ["openalex"]),
    ).resolves.toMatchObject({ results: [] });

    expect(command).toHaveBeenCalledWith(
      "discovery.searchOpenSources",
      expect.objectContaining({
        limit: 20,
        query: { text: "semantic command search" },
        requestId: expect.any(String),
        sources: ["openalex"],
      }),
    );
  });

  it("maps an active PDF status from the typed command", async () => {
    command.mockResolvedValueOnce({ statuses: [{ hasPdf: true, workId: "work-1" }] });

    await expect(markLibraryStatus([result])).resolves.toEqual([
      expect.objectContaining({
        inLibrary: true,
        libraryWorkId: "work-1",
        needsFulltext: false,
      }),
    ]);
  });

  it("preserves unmatched result fields from the positional command mapping", async () => {
    command.mockResolvedValueOnce({ statuses: [{ hasPdf: false, workId: null }] });

    await expect(markLibraryStatus([result])).resolves.toEqual([
      expect.objectContaining({
        inLibrary: false,
        libraryWorkId: undefined,
        needsFulltext: undefined,
      }),
    ]);
  });

  it("returns early without Aura, including for an already-aborted request", async () => {
    vi.stubGlobal("window", {});
    const controller = new AbortController();
    controller.abort();

    await expect(markLibraryStatus([result], controller.signal)).resolves.toEqual([
      expect.objectContaining({ inLibrary: false, matchedSources: ["crossref"] }),
    ]);
    expect(command).not.toHaveBeenCalled();
  });

  it("honors an aborted desktop search before it dispatches status work", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(markLibraryStatus([result], controller.signal)).rejects.toThrow(/abort/i);
    expect(command).not.toHaveBeenCalled();
  });
});
