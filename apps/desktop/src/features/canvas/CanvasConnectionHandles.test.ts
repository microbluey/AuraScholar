import { describe, expect, it } from "vitest";
import {
  isCanvasConnectionHandleReady,
  needsCanvasConnectionHandleMeasurement,
} from "./CanvasConnectionHandles";

describe("isCanvasConnectionHandleReady", () => {
  it("requires the exact source handle to be present in XYFlow's internal bounds", () => {
    const sourceHandles = [{ id: "link-left" }, { id: "link-right" }] as const;

    expect(isCanvasConnectionHandleReady(sourceHandles, "link-left")).toBe(true);
    expect(isCanvasConnectionHandleReady(sourceHandles, "link-top")).toBe(false);
  });

  it("keeps a handle unavailable until XYFlow has measured source bounds", () => {
    expect(isCanvasConnectionHandleReady(undefined, "link-left")).toBe(false);
    expect(isCanvasConnectionHandleReady(null, "link-left")).toBe(false);
  });
});

describe("needsCanvasConnectionHandleMeasurement", () => {
  it("requests one internal measurement only while XYFlow has no handle bounds", () => {
    expect(needsCanvasConnectionHandleMeasurement(undefined)).toBe(false);
    expect(needsCanvasConnectionHandleMeasurement({ internals: {} })).toBe(true);
    expect(
      needsCanvasConnectionHandleMeasurement({
        internals: { handleBounds: { source: [], target: [] } },
      }),
    ).toBe(false);
  });
});
