import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DownloadFinishedPayload,
  DownloadStartedPayload,
  ResearchDownloadContent,
} from "../../electron/shared";

const mocks = vi.hoisted(() => ({
  analyzePdfWithIdentity: vi.fn(),
  analyzeResearchDownloadPdf: vi.fn(),
  consumeDownload: vi.fn(),
  importReferences: vi.fn(),
  offFinished: vi.fn(),
  offStarted: vi.fn(),
  previewReferences: vi.fn(),
}));

vi.mock("./library", () => ({
  analyzePdfWithIdentity: mocks.analyzePdfWithIdentity,
  analyzeResearchDownloadPdf: mocks.analyzeResearchDownloadPdf,
}));
vi.mock("./import-refs", () => ({
  importReferences: mocks.importReferences,
  previewReferences: mocks.previewReferences,
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
    mocks.consumeDownload.mockResolvedValue({ kind: "ignored" });
    mocks.analyzePdfWithIdentity.mockResolvedValue({ pdf: null });
    mocks.analyzeResearchDownloadPdf.mockResolvedValue({ pdf: null });
    mocks.importReferences.mockResolvedValue({ deduped: 0, imported: 1, total: 1 });
    mocks.previewReferences.mockReturnValue([{ id: "reference-id" }]);
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
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
    let resolveRead: ((content: ResearchDownloadContent) => void) | undefined;
    mocks.consumeDownload.mockReturnValueOnce(
      new Promise<ResearchDownloadContent>((resolve) => {
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
    resolveRead?.({ kind: "ignored" });
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
    mocks.consumeDownload.mockResolvedValueOnce({ kind: "pdf", bytes });
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

  it("uses the main references tag to parse and import a text export", async () => {
    const captures: CapturedDownload[] = [];
    const bytes = new TextEncoder().encode("TY  - JOUR\nTI  - Tagged reference\nER  -");
    mocks.consumeDownload.mockResolvedValueOnce({ kind: "references", bytes });
    subscribeResearchDownloads((result) => captures.push(result));

    emitFinished?.({
      tabId: "research-tab-references",
      ownerTabId: "research-tab-references",
      fileName: "1710000000005-export.txt",
      downloadId: "download-references",
      success: true,
    });

    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(mocks.previewReferences).toHaveBeenCalledWith(
      "TY  - JOUR\nTI  - Tagged reference\nER  -",
    );
    expect(mocks.importReferences).toHaveBeenCalledWith(
      "TY  - JOUR\nTI  - Tagged reference\nER  -",
    );
    expect(captures[0]).toMatchObject({ imported: 1, kind: "references" });
  });

  it("does not parse a filename that main has classified as ignored", async () => {
    const captures: CapturedDownload[] = [];
    subscribeResearchDownloads((result) => captures.push(result));

    emitFinished?.({
      tabId: "research-tab-ignored-json",
      ownerTabId: "research-tab-ignored-json",
      fileName: "1710000000006-export.json",
      downloadId: "download-ignored-json",
      success: true,
    });

    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toMatchObject({ kind: "ignored", fileName: "export.json" });
    expect(mocks.previewReferences).not.toHaveBeenCalled();
    expect(mocks.importReferences).not.toHaveBeenCalled();
  });

  it("serializes complete consumption and PDF analysis before starting the next download", async () => {
    const captures: CapturedDownload[] = [];
    let releaseFirstAnalysis: (() => void) | undefined;
    mocks.consumeDownload.mockResolvedValue({ kind: "pdf", bytes: new Uint8Array([1, 2, 3]) });
    mocks.analyzeResearchDownloadPdf.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirstAnalysis = () => resolve({ pdf: null });
        }),
    );
    subscribeResearchDownloads((result) => captures.push(result));

    emitFinished?.({
      tabId: "research-tab-first",
      ownerTabId: "research-tab-first",
      fileName: "1710000000007-first.pdf",
      downloadId: "download-first",
      success: true,
    });
    emitFinished?.({
      tabId: "research-tab-second",
      ownerTabId: "research-tab-second",
      fileName: "1710000000008-second.pdf",
      downloadId: "download-second",
      success: true,
    });

    await vi.waitFor(() => expect(mocks.analyzeResearchDownloadPdf).toHaveBeenCalledTimes(1));
    expect(mocks.consumeDownload).toHaveBeenCalledTimes(1);
    expect(mocks.consumeDownload).toHaveBeenLastCalledWith({ downloadId: "download-first" });
    releaseFirstAnalysis?.();

    await vi.waitFor(() => expect(mocks.consumeDownload).toHaveBeenCalledTimes(2));
    expect(mocks.consumeDownload).toHaveBeenLastCalledWith({ downloadId: "download-second" });
    await vi.waitFor(() => expect(captures).toHaveLength(2));
  });

  it("skips queued work from a disposed broker generation", async () => {
    let releaseFirstAnalysis: (() => void) | undefined;
    const currentResults = vi.fn();
    mocks.consumeDownload.mockResolvedValueOnce({ kind: "pdf", bytes: new Uint8Array([1, 2, 3]) });
    mocks.analyzeResearchDownloadPdf.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirstAnalysis = () => resolve({ pdf: null });
        }),
    );
    subscribeResearchDownloads(vi.fn());

    emitFinished?.({
      tabId: "research-tab-active-old",
      ownerTabId: "research-tab-active-old",
      fileName: "1710000000009-active.pdf",
      downloadId: "download-active-old",
      success: true,
    });
    await vi.waitFor(() => expect(mocks.analyzeResearchDownloadPdf).toHaveBeenCalledTimes(1));
    emitFinished?.({
      tabId: "research-tab-stale",
      ownerTabId: "research-tab-stale",
      fileName: "1710000000010-stale.ris",
      downloadId: "download-stale",
      success: true,
    });

    disposeResearchDownloadBroker();
    subscribeResearchDownloads(currentResults);
    emitFinished?.({
      tabId: "research-tab-current",
      ownerTabId: "research-tab-current",
      fileName: "1710000000011-current.zip",
      downloadId: "download-current",
      success: true,
    });
    releaseFirstAnalysis?.();

    await vi.waitFor(() => expect(mocks.consumeDownload).toHaveBeenCalledTimes(2));
    expect(mocks.consumeDownload).toHaveBeenCalledWith({ downloadId: "download-active-old" });
    expect(mocks.consumeDownload).toHaveBeenCalledWith({ downloadId: "download-current" });
    expect(mocks.consumeDownload).not.toHaveBeenCalledWith({ downloadId: "download-stale" });
    await vi.waitFor(() =>
      expect(currentResults).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "ignored", tabId: "research-tab-current" }),
      ),
    );
  });

  it("continues the queue after a failed consume", async () => {
    const captures: CapturedDownload[] = [];
    mocks.consumeDownload.mockRejectedValueOnce(new Error("read failed"));
    subscribeResearchDownloads((result) => captures.push(result));

    emitFinished?.({
      tabId: "research-tab-failed-consume",
      ownerTabId: "research-tab-failed-consume",
      fileName: "1710000000012-first.zip",
      downloadId: "download-failed-consume",
      success: true,
    });
    emitFinished?.({
      tabId: "research-tab-after-failure",
      ownerTabId: "research-tab-after-failure",
      fileName: "1710000000013-second.zip",
      downloadId: "download-after-failure",
      success: true,
    });

    await vi.waitFor(() => expect(mocks.consumeDownload).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(captures).toHaveLength(2));
    expect(captures[0]).toMatchObject({ kind: "error", tabId: "research-tab-failed-consume" });
    expect(captures[1]).toMatchObject({ kind: "ignored", tabId: "research-tab-after-failure" });
  });
});
