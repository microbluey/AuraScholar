import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadFinishedPayload, DownloadStartedPayload } from "../../electron/shared";

const mocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  offFinished: vi.fn(),
  offStarted: vi.fn(),
  readResearchDownload: vi.fn(),
}));

vi.mock("./aura-platform", () => ({
  auraFs: {
    deleteFile: mocks.deleteFile,
  },
  auraFiles: {
    readResearchDownload: mocks.readResearchDownload,
  },
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
    mocks.deleteFile.mockResolvedValue(undefined);
    mocks.readResearchDownload.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.stubGlobal("window", {
      aura: {
        research: {
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
      relPath: "research-downloads/failed.pdf",
      success: false,
    });
    emitFinished?.({
      tabId: "research-tab-ignored",
      ownerTabId: "research-tab-root",
      fileName: "1710000000001-supplement.zip",
      relPath: "research-downloads/supplement.zip",
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
    expect(mocks.deleteFile).toHaveBeenCalledWith("research-downloads/failed.pdf");
    expect(mocks.deleteFile).toHaveBeenCalledWith("research-downloads/supplement.zip");
  });

  it("buffers an analysis that finishes after its page subscriber leaves", async () => {
    let resolveRead: ((bytes: Uint8Array) => void) | undefined;
    mocks.readResearchDownload.mockReturnValueOnce(
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
      relPath: "research-downloads/late.zip",
      success: true,
    });
    unsubscribe();
    resolveRead?.(new Uint8Array([1, 2, 3]));
    await vi.waitFor(() =>
      expect(mocks.deleteFile).toHaveBeenCalledWith("research-downloads/late.zip"),
    );
    expect(staleResult).not.toHaveBeenCalled();

    const replayed = vi.fn();
    subscribeResearchDownloads(replayed);
    expect(replayed).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "ignored",
        ownerTabId: "research-tab-root",
        tabId: "research-tab-child",
      }),
    );
  });
});
