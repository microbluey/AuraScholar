import { afterEach, describe, expect, it, vi } from "vitest";
import { openResearchTab } from "./research-browser";

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
    expect(open).toHaveBeenCalledWith(
      "_fulltext",
      "https://publisher.test/paper-b",
      "",
      { reuseExisting: false },
    );
  });
});
