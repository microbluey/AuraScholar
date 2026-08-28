import { describe, expect, it, vi } from "vitest";
import {
  loadResearchBrowserViewAfterProxy,
  openResearchTabAfterProxy,
} from "./research-browser-proxy-bootstrap";

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("research browser proxy bootstrap", () => {
  it("waits for proxy setup before constructing a view and starting its first load", async () => {
    const setup = deferred<void>();
    const loadURL = vi.fn();
    const open = vi.fn(() => loadURL("https://example.edu/paper"));
    const setProxy = vi.fn(() => setup.promise);

    const result = openResearchTabAfterProxy({ setProxy }, "socks5://127.0.0.1:7890", open);

    expect(setProxy).toHaveBeenCalledWith({ proxyRules: "socks5://127.0.0.1:7890" });
    expect(open).not.toHaveBeenCalled();
    expect(loadURL).not.toHaveBeenCalled();

    setup.resolve();

    await expect(result).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledOnce();
    expect(loadURL).toHaveBeenCalledWith("https://example.edu/paper");
  });

  it("configures direct mode before opening when no proxy is selected", async () => {
    const open = vi.fn(() => "tab-id");
    const setProxy = vi.fn().mockResolvedValue(undefined);

    await expect(openResearchTabAfterProxy({ setProxy }, "", open)).resolves.toBe("tab-id");

    expect(setProxy).toHaveBeenCalledWith({ mode: "direct" });
    expect(open).toHaveBeenCalledOnce();
  });

  it("fails closed when proxy configuration is rejected", async () => {
    const open = vi.fn();
    const setProxy = vi.fn().mockRejectedValue(new Error("proxy unavailable"));

    await expect(
      openResearchTabAfterProxy({ setProxy }, "http://proxy.test", open),
    ).rejects.toThrow("proxy unavailable");
    expect(open).not.toHaveBeenCalled();
  });

  it("waits again before loading a restored view whose proxy may have changed", async () => {
    const setup = deferred<void>();
    const loadURL = vi.fn();
    const setProxy = vi.fn(() => setup.promise);

    const result = loadResearchBrowserViewAfterProxy(
      { setProxy },
      "http://proxy.test",
      false,
      () => true,
      loadURL,
    );

    expect(loadURL).not.toHaveBeenCalled();
    setup.resolve();

    await expect(result).resolves.toBe(true);
    expect(setProxy).toHaveBeenCalledWith({ proxyRules: "http://proxy.test" });
    expect(loadURL).toHaveBeenCalledOnce();
  });

  it("does not configure or load a view that is no longer current", async () => {
    const loadURL = vi.fn();
    const setProxy = vi.fn().mockResolvedValue(undefined);

    await expect(
      loadResearchBrowserViewAfterProxy({ setProxy }, "", false, () => false, loadURL),
    ).resolves.toBe(false);

    expect(setProxy).not.toHaveBeenCalled();
    expect(loadURL).not.toHaveBeenCalled();
  });

  it("does not load when a view becomes stale during proxy setup", async () => {
    const setup = deferred<void>();
    const loadURL = vi.fn();
    const setProxy = vi.fn(() => setup.promise);
    let current = true;

    const result = loadResearchBrowserViewAfterProxy(
      { setProxy },
      "http://proxy.test",
      false,
      () => current,
      loadURL,
    );

    current = false;
    setup.resolve();

    await expect(result).resolves.toBe(false);
    expect(setProxy).toHaveBeenCalledWith({ proxyRules: "http://proxy.test" });
    expect(loadURL).not.toHaveBeenCalled();
  });

  it("skips a queued view that becomes stale before it reaches the session", async () => {
    const releaseFirstOpen = deferred<void>();
    const setProxy = vi.fn().mockResolvedValue(undefined);
    const firstOpen = vi.fn(() => releaseFirstOpen.promise);
    const loadURL = vi.fn();
    const session = { setProxy };
    let current = true;

    const first = openResearchTabAfterProxy(session, "http://proxy-a.test", firstOpen);
    await vi.waitFor(() => expect(firstOpen).toHaveBeenCalledOnce());
    const staleView = loadResearchBrowserViewAfterProxy(
      session,
      "http://proxy-b.test",
      false,
      () => current,
      loadURL,
    );

    current = false;
    releaseFirstOpen.resolve();

    await expect(first).resolves.toBeUndefined();
    await expect(staleView).resolves.toBe(false);
    expect(setProxy).toHaveBeenCalledTimes(1);
    expect(loadURL).not.toHaveBeenCalled();
  });

  it("serializes proxy setup with the opening callback for one shared session", async () => {
    const firstOpen = deferred<void>();
    const setProxy = vi.fn().mockResolvedValue(undefined);
    const openFirst = vi.fn(() => firstOpen.promise);
    const openSecond = vi.fn(() => "second-tab");
    const session = { setProxy };

    const first = openResearchTabAfterProxy(session, "http://proxy-a.test", openFirst);
    const second = openResearchTabAfterProxy(session, "http://proxy-b.test", openSecond);

    await vi.waitFor(() => expect(openFirst).toHaveBeenCalledOnce());
    expect(setProxy).toHaveBeenCalledTimes(1);
    expect(openSecond).not.toHaveBeenCalled();

    firstOpen.resolve();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe("second-tab");
    expect(setProxy).toHaveBeenNthCalledWith(1, { proxyRules: "http://proxy-a.test" });
    expect(setProxy).toHaveBeenNthCalledWith(2, { proxyRules: "http://proxy-b.test" });
    expect(openSecond).toHaveBeenCalledOnce();
  });

  it("continues with the next operation after a proxy setup failure", async () => {
    const error = new Error("proxy unavailable");
    const setProxy = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const firstOpen = vi.fn();
    const secondOpen = vi.fn(() => "second-tab");
    const session = { setProxy };

    const first = openResearchTabAfterProxy(session, "http://proxy-a.test", firstOpen);
    const second = openResearchTabAfterProxy(session, "http://proxy-b.test", secondOpen);

    await expect(first).rejects.toThrow(error);
    await expect(second).resolves.toBe("second-tab");
    expect(firstOpen).not.toHaveBeenCalled();
    expect(secondOpen).toHaveBeenCalledOnce();
    expect(setProxy).toHaveBeenNthCalledWith(1, { proxyRules: "http://proxy-a.test" });
    expect(setProxy).toHaveBeenNthCalledWith(2, { proxyRules: "http://proxy-b.test" });
  });

  it("uses the same queue for restoring a view and opening another tab", async () => {
    const firstSetup = deferred<void>();
    const setProxy = vi
      .fn()
      .mockReturnValueOnce(firstSetup.promise)
      .mockResolvedValueOnce(undefined);
    const restoredLoad = vi.fn();
    const open = vi.fn(() => "new-tab");
    const session = { setProxy };

    const restored = loadResearchBrowserViewAfterProxy(
      session,
      "http://proxy-a.test",
      false,
      () => true,
      restoredLoad,
    );
    const opening = openResearchTabAfterProxy(session, "http://proxy-b.test", open);

    expect(setProxy).toHaveBeenCalledTimes(1);
    expect(restoredLoad).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    firstSetup.resolve();

    await expect(restored).resolves.toBe(true);
    await expect(opening).resolves.toBe("new-tab");
    expect(restoredLoad).toHaveBeenCalledOnce();
    expect(setProxy).toHaveBeenNthCalledWith(1, { proxyRules: "http://proxy-a.test" });
    expect(setProxy).toHaveBeenNthCalledWith(2, { proxyRules: "http://proxy-b.test" });
  });

  it("does not block independent sessions behind another site's proxy setup", async () => {
    const pendingSetup = deferred<void>();
    const firstSetProxy = vi.fn(() => pendingSetup.promise);
    const secondSetProxy = vi.fn().mockResolvedValue(undefined);
    const firstOpen = vi.fn();
    const secondOpen = vi.fn(() => "second-tab");

    const first = openResearchTabAfterProxy(
      { setProxy: firstSetProxy },
      "http://proxy-a.test",
      firstOpen,
    );
    const second = openResearchTabAfterProxy(
      { setProxy: secondSetProxy },
      "http://proxy-b.test",
      secondOpen,
    );

    await expect(second).resolves.toBe("second-tab");
    expect(secondOpen).toHaveBeenCalledOnce();
    expect(firstOpen).not.toHaveBeenCalled();

    pendingSetup.resolve();
    await expect(first).resolves.toBeUndefined();
  });
});
