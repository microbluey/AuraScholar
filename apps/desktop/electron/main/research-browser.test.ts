import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CH } from "../shared";

type RegisteredHandler = (_event: unknown, ...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  destroyedViews: [] as Array<() => void>,
  getPath: vi.fn(),
  handlers: new Map<string, RegisteredHandler>(),
  loadURL: vi.fn(),
  reload: vi.fn(),
  setProxy: vi.fn(),
  views: [] as unknown[],
}));

vi.mock("electron", () => {
  class WebContentsView {
    readonly setBounds = vi.fn();
    readonly webContents = {
      close: vi.fn(),
      executeJavaScript: vi.fn(),
      getTitle: vi.fn(),
      getURL: vi.fn(() => ""),
      isDestroyed: vi.fn(() => false),
      loadURL: mocks.loadURL,
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
      on: vi.fn(),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === "destroyed") mocks.destroyedViews.push(listener);
      }),
      reload: mocks.reload,
      setWindowOpenHandler: vi.fn(),
    };

    constructor() {
      mocks.views.push(this);
    }
  }

  return {
    app: { getPath: mocks.getPath },
    BrowserWindow: class BrowserWindow {},
    session: { fromPartition: mocks.fromPartition },
    WebContentsView,
  };
});
vi.mock("./ipc", () => ({
  handle: (channel: string, handler: RegisteredHandler) => mocks.handlers.set(channel, handler),
}));
vi.mock("./research-download-events", () => ({ wireResearchDownloadSession: vi.fn() }));
vi.mock("./research-download-store", () => ({
  assertResearchDownloadConsumeInput: vi.fn(),
  consumeResearchDownload: vi.fn(),
  ensureSafeResearchDownloadDirectory: vi.fn(),
  openResearchDownloads: vi.fn(),
}));
vi.mock("./research-download-user-intent", () => ({
  notifyResearchDownloadCaptureExpired: vi.fn(),
  startResearchDownloadCapture: vi.fn(),
}));
vi.mock("./research-print-capture", () => ({ captureResearchPrint: vi.fn() }));

import { initResearchBrowser, registerResearchHandlers } from "./research-browser";

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function researchWindow() {
  let onClosed: (() => void) | undefined;
  const window = {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === "closed") onClosed = listener;
    }),
    webContents: { send: vi.fn() },
  };
  return { close: () => onClosed?.(), window };
}

function researchOpen(): RegisteredHandler {
  const handler = mocks.handlers.get(CH.researchOpen);
  if (!handler) throw new Error("research open handler is missing");
  return handler;
}

function researchActivate(): RegisteredHandler {
  const handler = mocks.handlers.get(CH.researchActivate);
  if (!handler) throw new Error("research activate handler is missing");
  return handler;
}

function researchList(): RegisteredHandler {
  const handler = mocks.handlers.get(CH.researchList);
  if (!handler) throw new Error("research list handler is missing");
  return handler;
}

function researchNavigate(): RegisteredHandler {
  const handler = mocks.handlers.get(CH.researchNavigate);
  if (!handler) throw new Error("research navigate handler is missing");
  return handler;
}

function researchReload(): RegisteredHandler {
  const handler = mocks.handlers.get(CH.researchReload);
  if (!handler) throw new Error("research reload handler is missing");
  return handler;
}

function researchClose(): RegisteredHandler {
  const handler = mocks.handlers.get(CH.researchClose);
  if (!handler) throw new Error("research close handler is missing");
  return handler;
}

let closeWindow: (() => void) | undefined;

beforeEach(() => {
  mocks.fromPartition.mockReset();
  mocks.fromPartition.mockReturnValue({ setProxy: mocks.setProxy });
  mocks.destroyedViews.length = 0;
  mocks.getPath.mockReset();
  mocks.getPath.mockReturnValue("/tmp/aurascholar-research-browser-test");
  mocks.handlers.clear();
  mocks.loadURL.mockReset();
  mocks.loadURL.mockResolvedValue(undefined);
  mocks.reload.mockReset();
  mocks.setProxy.mockReset();
  mocks.setProxy.mockResolvedValue(undefined);
  mocks.views.length = 0;
  registerResearchHandlers();
  const research = researchWindow();
  closeWindow = research.close;
  initResearchBrowser(research.window as never);
});

afterEach(() => {
  closeWindow?.();
  closeWindow = undefined;
});

