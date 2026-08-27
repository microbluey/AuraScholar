import type { Session } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createResearchDownloadInFlightGate,
  type ResearchDownloadInFlightGate,
} from "./research-download-inflight";
import {
  createResearchDownloadUserIntentGate,
  type ResearchDownloadUserIntentGate,
} from "./research-download-user-intent";

const mocks = vi.hoisted(() => ({
  createFileName: vi.fn(),
  createTarget: vi.fn(),
  discard: vi.fn(),
  getPath: vi.fn(),
  register: vi.fn(),
}));

vi.mock("electron", () => ({ app: { getPath: mocks.getPath } }));
vi.mock("./research-download-file-name", () => ({
  createResearchDownloadFileName: mocks.createFileName,
}));
vi.mock("./research-download-store", () => ({
  discardResearchDownload: mocks.discard,
  registerResearchDownload: mocks.register,
}));
vi.mock("./research-download-stream-target", () => ({
  createResearchDownloadStreamTarget: mocks.createTarget,
}));

import {
  type ResearchDownloadEventContext,
  wireResearchDownloadSession,
} from "./research-download-events";

const FILE_NAME = "171000000000000000000000000000001-page.pdf";
const SOURCE = {};
const DOWNLOAD_URL = "https://example.edu/page.pdf";
const TARGET = {
  absolutePath:
    "/user-data/research-downloads/.stream-11111111-1111-4111-8111-111111111111/download",
  directory: "/user-data/research-downloads/.stream-11111111-1111-4111-8111-111111111111",
  directoryName: ".stream-11111111-1111-4111-8111-111111111111",
};

type DoneState = "completed" | "cancelled" | "interrupted";
type UpdateState = "progressing" | "interrupted";
type DoneListener = (_event: unknown, state: DoneState) => void;
type UpdatedListener = (_event: unknown, state: UpdateState) => void;
type DownloadEvent = { preventDefault: ReturnType<typeof vi.fn> };

interface DownloadItemFake {
  cancel: ReturnType<typeof vi.fn>;
  emitDone(state: DoneState): void;
  emitUpdated(receivedBytes: number, state?: UpdateState): void;
  getFilename: ReturnType<typeof vi.fn>;
  getReceivedBytes: ReturnType<typeof vi.fn>;
  getTotalBytes: ReturnType<typeof vi.fn>;
  getURLChain: ReturnType<typeof vi.fn>;
  getURL: ReturnType<typeof vi.fn>;
  hasUserGesture: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  setSavePath: ReturnType<typeof vi.fn>;
}

type WillDownloadListener = (event: DownloadEvent, item: DownloadItemFake, source: unknown) => void;

function downloadItem({
  hasUserGesture = true,
  receivedBytes = 0,
  setSavePath = vi.fn(),
  totalBytes = 1,
  urlChain = [DOWNLOAD_URL],
}: {
  hasUserGesture?: boolean;
  receivedBytes?: number;
  setSavePath?: ReturnType<typeof vi.fn>;
  totalBytes?: number;
  urlChain?: string[];
} = {}): DownloadItemFake {
  let done: DoneListener | undefined;
  let updated: UpdatedListener | undefined;
  let received = receivedBytes;
  const item = {} as DownloadItemFake;
  Object.assign(item, {
    cancel: vi.fn(),
    emitDone(state: DoneState) {
      const listener = done;
      done = undefined;
      if (!listener) throw new Error("done listener is missing");
      listener({}, state);
    },
    emitUpdated(nextReceivedBytes: number, state: UpdateState = "progressing") {
      received = nextReceivedBytes;
      if (!updated) throw new Error("updated listener is missing");
      updated({}, state);
    },
    getFilename: vi.fn(() => "page.pdf"),
    getReceivedBytes: vi.fn(() => received),
    getTotalBytes: vi.fn(() => totalBytes),
    getURLChain: vi.fn(() => urlChain),
    getURL: vi.fn(() => DOWNLOAD_URL),
    hasUserGesture: vi.fn(() => hasUserGesture),
    on: vi.fn((event: string, listener: UpdatedListener) => {
      if (event === "updated") updated = listener;
      return item;
    }),
    once: vi.fn((event: string, listener: DoneListener) => {
      if (event === "done") done = listener;
      return item;
    }),
    setSavePath,
  });
  return item;
}

