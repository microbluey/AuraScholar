import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadFinishedPayload, DownloadStartedPayload } from "../../electron/shared";

const mocks = vi.hoisted(() => ({
  analyzePdfWithIdentity: vi.fn(),
  analyzeResearchDownloadPdf: vi.fn(),
  consumeDownload: vi.fn(),
  offFinished: vi.fn(),
  offStarted: vi.fn(),
}));

vi.mock("./library", () => ({
  analyzePdfWithIdentity: mocks.analyzePdfWithIdentity,
  analyzeResearchDownloadPdf: mocks.analyzeResearchDownloadPdf,
}));

import {
  disposeResearchDownloadBroker,
  subscribeResearchDownloads,
  type CapturedDownload,
} from "./research-downloads";

describe("research download source-tab propagation", () => {
  let emitFinished: ((payload: DownloadFinishedPayload) => void) | undefined;
  let emitStarted: ((payload: DownloadStartedPayload) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeDownload.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.analyzePdfWithIdentity.mockResolvedValue({ pdf: null });
    mocks.analyzeResearchDownloadPdf.mockResolvedValue({ pdf: null });
    vi.stubGlobal("window", {
      aura: {
        research: {
          consumeDownload: mocks.consumeDownload,
          onDownloadFinished(callback: (payload: DownloadFinishedPayload) => void) {
            emitFinished = callback;
            return mocks.offFinished;
          },
          onDownloadStarted(callback: (payload: DownloadStartedPayload) => void) {
            emitStarted = callback;
            return mocks.offStarted;
          },
        },
      },
    });
  });

  afterEach(() => {
    disposeResearchDownloadBroker();
    emitFinished = undefined;
    emitStarted = undefined;
    vi.unstubAllGlobals();
  });

  it("forwards the complete started payload and unsubscribes both listeners", () => {
    const onStarted = vi.fn();
    const unsubscribe = subscribeResearchDownloads(vi.fn(), onStarted);
    const payload = { tabId: "research-tab-a", fileName: "paper.pdf" };

    emitStarted?.(payload);

    expect(onStarted).toHaveBeenCalledWith(payload);
    unsubscribe();
    expect(mocks.offStarted).not.toHaveBeenCalled();
    expect(mocks.offFinished).not.toHaveBeenCalled();
    disposeResearchDownloadBroker();
    expect(mocks.offStarted).toHaveBeenCalledOnce();
    expect(mocks.offFinished).toHaveBeenCalledOnce();
  });

  it("keeps the originating tab on failed and successfully inspected downloads", async () => {
    const captures: CapturedDownload[] = [];
    subscribeResearchDownloads((result) => captures.push(result));

    emitFinished?.({
      tabId: "research-tab-failed",
      ownerTabId: "research-tab-failed",
      fileName: "1710000000000-paper.pdf",
      downloadId: null,
      success: false,
    });
    emitFinished?.({
      tabId: "research-tab-ignored",
      ownerTabId: "research-tab-root",
      fileName: "1710000000001-supplement.zip",
      downloadId: "download-ignored",
      success: true,
    });

    await vi.waitFor(() => expect(captures).toHaveLength(2));
    expect(captures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tabId: "research-tab-failed",
          ownerTabId: "research-tab-failed",
          kind: "error",
          fileName: "paper.pdf",
        }),
        expect.objectContaining({
          tabId: "research-tab-ignored",
          ownerTabId: "research-tab-root",
          kind: "ignored",
          fileName: "supplement.zip",
        }),
      ]),
    );
    expect(mocks.consumeDownload).toHaveBeenCalledWith({ downloadId: "download-ignored" });
  });

  it("buffers an analysis that finishes after its page subscriber leaves", async () => {
    let resolveRead: ((bytes: Uint8Array) => void) | undefined;
    mocks.consumeDownload.mockReturnValueOnce(
      new Promise<Uint8Array>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const staleResult = vi.fn();
    const unsubscribe = subscribeResearchDownloads(staleResult);
    emitFinished?.({
      tabId: "research-tab-child",
      ownerTabId: "research-tab-root",
      fileName: "1710000000002-supplement.zip",
      downloadId: "download-late",
      success: true,
    });
    unsubscribe();
    resolveRead?.(new Uint8Array([1, 2, 3]));
    await vi.waitFor(() =>
      expect(mocks.consumeDownload).toHaveBeenCalledWith({ downloadId: "download-late" }),
    );
    expect(staleResult).not.toHaveBeenCalled();

    const replayed = vi.fn();
    subscribeResearchDownloads(replayed);
    await vi.waitFor(() =>
      expect(replayed).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "ignored",
          ownerTabId: "research-tab-root",
          tabId: "research-tab-child",
        }),
      ),
    );
  });

  it("reports a successful event without an opaque lease as an error", async () => {
    const captures: CapturedDownload[] = [];
    subscribeResearchDownloads((result) => captures.push(result));

    emitFinished?.({
      tabId: "research-tab-missing-lease",
      ownerTabId: "research-tab-missing-lease",
      fileName: "1710000000003-paper.pdf",
      downloadId: null,
      success: true,
    } as unknown as DownloadFinishedPayload);

    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toMatchObject({
      kind: "error",
      fileName: "paper.pdf",
      error: "下载凭证无效",
    });
    expect(mocks.consumeDownload).not.toHaveBeenCalled();
  });

  it("consumes the opaque lease before handing PDF bytes to the analyzer", async () => {
    const captures: CapturedDownload[] = [];
    subscribeResearchDownloads((result) => captures.push(result));
    const bytes = new Uint8Array([9, 8, 7]);
    mocks.consumeDownload.mockResolvedValueOnce(bytes);
    const scholar = { doi: "10.4242/lease", title: "Lease paper" };

    emitFinished?.({
      tabId: "research-tab-pdf",
      ownerTabId: "research-tab-pdf",
      fileName: "1710000000004-paper.pdf",
      downloadId: "download-pdf",
      success: true,
      scholar,
    });

    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(mocks.consumeDownload).toHaveBeenCalledWith({ downloadId: "download-pdf" });
    expect(mocks.analyzePdfWithIdentity).toHaveBeenCalledWith("paper.pdf", bytes, scholar);
    expect(mocks.analyzePdfWithIdentity.mock.calls[0]).toHaveLength(3);
    expect(captures[0]).toMatchObject({ kind: "pdf", fileName: "paper.pdf" });
  });
});
