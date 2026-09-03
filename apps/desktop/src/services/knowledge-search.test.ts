import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeContentSearchResult } from "../../electron/data-command-contract";
import { getActiveLibraryCommandScopeToken } from "./library-command-scope";
import {
  DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL,
  searchKnowledgeContent,
} from "./knowledge-search";

vi.mock("./library-command-scope", () => ({ getActiveLibraryCommandScopeToken: vi.fn() }));

const SCOPE = { libraryId: "library:service", scopeToken: "scope:service" } as const;

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
    vi.mocked(getActiveLibraryCommandScopeToken).mockResolvedValue(SCOPE);
  });

  it("obtains local scope and forwards only typed search filters to the command", async () => {
    command.mockResolvedValue({
      results: [result],
      retrieval: { mode: "hybrid", semanticStatus: "used" },
      scope: SCOPE,
    });

    await expect(
      searchKnowledgeContent("  grounded anchor  ", {
        includeContextOnly: false,
        limit: 12,
        scope: { kind: "project", projectId: "project:service" },
        sourceTypes: ["pdf"],
        workId: "work:service",
      }),
    ).resolves.toEqual({
      results: [result],
      retrieval: { mode: "hybrid", semanticStatus: "used" },
    });

    expect(command).toHaveBeenCalledWith("knowledge.searchContent", {
      includeContextOnly: false,
      expectedScope: SCOPE,
      limit: 12,
      query: "grounded anchor",
      scope: { kind: "project", projectId: "project:service" },
      sourceTypes: ["pdf"],
      workId: "work:service",
    });
  });

  it("does not cross a command boundary for an empty or cancelled request", async () => {
    await expect(searchKnowledgeContent("   ")).resolves.toEqual({
      results: [],
      retrieval: DEFAULT_KNOWLEDGE_CONTENT_SEARCH_RETRIEVAL,
    });
    expect(getActiveLibraryCommandScopeToken).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();

    const beforeScope = new AbortController();
    beforeScope.abort();
    await expect(
      searchKnowledgeContent("grounded", { signal: beforeScope.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(getActiveLibraryCommandScopeToken).not.toHaveBeenCalled();

    const afterScope = new AbortController();
    vi.mocked(getActiveLibraryCommandScopeToken).mockImplementationOnce(async () => {
      afterScope.abort();
      return SCOPE;
    });
    await expect(
      searchKnowledgeContent("grounded", { signal: afterScope.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(command).not.toHaveBeenCalled();
  });

  it("fails closed when the search acknowledgement belongs to another Library generation", async () => {
    command.mockResolvedValue({
      results: [result],
      retrieval: { mode: "fulltext", semanticStatus: "not-configured" },
      scope: { ...SCOPE, scopeToken: "scope:stale" },
    });

    await expect(searchKnowledgeContent("grounded")).rejects.toThrow(
      "Knowledge Library scope does not match the request",
    );
  });
});
