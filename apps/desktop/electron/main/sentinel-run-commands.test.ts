import { describe, expect, it, vi } from "vitest";
import {
  executeSentinelRunCommand,
  parseSentinelCancelRunInput,
  parseSentinelRunDuePollsInput,
  parseSentinelRunTaskNowInput,
} from "./sentinel-run-commands";

function dependencies() {
  return {
    cancel: vi.fn(() => true),
    runDuePolls: vi.fn(async () => ({ changes: 0, checked: 0, failed: 0, failures: [] })),
    runTaskNow: vi.fn(async () => ({ changes: 1, checked: 1, failed: 0, failures: [] })),
  };
}

describe("Sentinel main-run command input boundary", () => {
  it("routes only bounded opaque request ids and task ids", async () => {
    const runner = dependencies();

    await expect(
      executeSentinelRunCommand(
        { input: { requestId: "sentinel-run:due.1" }, name: "sentinel.runDuePolls" },
        runner,
      ),
    ).resolves.toEqual({ changes: 0, checked: 0, failed: 0, failures: [] });
    await expect(
      executeSentinelRunCommand(
        {
          input: { requestId: "sentinel-run:task.1", taskId: "sentinel-task-1" },
          name: "sentinel.runTaskNow",
        },
        runner,
      ),
    ).resolves.toEqual({ changes: 1, checked: 1, failed: 0, failures: [] });
    await expect(
      executeSentinelRunCommand(
        { input: { requestId: "sentinel-run:task.1" }, name: "sentinel.cancelRun" },
        runner,
      ),
    ).resolves.toEqual({ cancelled: true });

    expect(runner.runDuePolls).toHaveBeenCalledWith("sentinel-run:due.1");
    expect(runner.runTaskNow).toHaveBeenCalledWith("sentinel-task-1", "sentinel-run:task.1");
    expect(runner.cancel).toHaveBeenCalledWith("sentinel-run:task.1");
  });

  it("rejects malformed, scope-injected, and egress-injected input before runner use", () => {
    const invalidDue = [
      {},
      { requestId: "" },
      { requestId: "x".repeat(129) },
      { requestId: "contains space" },
      { libraryId: "library-1", requestId: "run-1" },
      { requestId: "run-1", url: "https://api.crossref.org/works" },
    ];
    for (const input of invalidDue) {
      expect(() => parseSentinelRunDuePollsInput(input)).toThrow();
      expect(() => parseSentinelCancelRunInput(input)).toThrow();
    }

    for (const input of [
      { requestId: "run-1" },
      { requestId: "run-1", taskId: " " },
      { requestId: "run-1", taskId: "task-1", timeoutMs: 1 },
      { libraryId: "library-1", requestId: "run-1", taskId: "task-1" },
      { requestId: "run-1", taskId: "task-1", update: { newState: "in_issue" } },
    ]) {
      expect(() => parseSentinelRunTaskNowInput(input)).toThrow();
    }
  });
});
