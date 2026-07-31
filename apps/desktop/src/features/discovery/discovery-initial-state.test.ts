import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryResultWithLibrary } from "../../services/discovery";
import {
  createDiscoveryInitialState,
  previewDiscoverySourceStatus,
} from "./discovery-initial-state";

const sources = ["openalex", "crossref", "s2", "arxiv"] as const;
const previewResult: DiscoveryResultWithLibrary = {
  id: "preview-1",
  inLibrary: false,
  matchedSources: ["openalex"],
  score: 1,
  source: "openalex",
  work: { authors: [], source: "openalex", title: "Preview result" },
};

afterEach(() => vi.unstubAllGlobals());

describe("discovery initial state", () => {
  it("starts browser preview with sample results and source status", () => {
    vi.stubGlobal("window", { location: { hash: "#/discovery" } });

    expect(
      createDiscoveryInitialState({
        allSources: sources,
        previewQuery: "preview query",
        previewResults: [previewResult],
      }),
    ).toMatchObject({
      mode: "opensource",
      pendingTask: null,
      query: "preview query",
      results: [previewResult],
      selectedId: "preview-1",
      sourceStatus: previewDiscoverySourceStatus(sources),
    });
  });

  it("lets a full-text handoff replace preview state without opening it yet", () => {
    vi.stubGlobal("window", {
      aura: {},
      location: {
        hash:
          "#/discovery?pendingWorkId=work-1&pendingTitle=Target+paper" +
          "&url=https%3A%2F%2Fdoi.org%2F10.1000%2Ftarget&handoffId=handoff-1",
      },
    });

    expect(
      createDiscoveryInitialState({
        allSources: sources,
        previewQuery: "preview query",
        previewResults: [previewResult],
      }),
    ).toMatchObject({
      mode: "home",
      pendingTask: {
        handoffId: "handoff-1",
        id: "work-1",
        title: "Target paper",
      },
      query: "Target paper",
      results: [],
      selectedId: null,
      sourceStatus: {
        arxiv: "idle",
        crossref: "idle",
        openalex: "idle",
        s2: "idle",
      },
    });
  });
});
