import { describe, expect, it } from "vitest";
import {
  normalizeMainSyncSettings,
  parseAdoptLegacySyncSettingsInput,
  parseSyncGetSettingsInput,
  parseSyncRunInput,
  parseSyncSaveSettingsInput,
  syncProviderScope,
} from "./sync-command-input";

describe("sync command input", () => {
  it("normalizes persisted targets and preserves the existing v1 provider scope", () => {
    const input = parseSyncSaveSettingsInput({
      baseUrl: " https://dav.example.test/aurascholar/// ",
      password: " app-password ",
      username: " alice ",
    });

    expect(input).toEqual({
      baseUrl: "https://dav.example.test/aurascholar",
      password: "app-password",
      username: "alice",
    });
    expect(syncProviderScope(input)).toBe("webdav-0iqhggj0aneta7");
  });

  it("allows a password omission only for an already configured save", () => {
    expect(
      parseSyncSaveSettingsInput({
        baseUrl: "https://dav.example.test/aurascholar",
        username: "alice",
      }),
    ).toEqual({ baseUrl: "https://dav.example.test/aurascholar", username: "alice" });
    expect(
      parseAdoptLegacySyncSettingsInput({
        baseUrl: "https://dav.example.test/aurascholar",
        inlinePassword: "legacy-password",
        username: "alice",
      }),
    ).toEqual({
      baseUrl: "https://dav.example.test/aurascholar",
      inlinePassword: "legacy-password",
      username: "alice",
    });
    expect(
      parseAdoptLegacySyncSettingsInput({
        baseUrl: "https://dav.example.test/aurascholar",
        inlinePassword: " ",
        username: "alice",
      }),
    ).toEqual({ baseUrl: "https://dav.example.test/aurascholar", username: "alice" });
  });

  it("requires a concrete password before a trusted main runner can start", () => {
    expect(() =>
      normalizeMainSyncSettings({
        baseUrl: "https://dav.example.test/aurascholar",
        password: " ",
        username: "alice",
      }),
    ).toThrow("Sync password is required");
  });

  it("rejects non-empty input for zero-argument commands", () => {
    expect(parseSyncGetSettingsInput({})).toEqual({});
    expect(parseSyncRunInput({})).toEqual({});
    expect(() => parseSyncGetSettingsInput({ libraryId: "foreign" })).toThrow(
      "Invalid sync.getSettings input",
    );
    expect(() => parseSyncRunInput({ providerScope: "webdav-00000000000000" })).toThrow(
      "Invalid sync.run input",
    );
  });

  it("rejects URL credentials, unsupported protocols, query fragments, and excess keys", () => {
    const invalidInputs = [
      { baseUrl: "https://user:pass@dav.example.test/", username: "alice" },
      { baseUrl: "file:///tmp/remote", username: "alice" },
      { baseUrl: "https://dav.example.test/?unsafe=1", username: "alice" },
      { baseUrl: "https://dav.example.test/#unsafe", username: "alice" },
      { baseUrl: "https://dav.example.test/", username: "alice", unexpected: true },
    ];

    for (const input of invalidInputs) {
      expect(() => parseSyncSaveSettingsInput(input)).toThrow();
    }
  });
});
