import type { NormalizedWork } from "@aurascholar/connectors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachmentsCreate: vi.fn(),
  attachmentsForWork: vi.fn(),
  attachmentsBySha: vi.fn(),
  cluesFromPdfSource: vi.fn(),
  findOaPdfCandidates: vi.fn(),
  fsExists: vi.fn(),
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  getLibraryDb: vi.fn(),
  httpRequest: vi.fn(),
  pdfDestroy: vi.fn(),
  pdfLoad: vi.fn(),
  sha256Hex: vi.fn(),
  worksUpsert: vi.fn(),
  worksGet: vi.fn(),
  worksList: vi.fn(),
  titleCandidatesFromPdfSource: vi.fn(),
}));

vi.mock("@aurascholar/core", () => ({
  clueFromInput: vi.fn(),
  cluesFromPdfSource: mocks.cluesFromPdfSource,
  findOaPdfCandidates: mocks.findOaPdfCandidates,
  resolveClue: vi.fn(),
  titleCandidatesFromPdfSource: mocks.titleCandidatesFromPdfSource,
}));

vi.mock("@aurascholar/db/repos/attachments", () => ({
  AttachmentsRepo: class {
    bySha = mocks.attachmentsBySha;
    create = mocks.attachmentsCreate;
    forWork = mocks.attachmentsForWork;
  },
}));

vi.mock("@aurascholar/db/repos/works", () => ({
  WorksRepo: class {
    get = mocks.worksGet;
    list = mocks.worksList;
    upsert = mocks.worksUpsert;
  },
}));

vi.mock("@aurascholar/reader", () => ({
  configureWorker: vi.fn(),
  PdfDocument: class {
    static load = mocks.pdfLoad;
  },
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "pdf.worker.js",
}));

vi.mock("./aura-db", () => ({
  getLibraryDb: mocks.getLibraryDb,
}));

vi.mock("./aura-platform", () => ({
  auraFs: {
    exists: mocks.fsExists,
    readFile: mocks.fsReadFile,
    writeFile: mocks.fsWriteFile,
  },
  auraHttp: { request: mocks.httpRequest },
  blobPath: vi.fn((sha: string) => `blobs/${sha}.pdf`),
  sha256Hex: mocks.sha256Hex,
}));

vi.mock("./work-input", () => ({
  toWorkInput: vi.fn((work: NormalizedWork) => work),
}));

