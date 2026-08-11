import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReaderAnnotation,
  deleteReaderAnnotation,
  loadReaderAnnotations,
  loadReaderAttachment,
  loadReaderWorkPdfCandidates,
  markReaderWorkReadingStarted,
  restoreReaderAnnotation,
  updateReaderAnnotationContent,
  type ReaderAnnotations,
  type ReaderAttachment,
  type ReaderCreatedAnnotation,
  type ReaderDeletedAnnotation,
  type ReaderRestoredAnnotation,
  type ReaderUpdatedAnnotationContent,
  type ReaderWorkReadingStarted,
  type ReaderWorkPdfCandidates,
} from "./reader-session-data";

describe("reader session data facade", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("loads scoped work and PDF candidates through the typed command bridge", async () => {
    const result = { pdfAttachments: [], work: null } satisfies ReaderWorkPdfCandidates;
    command.mockResolvedValueOnce(result);

    await expect(loadReaderWorkPdfCandidates("work-1")).resolves.toBe(result);
    expect(command).toHaveBeenCalledWith("reader.getWorkPdfCandidates", { workId: "work-1" });
  });

  it("keeps work identity on attachment and annotation reads", async () => {
    const attachment = { attachment: null } satisfies ReaderAttachment;
    const annotations = { annotations: [] } satisfies ReaderAnnotations;
    command.mockResolvedValueOnce(attachment).mockResolvedValueOnce(annotations);

    await expect(loadReaderAttachment("work-1", "attachment-1")).resolves.toBe(attachment);
    await expect(loadReaderAnnotations("work-1", "attachment-1")).resolves.toBe(annotations);
    expect(command).toHaveBeenNthCalledWith(1, "reader.getAttachment", {
      attachmentId: "attachment-1",
      workId: "work-1",
    });
    expect(command).toHaveBeenNthCalledWith(2, "reader.listAnnotations", {
      attachmentId: "attachment-1",
      workId: "work-1",
    });
  });

  it("creates annotations through a main-scoped command without a Library id", async () => {
    const result = { annotationId: "annotation-new" } satisfies ReaderCreatedAnnotation;
    command.mockResolvedValueOnce(result);

    await expect(
      createReaderAnnotation({
        anchor: {
          pageIndex: 2,
          quote: { exact: "saved evidence", prefix: "", suffix: "" },
          version: 1,
        },
        attachmentId: "attachment-1",
        color: "#ffd866",
        contentMd: "margin note",
        pageIndex: 2,
        type: "highlight",
        workId: "work-1",
      }),
    ).resolves.toBe(result);
    expect(command).toHaveBeenCalledWith("reader.createAnnotation", {
      anchor: {
        pageIndex: 2,
        quote: { exact: "saved evidence", prefix: "", suffix: "" },
        version: 1,
      },
      attachmentId: "attachment-1",
      color: "#ffd866",
      contentMd: "margin note",
      pageIndex: 2,
      type: "highlight",
      workId: "work-1",
    });
  });

  it("sends Reader annotation and reading-status mutations through typed commands", async () => {
    const deleted = { updated: 1 } satisfies ReaderDeletedAnnotation;
    const restored = { updated: 1 } satisfies ReaderRestoredAnnotation;
    const contentUpdated = { updated: 1 } satisfies ReaderUpdatedAnnotationContent;
    const readingStarted = { started: true } satisfies ReaderWorkReadingStarted;
    command
      .mockResolvedValueOnce(deleted)
      .mockResolvedValueOnce(restored)
      .mockResolvedValueOnce(contentUpdated)
      .mockResolvedValueOnce(readingStarted);

    await expect(deleteReaderAnnotation({ annotationId: "annotation-1" })).resolves.toBe(deleted);
    await expect(restoreReaderAnnotation({ annotationId: "annotation-1" })).resolves.toBe(restored);
    await expect(
      updateReaderAnnotationContent({ annotationId: "annotation-1", contentMd: "revised note" }),
    ).resolves.toBe(contentUpdated);
    await expect(markReaderWorkReadingStarted({ workId: "work-1" })).resolves.toBe(readingStarted);

    expect(command).toHaveBeenNthCalledWith(1, "reader.deleteAnnotation", {
      annotationId: "annotation-1",
    });
    expect(command).toHaveBeenNthCalledWith(2, "reader.restoreAnnotation", {
      annotationId: "annotation-1",
    });
    expect(command).toHaveBeenNthCalledWith(3, "reader.updateAnnotationContent", {
      annotationId: "annotation-1",
      contentMd: "revised note",
    });
    expect(command).toHaveBeenNthCalledWith(4, "reader.markWorkReadingStarted", {
      workId: "work-1",
    });
  });

  it("preserves main-process Reader read failures", async () => {
    const failure = new Error("scoped reader query failed");
    command.mockRejectedValueOnce(failure);

    await expect(loadReaderWorkPdfCandidates("work-1")).rejects.toBe(failure);
  });

  it("preserves main-process Reader write failures", async () => {
    const failure = new Error("scoped reader mutation failed");
    command.mockRejectedValueOnce(failure);

    await expect(deleteReaderAnnotation({ annotationId: "annotation-1" })).rejects.toBe(failure);
  });
});
