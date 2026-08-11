import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchScholarEnrichment } from "./scholar";

const command = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { aura: { data: { command } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Semantic Scholar enrichment", () => {
  it("uses the named main command instead of renderer HTTP", async () => {
    command.mockResolvedValueOnce({ enrichment: { citationCount: 12, tldr: "A concise summary" } });

    await expect(fetchScholarEnrichment("10.1000/enrichment")).resolves.toEqual({
      citationCount: 12,
      tldr: "A concise summary",
    });
    expect(command).toHaveBeenCalledWith(
      "scholar.enrichByDoi",
      expect.objectContaining({ doi: "10.1000/enrichment", requestId: expect.any(String) }),
    );
  });
});
