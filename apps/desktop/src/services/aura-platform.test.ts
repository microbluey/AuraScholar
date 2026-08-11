import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openExternalUrl } from "./aura-platform";

const mocks = {
  open: vi.fn(),
};

beforeEach(() => {
  mocks.open.mockReset();
  mocks.open.mockReturnValue({});
  vi.stubGlobal("window", { open: mocks.open });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web external-link fallback", () => {
  it("opens an allowed URL with isolation flags without requiring Electron preload", async () => {
    await openExternalUrl("https://example.com/aurascholar");

    expect(mocks.open).toHaveBeenCalledWith(
      "https://example.com/aurascholar",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("rejects unsafe URLs before attempting a popup", async () => {
    await expect(openExternalUrl("javascript:alert('xss')")).rejects.toThrow("不允许打开");
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("reports a browser-blocked popup", async () => {
    mocks.open.mockReturnValue(null);

    await expect(openExternalUrl("https://example.com/aurascholar")).rejects.toThrow(
      "浏览器阻止了外部链接弹窗",
    );
  });
});
