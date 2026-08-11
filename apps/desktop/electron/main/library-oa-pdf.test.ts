import type { WorkWithAuthors } from "@aurascholar/db/repos/works";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOaPdfCandidates: vi.fn(),
  resolveScholarlyClue: vi.fn(),
}));

vi.mock("@aurascholar/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@aurascholar/core")>();
  return { ...original, findOaPdfCandidates: mocks.findOaPdfCandidates };
});

vi.mock("./scholarly-commands", () => ({
  resolveScholarlyClue: mocks.resolveScholarlyClue,
}));

import { findMainOaPdfCandidates } from "./library-oa-pdf";

describe("main OA candidate derivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOaPdfCandidates.mockResolvedValue([]);
    mocks.resolveScholarlyClue.mockResolvedValue(null);
  });

  it("adds a persisted tokenized HTTPS URL as a final main-derived fallback", async () => {
    mocks.resolveScholarlyClue.mockResolvedValue({
      work: {
        authors: [],
        oaPdfUrl: "https://open.example/remote.pdf",
        source: "openalex",
        title: "x",
      },
    });
    mocks.findOaPdfCandidates.mockResolvedValue([
      { url: "https://unpaywall.example/paper.pdf", via: "unpaywall" },
      { url: "https://open.example/remote.pdf", via: "openalex" },
    ]);

    await expect(
      findMainOaPdfCandidates(work({ url: "https://publisher.example/download?ticket=opaque" })),
    ).resolves.toEqual([
      { url: "https://unpaywall.example/paper.pdf", via: "unpaywall" },
      { url: "https://open.example/remote.pdf", via: "openalex" },
      { url: "https://publisher.example/download?ticket=opaque", via: "openalex" },
    ]);
    expect(mocks.findOaPdfCandidates).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ oaPdfUrl: "https://open.example/remote.pdf" }),
    );
  });

  it("does not duplicate a persisted URL already supplied by fixed metadata lookup", async () => {
    mocks.findOaPdfCandidates.mockResolvedValue([
      { url: "https://publisher.example/download?ticket=opaque", via: "openalex" },
    ]);

    await expect(
      findMainOaPdfCandidates(
        work({ url: "https://publisher.example/download?ticket=opaque#ignored" }),
      ),
    ).resolves.toEqual([
      { url: "https://publisher.example/download?ticket=opaque", via: "openalex" },
    ]);
  });

  it("does not turn non-HTTPS or malformed stored metadata into a candidate", async () => {
    await expect(
      findMainOaPdfCandidates(work({ doi: null, url: "http://publisher.example/paper.pdf" })),
    ).resolves.toEqual([]);
    await expect(findMainOaPdfCandidates(work({ doi: null, url: "not a URL" }))).resolves.toEqual(
      [],
    );
    expect(mocks.resolveScholarlyClue).not.toHaveBeenCalled();
  });
});

function work(overrides: Partial<WorkWithAuthors> = {}): WorkWithAuthors {
  return {
    abstract: null,
    accession_number: null,
    accessed_date: null,
    arxiv_id: null,
    authorNames: [],
    call_number: null,
    created_at: 0,
    database_name: null,
    deleted_at: null,
    doi: "10.1000/main-oa",
    edition: null,
    fingerprint: null,
    id: "work-1",
    isbn: null,
    issn: null,
    issue: null,
    keywords_json: null,
    label: null,
    language: null,
    library_id: "library-1",
    notes_md: null,
    number_of_volumes: null,
    openalex_id: null,
    original_title: null,
    pages: null,
    place_published: null,
    pmid: null,
    publication_date: null,
    publisher: null,
    reading_status: "unread",
    s2_id: null,
    section: null,
    series_title: null,
    short_title: null,
    starred: 0,
    title: "Main OA work",
    type: "article",
    updated_at: 0,
    url: null,
    venue_name: null,
    venue_type: null,
    volume: null,
    year: null,
    ...overrides,
  };
}
