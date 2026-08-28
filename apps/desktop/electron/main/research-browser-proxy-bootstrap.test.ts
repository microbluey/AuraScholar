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

  it("does not load a view that is no longer current after proxy setup", async () => {
    const loadURL = vi.fn();
    const setProxy = vi.fn().mockResolvedValue(undefined);

    await expect(
      loadResearchBrowserViewAfterProxy({ setProxy }, "", false, () => false, loadURL),
    ).resolves.toBe(false);

    expect(setProxy).toHaveBeenCalledWith({ mode: "direct" });
    expect(loadURL).not.toHaveBeenCalled();
  });
});