describe("research browser proxy startup", () => {
  it("does not create a view or start its first load until proxy setup completes", async () => {
    const setup = deferred<void>();
    mocks.setProxy.mockReturnValueOnce(setup.promise);

    const opening = researchOpen()(
      {},
      "custom:site-1",
      "https://example.edu/paper",
      "socks5://127.0.0.1:7890",
      undefined,
    ) as Promise<string>;

    expect(mocks.setProxy).toHaveBeenCalledWith({ proxyRules: "socks5://127.0.0.1:7890" });
    expect(researchList()({})).toEqual([]);
    expect(mocks.views).toHaveLength(0);
    expect(mocks.loadURL).not.toHaveBeenCalled();

    setup.resolve();

    await expect(opening).resolves.toEqual(expect.any(String));
    expect(mocks.views).toHaveLength(1);
    expect(mocks.loadURL).toHaveBeenCalledWith("https://example.edu/paper");
  });

  it("rejects without creating a tab or sending a direct first request when proxy setup fails", async () => {
    mocks.setProxy.mockRejectedValueOnce(new Error("proxy unavailable"));

    await expect(
      researchOpen()(
        {},
        "custom:site-1",
        "https://example.edu/paper",
        "http://proxy.test",
        undefined,
      ),
    ).rejects.toThrow("proxy unavailable");

    expect(researchList()({})).toEqual([]);
    expect(mocks.views).toHaveLength(0);
    expect(mocks.loadURL).not.toHaveBeenCalled();
  });

  it("does not resurrect a tab when proxy setup resolves after its window closes", async () => {
    const setup = deferred<void>();
    mocks.setProxy.mockReturnValueOnce(setup.promise);

    const opening = researchOpen()(
      {},
      "custom:site-1",
      "https://example.edu/paper",
      "http://proxy.test",
      undefined,
    );
    closeWindow?.();
    setup.resolve();

    await expect(opening).rejects.toThrow("研究浏览器已关闭");
    expect(researchList()({})).toEqual([]);
    expect(mocks.views).toHaveLength(0);
    expect(mocks.loadURL).not.toHaveBeenCalled();
  });

  it("returns a failed restored view to an inactive archived tab", async () => {
    const tabId = (await researchOpen()(
      {},
      "custom:site-1",
      "https://example.edu/paper",
      "http://proxy.test",
      undefined,
    )) as string;
    const destroy = mocks.destroyedViews[0];
    expect(destroy).toEqual(expect.any(Function));
    destroy!();
    mocks.loadURL.mockClear();
    mocks.setProxy.mockRejectedValueOnce(new Error("proxy unavailable"));

    await expect(researchActivate()({}, tabId)).rejects.toThrow("proxy unavailable");

    expect(mocks.loadURL).not.toHaveBeenCalled();
    expect(researchList()({})).toMatchObject([{ active: false, archived: true, tabId }]);
  });

  it("gates an archived view and a concurrent navigation behind its proxy setup", async () => {
    const tabId = (await researchOpen()(
      {},
      "custom:site-1",
      "https://example.edu/paper",
      "socks5://127.0.0.1:7890",
      undefined,
    )) as string;
    const destroy = mocks.destroyedViews[0];
    expect(destroy).toEqual(expect.any(Function));
    destroy!();
    mocks.loadURL.mockClear();
    mocks.setProxy.mockClear();

    const setup = deferred<void>();
    mocks.setProxy.mockReturnValueOnce(setup.promise);
    const activation = researchActivate()({}, tabId) as Promise<void>;
    const navigation = researchNavigate()({}, "https://example.edu/next") as Promise<string>;

    expect(mocks.views).toHaveLength(2);
    expect(mocks.loadURL).not.toHaveBeenCalled();

    setup.resolve();

    await expect(activation).resolves.toBeUndefined();
    await expect(navigation).resolves.toBe("https://example.edu/next");
    expect(mocks.setProxy).toHaveBeenCalledWith({ proxyRules: "socks5://127.0.0.1:7890" });
    expect(mocks.loadURL).toHaveBeenNthCalledWith(1, "https://example.edu/paper");
    expect(mocks.loadURL).toHaveBeenNthCalledWith(2, "https://example.edu/next");
  });

  it("waits for the archived next tab proxy before restoring it after a close", async () => {
    const firstTabId = (await researchOpen()(
      {},
      "custom:site-1",
      "https://example.edu/first",
      "socks5://127.0.0.1:7890",
      { reuseExisting: false },
    )) as string;
    const destroyFirst = mocks.destroyedViews[0];
    expect(destroyFirst).toEqual(expect.any(Function));
    destroyFirst!();
    const secondTabId = (await researchOpen()(
      {},
      "custom:site-2",
      "https://example.edu/second",
      "",
      { reuseExisting: false },
    )) as string;
    mocks.loadURL.mockClear();
    mocks.setProxy.mockClear();

    const setup = deferred<void>();
    mocks.setProxy.mockReturnValueOnce(setup.promise);
    const closing = researchClose()({}, secondTabId) as Promise<void>;

    expect(researchList()({})).toMatchObject([{ active: true, tabId: firstTabId }]);
    expect(mocks.loadURL).not.toHaveBeenCalled();

    setup.resolve();

    await expect(closing).resolves.toBeUndefined();
    expect(mocks.setProxy).toHaveBeenCalledWith({ proxyRules: "socks5://127.0.0.1:7890" });
    expect(mocks.loadURL).toHaveBeenCalledWith("https://example.edu/first");
  });

  it("serializes concurrent same-site opens with their first loads", async () => {
    const firstSetup = deferred<void>();
    const secondSetup = deferred<void>();
    const loadedWith: Array<{ proxy: string; url: string }> = [];
    let effectiveProxy = "";
    mocks.setProxy
      .mockImplementationOnce((config) =>
        firstSetup.promise.then(() => {
          effectiveProxy = config.proxyRules ?? "";
        }),
      )
      .mockImplementationOnce((config) =>
        secondSetup.promise.then(() => {
          effectiveProxy = config.proxyRules ?? "";
        }),
      );
    mocks.loadURL.mockImplementation((url: string) => {
      loadedWith.push({ proxy: effectiveProxy, url });
      return Promise.resolve();
    });

    const first = researchOpen()(
      {},
      "custom:site-1",
      "https://example.edu/first",
      "http://proxy-a.test",
      { reuseExisting: false },
    ) as Promise<string>;
    const second = researchOpen()(
      {},
      "custom:site-1",
      "https://example.edu/second",
      "http://proxy-b.test",
      { reuseExisting: false },
    ) as Promise<string>;

    expect(mocks.setProxy).toHaveBeenCalledTimes(1);
    expect(mocks.views).toHaveLength(0);

    firstSetup.resolve();

    await vi.waitFor(() => expect(mocks.setProxy).toHaveBeenCalledTimes(2));
    expect(loadedWith).toEqual([
      { proxy: "http://proxy-a.test/", url: "https://example.edu/first" },
    ]);
    expect(mocks.loadURL.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.setProxy.mock.invocationCallOrder[1]!,
    );
    expect(mocks.views).toHaveLength(1);

    secondSetup.resolve();

    const [firstTabId, secondTabId] = await Promise.all([first, second]);
    expect(loadedWith).toEqual([
      { proxy: "http://proxy-a.test/", url: "https://example.edu/first" },
      { proxy: "http://proxy-b.test/", url: "https://example.edu/second" },
    ]);
    expect(researchList()({})).toEqual(
      expect.arrayContaining([expect.objectContaining({ active: true, tabId: secondTabId })]),
    );
    expect(firstTabId).not.toBe(secondTabId);
  });

  it("does not let navigation bypass a queued same-site proxy change", async () => {
    await researchOpen()({}, "custom:site-1", "https://example.edu/first", "http://proxy-a.test", {
      reuseExisting: false,
    });
    mocks.loadURL.mockClear();
    mocks.setProxy.mockClear();

    const setup = deferred<void>();
    mocks.setProxy.mockReturnValueOnce(setup.promise);
    const opening = researchOpen()(
      {},
      "custom:site-1",
      "https://example.edu/second",
      "http://proxy-b.test",
      { reuseExisting: false },
    ) as Promise<string>;
    const navigation = researchNavigate()({}, "https://example.edu/next") as Promise<string>;

    expect(mocks.setProxy).toHaveBeenCalledWith({ proxyRules: "http://proxy-b.test/" });
    expect(mocks.loadURL).not.toHaveBeenCalled();

    setup.resolve();

    await expect(opening).resolves.toEqual(expect.any(String));
    await expect(navigation).resolves.toBe("https://example.edu/next");
    expect(mocks.loadURL).toHaveBeenNthCalledWith(1, "https://example.edu/second");
    expect(mocks.loadURL).toHaveBeenNthCalledWith(2, "https://example.edu/next");
  });

  it("does not let reload bypass a queued same-site proxy change", async () => {
    await researchOpen()({}, "custom:site-1", "https://example.edu/first", "http://proxy-a.test", {
      reuseExisting: false,
    });
    mocks.loadURL.mockClear();
    mocks.reload.mockClear();
    mocks.setProxy.mockClear();

    const setup = deferred<void>();
    mocks.setProxy.mockReturnValueOnce(setup.promise);
    const opening = researchOpen()(
      {},
      "custom:site-1",
      "https://example.edu/second",
      "http://proxy-b.test",
      { reuseExisting: false },
    ) as Promise<string>;
    researchReload()({});

    expect(mocks.reload).not.toHaveBeenCalled();

    setup.resolve();

    await expect(opening).resolves.toEqual(expect.any(String));
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce());
    expect(mocks.loadURL).toHaveBeenCalledWith("https://example.edu/second");
    expect(mocks.loadURL.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.reload.mock.invocationCallOrder[0]!,
    );
  });
});