import { analyzeResearchDownloadPdf, ingestResolvedWork } from "./library";

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
    mocks.attachmentsCreate.mockResolvedValue({ deduped: false, id: "attachment-1" });
    mocks.attachmentsBySha.mockResolvedValue(null);
    mocks.cluesFromPdfSource.mockReturnValue([]);
    mocks.findOaPdfCandidates.mockResolvedValue([]);
    mocks.sha256Hex.mockResolvedValue("pdf-sha");
    mocks.titleCandidatesFromPdfSource.mockReturnValue([]);
    mocks.worksList.mockResolvedValue([]);
    mocks.pdfLoad.mockResolvedValue({
      destroy: mocks.pdfDestroy,
      getMetadata: vi.fn().mockResolvedValue({}),
      getPageTextLines: vi.fn().mockResolvedValue([]),
      pageCount: 3,
    });
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

  it("ignores non-PDF attachments and falls back across invalid OA candidates", async () => {
    mocks.attachmentsForWork.mockResolvedValue([
      {
        id: "supplement-1",
        kind: "supplement",
        sha256: "supplement-sha",
      },
    ]);
    mocks.findOaPdfCandidates.mockResolvedValue([
      { url: "https://publisher.test/paywall.pdf", via: "unpaywall" },
      { url: "https://arxiv.org/pdf/2607.01234", via: "arxiv" },
    ]);
    mocks.httpRequest
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: new TextEncoder().encode("<html>paywall</html>"),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: pdfBytes(),
      });

    await expect(ingestResolvedWork(work)).resolves.toMatchObject({
      pdfFetched: true,
      workId: "work-1",
    });
    expect(mocks.httpRequest).toHaveBeenCalledTimes(2);
    expect(mocks.attachmentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchedVia: "arxiv",
        pageCount: 3,
        sourceUrl: "https://arxiv.org/pdf/2607.01234",
        workId: "work-1",
      }),
    );
  });

  it("repairs a missing PDF blob instead of treating its database row as readable", async () => {
    mocks.attachmentsForWork.mockResolvedValue([
      {
        id: "attachment-stale",
        kind: "pdf",
        sha256: "missing-sha",
      },
    ]);
    mocks.fsExists.mockResolvedValue(false);
    mocks.findOaPdfCandidates.mockResolvedValue([
      { url: "https://repository.test/repaired.pdf", via: "openalex" },
    ]);
    mocks.httpRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: pdfBytes(),
    });

    await expect(ingestResolvedWork(work)).resolves.toMatchObject({ pdfFetched: true });
    expect(mocks.fsExists).toHaveBeenCalledWith("blobs/missing-sha.pdf");
    expect(mocks.fsWriteFile).toHaveBeenCalledWith("blobs/pdf-sha.pdf", expect.any(Uint8Array));
  });

  it("continues after a PDF-shaped OA payload fails document validation", async () => {
    mocks.attachmentsForWork.mockResolvedValue([]);
    mocks.findOaPdfCandidates.mockResolvedValue([
      { url: "https://repository.test/corrupt.pdf", via: "unpaywall" },
      { url: "https://repository.test/valid.pdf", via: "openalex" },
    ]);
    mocks.httpRequest.mockResolvedValue({
      status: 200,
      headers: {},
      body: pdfBytes(),
    });
    mocks.pdfLoad.mockRejectedValueOnce(new Error("corrupt xref"));

    await expect(ingestResolvedWork(work)).resolves.toMatchObject({ pdfFetched: true });
    expect(mocks.httpRequest).toHaveBeenCalledTimes(2);
    expect(mocks.attachmentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchedVia: "openalex",
        sourceUrl: "https://repository.test/valid.pdf",
      }),
    );
  });

  it("does not fetch again when an existing PDF blob is readable", async () => {
    mocks.attachmentsForWork.mockResolvedValue([
      {
        id: "attachment-ready",
        kind: "pdf",
        sha256: "ready-sha",
      },
    ]);
    mocks.fsExists.mockResolvedValue(true);
    mocks.fsReadFile.mockResolvedValue(pdfBytes());

    await expect(ingestResolvedWork(work)).resolves.toMatchObject({ pdfFetched: true });
    expect(mocks.findOaPdfCandidates).not.toHaveBeenCalled();
    expect(mocks.httpRequest).not.toHaveBeenCalled();
    expect(mocks.attachmentsCreate).not.toHaveBeenCalled();
  });

  it("keeps the exact browser temp path when page citation metadata is unavailable", async () => {
    const analyzed = await analyzeResearchDownloadPdf(
      "captured.pdf",
      pdfBytes(),
      "research-downloads/captured.pdf",
    );

    expect(analyzed).toMatchObject({
      source: "browser",
      pdf: {
        fetchedVia: "research-download",
        relPath: "research-downloads/captured.pdf",
      },
    });
  });

  it("stages an exact duplicate so an explicit target can reuse its blob", async () => {
    mocks.attachmentsBySha.mockResolvedValue({
      id: "existing-attachment",
      kind: "pdf",
      page_count: 3,
      sha256: "pdf-sha",
      work_id: "existing-work",
    });
    mocks.worksGet.mockResolvedValue({ id: "existing-work", title: "Existing paper" });

    const analyzed = await analyzeResearchDownloadPdf(
      "duplicate.pdf",
      pdfBytes(),
      "research-downloads/duplicate.pdf",
    );

    expect(analyzed).toMatchObject({
      dedup: {
        reason: "exact-file",
        title: "Existing paper",
        workId: "existing-work",
      },
      pdf: {
        relPath: "research-downloads/duplicate.pdf",
        sha: "pdf-sha",
      },
    });
  });
});

function pdfBytes(): Uint8Array {
  const bytes = new Uint8Array(1100);
  bytes.set(new TextEncoder().encode("%PDF-1.7"));
  return bytes;
}
