import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/aurascholar-platform-test") },
  clipboard: { writeText: vi.fn() },
  ipcMain: { handle: vi.fn() },
  Notification: class Notification {
    static isSupported(): boolean {
      return false;
    }
  },
  safeStorage: {
    decryptString: vi.fn(),
    encryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(() => true),
  },
  shell: { openExternal: mocks.openExternal },
}));

import { openExternalUrl } from "./platform";

beforeEach(() => {
  mocks.openExternal.mockReset();
  mocks.openExternal.mockResolvedValue(undefined);
});

describe("main-owned external URL guard", () => {
  it("rejects non-web schemes without opening the operating-system shell", async () => {
    await expect(openExternalUrl("javascript:alert('xss')")).rejects.toThrow("不允许打开");
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it("rejects credential-bearing URLs without opening the operating-system shell", async () => {
    await expect(openExternalUrl("https://user:password@example.com/aurascholar")).rejects.toThrow(
      "不能包含用户名或密码",
    );
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it("opens validated external links from main-owned navigation handling", async () => {
    await openExternalUrl("https://example.com/aurascholar");
    expect(mocks.openExternal).toHaveBeenCalledWith("https://example.com/aurascholar");
  });
});
