import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveLibraryCommandScope } from "./library-command-scope";
import {
  buildKnowledgeSemanticIndex,
  getKnowledgeSemanticIndexStatus,
} from "./knowledge-semantic-index";

vi.mock("./library-command-scope", () => ({ getActiveLibraryCommandScope: vi.fn() }));

describe("Knowledge semantic-index desktop gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    vi.mocked(getActiveLibraryCommandScope).mockResolvedValue("library:semantic");
  });

  it("starts only the fixed local semantic-index command for the active Library", async () => {
    command.mockResolvedValue({
      created: true,
      index: {
        expectedCount: 4,
        id: "index:build",
        indexedCount: 0,
        stale: false,
        status: "building",
      },
      job: { id: "job:build", status: "queued" },
    });

    await expect(buildKnowledgeSemanticIndex()).resolves.toMatchObject({
      index: { id: "index:build", status: "building" },
      job: { status: "queued" },
    });
    expect(command).toHaveBeenCalledWith("knowledge.buildSemanticIndex", {
      libraryId: "library:semantic",
    });
  });

  it("reads only the safe semantic-index status projection", async () => {
    const status = {
      active: {
        expectedCount: 4,
        id: "index:active",
        indexedCount: 4,
        stale: false,
        status: "active",
      },
      building: null,
      failed: null,
    } as const;
    command.mockResolvedValue({ status });

    await expect(getKnowledgeSemanticIndexStatus()).resolves.toEqual(status);
    expect(command).toHaveBeenCalledWith("knowledge.getSemanticIndexStatus", {
      libraryId: "library:semantic",
    });
  });

  it("does not cross a knowledge command when the request is cancelled", async () => {
    const beforeScope = new AbortController();
    beforeScope.abort();

    await expect(buildKnowledgeSemanticIndex({ signal: beforeScope.signal })).rejects.toMatchObject(
      {
        name: "AbortError",
      },
    );
    expect(getActiveLibraryCommandScope).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();

    const afterScope = new AbortController();
    vi.mocked(getActiveLibraryCommandScope).mockImplementationOnce(async () => {
      afterScope.abort();
      return "library:semantic";
    });
    await expect(
      getKnowledgeSemanticIndexStatus({ signal: afterScope.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(command).not.toHaveBeenCalled();
  });
});
