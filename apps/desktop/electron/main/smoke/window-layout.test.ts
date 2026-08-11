import { describe, expect, it, vi } from "vitest";
import { prepareSmokeWindowForLayout } from "./window-layout";

describe("prepareSmokeWindowForLayout", () => {
  it("shows a hidden smoke window without activating it", () => {
    const showInactive = vi.fn();

    prepareSmokeWindowForLayout({
      isVisible: () => false,
      showInactive,
    });

    expect(showInactive).toHaveBeenCalledOnce();
  });

  it("leaves an already visible smoke window alone", () => {
    const showInactive = vi.fn();

    prepareSmokeWindowForLayout({
      isVisible: () => true,
      showInactive,
    });

    expect(showInactive).not.toHaveBeenCalled();
  });
});
