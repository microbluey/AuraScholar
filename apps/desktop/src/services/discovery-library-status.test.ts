import type { DiscoveryResult } from "@aurascholar/core";
import { describe, expect, it, vi } from "vitest";
import {
  discoveryLibraryStatusInput,
  loadDiscoveryLibraryStatuses,
  type DiscoveryLibraryStatusCommandClient,
} from "./discovery-library-status";

const result: DiscoveryResult = {
  id: "discovery:1",
  score: 10,
  source: "crossref",
  work: {
    arxivId: "arxiv:2608.00001",
    authors: [{ displayName: "Ada Lovelace", family: "Lovelace", position: 0 }],
    doi: "10.1000/discovery",
    openalexId: "W123",
    pmid: "456",
    s2Id: "S2-789",
    source: "crossref",
    title: "Discovery status title",
    year: 2026,
  },
};

describe("Discovery Library status facade", () => {
  it("builds positional stable-identifier probes without a Library id", () => {
    const input = discoveryLibraryStatusInput([result]);

    expect(input.probes).toEqual([
      {
        arxivId: "arxiv:2608.00001",
        doi: "10.1000/discovery",
        fingerprint: "discovery status title|2026|lovelace",
        openalexId: "W123",
        pmid: "456",
        s2Id: "S2-789",
      },
    ]);
    expect(JSON.stringify(input)).not.toContain("libraryId");
  });

  it("checks an AbortSignal around the narrow command transport", async () => {
    const command = vi.fn().mockResolvedValue({
      statuses: [{ hasPdf: false, workId: "work-1" }],
    });
    const client: DiscoveryLibraryStatusCommandClient = { command };
    const controller = new AbortController();

    await expect(
      loadDiscoveryLibraryStatuses(client, { probes: [{}] }, { signal: controller.signal }),
    ).resolves.toEqual({ statuses: [{ hasPdf: false, workId: "work-1" }] });
    expect(command).toHaveBeenCalledWith("discovery.getLibraryStatus", { probes: [{}] });

    controller.abort();
    await expect(
      loadDiscoveryLibraryStatuses(client, { probes: [{}] }, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(command).toHaveBeenCalledOnce();
  });

  it("chunks larger result sets while preserving positional status order", async () => {
    const command = vi
      .fn()
      .mockImplementation(async (_name: string, input: { probes: Array<{ doi?: string }> }) => ({
        statuses: input.probes.map((probe) => ({
          hasPdf: probe.doi !== undefined,
          workId: probe.doi ?? null,
        })),
      }));
    const client: DiscoveryLibraryStatusCommandClient = { command };
    const probes = Array.from({ length: 201 }, (_, index) => ({ doi: `10.1000/${index}` }));

    await expect(loadDiscoveryLibraryStatuses(client, { probes })).resolves.toEqual({
      statuses: probes.map((probe) => ({ hasPdf: true, workId: probe.doi })),
    });
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls.map(([, input]) => input.probes)).toEqual([
      probes.slice(0, 200),
      probes.slice(200),
    ]);
  });
});
