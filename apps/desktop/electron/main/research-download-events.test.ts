import type { Session } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const TARGET = {
  absolutePath:
    "/user-data/research-downloads/.stream-11111111-1111-4111-8111-111111111111/download",
  directory: "/user-data/research-downloads/.stream-11111111-1111-4111-8111-111111111111",
  directoryName: ".stream-11111111-1111-4111-8111-111111111111",
};

type DoneListener = (_event: unknown, state: "completed" | "cancelled" | "interrupted") => void;
type WillDownloadListener = (
  _event: unknown,
  item: ReturnType<typeof downloadItem>,
  source: unknown,
) => void;

function downloadItem(setSavePath = vi.fn()) {
  let done: DoneListener | null = null;
  const item = {
    cancel: vi.fn(),
    getFilename: vi.fn(() => "page.pdf"),
    getURL: vi.fn(() => "https://example.edu/page.pdf"),
    once: vi.fn((event: string, listener: DoneListener) => {
      if (event === "done") done = listener;
      return item;
    }),
    setSavePath,
  };
  return {
    ...item,
    emitDone: (state: "completed" | "cancelled" | "interrupted") => done?.({}, state),
  };
}

function wiredSession(): { session: Session; willDownload(): WillDownloadListener } {
  let listener: WillDownloadListener | null = null;
  const session = {
    on: vi.fn((_event: string, callback: WillDownloadListener) => {
      listener = callback;
      return session;
    }),
    setPermissionRequestHandler: vi.fn(),
  } as unknown as Session;
  return {
    session,
    willDownload: () => {
      if (!listener) throw new Error("will-download listener is missing");
      return listener;
    },
  };
}

function context(send = vi.fn()) {
  return {
    context: {
      findSourceTab: vi.fn(() => ({ ownerTabId: "owner-tab", tabId: "source-tab", view: null })),
      getWindow: vi.fn(() => ({ webContents: { send } })),
      resolveIdentity: vi.fn(() => undefined),
    } as unknown as ResearchDownloadEventContext,
    send,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

describe("research stream download ownership", () => {
  it("cancels without cleanup when it cannot allocate an owned target", () => {
    mocks.createTarget.mockImplementation(() => {
      throw new Error("target collision");
    });
    const { session, willDownload } = wiredSession();
    const { context: eventContext, send } = context();
    const item = downloadItem();
    wireResearchDownloadSession(session, eventContext);

    willDownload()({}, item, {});

    expect(item.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith(
      "research://download-finished",
      expect.objectContaining({ downloadId: null, fileName: FILE_NAME, success: false }),
    );
  });

  it("cleans only its allocated target when setting the Electron save path fails", () => {
    const setSavePath = vi.fn(() => {
      throw new Error("save path rejected");
    });
    const { session, willDownload } = wiredSession();
    const { context: eventContext } = context();
    const item = downloadItem(setSavePath);
    wireResearchDownloadSession(session, eventContext);

    willDownload()({}, item, {});

    expect(item.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.discard).toHaveBeenCalledWith(FILE_NAME, TARGET);
  });

  it("cleans only its allocated target after a cancelled stream", () => {
    const { session, willDownload } = wiredSession();
    const { context: eventContext } = context();
    const item = downloadItem();
    wireResearchDownloadSession(session, eventContext);

    willDownload()({}, item, {});
    item.emitDone("cancelled");

    expect(mocks.discard).toHaveBeenCalledWith(FILE_NAME, TARGET);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("registers the completed stream against its allocated target", async () => {
    const { session, willDownload } = wiredSession();
    const { context: eventContext, send } = context();
    const item = downloadItem();
    wireResearchDownloadSession(session, eventContext);

    willDownload()({}, item, {});
    item.emitDone("completed");
    await settle();

    expect(mocks.register).toHaveBeenCalledWith(FILE_NAME, "owner-tab", TARGET);
    expect(send).toHaveBeenLastCalledWith(
      "research://download-finished",
      expect.objectContaining({ downloadId: "download-id", fileName: FILE_NAME, success: true }),
    );
  });

  it("cleans only its allocated target when completed registration fails", async () => {
    mocks.register.mockRejectedValue(new Error("lease unavailable"));
    const { session, willDownload } = wiredSession();
    const { context: eventContext, send } = context();
    const item = downloadItem();
    wireResearchDownloadSession(session, eventContext);

    willDownload()({}, item, {});
    item.emitDone("completed");
    await settle();

    expect(mocks.discard).toHaveBeenCalledWith(FILE_NAME, TARGET);
    expect(send).toHaveBeenLastCalledWith(
      "research://download-finished",
      expect.objectContaining({ downloadId: null, fileName: FILE_NAME, success: false }),
    );
  });
});
