import type { AttachmentRow } from "@aurascholar/db/repos/attachments";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCandidates: vi.fn(),
  readBlobPdf: vi.fn(),
}));

vi.mock("./aura-platform", () => ({
  auraFiles: {
    readBlobPdf: mocks.readBlobPdf,
  },
}));

vi.mock("./reader-session-data", () => ({
  loadReaderWorkPdfCandidates: mocks.loadCandidates,
}));

import { loadPdfForWork, loadPdfFromCandidates } from "./library-read";

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
    mocks.readBlobPdf.mockResolvedValue(new Uint8Array([7, 8, 9]));
  });

  it("loads typed Reader candidates and falls back to the next readable PDF", async () => {
    const first = attachment({ id: "pdf-broken", sha256: "broken" });
    const second = attachment({ id: "pdf-readable", sha256: "readable" });
    mocks.loadCandidates.mockResolvedValue({ work: null, pdfAttachments: [first, second] });
    mocks.readBlobPdf
      .mockRejectedValueOnce(new Error("first blob password=private-token"))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    await expect(loadPdfForWork("work-1")).resolves.toEqual({
      attachmentId: "pdf-readable",
      data: new Uint8Array([1, 2, 3]),
    });
    expect(mocks.loadCandidates).toHaveBeenCalledWith("work-1");
    expect(mocks.readBlobPdf).toHaveBeenCalledWith("broken");
    expect(mocks.readBlobPdf).toHaveBeenCalledWith("readable");
  });

  it("uses only the explicitly requested PDF and rejects a missing preference", async () => {
    const first = attachment({ id: "pdf-first", sha256: "first" });
    const second = attachment({ id: "pdf-selected", sha256: "selected" });

    await expect(loadPdfFromCandidates([first, second], "pdf-selected")).resolves.toEqual({
      attachmentId: "pdf-selected",
      data: new Uint8Array([7, 8, 9]),
    });
    expect(mocks.readBlobPdf).toHaveBeenCalledOnce();
    expect(mocks.readBlobPdf).toHaveBeenCalledWith("selected");

    await expect(loadPdfFromCandidates([first, second], "removed-pdf")).rejects.toThrow(
      "指定的 PDF 附件不存在或已被移除",
    );
  });

  it("returns null without file access when the work has no PDF candidates", async () => {
    mocks.loadCandidates.mockResolvedValue({ work: null, pdfAttachments: [] });

    await expect(loadPdfForWork("work-1")).resolves.toBeNull();
    expect(mocks.readBlobPdf).not.toHaveBeenCalled();
  });

  it("surfaces only a safe error after every candidate fails", async () => {
    mocks.readBlobPdf.mockRejectedValue(new Error("blob password=private-token unavailable"));

    await expect(loadPdfFromCandidates([attachment()])).rejects.toThrow(
      "PDF 附件文件无法读取:blob password=[redacted] unavailable",
    );
  });
});
