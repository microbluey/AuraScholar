import { describe, expect, it } from "vitest";
import { isCanvasIngressRequestCurrent } from "./canvas-ingress-lifecycle";

describe("canvas ingress lifecycle", () => {
  it("accepts only the active request sequence", () => {
    expect(isCanvasIngressRequestCurrent(2, 2)).toBe(true);
    expect(isCanvasIngressRequestCurrent(3, 2)).toBe(false);
  });

  it("rejects an active sequence after its caller session aborts", () => {
    const controller = new AbortController();
    expect(isCanvasIngressRequestCurrent(1, 1, controller.signal)).toBe(true);

    controller.abort();

    expect(isCanvasIngressRequestCurrent(1, 1, controller.signal)).toBe(false);
  });
});
