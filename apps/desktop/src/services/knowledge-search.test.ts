import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeContentSearchResult } from "../../electron/data-command-contract";
import { getActiveLibraryCommandScope } from "./library-command-scope";
import {
  DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL,
  searchKnowledgeContent,
} from "./knowledge-search";

vi.mock("./library-command-scope", () => ({ getActiveLibraryCommandScope: vi.fn() }));

const result: KnowledgeContentSearchResult = {
  id: "content-unit:service",
  sourceType: "pdf",
  sourceId: "revision:service",
  workId: "work:service",
  workTitle: "Grounded Service Paper",
  assetId: "asset:service",
  revisionId: "revision:service",
  parentUnitId: null,
  ordinal: 0,
  headingPath: ["Results"],
  anchor: { kind: "pdf", pageIndex: 1, version: 1 },
  text: "Grounded service search keeps its reader anchor.",
  language: "en",
  tokenCount: 7,
  state: "ready",
  score: 0.5,
  excerpt: "Grounded service search keeps its reader anchor.",
};

describe("Knowledge search desktop gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    vi.mocked(getActiveLibraryCommandScope).mockResolvedValue("library:service");
  });

  it("obtains local scope and forwards only typed search filters to the command", async () => {
    command.mockResolvedValue({
      results: [result],
      retrieval: { mode: "hybrid", semanticStatus: "used" },
    });

    await expect(
      searchKnowledgeContent("  grounded anchor  ", {
        includeContextOnly: false,
        limit: 12,
        sourceTypes: ["pdf"],
        workId: "work:service",
      }),
    ).resolves.toEqual({
      results: [result],
      retrieval: { mode: "hybrid", semanticStatus: "used" },
    });

    expect(command).toHaveBeenCalledWith("knowledge.searchContent", {
      includeContextOnly: false,
      libraryId: "library:service",
      limit: 12,
      query: "grounded anchor",
      sourceTypes: ["pdf"],
      workId: "work:service",
    });
  });

  it("does not cross a command boundary for an empty or cancelled request", async () => {
    await expect(searchKnowledgeContent("   ")).resolves.toEqual({
      results: [],
      retrieval: DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL,
    });
    expect(getActiveLibraryCommandScope).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();

    const beforeScope = new AbortController();
    beforeScope.abort();
    await expect(
      searchKnowledgeContent("grounded", { signal: beforeScope.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(getActiveLibraryCommandScope).not.toHaveBeenCalled();

    const afterScope = new AbortController();
    vi.mocked(getActiveLibraryCommandScope).mockImplementationOnce(async () => {
      afterScope.abort();
      return "library:service";
    });
    await expect(
      searchKnowledgeContent("grounded", { signal: afterScope.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(command).not.toHaveBeenCalled();
  });
});
