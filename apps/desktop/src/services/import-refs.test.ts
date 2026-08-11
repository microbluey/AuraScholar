import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importReferences, previewReferences } from "./import-refs";

const RIS_TEXT = [
  "TY  - JOUR",
  "TI  - Renderer preview remains local",
  "AU  - Lovelace, Ada",
  "DO  - 10.4242/renderer-reference-import",
  "ER  -",
].join("\n");

describe("reference import renderer facade", () => {
  const command = vi.fn();
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      aura: { data: { command } },
      dispatchEvent,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps parsing available for the synchronous preview", () => {
    expect(previewReferences(RIS_TEXT, "ris")).toEqual([
      expect.objectContaining({
        DOI: "10.4242/renderer-reference-import",
        title: "Renderer preview remains local",
      }),
    ]);
  });

  it("forwards only the original export and optional format to main without publishing a Library update", async () => {
    command.mockResolvedValue({ deduped: 1, imported: 2, total: 3 });

    await expect(importReferences(RIS_TEXT, "ris")).resolves.toEqual({
      deduped: 1,
      imported: 2,
      total: 3,
    });

    expect(command).toHaveBeenCalledWith("library.importReferences", {
      format: "ris",
      text: RIS_TEXT,
    });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("does not synthesize an undefined format field", async () => {
    command.mockResolvedValue({ deduped: 0, imported: 0, total: 0 });

    await importReferences("");

    expect(command).toHaveBeenCalledWith("library.importReferences", { text: "" });
  });
});
