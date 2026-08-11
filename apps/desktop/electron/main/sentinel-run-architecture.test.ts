import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandInput, DataCommandOutput } from "../data-command-contract";

function assertCompileTimeSentinelRunContract(): void {
  const due: DataCommandInput<"sentinel.runDuePolls"> = { requestId: "sentinel-run-1" };
  const task: DataCommandInput<"sentinel.runTaskNow"> = {
    requestId: "sentinel-run-2",
    taskId: "sentinel-task-1",
  };
  const cancel: DataCommandInput<"sentinel.cancelRun"> = { requestId: "sentinel-run-2" };
  const summary: DataCommandOutput<"sentinel.runDuePolls"> = {
    changes: 0,
    checked: 0,
    failed: 0,
    failures: [],
  };
  const cancelled: DataCommandOutput<"sentinel.cancelRun"> = { cancelled: false };
  const injectedScope: DataCommandInput<"sentinel.runDuePolls"> = {
    requestId: "sentinel-run-1",
    // @ts-expect-error Sentinel runs derive local Library scope in main.
    libraryId: "library-id",
  };
  const injectedUpdate: DataCommandInput<"sentinel.runTaskNow"> = {
    requestId: "sentinel-run-2",
    taskId: "sentinel-task-1",
    // @ts-expect-error Renderer cannot send a state transition/evidence update.
    update: { newState: "in_issue" },
  };
  void due;
  void task;
  void cancel;
  void summary;
  void cancelled;
  void injectedScope;
  void injectedUpdate;
}

void assertCompileTimeSentinelRunContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Sentinel main-run architecture", () => {
  it("keeps polling egress, CAS writes, notification, and auto-ingest in Electron main", () => {
    const contract = source("electron/sentinel-run-command-contract.ts");
    const handler = source("electron/main/sentinel-run-commands.ts");
    const runner = source("electron/main/sentinel-runner.ts");
    const runnerHelpers = source("electron/main/sentinel-runner-helpers.ts");
    const runnerInput = source("electron/main/sentinel-runner-input.ts");
    const runnerSerialization = source("electron/main/sentinel-runner-serialization.ts");
    const renderer = source("src/services/sentinel.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const envelope = source("electron/main/data-command-envelope.ts");
    const runnerModules = [runner, runnerHelpers, runnerInput, runnerSerialization].join("\n");

    for (const commandName of [
      "sentinel.cancelRun",
      "sentinel.runDuePolls",
      "sentinel.runTaskNow",
    ]) {
      expect(contract).toContain(`"${commandName}"`);
      expect(envelope).toContain(`"${commandName}"`);
      expect(renderer).toContain(`data.command("${commandName}"`);
    }
    expect(contract).toContain("requestId: string");
    expect(contract).not.toContain("libraryId:");
    expect(contract).not.toContain("url:");
    expect(contract).not.toContain("headers:");
    expect(contract).not.toContain("evidence:");
    expect(contract).not.toContain("newState:");

    expect(handler).toContain("requireExactSentinelRunInput");
    expect(handler).toContain("requireRecordId");
    expect(handler).toContain("MAX_SENTINEL_RUN_REQUEST_ID_LENGTH");
    expect(handler).not.toContain("window.aura");

    expect(runnerModules).toContain("mainScholarlyHttp");
    expect(runnerModules).toContain("resolveScholarlyClue");
    expect(runnerModules).toContain("requireLocalLibraryId");
    expect(runnerModules).toContain("assertActiveLocalLibrary");
    expect(runnerModules).toContain("new SentinelRepo");
    expect(runnerModules).toContain("new WorksRepo");
    expect(runnerModules).toContain("linkWorkIfCurrent");
    expect(runner).toContain("MainSentinelRunRegistry");
    expect(runnerSerialization).toContain("MAX_SENTINEL_SUMMARY_OUTPUT_BYTES");
    expect(runner).toContain("withDatabaseTransaction");
    expect(runnerModules).not.toContain("window.aura");
    expect(runnerModules).not.toContain("data.command(");

    expect(renderer).not.toContain("ConnectorContext");
    expect(renderer).not.toContain("auraHttp");
    expect(renderer).not.toContain("checkDoi");
    expect(renderer).not.toContain("findDoiByTitle");
    expect(renderer).not.toContain("ingestFromInput");
    expect(renderer).not.toContain("auraNotifier");
    expect(dispatcher).toContain("executeSentinelRunCommand(envelope)");
  });
});
