import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runDuePolls,
  runDuePollsDetailed,
  runSentinelTaskNow,
  type SentinelPollDataSource,
  type SentinelPollSummary,
} from "./sentinel";

function dataSource(overrides: Partial<SentinelPollDataSource> = {}): SentinelPollDataSource {
  return {
    cancelRun: vi.fn(async () => ({ cancelled: true })),
    runDuePolls: vi.fn(async () => ({ changes: 0, checked: 0, failed: 0, failures: [] })),
    runTaskNow: vi.fn(async () => ({ changes: 0, checked: 1, failed: 0, failures: [] })),
    ...overrides,
  };
}

describe("Sentinel renderer main-run facade", () => {
  const command = vi.fn();
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        aura: { data: { command } },
        dispatchEvent,
      },
    });
  });

  it("uses the main-owned due-run command and publishes a renderer refresh event after completion", async () => {
    command.mockResolvedValue({ changes: 2, checked: 3, failed: 0, failures: [] });

    await expect(runDuePolls()).resolves.toBe(2);

    expect(command).toHaveBeenCalledWith("sentinel.runDuePolls", {
      requestId: expect.any(String),
    });
    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect((dispatchEvent.mock.calls[0]?.[0] as Event).type).toBe("aurascholar:sentinel-updated");
  });

  it("uses the main-owned task-run command and preserves its bounded failure summary", async () => {
    const source = dataSource({
      runTaskNow: vi.fn(async () => ({
        changes: 1,
        checked: 1,
        failed: 2,
        failures: [{ error: "safe failure", taskId: "task-1", title: "Sentinel task" }],
      })),
    });

    await expect(runSentinelTaskNow("task-1", {}, source)).resolves.toEqual({
      changes: 1,
      checked: 1,
      failed: 2,
      failures: [{ error: "safe failure", taskId: "task-1", title: "Sentinel task" }],
    });

    expect(source.runTaskNow).toHaveBeenCalledWith("task-1", expect.any(String));
    expect(source.cancelRun).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });

  it("cancels an in-flight main run when its renderer abort fence expires", async () => {
    let resolveRun!: (summary: SentinelPollSummary) => void;
    const source = dataSource({
      runDuePolls: vi.fn(
        () =>
          new Promise<SentinelPollSummary>((resolve) => {
            resolveRun = resolve;
          }),
      ),
    });
    const controller = new AbortController();

    const pending = runDuePollsDetailed({ signal: controller.signal }, source);
    await Promise.resolve();
    controller.abort();
    resolveRun({ changes: 0, checked: 0, failed: 0, failures: [] });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(source.cancelRun).toHaveBeenCalledWith(expect.any(String));
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("does not start a main run after an already-aborted signal", async () => {
    const source = dataSource();
    const controller = new AbortController();
    controller.abort();

    await expect(runDuePollsDetailed({ signal: controller.signal }, source)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(source.runDuePolls).not.toHaveBeenCalled();
    expect(source.cancelRun).not.toHaveBeenCalled();
  });
});
