import { describe, expect, it, vi } from "vitest";
import {
  createResearchDownloadUserIntentGate,
  notifyResearchDownloadCaptureExpired,
  startResearchDownloadCapture,
} from "./research-download-user-intent";

const DOWNLOAD_URL = "https://example.edu/article.pdf?access=granted";

describe("research download user intent gate", () => {
  it("claims one matching app capture exactly once", () => {
    const gate = createResearchDownloadUserIntentGate();
    const source = {};

    gate.issueAppCapture(source, `${DOWNLOAD_URL}#viewer`);

    expect(
      gate.consumeAppCapture(source, [
        DOWNLOAD_URL,
        "https://cdn.example.edu/article.pdf?access=granted",
      ]),
    ).toBe(true);
    expect(gate.consumeAppCapture(source, [DOWNLOAD_URL])).toBe(false);
  });

  it("keeps a permit for its exact source and URL until it is claimed", () => {
    const gate = createResearchDownloadUserIntentGate();
    const source = {};
    const otherSource = {};

    gate.issueAppCapture(source, DOWNLOAD_URL);

    expect(gate.consumeAppCapture(otherSource, [DOWNLOAD_URL])).toBe(false);
    expect(gate.consumeAppCapture(source, ["https://example.edu/other.pdf"])).toBe(false);
    expect(
      gate.consumeAppCapture(source, ["https://example.edu/redirect", DOWNLOAD_URL]),
    ).toBe(false);
    expect(gate.consumeAppCapture(source, [DOWNLOAD_URL])).toBe(true);
  });

  it("expires permits before they can be claimed", () => {
    let now = 10;
    const gate = createResearchDownloadUserIntentGate({ now: () => now, ttlMs: 10 });
    const source = {};
    const onExpired = vi.fn();

    gate.issueAppCapture(source, DOWNLOAD_URL, onExpired);
    now = 20;

    expect(gate.consumeAppCapture(source, [DOWNLOAD_URL])).toBe(false);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("does not let an older revoke remove a replacement permit", () => {
    const gate = createResearchDownloadUserIntentGate();
    const source = {};
    const revokeFirst = gate.issueAppCapture(source, DOWNLOAD_URL);
    const revokeSecond = gate.issueAppCapture(source, DOWNLOAD_URL);

    revokeFirst();
    expect(gate.consumeAppCapture(source, [DOWNLOAD_URL])).toBe(true);
    revokeSecond();
    expect(gate.consumeAppCapture(source, [DOWNLOAD_URL])).toBe(false);
  });

  it("rejects invalid permit sources, URLs, and TTLs", () => {
    expect(() => createResearchDownloadUserIntentGate({ ttlMs: 0 })).toThrow(
      "Research download capture intent TTL",
    );
    const gate = createResearchDownloadUserIntentGate();

    expect(() => gate.issueAppCapture(null, DOWNLOAD_URL)).toThrow("capture intent is invalid");
    expect(() => gate.issueAppCapture({}, "file:///private/data.pdf")).toThrow(
      "capture intent is invalid",
    );
  });

  it("starts an app capture and revokes it if downloadURL throws", () => {
    const gate = createResearchDownloadUserIntentGate();
    const source = { downloadURL: vi.fn(() => undefined) };

    startResearchDownloadCapture(source, DOWNLOAD_URL, { gate });
    expect(source.downloadURL).toHaveBeenCalledWith(DOWNLOAD_URL);
    expect(gate.consumeAppCapture(source, [DOWNLOAD_URL])).toBe(true);

    const failure = new Error("download URL rejected");
    source.downloadURL.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => startResearchDownloadCapture(source, DOWNLOAD_URL, { gate })).toThrow(failure);
    expect(gate.consumeAppCapture(source, [DOWNLOAD_URL])).toBe(false);
  });

  it("reports an expired app capture only to its original window", () => {
    const send = vi.fn();
    const capture = { ownerTabId: "owner-tab", tabId: "source-tab" };

    notifyResearchDownloadCaptureExpired({ webContents: { send } } as never, capture);
    notifyResearchDownloadCaptureExpired(null, capture);

    expect(send).toHaveBeenCalledWith(
      "research://download-finished",
      expect.objectContaining({
        downloadId: null,
        fileName: "download",
        ownerTabId: "owner-tab",
        success: false,
        tabId: "source-tab",
      }),
    );
  });
});
