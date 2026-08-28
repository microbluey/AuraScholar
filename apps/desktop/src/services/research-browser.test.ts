import { afterEach, describe, expect, it, vi } from "vitest";
import { openResearchTab, resumeResearchViews, suspendResearchViews } from "./research-browser";

describe("research browser tab ownership", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the no-reuse option used by isolated full-text tasks", async () => {
    const open = vi.fn().mockResolvedValue("tab-b");
    vi.stubGlobal("window", { aura: { research: { open } } });

    await expect(
      openResearchTab("_fulltext", "https://publisher.test/paper-b", "", {
        reuseExisting: false,
      }),
    ).resolves.toBe("tab-b");
    expect(open).toHaveBeenCalledWith("_fulltext", "https://publisher.test/paper-b", "", {
      reuseExisting: false,
    });
  });

  it("forwards a modal suspension lease without exposing native views", async () => {
    const resume = vi.fn().mockResolvedValue(true);
    const suspend = vi.fn().mockResolvedValue("research-modal-lease");
    vi.stubGlobal("window", { aura: { research: { resume, suspend } } });

    await expect(suspendResearchViews()).resolves.toBe("research-modal-lease");
    await expect(resumeResearchViews("research-modal-lease")).resolves.toBe(true);
    expect(resume).toHaveBeenCalledWith("research-modal-lease");
  });
});
