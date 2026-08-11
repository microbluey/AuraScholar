import type { WorkPatch, WorkRow } from "@aurascholar/db/repos/works";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkMetadata, saveWorkMetadata, type WorkMetadata } from "./metadata";

function metadata(): WorkMetadata {
  return {
    authors: [{ displayName: "Ada Lovelace", orcid: null, position: 0, role: "author" }],
    keywords: ["methods"],
    work: { id: "work-1", title: "Metadata source" } as WorkRow,
  };
}

describe("work metadata data facade", () => {
  const command = vi.fn();
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } }, dispatchEvent },
    });
  });

  it("loads the existing metadata shape through its local-library typed command", async () => {
    const snapshot = metadata();
    command.mockResolvedValueOnce({ metadata: snapshot });

    await expect(loadWorkMetadata("work-1")).resolves.toBe(snapshot);
    expect(command).toHaveBeenCalledWith("library.getWorkMetadata", { workId: "work-1" });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("saves partial metadata through main and preserves the library update event", async () => {
    const patch: WorkPatch = {
      authors: [{ displayName: "Ada Lovelace", position: 0, role: "author" }],
      keywords: ["methods"],
      title: "Updated metadata source",
      year: 1843,
    };
    command.mockResolvedValueOnce({ updated: 1 });

    await expect(saveWorkMetadata("work-1", patch)).resolves.toBeUndefined();
    expect(command).toHaveBeenCalledWith("library.updateWorkMetadata", { patch, workId: "work-1" });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "aurascholar:library-updated" }),
    );
  });

  it("keeps command failures observable without publishing a false update", async () => {
    const failure = new Error("metadata save failed");
    command.mockRejectedValueOnce(failure);

    await expect(saveWorkMetadata("work-1", { title: "Uncommitted" })).rejects.toBe(failure);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
