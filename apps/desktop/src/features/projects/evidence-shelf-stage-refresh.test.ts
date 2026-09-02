import { describe, expect, it, vi } from "vitest";
import {
  isEvidenceShelfStageScopeCurrent,
  stageEvidenceShelfWithAbortRefresh,
  type EvidenceShelfStageScope,
} from "./evidence-shelf-stage-refresh";

function scope(overrides: Partial<EvidenceShelfStageScope> = {}): EvidenceShelfStageScope {
  return {
    previewMode: false,
    projectId: "project:one",
    service: {},
    ...overrides,
  };
}

describe("isEvidenceShelfStageScopeCurrent", () => {
  it("accepts the same project, mode, and service", () => {
    const expected = scope();

    expect(isEvidenceShelfStageScopeCurrent(expected, { ...expected })).toBe(true);
  });

  it.each([
    ["a different project", { projectId: "project:two" }],
    ["a different runtime mode", { previewMode: true }],
    ["a different service", { service: {} }],
  ])("rejects %s", (_description, change) => {
    const expected = scope();

    expect(isEvidenceShelfStageScopeCurrent(expected, { ...expected, ...change })).toBe(false);
    expect(isEvidenceShelfStageScopeCurrent(expected, null)).toBe(false);
  });
});

describe("stageEvidenceShelfWithAbortRefresh", () => {
  it("does not dispatch or refresh when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const stage = vi.fn(async () => "staged");
    const refresh = vi.fn();
    const expectedScope = scope();

    await expect(
      stageEvidenceShelfWithAbortRefresh({
        currentScope: () => expectedScope,
        expectedScope,
        refresh,
        signal: controller.signal,
        stage,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(stage).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once after a successful stage", async () => {
    const expectedScope = scope();
    const refresh = vi.fn();

    await expect(
      stageEvidenceShelfWithAbortRefresh({
        currentScope: () => expectedScope,
        expectedScope,
        refresh,
        signal: new AbortController().signal,
        stage: async () => "staged",
      }),
    ).resolves.toBe("staged");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the adapter rejects after the command commits", async () => {
    const controller = new AbortController();
    const expectedScope = scope();
    const refresh = vi.fn();

    const pending = stageEvidenceShelfWithAbortRefresh({
      currentScope: () => expectedScope,
      expectedScope,
      refresh,
      signal: controller.signal,
      stage: async () => {
        controller.abort();
        controller.signal.throwIfAborted();
        return "unreachable";
      },
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes once when abort races a late IPC response", async () => {
    const controller = new AbortController();
    const expectedScope = scope();
    const refresh = vi.fn();
    let resolveStage!: (value: string) => void;
    const stage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveStage = resolve;
        }),
    );

    const pending = stageEvidenceShelfWithAbortRefresh({
      currentScope: () => expectedScope,
      expectedScope,
      refresh,
      signal: controller.signal,
      stage,
    });
    controller.abort();
    resolveStage("committed");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a newer project after a late response", async () => {
    const controller = new AbortController();
    const expectedScope = scope();
    let currentScope: EvidenceShelfStageScope | null = expectedScope;
    const refresh = vi.fn();
    let resolveStage!: (value: string) => void;
    const pending = stageEvidenceShelfWithAbortRefresh({
      currentScope: () => currentScope,
      expectedScope,
      refresh,
      signal: controller.signal,
      stage: () =>
        new Promise<string>((resolve) => {
          resolveStage = resolve;
        }),
    });

    currentScope = scope({ projectId: "project:two" });
    controller.abort();
    resolveStage("committed");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh an ordinary failed stage", async () => {
    const expectedScope = scope();
    const refresh = vi.fn();
    const failure = new Error("write failed");

    await expect(
      stageEvidenceShelfWithAbortRefresh({
        currentScope: () => expectedScope,
        expectedScope,
        refresh,
        signal: new AbortController().signal,
        stage: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(refresh).not.toHaveBeenCalled();
  });
});
