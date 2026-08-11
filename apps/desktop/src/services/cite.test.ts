import type { CslItem } from "@aurascholar/cite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cslItemsForWorks, referenceForWork } from "./cite";

describe("citation data facade", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("loads CSL items through the scoped typed command without reading the database", async () => {
    const items = [
      {
        author: [{ family: "Lovelace", given: "Ada" }],
        id: "work-2",
        title: "Second selection",
        type: "article-journal",
      },
      {
        author: [{ family: "Hopper", given: "Grace" }],
        id: "work-1",
        title: "First selection",
        type: "book",
      },
    ] satisfies CslItem[];
    command.mockResolvedValueOnce({ items });

    await expect(cslItemsForWorks(["work-2", "work-1"])).resolves.toEqual(items);
    expect(command).toHaveBeenCalledWith("library.getCslItems", {
      workIds: ["work-2", "work-1"],
    });
  });

  it("keeps an empty selection local and preserves typed command failures", async () => {
    await expect(cslItemsForWorks([])).resolves.toEqual([]);
    expect(command).not.toHaveBeenCalled();

    const failure = new Error("CSL unavailable");
    command.mockRejectedValueOnce(failure);
    await expect(referenceForWork("work-1", "apa")).rejects.toBe(failure);
    expect(command).toHaveBeenCalledWith("library.getCslItems", { workIds: ["work-1"] });
  });
});
