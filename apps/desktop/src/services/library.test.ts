import type { NormalizedWork } from "@aurascholar/connectors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clueFromInput: vi.fn(),
  cluesFromPdfSource: vi.fn(),
  discardStagedPdf: vi.fn(),
  ensureOaPdfAttachment: vi.fn(),
  finalizeIngest: vi.fn(),
  findIngestDedup: vi.fn(),
  pdfDestroy: vi.fn(),
  pdfLoad: vi.fn(),
  resolveLibraryScholarlyClue: vi.fn(),
  searchWorksByMetadata: vi.fn(),
  sha256Hex: vi.fn(),
  stagePdf: vi.fn(),
  restoreAnnotationsForAttachment: vi.fn(),
  titleCandidatesFromPdfSource: vi.fn(),
}));

vi.mock("@aurascholar/core", () => ({
  clueFromInput: mocks.clueFromInput,
  cluesFromPdfSource: mocks.cluesFromPdfSource,
  titleCandidatesFromPdfSource: mocks.titleCandidatesFromPdfSource,
}));

vi.mock("./scholarly-data", () => ({
  resolveLibraryScholarlyClue: mocks.resolveLibraryScholarlyClue,
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

vi.mock("./library-annotation-recovery", () => ({
  restoreAnnotationsForAttachment: mocks.restoreAnnotationsForAttachment,
}));

vi.mock("./library-actions", () => ({
  discardStagedPdf: mocks.discardStagedPdf,
  finalizeIngest: mocks.finalizeIngest,
  findIngestDedup: mocks.findIngestDedup,
  stagePdf: mocks.stagePdf,
}));

vi.mock("./library-list", () => ({
  searchWorksByMetadata: mocks.searchWorksByMetadata,
}));

vi.mock("./library-oa", () => ({
  ensureOaPdfAttachment: mocks.ensureOaPdfAttachment,
}));

vi.mock("./aura-platform", () => ({
  sha256Hex: mocks.sha256Hex,
}));

vi.mock("./work-input", () => ({
  toWorkInput: vi.fn((work: NormalizedWork) => work),
}));

import {
  analyzeInput,
  analyzeResearchDownloadPdf,
  attachPdfToWork,
  ingestResolvedWork,
} from "./library";

describe("library resolved-work ingest", () => {
  const work: NormalizedWork = {
    authors: [],
    doi: "10.1000/committed",
    source: "crossref",
    title: "Committed metadata",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clueFromInput.mockReturnValue(null);
    mocks.cluesFromPdfSource.mockReturnValue([]);
    mocks.findIngestDedup.mockResolvedValue({ hit: null });
    mocks.ensureOaPdfAttachment.mockResolvedValue(false);
    mocks.resolveLibraryScholarlyClue.mockResolvedValue({ resolved: null });
    mocks.searchWorksByMetadata.mockResolvedValue([]);
    mocks.sha256Hex.mockResolvedValue("pdf-sha");
    mocks.titleCandidatesFromPdfSource.mockReturnValue([]);
    mocks.restoreAnnotationsForAttachment.mockResolvedValue(0);
    mocks.discardStagedPdf.mockResolvedValue(undefined);
    mocks.finalizeIngest.mockResolvedValue({
      attachment: { deduped: false, id: "attachment-1" },
      deduped: false,
      pdfFetched: false,
      title: "Committed metadata",
      workId: "work-1",
    });
    mocks.stagePdf.mockResolvedValue({
      byteSize: 1_100,
      sha: "pdf-sha",
      stageId: "s".repeat(43),
    });
    mocks.pdfLoad.mockResolvedValue({
      destroy: mocks.pdfDestroy,
      getMetadata: vi.fn().mockResolvedValue({}),
      getPageTextLines: vi.fn().mockResolvedValue([]),
      pageCount: 3,
    });
  });

  it("keeps the main-process metadata commit when OA attachment fails", async () => {
    mocks.ensureOaPdfAttachment.mockRejectedValueOnce(
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
    expect(mocks.finalizeIngest).toHaveBeenCalledOnce();
    expect(mocks.finalizeIngest).toHaveBeenCalledWith({
      mode: "create",
      pdf: null,
      workInput: work,
    });
    expect(mocks.ensureOaPdfAttachment).toHaveBeenCalledWith("work-1");
  });

  it("uses the main-owned OA attachment command after metadata is committed", async () => {
    mocks.ensureOaPdfAttachment.mockResolvedValue(true);
    await expect(ingestResolvedWork(work)).resolves.toMatchObject({
      pdfFetched: true,
      workId: "work-1",
    });
    expect(mocks.ensureOaPdfAttachment).toHaveBeenCalledWith("work-1");
    expect(mocks.finalizeIngest).toHaveBeenCalledTimes(1);
  });

  it("keeps the prior false result when main cannot obtain an OA PDF", async () => {
    await expect(ingestResolvedWork(work)).resolves.toMatchObject({ pdfFetched: false });
    expect(mocks.ensureOaPdfAttachment).toHaveBeenCalledWith("work-1");
  });

  it("keeps browser provenance without exposing a temporary filesystem path", async () => {
    const analyzed = await analyzeResearchDownloadPdf("captured.pdf", pdfBytes());

    expect(analyzed).toMatchObject({
      source: "browser",
      pdf: {
        fetchedVia: "research-download",
        stageId: "s".repeat(43),
      },
    });
  });

  it("stages an exact duplicate so an explicit target can reuse its blob", async () => {
    mocks.findIngestDedup.mockResolvedValue({
      hit: {
        pageCount: 3,
        reason: "exact-file",
        title: "Existing paper",
        workId: "existing-work",
      },
    });

    const analyzed = await analyzeResearchDownloadPdf("duplicate.pdf", pdfBytes());

    expect(analyzed).toMatchObject({
      dedup: {
        reason: "exact-file",
        title: "Existing paper",
        workId: "existing-work",
      },
      pdf: {
        sha: "pdf-sha",
        stageId: "s".repeat(43),
      },
    });
    expect(mocks.findIngestDedup).toHaveBeenCalledWith({
      kind: "attachmentSha",
      sha256: "pdf-sha",
    });
  });

  it("uses the scoped dedup lookup for a DOI before resolving remote candidates", async () => {
    mocks.clueFromInput.mockReturnValue({ kind: "doi", doi: "10.1000/local" });
    mocks.findIngestDedup.mockResolvedValue({
      hit: { reason: "doi", title: "Local DOI work", workId: "existing-work" },
    });

    await expect(analyzeInput("10.1000/local")).resolves.toMatchObject({
      dedup: { reason: "doi", title: "Local DOI work", workId: "existing-work" },
      localMatches: [],
    });
    expect(mocks.findIngestDedup).toHaveBeenCalledWith({
      doi: "10.1000/local",
      kind: "doi",
    });
    expect(mocks.resolveLibraryScholarlyClue).not.toHaveBeenCalled();
  });

  it("uses the scoped metadata-search facade for local title candidates", async () => {
    mocks.clueFromInput.mockReturnValue({ kind: "title", title: "Long local title" });
    mocks.resolveLibraryScholarlyClue.mockResolvedValue({
      resolved: {
        candidates: [],
        confidence: 0,
        work: { authors: [], source: "crossref", title: "Resolved title" },
      },
    });
    mocks.searchWorksByMetadata.mockResolvedValue([
      {
        authorNames: ["Ada Lovelace"],
        doi: "10.1000/local",
        id: "existing-work",
        title: "Long local title",
        year: 2026,
      },
    ]);

    await expect(analyzeInput("Long local title")).resolves.toMatchObject({
      localMatches: [
        {
          authors: ["Ada Lovelace"],
          doi: "10.1000/local",
          title: "Long local title",
          workId: "existing-work",
          year: 2026,
        },
      ],
    });
    expect(mocks.searchWorksByMetadata).toHaveBeenCalledWith("Long local title", 5);
  });

  it("returns the main-process annotation repair count after attaching a PDF", async () => {
    mocks.restoreAnnotationsForAttachment.mockResolvedValue(3);

    await expect(attachPdfToWork("work-1", "replacement.pdf", pdfBytes())).resolves.toEqual({
      attachmentId: "attachment-1",
      deduped: false,
      pageCount: 3,
      restoredAnnotationCount: 3,
    });

    expect(mocks.restoreAnnotationsForAttachment).toHaveBeenCalledWith("work-1", "attachment-1");
    expect(mocks.finalizeIngest).toHaveBeenCalledWith({
      mode: "attach",
      pdf: expect.objectContaining({
        fetchedVia: "manual",
        fileName: "replacement.pdf",
        stageId: "s".repeat(43),
      }),
      workId: "work-1",
    });
  });

  it("propagates annotation recovery failures after the attachment is created", async () => {
    const failure = new Error("annotation recovery failed");
    mocks.restoreAnnotationsForAttachment.mockRejectedValue(failure);

    await expect(attachPdfToWork("work-1", "replacement.pdf", pdfBytes())).rejects.toBe(failure);
    expect(mocks.finalizeIngest).toHaveBeenCalledOnce();
    expect(mocks.discardStagedPdf).not.toHaveBeenCalled();
  });

  it("releases a manual staging receipt when the typed attachment command rejects", async () => {
    const failure = new Error("target removed");
    mocks.finalizeIngest.mockRejectedValueOnce(failure);

    await expect(attachPdfToWork("work-missing", "replacement.pdf", pdfBytes())).rejects.toBe(
      failure,
    );
    expect(mocks.discardStagedPdf).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: "s".repeat(43) }),
    );
  });
});

function pdfBytes(): Uint8Array {
  const bytes = new Uint8Array(1100);
  bytes.set(new TextEncoder().encode("%PDF-1.7"));
  return bytes;
}
