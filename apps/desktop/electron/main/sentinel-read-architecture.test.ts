import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeSentinelReadOutputContract(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("sentinel.getPageSnapshot", async () => ({ events: [], tasks: [] }));
  // @ts-expect-error sentinel.getPageSnapshot must return its complete page snapshot.
  void dependencies.execute?.("sentinel.getPageSnapshot", async () => ({ tasks: [] }));
  void dependencies.execute?.("sentinel.getDuePollSnapshot", async () => ({
    libraryId: "library-id",
    tasks: [],
  }));
  // @ts-expect-error sentinel.getDuePollSnapshot must return its scoped polling snapshot.
  void dependencies.execute?.("sentinel.getDuePollSnapshot", async () => ({ tasks: [] }));
  void dependencies.execute?.("sentinel.getTaskPollSnapshot", async () => ({
    libraryId: "library-id",
    reachedStates: [],
    task: null,
  }));
  // @ts-expect-error sentinel.getTaskPollSnapshot must return its complete polling snapshot.
  void dependencies.execute?.("sentinel.getTaskPollSnapshot", async () => ({
    libraryId: "library-id",
    task: null,
  }));
}

void assertCompileTimeSentinelReadOutputContract;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Sentinel read command architecture", () => {
  it("keeps Sentinel reads and mutations behind typed main-process command boundaries", () => {
    const sentinelPage = source("src/pages/SentinelPage.tsx");
    const gateway = source("src/services/sentinel-page-data.ts");
    const pollingService = source("src/services/sentinel.ts");
    const commands = source("electron/main/sentinel-commands.ts");
    const readCommands = source("electron/main/sentinel-read-commands.ts");
    const pageCommandNames = [
      "sentinel.createOrRestore",
      "sentinel.delete",
      "sentinel.restore",
      "sentinel.setStatus",
    ];

    for (const commandName of pageCommandNames) {
      expect(gateway).toContain(`data.command("${commandName}"`);
    }
    for (const commandName of [
      "sentinel.cancelRun",
      "sentinel.runDuePolls",
      "sentinel.runTaskNow",
    ]) {
      expect(pollingService).toContain(`data.command("${commandName}"`);
    }
    expect(gateway).toContain('data.command("sentinel.getPageSnapshot"');
    expect(sentinelPage).not.toContain("data.command(");
    expect(sentinelPage).not.toContain("getLibraryDb");
    expect(sentinelPage).not.toContain("SentinelRepo");
    for (const rendererSource of [gateway, pollingService]) {
      expect(rendererSource).not.toContain("getLibraryDb");
      expect(rendererSource).not.toContain("aura-db");
      expect(rendererSource).not.toContain("SentinelRepo");
      expect(rendererSource).not.toMatch(/\b(?:db|database)\s*\.\s*query\b/);
    }
    expect(pollingService).not.toContain("ConnectorContext");
    expect(pollingService).not.toContain("auraHttp");
    expect(pollingService).not.toContain("checkDoi");
    expect(pollingService).not.toContain("findDoiByTitle");
    expect(pollingService).not.toContain("ingestFromInput");
    expect(pollingService).not.toContain("auraNotifier");
    expect(commands).toContain("assertActiveLocalLibrary");
    expect(commands).toContain("new SentinelRepo");
    expect(readCommands).toContain("requireLocalLibraryId");
    expect(readCommands).toContain("assertActiveLocalLibrary");
    expect(readCommands).toContain("describeSafeError");
    expect(readCommands).toContain("MAX_SENTINEL_PAGE_EVENTS + 1");
  });
});
