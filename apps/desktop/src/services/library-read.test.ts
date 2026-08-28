import type { AttachmentRow } from "@aurascholar/db/repos/attachments";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReaderPdfIpcBusyError,
  createReaderPdfIpcLimitError,
} from "../../electron/reader-pdf-ipc-limit";

const mocks = vi.hoisted(() => ({
  loadAttachmentPdf: vi.fn(),
  loadCandidates: vi.fn(),
}));

vi.mock("./reader-session-data", () => ({
  loadReaderAttachmentPdf: mocks.loadAttachmentPdf,
  loadReaderWorkPdfCandidates: mocks.loadCandidates,
}));

import {
  loadPdfForWork,
  loadPdfFromCandidates,
  ReaderPdfBusyError,
  ReaderPdfTooLargeError,
} from "./library-read";

function attachment(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: "attachment-1",
    work_id: "work-1",
    kind: "pdf",
    sha256: "sha-1",
    byte_size: 123,
    original_filename: "paper.pdf",
    fetched_via: "local",
    page_count: 8,
    created_at: 1,
    ...overrides,
  };
}

describe("library PDF reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAttachmentPdf.mockResolvedValue({ data: new Uint8Array([7, 8, 9]) });
  });

  it("loads typed Reader candidates and falls back to the next readable PDF", async () => {
    const first = attachment({ id: "pdf-broken", sha256: "broken" });
    const second = attachment({ id: "pdf-readable", sha256: "readable" });
    mocks.loadCandidates.mockResolvedValue({ work: null, pdfAttachments: [first, second] });
    mocks.loadAttachmentPdf
      .mockRejectedValueOnce(new Error("first blob password=private-token"))
      .mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]) });

    await expect(loadPdfForWork("work-1")).resolves.toEqual({
      attachmentId: "pdf-readable",
      data: new Uint8Array([1, 2, 3]),
    });
    expect(mocks.loadCandidates).toHaveBeenCalledWith("work-1");
    expect(mocks.loadAttachmentPdf).toHaveBeenNthCalledWith(1, "work-1", "pdf-broken");
    expect(mocks.loadAttachmentPdf).toHaveBeenNthCalledWith(2, "work-1", "pdf-readable");
  });

  it("uses only the explicitly requested PDF and rejects a missing preference", async () => {
    const first = attachment({ id: "pdf-first", sha256: "first" });
    const second = attachment({ id: "pdf-selected", sha256: "selected" });

    await expect(loadPdfFromCandidates("work-1", [first, second], "pdf-selected")).resolves.toEqual(
      {
        attachmentId: "pdf-selected",
        data: new Uint8Array([7, 8, 9]),
      },
    );
    expect(mocks.loadAttachmentPdf).toHaveBeenCalledOnce();
    expect(mocks.loadAttachmentPdf).toHaveBeenCalledWith("work-1", "pdf-selected");

    await expect(loadPdfFromCandidates("work-1", [first, second], "removed-pdf")).rejects.toThrow(
      "指定的 PDF 附件不存在或已被移除",
    );
  });

  it("falls back from an oversized automatic candidate but preserves its semantic failure when selected", async () => {
    const oversized = attachment({ id: "pdf-oversized", sha256: "oversized" });
    const readable = attachment({ id: "pdf-readable", sha256: "readable" });
    mocks.loadAttachmentPdf
      .mockRejectedValueOnce(createReaderPdfIpcLimitError())
      .mockResolvedValueOnce({ data: new Uint8Array([4, 5, 6]) });

    await expect(loadPdfFromCandidates("work-1", [oversized, readable])).resolves.toEqual({
      attachmentId: "pdf-readable",
      data: new Uint8Array([4, 5, 6]),
    });

    mocks.loadAttachmentPdf.mockRejectedValueOnce(createReaderPdfIpcLimitError());
    await expect(
      loadPdfFromCandidates("work-1", [oversized, readable], oversized.id),
    ).rejects.toBeInstanceOf(ReaderPdfTooLargeError);

    mocks.loadAttachmentPdf.mockRejectedValueOnce(
      new Error(`Error invoking remote method: ${createReaderPdfIpcLimitError().message}`),
    );
    await expect(loadPdfFromCandidates("work-1", [oversized], oversized.id)).rejects.toBeInstanceOf(
      ReaderPdfTooLargeError,
    );

    mocks.loadAttachmentPdf.mockRejectedValueOnce({
      message: createReaderPdfIpcLimitError().message,
    });
    await expect(loadPdfFromCandidates("work-1", [oversized], oversized.id)).rejects.toBeInstanceOf(
      ReaderPdfTooLargeError,
    );

    mocks.loadAttachmentPdf.mockRejectedValueOnce(createReaderPdfIpcBusyError());
    await expect(loadPdfFromCandidates("work-1", [oversized], oversized.id)).rejects.toBeInstanceOf(
      ReaderPdfBusyError,
    );
  });

  it("returns null without file access when the work has no PDF candidates", async () => {
    mocks.loadCandidates.mockResolvedValue({ work: null, pdfAttachments: [] });

    await expect(loadPdfForWork("work-1")).resolves.toBeNull();
    expect(mocks.loadAttachmentPdf).not.toHaveBeenCalled();
  });

  it("surfaces only a safe error after every candidate fails", async () => {
    mocks.loadAttachmentPdf.mockRejectedValue(new Error("blob password=private-token unavailable"));

    await expect(loadPdfFromCandidates("work-1", [attachment()])).rejects.toThrow(
      "PDF 附件文件无法读取:blob password=[redacted] unavailable",
    );
  });
});