function wiredSession(): { session: Session; willDownload(): WillDownloadListener } {
  let listener: WillDownloadListener | undefined;
  const session = {} as Session;
  Object.assign(session, {
    on: vi.fn((event: string, callback: WillDownloadListener) => {
      if (event === "will-download") listener = callback;
      return session;
    }),
    setPermissionRequestHandler: vi.fn(),
  });
  return {
    session,
    willDownload: () => {
      if (!listener) throw new Error("will-download listener is missing");
      return listener;
    },
  };
}

function eventContext({
  findSourceTab = vi.fn(() => ({ ownerTabId: "owner-tab", tabId: "source-tab", view: null })),
  inFlightGate = createResearchDownloadInFlightGate({
    maxBytes: 20,
    maxDownloadBytes: 10,
    maxDownloads: 2,
  }),
  send = vi.fn(),
  userIntentGate,
}: {
  findSourceTab?: ReturnType<typeof vi.fn>;
  inFlightGate?: ResearchDownloadInFlightGate;
  send?: ReturnType<typeof vi.fn>;
  userIntentGate?: ResearchDownloadUserIntentGate;
} = {}): { context: ResearchDownloadEventContext; send: ReturnType<typeof vi.fn> } {
  return {
    context: {
      findSourceTab,
      getWindow: vi.fn(() => ({ webContents: { send } })),
      inFlightGate,
      resolveIdentity: vi.fn(() => undefined),
      userIntentGate,
    } as unknown as ResearchDownloadEventContext,
    send,
  };
}

function dispatch(
  willDownload: WillDownloadListener,
  item: DownloadItemFake,
  source: unknown = SOURCE,
): DownloadEvent {
  const event = { preventDefault: vi.fn() };
  willDownload(event, item, source);
  return event;
}

beforeEach(() => {
  mocks.createFileName.mockReset();
  mocks.createFileName.mockReturnValue(FILE_NAME);
  mocks.createTarget.mockReset();
  mocks.createTarget.mockReturnValue(TARGET);
  mocks.discard.mockReset();
  mocks.discard.mockResolvedValue(undefined);
  mocks.getPath.mockReset();
  mocks.getPath.mockReturnValue("/user-data");
  mocks.register.mockReset();
  mocks.register.mockResolvedValue({
    downloadId: "download-id",
    fileName: FILE_NAME,
    ownerTabId: "owner-tab",
  });
});

