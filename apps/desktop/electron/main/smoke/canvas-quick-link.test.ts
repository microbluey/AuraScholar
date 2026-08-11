import { describe, expect, it } from "vitest";
import { smokeCanvas } from "./fragments/canvas";
import { buildRendererSmokeScript } from "./renderer-script";

describe("canvas quick-link smoke fragment", () => {
  it("keeps the generated renderer smoke script syntactically valid", () => {
    expect(() => new Function(buildRendererSmokeScript())).not.toThrow();
  });

  it("uses the outward-facing source handle for the free-pane target", () => {
    expect(smokeCanvas).toContain("const selectQuickLinkSourceHandleId = (dropPoint) => {");
    expect(smokeCanvas).toContain('return deltaX >= 0 ? "link-right" : "link-left";');
    expect(smokeCanvas).toContain('return deltaY >= 0 ? "link-bottom" : "link-top";');
    expect(smokeCanvas).toContain(
      "const liveSourceHandle = resolveQuickLinkSourceHandle(sourceHandleId);",
    );
    expect(smokeCanvas).toContain('handle.getAttribute("data-canvas-connection-ready") !== "true"');
  });

  it("retries one drag only after the previous attempt has no mutation or active connection", () => {
    expect(smokeCanvas.match(/await runQuickLinkDrag\(\)/g)).toHaveLength(2);
    expect(smokeCanvas).toContain("const quickLinkMutationAfterInitialDrag = await waitFor(");
    expect(smokeCanvas).toContain("hasNewQuickLinkMutation,");
    expect(smokeCanvas).toContain("initialQuickLinkDrag.inputCompleted &&");
    expect(smokeCanvas).toContain("!initialQuickLinkDrag.observedConnectionStart &&");
    expect(smokeCanvas).toContain("!quickLinkMutationAfterInitialDrag &&");
    expect(smokeCanvas).toContain("!isQuickLinkConnectionActive() &&");
    expect(smokeCanvas).toContain("!(await hasNewQuickLinkMutation());");
    expect(smokeCanvas).toContain("return candidates.length === 1 ? candidates : null;");
    expect(smokeCanvas).not.toContain("AURASCHOLAR_SMOKE_CANVAS_QUICK_LINK_GESTURE");
    expect(smokeCanvas).not.toContain('document.addEventListener("mousedown", captureGesture');
  });
});
