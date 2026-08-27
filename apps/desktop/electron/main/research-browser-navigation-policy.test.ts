import { describe, expect, it } from "vitest";
import {
  acceptResearchMainFrameUrl,
  commitResearchMainFrameUrl,
  guardResearchNavigation,
  isAllowedResearchFrameUrl,
  shouldBlockResearchFrameNavigation,
} from "./research-browser-navigation-policy";

describe("research browser navigation policy", () => {
  it("allows network navigations and compatible embedded documents", () => {
    for (const url of ["https://example.edu/paper", "http://localhost:8080/"]) {
      expect(isAllowedResearchFrameUrl(url, true)).toBe(true);
      expect(isAllowedResearchFrameUrl(url, false)).toBe(true);
      expect(shouldBlockResearchFrameNavigation(url, true)).toBe(false);
    }

    expect(isAllowedResearchFrameUrl("about:blank", false)).toBe(true);
    expect(isAllowedResearchFrameUrl("about:BLANK", false)).toBe(true);
    expect(isAllowedResearchFrameUrl("about:blank#fragment", false)).toBe(true);
    expect(isAllowedResearchFrameUrl("blob:https://example.edu/9b", false)).toBe(true);
    expect(isAllowedResearchFrameUrl("blob:http://localhost:8080/9b", false)).toBe(true);
    expect(
      isAllowedResearchFrameUrl(
        "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?stream=1",
        false,
      ),
    ).toBe(true);
  });

  it("blocks privileged or opaque protocols in every frame", () => {
    for (const url of [
      "file:///tmp/paper.pdf",
      "data:text/html,<script>alert(1)</script>",
      "javascript:alert(1)",
      "blob:file:///tmp/paper.pdf",
      "blob:data:text/html,unsafe",
      "blob:null/opaque",
      "about:srcdoc",
      "chrome-extension://other/index.html",
      "chrome-extension://mhjfbmdgcfjbbpaeojofoefgiehjai/other.html",
      "chrome-extension://mhjfbmdgcfjbbpaeojofoefgiehjai/index.html/extra",
      "chrome-extension://user:pass@mhjfbmdgcfjbbpaeojofoefgiehjai/index.html",
    ]) {
      expect(shouldBlockResearchFrameNavigation(url, true)).toBe(true);
      expect(shouldBlockResearchFrameNavigation(url, false)).toBe(true);
    }
  });

  it("fails closed for malformed, oversized, and non-boolean frame details", () => {
    for (const url of [
      "blob:",
      "blob:https://",
      "blob:https://example.edu/unsafe\nvalue",
      `blob:https://example.edu/${"x".repeat(16 * 1024)}`,
      "about:blank\u0000",
      undefined,
      42,
    ]) {
      expect(isAllowedResearchFrameUrl(url, false)).toBe(false);
      expect(shouldBlockResearchFrameNavigation(url, false)).toBe(true);
    }
    expect(isAllowedResearchFrameUrl("blob:https://example.edu/9b", undefined)).toBe(false);
    expect(isAllowedResearchFrameUrl("blob:https://example.edu/9b", "false")).toBe(false);
    expect(isAllowedResearchFrameUrl("https://example.edu/paper", undefined)).toBe(false);
    expect(isAllowedResearchFrameUrl("https://example.edu/paper", "true")).toBe(false);
  });

  it("accepts only validated main-frame committed URLs", () => {
    expect(acceptResearchMainFrameUrl("https://example.edu/paper", true)).toBe(
      "https://example.edu/paper",
    );
    expect(acceptResearchMainFrameUrl("https://example.edu/paper#page=2", true)).toBe(
      "https://example.edu/paper#page=2",
    );
    expect(acceptResearchMainFrameUrl("https://example.edu/paper", false)).toBeNull();
    expect(acceptResearchMainFrameUrl("https://example.edu/paper", undefined)).toBeNull();
    for (const url of [
      "file:///tmp/paper.pdf",
      "data:text/html,unsafe",
      "javascript:alert(1)",
      "blob:https://example.edu/9b",
      "not a url",
    ]) {
      expect(acceptResearchMainFrameUrl(url, true)).toBeNull();
    }
  });

  it("prevents unsafe navigation events without touching safe ones", () => {
    let prevented = 0;
    const preventDefault = () => {
      prevented += 1;
    };
    guardResearchNavigation({ url: "data:text/html,unsafe", isMainFrame: true, preventDefault });
    guardResearchNavigation({
      url: "https://example.edu/paper",
      isMainFrame: true,
      preventDefault,
    });
    guardResearchNavigation({
      url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html",
      isMainFrame: false,
      preventDefault,
    });
    expect(prevented).toBe(1);
  });

  it("clears stale page identity when an unsafe main-frame commit slips through", () => {
    const tab = { url: "https://example.edu/old", scholar: { title: "old" } };
    expect(commitResearchMainFrameUrl(tab, "file:///tmp/paper.pdf", true)).toBeNull();
    expect(tab).toEqual({ url: "https://example.edu/old" });
    expect(commitResearchMainFrameUrl(tab, "https://example.edu/new", true)).toBe(
      "https://example.edu/new",
    );
    expect(tab.url).toBe("https://example.edu/new");
  });
});
