import { describe, expect, it, vi } from "vitest";
import type { MainSyncSettings } from "./sync-command-input";
import {
  executeSyncCommand,
  type SyncCommandDependencies,
  type SyncCommandRequest,
} from "./sync-commands";

const SETTINGS: MainSyncSettings = {
  baseUrl: "https://dav.example.test/aurascholar",
  password: "main-only-secret",
  username: "alice",
};

function dependencies(): SyncCommandDependencies {
  return {
    runner: {
      run: vi.fn(async () => ({
        appliedEntries: 0,
        conflicts: 0,
        pulledEntries: 0,
        pushedEntries: 1,
      })),
    },
    settings: {
      adoptLegacy: vi.fn(async () => ({
        baseUrl: SETTINGS.baseUrl,
        hasPassword: true,
        username: SETTINGS.username,
      })),
      getSnapshot: vi.fn(async () => ({
        baseUrl: SETTINGS.baseUrl,
        hasPassword: true,
        username: SETTINGS.username,
      })),
      requireSettings: vi.fn(async () => SETTINGS),
      save: vi.fn(async (input) => ({
        baseUrl: input.baseUrl,
        hasPassword: true,
        username: input.username,
      })),
    },
  };
}

function request<K extends SyncCommandRequest["name"]>(
  name: K,
  input: Extract<SyncCommandRequest, { name: K }>["input"],
): Extract<SyncCommandRequest, { name: K }> {
  return { input, name } as Extract<SyncCommandRequest, { name: K }>;
}

describe("main sync commands", () => {
  it("returns a password-free settings snapshot", async () => {
    const commandDependencies = dependencies();

    await expect(
      executeSyncCommand(request("sync.getSettings", {}), commandDependencies),
    ).resolves.toEqual({
      baseUrl: SETTINGS.baseUrl,
      hasPassword: true,
      username: SETTINGS.username,
    });
    expect(commandDependencies.settings.getSnapshot).toHaveBeenCalledOnce();
    expect(commandDependencies.runner.run).not.toHaveBeenCalled();
  });

  it("accepts a secret only on save and leaves it out of the output", async () => {
    const commandDependencies = dependencies();

    await expect(
      executeSyncCommand(
        request("sync.saveSettings", {
          baseUrl: " https://dav.example.test/next/// ",
          password: " replacement-secret ",
          username: " alice ",
        }),
        commandDependencies,
      ),
    ).resolves.toEqual({
      baseUrl: "https://dav.example.test/next",
      hasPassword: true,
      username: "alice",
    });
    expect(commandDependencies.settings.save).toHaveBeenCalledWith({
      baseUrl: "https://dav.example.test/next",
      password: "replacement-secret",
      username: "alice",
    });
  });

  it("runs only from main-owned settings with a strict empty renderer input", async () => {
    const commandDependencies = dependencies();

    await expect(executeSyncCommand(request("sync.run", {}), commandDependencies)).resolves.toEqual(
      { appliedEntries: 0, conflicts: 0, pulledEntries: 0, pushedEntries: 1 },
    );
    expect(commandDependencies.settings.requireSettings).toHaveBeenCalledOnce();
    expect(commandDependencies.runner.run).toHaveBeenCalledWith(SETTINGS);

    await expect(
      executeSyncCommand(
        request("sync.run", { baseUrl: "https://attacker.example" } as never),
        commandDependencies,
      ),
    ).rejects.toThrow("Invalid sync.run input");
    expect(commandDependencies.settings.requireSettings).toHaveBeenCalledOnce();
    expect(commandDependencies.runner.run).toHaveBeenCalledOnce();
  });

  it("fails closed when the main settings owner has no usable secret", async () => {
    const commandDependencies = dependencies();
    const failure = new Error("请先配置 WebDAV 同步(地址、用户名、密码)");
    commandDependencies.settings.requireSettings = vi.fn(async () => {
      throw failure;
    });

    await expect(executeSyncCommand(request("sync.run", {}), commandDependencies)).rejects.toBe(
      failure,
    );
    expect(commandDependencies.runner.run).not.toHaveBeenCalled();
  });
});
