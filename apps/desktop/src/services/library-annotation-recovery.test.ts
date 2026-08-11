import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreAnnotationsForAttachment } from "./library-annotation-recovery";

describe("library annotation recovery renderer facade", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { aura: { data: { command } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only the work and new attachment ids to the typed main command", async () => {
    command.mockResolvedValue({ restoredAnnotationCount: 4 });

    await expect(restoreAnnotationsForAttachment("work-1", "attachment-2")).resolves.toBe(4);

    expect(command).toHaveBeenCalledWith("library.restoreAnnotationsForAttachment", {
      attachmentId: "attachment-2",
      workId: "work-1",
    });
  });

  it("preserves command failures for the attachment workflow", async () => {
    const failure = new Error("annotation recovery failed");
    command.mockRejectedValue(failure);

    await expect(restoreAnnotationsForAttachment("work-1", "attachment-2")).rejects.toBe(failure);
  });
});
