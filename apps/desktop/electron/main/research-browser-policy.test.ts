import { describe, expect, it } from "vitest";
import {
  MAX_RESEARCH_BOUNDS_DIMENSION,
  MAX_RESEARCH_SITE_ID_LENGTH,
  MAX_RESEARCH_SITE_IDS,
  MAX_RESEARCH_TAB_ID_LENGTH,
  MAX_RESEARCH_URL_LENGTH,
  RESEARCH_FULLTEXT_SITE_ID,
  isAllowedResearchUrl,
  parseResearchBounds,
  parseResearchNavigateInput,
  parseResearchOpenInput,
  parseResearchSiteIds,
  researchPartition,
  validateResearchSiteId,
  validateResearchTabId,
  validateResearchUrl,
} from "./research-browser-policy";

describe("research browser policy", () => {
  it("keeps legacy partitions while rejecting sanitizer-colliding site ids", () => {
    expect(researchPartition("custom:site-1")).toBe("persist:research-custom-site-1");
    expect(researchPartition(RESEARCH_FULLTEXT_SITE_ID)).toBe("persist:research-_fulltext");
    expect(researchPartition("custom:a-b")).toBe("persist:research-custom-a-b");
    expect(researchPartition("custom:a_b")).toBe("persist:research-custom-a_b");
    for (const value of [
      "custom:a/b",
      "custom:a:b",
      "custom:a b",
      "builtin:",
      "custom:",
      "site:legacy",
      "custom:a\u0000b",
      `custom:${"a".repeat(MAX_RESEARCH_SITE_ID_LENGTH)}`,
    ]) {
      expect(() => validateResearchSiteId(value)).toThrow();
    }
  });

  it("accepts canonical built-in and custom ids", () => {
    expect(validateResearchSiteId("builtin:google-scholar")).toBe("builtin:google-scholar");
    expect(validateResearchSiteId("custom:site_123")).toBe("custom:site_123");
    expect(validateResearchSiteId(RESEARCH_FULLTEXT_SITE_ID)).toBe(RESEARCH_FULLTEXT_SITE_ID);
  });

  it("bounds and validates navigation URLs", () => {
    expect(validateResearchUrl("https://example.edu/paper").href).toBe("https://example.edu/paper");
    expect(parseResearchNavigateInput(null)).toBeNull();
    expect(isAllowedResearchUrl("http://localhost:8080/")).toBe(true);
    for (const value of [
      "",
      " https://example.edu/",
      "https://example.edu/\n",
      "javascript:alert(1)",
      "file:///tmp/paper.pdf",
      "https://user:password@example.edu/",
      "https://example.edu/" + "x".repeat(MAX_RESEARCH_URL_LENGTH),
      123,
      undefined,
    ]) {
      expect(() => validateResearchUrl(value)).toThrow();
      expect(isAllowedResearchUrl(value)).toBe(false);
    }
    expect(() => parseResearchNavigateInput(undefined)).toThrow();
  });

  it("parses a bounded open request and rejects unknown options", () => {
    expect(
      parseResearchOpenInput(
        "custom:site-1",
        "https://example.edu/paper",
        "socks5://127.0.0.1:7890",
        { reuseExisting: false },
      ),
    ).toEqual({
      options: { reuseExisting: false },
      proxy: "socks5://127.0.0.1:7890",
      siteId: "custom:site-1",
      url: "https://example.edu/paper",
    });
    expect(
      parseResearchOpenInput("custom:site-1", "https://example.edu", undefined, undefined),
    ).toEqual({
      proxy: "",
      siteId: "custom:site-1",
      url: "https://example.edu/",
    });
    expect(
      parseResearchOpenInput("custom:site-1", "https://example.edu", "", {
        reuseExisting: undefined,
      }),
    ).toEqual({
      proxy: "",
      siteId: "custom:site-1",
      url: "https://example.edu/",
      options: {},
    });
    expect(() =>
      parseResearchOpenInput("custom:site-1", "https://example.edu", "ftp://proxy", undefined),
    ).toThrow();
    expect(() =>
      parseResearchOpenInput("custom:site-1", "https://example.edu", " ", undefined),
    ).not.toThrow();
    expect(() =>
      parseResearchOpenInput("custom:site-1", "https://example.edu", "http://proxy", {
        reuseExisting: "no",
      }),
    ).toThrow();
    expect(() =>
      parseResearchOpenInput("custom:site-1", "https://example.edu", "http://proxy", {
        extra: true,
      }),
    ).toThrow();
  });

  it("bounds tab ids, site-id batches, and view rectangles", () => {
    expect(validateResearchTabId("tab-1")).toBe("tab-1");
    expect(() => validateResearchTabId(" ")).toThrow();
    expect(() => validateResearchTabId("t".repeat(MAX_RESEARCH_TAB_ID_LENGTH + 1))).toThrow();

    expect(parseResearchSiteIds(["custom:one", "builtin:google-scholar"])).toEqual([
      "custom:one",
      "builtin:google-scholar",
    ]);
    expect(parseResearchSiteIds([])).toEqual([]);
    expect(() => parseResearchSiteIds(["custom:one", "custom:one"])).toThrow();
    const sparseSiteIds: string[] = [];
    sparseSiteIds.length = 1;
    expect(() => parseResearchSiteIds(sparseSiteIds)).toThrow();
    expect(() =>
      parseResearchSiteIds(Array.from({ length: MAX_RESEARCH_SITE_IDS + 1 }, () => "custom:one")),
    ).toThrow();

    expect(parseResearchBounds({ x: 0, y: 12, width: 800, height: 600 })).toEqual({
      height: 600,
      width: 800,
      x: 0,
      y: 12,
    });
    expect(parseResearchBounds({ x: -10, y: 0, width: 0, height: 0 })).toEqual({
      height: 0,
      width: 0,
      x: -10,
      y: 0,
    });
    for (const value of [
      { x: Number.NaN, y: 0, width: 1, height: 1 },
      { x: 0, y: Number.POSITIVE_INFINITY, width: 1, height: 1 },
      { x: 0, y: 0, width: -1, height: 1 },
      { x: 0, y: 0, width: MAX_RESEARCH_BOUNDS_DIMENSION + 1, height: 1 },
      { x: 0.5, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1, extra: true },
      null,
    ]) {
      expect(() => parseResearchBounds(value)).toThrow();
    }
  });
});
