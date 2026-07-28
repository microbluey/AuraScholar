import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("main-process data command architecture", () => {
  it("keeps permanent Library erasure behind the typed main-process command", () => {
    const libraryPage = source("src/pages/LibraryPage.tsx");

    expect(libraryPage).toContain('data.command("library.purgeDeletedWorks"');
    expect(libraryPage).not.toContain(".purgeDeleted(");
    expect(libraryPage).not.toContain(".purgeDeletedMany(");
  });

  it("keeps migrated backup and sync transactions out of renderer SQL IPC", () => {
    const syncService = source("src/services/sync.ts");
    const sharedBackup = source("src/shared/library-backup.ts");

    expect(syncService).toContain('data.command("library.importBackup"');
    expect(syncService).toContain('data.command("sync.applyRemoteSegment"');
    for (const rendererSource of [syncService, sharedBackup]) {
      expect(rendererSource).not.toMatch(
        /\.exec\(\s*["'`](?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
      );
    }
  });

  it("uses a typed allowlist rather than accepting arbitrary SQL commands", () => {
    const contract = source("electron/data-command-contract.ts");
    const dispatcher = source("electron/main/data-commands.ts");

    expect(contract).toContain('"library.importBackup"');
    expect(contract).toContain('"library.purgeDeletedWorks"');
    expect(contract).toContain('"sync.applyRemoteSegment"');
    expect(contract).not.toMatch(/\b(sql|statements)\s*[?:]/i);
    expect(dispatcher).toContain("assertActiveLocalLibrary");
    expect(dispatcher).toContain("withMainDatabaseTransaction");
  });

  it("routes every raw database IPC method through the connection coordinator", () => {
    const mainDatabase = source("electron/main/db.ts");
    const handlerSection = mainDatabase.slice(mainDatabase.indexOf("registerDbHandlers"));

    expect(handlerSection.match(/getMainDatabaseCoordinator\(\)/g)).toHaveLength(4);
    expect(handlerSection).not.toContain("getMainDb()).");
  });

  it("keeps the typed command contract, runtime dispatcher, and main registration in lockstep", () => {
    const contract = source("electron/data-command-contract.ts");
    const dispatcher = source("electron/main/data-commands.ts");
    const main = source("electron/main.ts");

    const contractNames = [...contract.matchAll(/^\s*"([^"]+)":\s*\{/gm)]
      .map((match) => match[1])
      .sort();
    const dispatchedNames = [...dispatcher.matchAll(/^\s*case "([^"]+)":\s*\{/gm)]
      .map((match) => match[1])
      .sort();

    expect(contractNames).toEqual([
      "library.importBackup",
      "library.purgeDeletedWorks",
      "sync.applyRemoteSegment",
    ]);
    expect(dispatchedNames).toEqual(contractNames);
    expect(dispatcher).toContain('value.name !== "library.importBackup"');
    expect(dispatcher).toContain('value.name !== "sync.applyRemoteSegment"');
    expect(main.match(/registerDataCommandHandlers\(\);/g)).toHaveLength(1);
  });
});
