import { describe, expect, it, vi } from "vitest";
import {
  RESEARCH_BROWSER_ARCHIVE_MS,
  RESEARCH_BROWSER_SWEEP_INTERVAL_MS,
  ResearchBrowserViewLifecycle,
  type ResearchBrowserViewLifecycleTab,
} from "./research-browser-view-lifecycle";

type TestTab = ResearchBrowserViewLifecycleTab;

function createView(url: string, destroyed = false) {
  return {
    webContents: {
      close: vi.fn(),
      getURL: vi.fn(() => url),
      isDestroyed: vi.fn(() => destroyed),
    },
  };
}

function createLifecycle(tabs: Map<string, TestTab>, now = 0) {
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const detached: unknown[] = [];
  const emitTabs = vi.fn();
  const lifecycle = new ResearchBrowserViewLifecycle({
    acceptUrl: (url) => (typeof url === "string" && url.startsWith("https://") ? url : null),
    activeTabId: () => "active",
    clearInterval: (timer) => timers.delete(timer as unknown as number),
    detachView: (view) => detached.push(view),
    emitTabs,
    now: () => now,
    setInterval: (callback, delayMs) => {
      expect(delayMs).toBe(RESEARCH_BROWSER_SWEEP_INTERVAL_MS);
      const timer = nextTimer++;
      timers.set(timer, callback);
      return timer as unknown as ReturnType<typeof setInterval>;
    },
    tabs,
  });
  return { detached, emitTabs, lifecycle, timers };
}

describe("ResearchBrowserViewLifecycle", () => {
  it("archives only inactive idle views, preserving a validated URL and closing its renderer", () => {
    const activeView = createView("https://example.edu/active");
    const idleView = createView("https://example.edu/redirected");
    const tabs = new Map<string, TestTab>([
      [
        "active",
        { lastActiveAt: 0, tabId: "active", url: "https://example.edu/active", view: activeView },
      ],
      ["idle", { lastActiveAt: 0, tabId: "idle", url: "https://example.edu/old", view: idleView }],
    ]);
    const { detached, emitTabs, lifecycle, timers } = createLifecycle(
      tabs,
      RESEARCH_BROWSER_ARCHIVE_MS + 1,
    );

    lifecycle.start();
    expect(timers.size).toBe(1);
    [...timers.values()][0]!();

    expect(tabs.get("active")?.view).toBe(activeView);
    expect(tabs.get("idle")).toMatchObject({ url: "https://example.edu/redirected", view: null });
    expect(detached).toEqual([idleView]);
    expect(idleView.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    expect(emitTabs).toHaveBeenCalledTimes(1);
  });

  it("disposes tabs and intervals idempotently, even when a view is already destroyed", () => {
    const liveView = createView("https://example.edu/live");
    const destroyedView = createView("https://example.edu/destroyed", true);
    const tabs = new Map<string, TestTab>([
      ["live", { lastActiveAt: 0, tabId: "live", url: "https://example.edu/live", view: liveView }],
      [
        "destroyed",
        {
          lastActiveAt: 0,
          tabId: "destroyed",
          url: "https://example.edu/destroyed",
          view: destroyedView,
        },
      ],
    ]);
    const { detached, lifecycle, timers } = createLifecycle(tabs);

    lifecycle.start();
    lifecycle.start();
    expect(timers.size).toBe(1);
    lifecycle.disposeAll();
    lifecycle.disposeAll();

    expect(timers.size).toBe(0);
    expect(detached).toEqual([liveView, destroyedView]);
    expect(liveView.webContents.close).toHaveBeenCalledTimes(1);
    expect(destroyedView.webContents.close).not.toHaveBeenCalled();
    expect([...tabs.values()].every((tab) => tab.view === null)).toBe(true);
  });

  it("does not persist an unsupported URL while archiving a view", () => {
    const view = createView("file:///private/paper.pdf");
    const tab: TestTab = {
      lastActiveAt: 0,
      tabId: "unsafe",
      url: "https://example.edu/last-safe-page",
      view,
    };
    const { lifecycle } = createLifecycle(new Map([[tab.tabId, tab]]));

    lifecycle.disposeTab(tab, true);

    expect(tab).toMatchObject({ url: "https://example.edu/last-safe-page", view: null });
    expect(view.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  });
});
