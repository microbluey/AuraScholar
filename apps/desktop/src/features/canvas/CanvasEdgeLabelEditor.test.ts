import { describe, expect, it } from "vitest";
import { resolveCanvasEdgeLabelDraft } from "./CanvasEdgeLabelEditor";

describe("resolveCanvasEdgeLabelDraft", () => {
  it("prefers the live input value over a stale React render", () => {
    expect(resolveCanvasEdgeLabelDraft("latest character ", "stale characte")).toBe(
      "latest character",
    );
  });

  it("falls back to the rendered value when no input is mounted", () => {
    expect(resolveCanvasEdgeLabelDraft(undefined, "  current label  ")).toBe("current label");
  });
});
