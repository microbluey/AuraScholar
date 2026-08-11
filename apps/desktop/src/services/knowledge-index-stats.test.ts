import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeContentIndexStats } from "../../electron/data-command-contract";
import { getActiveLibraryCommandScope } from "./library-command-scope";
import { getKnowledgeContentIndexStats } from "./knowledge-index-stats";

vi.mock("./library-command-scope", () => ({ getActiveLibraryCommandScope: vi.fn() }));

const stats: KnowledgeContentIndexStats = {
  totalContentUnits: 16,
  readyContentUnits: 12,
  contextOnlyContentUnits: 4,
  sourceCounts: { pdf: 10, annotation: 3, evidence: 3 },
  languageCoverage: { zh: 4, en: 6, other: 1, missing: 1 },
};

describe("Knowledge index statistics desktop gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    vi.mocked(getActiveLibraryCommandScope).mockResolvedValue("library:service");
  });

  it("obtains the local scope before requesting active corpus counts", async () => {
    command.mockResolvedValue({ stats });

    await expect(getKnowledgeContentIndexStats()).resolves.toEqual(stats);
    expect(command).toHaveBeenCalledWith("knowledge.getContentStats", {
      libraryId: "library:service",
    });
  });

  it("does not cross a command boundary for a cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      getKnowledgeContentIndexStats({ signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(getActiveLibraryCommandScope).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();

    const afterScope = new AbortController();
    vi.mocked(getActiveLibraryCommandScope).mockImplementationOnce(async () => {
      afterScope.abort();
      return "library:service";
    });
    await expect(
      getKnowledgeContentIndexStats({ signal: afterScope.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(command).not.toHaveBeenCalled();
  });
});