describe("research stream download admission", () => {
  it("rejects an unknown source before touching its DownloadItem", () => {
    const { session, willDownload } = wiredSession();
    const { context, send } = eventContext({ findSourceTab: vi.fn(() => undefined) });
    const item = downloadItem();
    wireResearchDownloadSession(session, context);

    const event = dispatch(willDownload(), item, {});

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(item.cancel).not.toHaveBeenCalled();
    expect(item.getFilename).not.toHaveBeenCalled();
    expect(item.getTotalBytes).not.toHaveBeenCalled();
    expect(item.getURLChain).not.toHaveBeenCalled();
    expect(item.getURL).not.toHaveBeenCalled();
    expect(item.hasUserGesture).not.toHaveBeenCalled();
    expect(item.on).not.toHaveBeenCalled();
    expect(item.once).not.toHaveBeenCalled();
    expect(item.setSavePath).not.toHaveBeenCalled();
    expect(mocks.createFileName).not.toHaveBeenCalled();
    expect(mocks.createTarget).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a known non-gesture download before allocating a target", () => {
    const { session, willDownload } = wiredSession();
    const { context, send } = eventContext();
    const item = downloadItem({ hasUserGesture: false });
    wireResearchDownloadSession(session, context);

    const event = dispatch(willDownload(), item);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(item.hasUserGesture).toHaveBeenCalledTimes(1);
    expect(item.getURLChain).toHaveBeenCalledTimes(1);
    expect(item.getFilename).not.toHaveBeenCalled();
    expect(item.getTotalBytes).not.toHaveBeenCalled();
    expect(item.on).not.toHaveBeenCalled();
    expect(item.once).not.toHaveBeenCalled();
    expect(item.setSavePath).not.toHaveBeenCalled();
    expect(mocks.createTarget).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("allows a matching app capture permit only once", () => {
    const intentGate = createResearchDownloadUserIntentGate();
    intentGate.issueAppCapture(SOURCE, DOWNLOAD_URL);
    const { session, willDownload } = wiredSession();
    const { context } = eventContext({ userIntentGate: intentGate });
    wireResearchDownloadSession(session, context);

    const permitted = dispatch(willDownload(), downloadItem({ hasUserGesture: false }));
    const replay = dispatch(willDownload(), downloadItem({ hasUserGesture: false }));

    expect(permitted.preventDefault).not.toHaveBeenCalled();
    expect(replay.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does not consume an app capture permit for a user-gesture download", () => {
    const intentGate = createResearchDownloadUserIntentGate();
    intentGate.issueAppCapture(SOURCE, DOWNLOAD_URL);
    const { session, willDownload } = wiredSession();
    const { context } = eventContext({ userIntentGate: intentGate });
    wireResearchDownloadSession(session, context);

    expect(dispatch(willDownload(), downloadItem()).preventDefault).not.toHaveBeenCalled();
    expect(
      dispatch(willDownload(), downloadItem({ hasUserGesture: false })).preventDefault,
    ).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared download before allocating a target", () => {
    const { session, willDownload } = wiredSession();
    const { context, send } = eventContext();
    const item = downloadItem({ totalBytes: 11 });
    wireResearchDownloadSession(session, context);

    const event = dispatch(willDownload(), item);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(item.cancel).not.toHaveBeenCalled();
    expect(item.getFilename).toHaveBeenCalledTimes(1);
    expect(item.getURL).toHaveBeenCalledTimes(1);
    expect(item.on).not.toHaveBeenCalled();
    expect(item.once).not.toHaveBeenCalled();
    expect(item.setSavePath).not.toHaveBeenCalled();
    expect(mocks.createTarget).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith(
      "research://download-finished",
      expect.objectContaining({ downloadId: null, fileName: FILE_NAME, success: false }),
    );
  });

  it("holds a shared synchronous admission until terminal cleanup completes", async () => {
    const gate = createResearchDownloadInFlightGate({
      maxBytes: 10,
      maxDownloadBytes: 10,
      maxDownloads: 1,
    });
    const first = wiredSession();
    const second = wiredSession();
    const { context, send } = eventContext({ inFlightGate: gate });
    const firstItem = downloadItem();
    const blockedItem = downloadItem();
    wireResearchDownloadSession(first.session, context);
    wireResearchDownloadSession(second.session, context);

    const firstEvent = dispatch(first.willDownload(), firstItem);
    const blockedEvent = dispatch(second.willDownload(), blockedItem);

    expect(firstEvent.preventDefault).not.toHaveBeenCalled();
    expect(blockedEvent.preventDefault).toHaveBeenCalledTimes(1);
    firstItem.emitDone("cancelled");
    await vi.waitFor(() => expect(mocks.discard).toHaveBeenCalledWith(FILE_NAME, TARGET));
    await vi.waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(
        "research://download-finished",
        expect.objectContaining({ downloadId: null, fileName: FILE_NAME, success: false }),
      ),
    );

    const nextItem = downloadItem();
    const nextEvent = dispatch(second.willDownload(), nextItem);
    expect(nextEvent.preventDefault).not.toHaveBeenCalled();
    expect(nextItem.setSavePath).toHaveBeenCalledWith(TARGET.absolutePath);
  });

  it("cancels an unknown-length stream only once when received bytes exceed its limit", async () => {
    const gate = createResearchDownloadInFlightGate({
      maxBytes: 10,
      maxDownloadBytes: 10,
      maxDownloads: 1,
    });
    const { session, willDownload } = wiredSession();
    const { context, send } = eventContext({ inFlightGate: gate });
    const item = downloadItem({ totalBytes: 0 });
    wireResearchDownloadSession(session, context);

    dispatch(willDownload(), item);
    item.emitUpdated(10);
    expect(item.cancel).not.toHaveBeenCalled();
    item.emitUpdated(11);
    item.emitUpdated(12);
    expect(item.cancel).toHaveBeenCalledTimes(1);

    const blocked = dispatch(willDownload(), downloadItem());
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1);
    item.emitDone("completed");
    await vi.waitFor(() => expect(mocks.discard).toHaveBeenCalledWith(FILE_NAME, TARGET));
    await vi.waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(
        "research://download-finished",
        expect.objectContaining({ downloadId: null, fileName: FILE_NAME, success: false }),
      ),
    );
    expect(mocks.register).not.toHaveBeenCalled();

    expect(dispatch(willDownload(), downloadItem()).preventDefault).not.toHaveBeenCalled();
  });

  it("waits for a terminal interrupted transfer before cleaning its owned target", async () => {
    const { session, willDownload } = wiredSession();
    const { context } = eventContext();
    const item = downloadItem();
    wireResearchDownloadSession(session, context);

    dispatch(willDownload(), item);
    item.emitUpdated(0, "interrupted");
    item.emitUpdated(0, "interrupted");
    expect(item.cancel).not.toHaveBeenCalled();
    item.emitDone("interrupted");

    await vi.waitFor(() => expect(mocks.discard).toHaveBeenCalledWith(FILE_NAME, TARGET));
    expect(mocks.register).not.toHaveBeenCalled();
  });
});

