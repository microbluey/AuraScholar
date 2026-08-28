import { describe, expect, it, vi } from "vitest";
import type { Bounds } from "../shared";
import {
  ResearchBrowserViewPresentation,
  type ResearchBrowserHostedView,
  type ResearchBrowserPresentedTab,
} from "./research-browser-view-presentation";

interface TestView extends ResearchBrowserHostedView {
  id: string;
}

interface TestTab extends ResearchBrowserPresentedTab<TestView> {
  id: string;
}

function createPresentation() {
  const bounds: Bounds = { height: 480, width: 640, x: 12, y: 24 };
  const tabs = new Map<string, TestTab>([
    ["first", { id: "first", lastActiveAt: 0, view: null }],
    ["popup", { id: "popup", lastActiveAt: 0, view: null }],
  ]);
  const attached: TestView[] = [];
  const detached: TestView[] = [];
  const createView = vi.fn((tab: TestTab): TestView => ({ id: tab.id, setBounds: vi.fn() }));
  const emitTabs = vi.fn();
  let detachError: Error | null = null;
  let activeTabId: string | null = null;
  const presentation = new ResearchBrowserViewPresentation({
    createView,
    emitTabs,
    getActiveTabId: () => activeTabId,
    getBounds: () => bounds,
    getTab: (tabId) => tabs.get(tabId),
    getWindow: () => ({
      contentView: {
        addChildView: (view) => attached.push(view),
        removeChildView: (view) => {
          if (detachError) throw detachError;
          detached.push(view);
        },
      },
      isDestroyed: () => false,
    }),
    setActiveTabId: (tabId) => {
      activeTabId = tabId;
    },
  });
  return {
    activeTabId: () => activeTabId,
    attached,
    bounds,
    createView,
    detached,
    emitTabs,
    failNextDetach: () => {
      detachError = new Error("window is closing");
    },
    presentation,
    tabs,
  };
}

describe("research browser view presentation", () => {
  it("attaches a normal active tab at the reported bounds", () => {
    const { attached, bounds, emitTabs, presentation, tabs } = createPresentation();

    presentation.present("first");

    const view = tabs.get("first")?.view;
    expect(attached).toEqual([view]);
    expect(view?.setBounds).toHaveBeenCalledWith(bounds);
    expect(emitTabs).toHaveBeenCalledOnce();
  });

  it("waits for an explicit renderer activation before attaching a requested tab", () => {
    const { attached, presentation } = createPresentation();
    presentation.select("first");
    expect(attached).toHaveLength(0);

    presentation.present("first");
    expect(attached).toHaveLength(1);
  });

  it("keeps popup and activation views detached until every modal lease is released", () => {
    const { activeTabId, attached, detached, presentation, tabs } = createPresentation();
    presentation.present("first");
    const firstView = tabs.get("first")?.view;
    const firstLease = presentation.suspend();
    const secondLease = presentation.suspend();

    presentation.show("popup");
    const popupView = tabs.get("popup")?.view;
    expect(activeTabId()).toBe("popup");
    expect(detached).toContain(firstView);
    expect(attached).toEqual([firstView]);

    expect(presentation.resume(firstLease)).toBe(true);
    presentation.show("popup");
    expect(attached).toEqual([firstView]);

    expect(presentation.resume(secondLease)).toBe(true);
    expect(presentation.resume(secondLease)).toBe(false);
    presentation.show("popup");
    expect(attached).toEqual([firstView, popupView]);
  });

  it("does not let an invalid release lift a suspension", () => {
    const { attached, presentation } = createPresentation();
    presentation.present("first");
    presentation.suspend();

    expect(presentation.resume({ suspensionId: "not-a-token" })).toBe(false);
    presentation.show("popup");
    expect(attached).toHaveLength(1);
  });

  it("keeps automatic popup views detached after the browser route is hidden", () => {
    const { attached, presentation } = createPresentation();
    presentation.present("first");
    presentation.hide();

    presentation.show("popup");
    expect(attached).toHaveLength(1);

    presentation.present("popup");
    expect(attached).toHaveLength(2);
  });

  it("rolls back a new lease when detaching a closing view fails", () => {
    const { failNextDetach, presentation } = createPresentation();
    presentation.present("first");
    failNextDetach();

    expect(() => presentation.suspend()).toThrow("window is closing");
    expect(presentation.suspended).toBe(false);
  });
});
