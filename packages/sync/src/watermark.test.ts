import { describe, expect, it } from "vitest";
import { safeSnapshotWatermark } from "./watermark";

describe("safeSnapshotWatermark", () => {
  it("leaves the current millisecond for the next snapshot", () => {
    expect(safeSnapshotWatermark(1_000)).toBe(999);
  });

  it("never returns a negative timestamp", () => {
    expect(safeSnapshotWatermark(0)).toBe(0);
  });
});