describe("research stream download ownership", () => {
  it("rejects and releases admission when it cannot allocate an owned target", () => {
    const gate = createResearchDownloadInFlightGate({
      maxBytes: 10,
      maxDownloadBytes: 10,
      maxDownloads: 1,
    });
    mocks.createTarget.mockImplementation(() => {
      throw new Error("target collision");
    });
    const { session, willDownload } = wiredSession();
    const { context, send } = eventContext({ inFlightGate: gate });
    const item = downloadItem();
    wireResearchDownloadSession(session, context);

    const event = dispatch(willDownload(), item);

    expect(item.cancel).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith(
      "research://download-finished",
      expect.objectContaining({ downloadId: null, fileName: FILE_NAME, success: false }),
    );
    mocks.createTarget.mockReturnValue(TARGET);
    expect(dispatch(willDownload(), downloadItem()).preventDefault).not.toHaveBeenCalled();
  });

  it("cleans and releases when setting the Electron save path fails", async () => {
    const gate = createResearchDownloadInFlightGate({
      maxBytes: 10,
      maxDownloadBytes: 10,
      maxDownloads: 1,
    });
    const setSavePath = vi.fn(() => {
      throw new Error("save path rejected");
    });
    const { session, willDownload } = wiredSession();
    const { context, send } = eventContext({ inFlightGate: gate });
    const item = downloadItem({ setSavePath });
    wireResearchDownloadSession(session, context);

    const event = dispatch(willDownload(), item);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(item.cancel).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.discard).toHaveBeenCalledWith(FILE_NAME, TARGET));
    await vi.waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(
        "research://download-finished",
        expect.objectContaining({ downloadId: null, fileName: FILE_NAME, success: false }),
      ),
    );
    expect(dispatch(willDownload(), downloadItem()).preventDefault).not.toHaveBeenCalled();
  });

  it("registers the completed stream before releasing its admission", async () => {
    const gate = createResearchDownloadInFlightGate({
      maxBytes: 10,
      maxDownloadBytes: 10,
      maxDownloads: 1,
    });
    const { session, willDownload } = wiredSession();
    const { context, send } = eventContext({ inFlightGate: gate });
    const item = downloadItem();
    wireResearchDownloadSession(session, context);

    dispatch(willDownload(), item);
    item.emitDone("completed");
    expect(dispatch(willDownload(), downloadItem()).preventDefault).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(mocks.register).toHaveBeenCalledWith(FILE_NAME, "owner-tab", TARGET),
    );
    await vi.waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(
        "research://download-finished",
        expect.objectContaining({ downloadId: "download-id", fileName: FILE_NAME, success: true }),
      ),
    );
    expect(dispatch(willDownload(), downloadItem()).preventDefault).not.toHaveBeenCalled();
  });

  it("cleans and releases when completed registration fails", async () => {
    const gate = createResearchDownloadInFlightGate({
      maxBytes: 10,
      maxDownloadBytes: 10,
      maxDownloads: 1,
    });
    mocks.register.mockRejectedValue(new Error("lease unavailable"));
    const { session, willDownload } = wiredSession();
    const { context, send } = eventContext({ inFlightGate: gate });
    const item = downloadItem();
    wireResearchDownloadSession(session, context);

    dispatch(willDownload(), item);
    item.emitDone("completed");

    await vi.waitFor(() => expect(mocks.discard).toHaveBeenCalledWith(FILE_NAME, TARGET));
    await vi.waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(
        "research://download-finished",
        expect.objectContaining({ downloadId: null, fileName: FILE_NAME, success: false }),
      ),
    );
    expect(dispatch(willDownload(), downloadItem()).preventDefault).not.toHaveBeenCalled();
  });
});
