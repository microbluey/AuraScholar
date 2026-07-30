import type { NormalizedWork } from "@aurascholar/connectors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachmentsForWork: vi.fn(),
  getLibraryDb: vi.fn(),
  worksUpsert: vi.fn(),
}));

vi.mock("@aurascholar/core", () => ({
  clueFromInput: vi.fn(),
  cluesFromPdfSource: vi.fn(),
  findOaPdf: vi.fn(),
  resolveClue: vi.fn(),
  titleCandidatesFromPdfSource: vi.fn(),
}));

vi.mock("@aurascholar/db/repos/attachments", () => ({
  AttachmentsRepo: class {
    forWork = mocks.attachmentsForWork;
  },
}));

vi.mock("@aurascholar/db/repos/works", () => ({
  WorksRepo: class {
    upsert = mocks.worksUpsert;
  },
}));

vi.mock("@aurascholar/reader", () => ({
  configureWorker: vi.fn(),
  PdfDocument: class {},
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "pdf.worker.js",
}));

vi.mock("./aura-db", () => ({
  getLibraryDb: mocks.getLibraryDb,
}));

vi.mock("./aura-platform", () => ({
  auraFs: {},
  auraHttp: {},
  blobPath: vi.fn(),
  sha256Hex: vi.fn(),
}));

vi.mock("./work-input", () => ({
  toWorkInput: vi.fn((work: NormalizedWork) => work),
}));

import { ingestResolvedWork } from "./library";

describe("library resolved-work ingest", () => {
  const work: NormalizedWork = {
    authors: [],
    doi: "10.1000/committed",
    source: "crossref",
    title: "Committed metadata",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLibraryDb.mockResolvedValue({ db: {}, libraryId: "library-1" });
    mocks.worksUpsert.mockResolvedValue({ deduped: false, id: "work-1" });
  });

  it("keeps the successful work upsert when subsequent PDF attachment lookup fails", async () => {
    mocks.attachmentsForWork.mockRejectedValueOnce(
      new Error("attachment lookup failed; password=private-token"),
    );

    await expect(ingestResolvedWork(work)).resolves.toEqual({
      deduped: false,
      needsConfirmation: undefined,
      pdfError: "attachment lookup failed; password=[redacted]",
      pdfFetched: false,
      title: "Committed metadata",
      workId: "work-1",
    });
    expect(mocks.worksUpsert).toHaveBeenCalledOnce();
    expect(mocks.attachmentsForWork).toHaveBeenCalledWith("work-1");
  });
});
