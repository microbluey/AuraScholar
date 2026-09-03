import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveLibraryCommandScopeToken } from "./library-command-scope";
import {
  buildKnowledgeSemanticIndex,
  getKnowledgeSemanticIndexStatus,
} from "./knowledge-semantic-index";

vi.mock("./library-command-scope", () => ({ getActiveLibraryCommandScopeToken: vi.fn() }));

const SCOPE = { libraryId: "library:semantic", scopeToken: "scope:semantic" } as const;

describe("Knowledge semantic-index desktop gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    vi.mocked(getActiveLibraryCommandScopeToken).mockResolvedValue(SCOPE);
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
      scope: SCOPE,
    });

    await expect(buildKnowledgeSemanticIndex()).resolves.toMatchObject({
      index: { id: "index:build", status: "building" },
      job: { status: "queued" },
    });
    expect(command).toHaveBeenCalledWith("knowledge.buildSemanticIndex", {
      expectedScope: SCOPE,
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
    command.mockResolvedValue({ status, scope: SCOPE });

    await expect(getKnowledgeSemanticIndexStatus()).resolves.toEqual(status);
    expect(command).toHaveBeenCalledWith("knowledge.getSemanticIndexStatus", {
      expectedScope: SCOPE,
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
    expect(getActiveLibraryCommandScopeToken).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();

    const afterScope = new AbortController();
    vi.mocked(getActiveLibraryCommandScopeToken).mockImplementationOnce(async () => {
      afterScope.abort();
      return SCOPE;
    });
    await expect(
      getKnowledgeSemanticIndexStatus({ signal: afterScope.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(command).not.toHaveBeenCalled();
  });

  it("fails closed when the main process acknowledges a different Library generation", async () => {
    command.mockResolvedValue({
      status: { active: null, building: null, failed: null },
      scope: { ...SCOPE, scopeToken: "scope:stale" },
    });

    await expect(getKnowledgeSemanticIndexStatus()).rejects.toThrow(
      "Knowledge Library scope does not match the request",
    );
  });
});
