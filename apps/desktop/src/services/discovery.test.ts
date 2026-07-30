import type { DiscoveryResult } from "@aurascholar/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLibraryDb: vi.fn(),
  query: vi.fn(),
}));

vi.mock("./aura-db", () => ({
  getLibraryDb: mocks.getLibraryDb,
}));

vi.mock("./aura-platform", () => ({
  auraHttp: {},
}));

import { markLibraryStatus } from "./discovery";

const result: DiscoveryResult = {
  id: "crossref:10.1000/paper:0",
  score: 10,
  source: "crossref",
  work: {
    authors: [],
    doi: "10.1000/paper",
    source: "crossref",
    title: "Discovery paper",
    year: 2026,
  },
};

describe("discovery library status", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { aura: {} });
    mocks.getLibraryDb.mockResolvedValue({
      db: { query: mocks.query },
      libraryId: "library-1",
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attachments")) return [];
      if (sql.includes("doi IN")) return [{ doi: "10.1000/paper", id: "work-1" }];
      return [];
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks a library match without a PDF as needing full text", async () => {
    await expect(markLibraryStatus([result])).resolves.toEqual([
      expect.objectContaining({
        inLibrary: true,
        libraryWorkId: "work-1",
        needsFulltext: true,
      }),
    ]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("FROM attachments"), [
      "library-1",
      "work-1",
    ]);
  });

  it("recognizes an active PDF attachment on a fresh search", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attachments")) return [{ work_id: "work-1" }];
      if (sql.includes("doi IN")) return [{ doi: "10.1000/paper", id: "work-1" }];
      return [];
    });

    await expect(markLibraryStatus([result])).resolves.toEqual([
      expect.objectContaining({
        inLibrary: true,
        libraryWorkId: "work-1",
        needsFulltext: false,
      }),
    ]);
  });

  it("does not use a fingerprint fallback when the stored DOI conflicts", async () => {
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("doi IN")) return [];
      if (sql.includes("fingerprint IN")) {
        return [
          {
            arxiv_id: null,
            doi: "10.1000/different",
            fingerprint: params[1],
            id: "different-work",
            openalex_id: null,
            pmid: null,
            s2_id: null,
          },
        ];
      }
      return [];
    });

    await expect(markLibraryStatus([result])).resolves.toEqual([
      expect.objectContaining({
        inLibrary: false,
        libraryWorkId: undefined,
        needsFulltext: undefined,
      }),
    ]);
  });

  it("selects the sole compatible fingerprint candidate regardless of SQL row order", async () => {
    const fingerprintRows = [
      {
        arxiv_id: null,
        doi: "10.1000/different",
        fingerprint: "",
        id: "conflicting-work",
        openalex_id: null,
        pmid: null,
        s2_id: null,
      },
      {
        arxiv_id: null,
        doi: null,
        fingerprint: "",
        id: "compatible-work",
        openalex_id: "W-compatible",
        pmid: null,
        s2_id: null,
      },
    ];
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("doi IN")) return [];
      if (sql.includes("fingerprint IN")) {
        return fingerprintRows.map((row) => ({ ...row, fingerprint: params[1] }));
      }
      return [];
    });

    const forward = await markLibraryStatus([result]);
    fingerprintRows.reverse();
    const reversed = await markLibraryStatus([result]);

    for (const match of [forward[0], reversed[0]]) {
      expect(match).toEqual(
        expect.objectContaining({
          inLibrary: true,
          libraryWorkId: "compatible-work",
          needsFulltext: true,
        }),
      );
    }
  });

  it("does not use an ambiguous fingerprint fallback", async () => {
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("doi IN")) return [];
      if (sql.includes("fingerprint IN")) {
        return ["work-a", "work-b"].map((id) => ({
          arxiv_id: null,
          doi: null,
          fingerprint: params[1],
          id,
          openalex_id: null,
          pmid: null,
          s2_id: null,
        }));
      }
      return [];
    });

    await expect(markLibraryStatus([result])).resolves.toEqual([
      expect.objectContaining({
        inLibrary: false,
        libraryWorkId: undefined,
        needsFulltext: undefined,
      }),
    ]);
    expect(mocks.query).not.toHaveBeenCalledWith(
      expect.stringContaining("FROM attachments"),
      expect.anything(),
    );
  });

  it("normalizes duplicate compatible fingerprint rows for one work", async () => {
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("doi IN")) return [];
      if (sql.includes("fingerprint IN")) {
        return [
          {
            arxiv_id: null,
            doi: null,
            fingerprint: params[1],
            id: "same-work",
            openalex_id: "W-compatible",
            pmid: null,
            s2_id: null,
          },
          {
            arxiv_id: null,
            doi: null,
            fingerprint: params[1],
            id: "same-work",
            openalex_id: null,
            pmid: null,
            s2_id: "S2-compatible",
          },
        ];
      }
      return [];
    });

    await expect(markLibraryStatus([result])).resolves.toEqual([
      expect.objectContaining({
        inLibrary: true,
        libraryWorkId: "same-work",
        needsFulltext: true,
      }),
    ]);
  });
});
