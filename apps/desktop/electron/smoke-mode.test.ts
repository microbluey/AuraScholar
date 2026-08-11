import { describe, expect, it } from "vitest";
import { hasPreloadSmokeBridge, isMainSmokeMode, SMOKE_PRELOAD_ARGUMENT } from "./smoke-mode";

describe("smoke mode capability gate", () => {
  it("permits smoke only for an unpackaged process that explicitly requests it", () => {
    expect(isMainSmokeMode("1", false)).toBe(true);
    expect(isMainSmokeMode(undefined, false)).toBe(false);
    expect(isMainSmokeMode("0", false)).toBe(false);
  });

  it("never permits smoke mode in a packaged application", () => {
    expect(isMainSmokeMode("1", true)).toBe(false);
  });

  it("requires main's explicit preload capability marker", () => {
    expect(hasPreloadSmokeBridge(["electron", "app"])).toBe(false);
    expect(hasPreloadSmokeBridge(["electron", SMOKE_PRELOAD_ARGUMENT])).toBe(true);
  });
});
