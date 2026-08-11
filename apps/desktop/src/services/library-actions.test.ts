import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardStagedPdf,
  finalizeDedupIngest,
  finalizeIngest,
  findIngestDedup,
  stagePdf,
} from "./library-actions";
import type { PendingPdf } from "./library-types";

const stagedPdf: PendingPdf = {
  byteSize: 1_024,
  fetchedVia: "research-download",
  fileName: "downloaded-paper.pdf",
  pageCount: 8,
  relPath: "research-downloads/temporary-paper.pdf",
  sha: "b".repeat(64),
  stageId: "s".repeat(43),
};

describe("library ingest action facade", () => {
  const command = vi.fn();
  const deleteFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { aura: { data: { command }, fs: { deleteFile } } });
    command.mockResolvedValue({ released: true });
    deleteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a create decision through the typed command without exposing a staged temp path", async () => {
    const result = {
      attachment: { deduped: false, id: "attachment-1" },
      deduped: false,
      pdfFetched: true,
      title: "Create through main",
      workId: "work-1",
    };
    command.mockResolvedValue(result);

    await expect(
      finalizeIngest({
        mode: "create",
        pdf: stagedPdf,
        workInput: { doi: "10.4242/facade", title: "Create through main" },
      }),
    ).resolves.toBe(result);

    expect(command).toHaveBeenCalledWith("library.finalizeIngest", {
      mode: "create",
      pdf: {
        fetchedVia: "research-download",
        fileName: "downloaded-paper.pdf",
        pageCount: 8,
        stageId: "s".repeat(43),
      },
      workInput: { doi: "10.4242/facade", title: "Create through main" },
    });
    expect(command.mock.calls[0]?.[1].pdf).not.toHaveProperty("relPath");
  });

  it("forwards active-work attach decisions and preserves the attachment dedup result", async () => {
    const result = {
      attachment: { deduped: true, id: "attachment-existing" },
      deduped: true,
      pdfFetched: true,
      title: "Existing work",
      workId: "work-existing",
    };
    command.mockResolvedValue(result);

    await expect(
      finalizeIngest({ mode: "attach", pdf: stagedPdf, workId: "work-existing" }),
    ).resolves.toBe(result);
    expect(command).toHaveBeenCalledWith("library.finalizeIngest", {
      mode: "attach",
      pdf: expect.objectContaining({ stageId: "s".repeat(43) }),
      workId: "work-existing",
    });
  });

  it("preserves an active dedup surface after a staged-PDF failure only when main revalidates its target", async () => {
    const attachmentFailure = new Error("attachment unavailable");
    const validatedTarget = {
      attachment: null,
      deduped: true,
      pdfFetched: false,
      title: "Existing work",
      workId: "work-existing",
    };
    command.mockRejectedValueOnce(attachmentFailure).mockResolvedValueOnce(validatedTarget);

    await expect(finalizeDedupIngest("work-existing", stagedPdf)).resolves.toEqual({
      attachmentError: attachmentFailure,
      result: validatedTarget,
    });
    expect(command.mock.calls).toEqual([
      [
        "library.finalizeIngest",
        {
          mode: "attach",
          pdf: {
            fetchedVia: "research-download",
            fileName: "downloaded-paper.pdf",
            pageCount: 8,
            stageId: "s".repeat(43),
          },
          workId: "work-existing",
        },
      ],
      ["library.finalizeIngest", { mode: "attach", pdf: null, workId: "work-existing" }],
      ["library.releaseStagedPdf", { stageId: "s".repeat(43) }],
    ]);
    expect(deleteFile).toHaveBeenCalledWith("research-downloads/temporary-paper.pdf");
  });

  it("does not mask an attachment failure when active-target revalidation also fails", async () => {
    const attachmentFailure = new Error("attachment unavailable");
    command
      .mockRejectedValueOnce(attachmentFailure)
      .mockRejectedValueOnce(new Error("target removed"));

    await expect(finalizeDedupIngest("work-missing", stagedPdf)).rejects.toBe(attachmentFailure);
  });

  it("preserves confirmed attach failures for the caller to handle as hard errors", async () => {
    const failure = new Error("target removed");
    command.mockRejectedValue(failure);

    await expect(
      finalizeIngest({ mode: "attach", pdf: null, workId: "work-missing" }),
    ).rejects.toBe(failure);
  });

  it("keeps source provenance while hiding renderer-computed hash and byte size", async () => {
    const result = {
      attachment: { deduped: false, id: "attachment-oa" },
      deduped: true,
      pdfFetched: true,
      title: "OA work",
      workId: "work-oa",
    };
    command.mockResolvedValue(result);

    await expect(
      finalizeIngest({
        mode: "attach",
        pdf: {
          ...stagedPdf,
          fetchedVia: "openalex",
          sourceUrl: "https://repository.example.test/tokenized.pdf?token=opaque",
        },
        workId: "work-oa",
      }),
    ).resolves.toBe(result);
    expect(command).toHaveBeenCalledWith("library.finalizeIngest", {
      mode: "attach",
      pdf: {
        fetchedVia: "openalex",
        fileName: "downloaded-paper.pdf",
        pageCount: 8,
        sourceUrl: "https://repository.example.test/tokenized.pdf?token=opaque",
        stageId: "s".repeat(43),
      },
      workId: "work-oa",
    });
  });

  it("stages raw bytes through the main-owned capability", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const receipt = { byteSize: 3, sha: "c".repeat(64), stageId: "r".repeat(43) };
    command.mockResolvedValue(receipt);

    await expect(stagePdf(bytes)).resolves.toBe(receipt);
    expect(command).toHaveBeenCalledWith("library.stagePdf", { bytes });
  });

  it("looks up ingest dedup through the scoped typed command without a Library id", async () => {
    const result = {
      hit: {
        pageCount: 8,
        reason: "exact-file" as const,
        title: "Existing work",
        workId: "work-1",
      },
    };
    command.mockResolvedValue(result);

    await expect(findIngestDedup({ kind: "attachmentSha", sha256: "a".repeat(64) })).resolves.toBe(
      result,
    );
    expect(command).toHaveBeenCalledWith("library.findIngestDedup", {
      kind: "attachmentSha",
      sha256: "a".repeat(64),
    });
  });

  it("releases main-owned staging plus renderer-only download cleanup on cancellation", async () => {
    deleteFile.mockResolvedValue(undefined);
    command.mockResolvedValue({ released: true });

    await discardStagedPdf(stagedPdf);
    await discardStagedPdf({ ...stagedPdf, relPath: null });

    expect(command.mock.calls).toEqual([
      ["library.releaseStagedPdf", { stageId: "s".repeat(43) }],
      ["library.releaseStagedPdf", { stageId: "s".repeat(43) }],
    ]);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("research-downloads/temporary-paper.pdf");
  });
});
