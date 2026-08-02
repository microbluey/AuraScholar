import { describe, expect, it, vi } from "vitest";
import type { ReaderEvidenceSelection } from "@aurascholar/reader";
import {
  buildReaderEvidenceCommand,
  commitReaderEvidence,
  type ReaderEvidenceCaptureGateway,
} from "./reader-evidence-capture";

const selection: ReaderEvidenceSelection = {
  anchor: {
    kind: "pdf",
    pageIndex: 3,
    position: { end: 18, start: 8 },
    quads: { pageIndex: 3, rects: [{ x1: 1, x2: 3, y1: 2, y2: 4 }] },
    quote: { exact: "stable text", prefix: "before", suffix: "after" },
    version: 1,
  },
  clientRect: { height: 14, width: 80, x: 20, y: 30 },
  exact: "stable text",
  pageIndex: 3,
};

function command(evidenceId = "evidence-stable") {
  return buildReaderEvidenceCommand({
    evidenceId,
    evidenceKind: "context",
    libraryId: "library-1",
    projectId: "project-1",
    selection,
    source: {
      attachmentId: "attachment-1",
      expectedBlobSha256: "a".repeat(64),
      workId: "work-1",
      workTitle: "Evidence source",
    },
  });
}

describe("Reader Evidence capture", () => {
  it("keeps the caller-owned Evidence id and complete source anchor across retries", () => {
    const first = command();
    const retry = command();

    expect(retry.evidenceId).toBe(first.evidenceId);
    expect(retry).toMatchObject({
      anchor: selection.anchor,
      attachmentId: "attachment-1",
      captureMethod: "reader-selection",
      evidenceKind: "context",
      expectedBlobSha256: "a".repeat(64),
      libraryId: "library-1",
      projectId: "project-1",
      text: "stable text",
      workId: "work-1",
    });
  });

  it("does not report a late durable save into a replaced Reader session", async () => {
    let current = true;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const gateway: ReaderEvidenceCaptureGateway = {
      loadScope: vi.fn(),
      save: vi.fn(async () => {
        await pending;
        return {
          created: true,
          evidence: {} as never,
          projectMembershipAdded: true,
          sourceMembershipAdded: true,
        };
      }),
    };
    const controller = new AbortController();
    const committing = commitReaderEvidence({
      command: command(),
      gateway,
      session: { isCurrent: () => current, signal: controller.signal },
    });

    current = false;
    finish();

    await expect(committing).resolves.toEqual({ status: "stale" });
  });

  it("does not start a save after the Reader session is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const gateway: ReaderEvidenceCaptureGateway = {
      loadScope: vi.fn(),
      save: vi.fn(),
    };

    await expect(
      commitReaderEvidence({
        command: command(),
        gateway,
        session: { isCurrent: () => true, signal: controller.signal },
      }),
    ).resolves.toEqual({ status: "stale" });
    expect(gateway.save).not.toHaveBeenCalled();
  });
});
