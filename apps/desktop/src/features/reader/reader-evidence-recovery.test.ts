import { describe, expect, it, vi } from "vitest";
import {
  recoverReaderEvidenceSource,
  type ReaderEvidenceRecoveryGateway,
} from "./reader-evidence-recovery";

function gateway(overrides: Partial<ReaderEvidenceRecoveryGateway> = {}) {
  return {
    getLibraryId: vi.fn(async () => "library:one"),
    recover: vi.fn(async () => ({
      attachmentId: "attachment:recovered",
      evidenceId: "evidence:one",
      pageIndex: 4,
      reusedAttachment: false,
      revisionId: "revision:one",
      workId: "work:one",
    })),
    ...overrides,
  } satisfies ReaderEvidenceRecoveryGateway;
}

describe("Reader Evidence source recovery", () => {
  it("passes bytes through the typed recovery boundary and retains exact identity", async () => {
    const source = gateway();
    const file = new File([new Uint8Array([1, 2, 3])], "original.pdf", {
      type: "application/pdf",
    });
    await expect(
      recoverReaderEvidenceSource(
        { evidenceId: "evidence:one", expectedWorkId: "work:one", file },
        source,
      ),
    ).resolves.toMatchObject({
      attachmentId: "attachment:recovered",
      revisionId: "revision:one",
      workId: "work:one",
    });
    expect(source.recover).toHaveBeenCalledWith({
      bytes: new Uint8Array([1, 2, 3]),
      evidenceId: "evidence:one",
      fileName: "original.pdf",
      libraryId: "library:one",
    });
  });

  it("rejects a recovery result that belongs to another route Work", async () => {
    const source = gateway({
      recover: vi.fn(async () => ({
        attachmentId: "attachment:other",
        evidenceId: "evidence:one",
        pageIndex: 0,
        reusedAttachment: false,
        revisionId: "revision:other",
        workId: "work:other",
      })),
    });
    await expect(
      recoverReaderEvidenceSource(
        {
          evidenceId: "evidence:one",
          expectedWorkId: "work:one",
          file: new File(["pdf"], "other.pdf"),
        },
        source,
      ),
    ).rejects.toThrow("不一致");
  });

  it("does not cross the preload boundary after the Reader session aborts", async () => {
    const controller = new AbortController();
    const source = gateway({
      getLibraryId: vi.fn(async () => {
        controller.abort();
        return "library:one";
      }),
    });
    await expect(
      recoverReaderEvidenceSource(
        {
          evidenceId: "evidence:one",
          expectedWorkId: "work:one",
          file: new File(["pdf"], "original.pdf"),
          signal: controller.signal,
        },
        source,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(source.recover).not.toHaveBeenCalled();
  });
});
