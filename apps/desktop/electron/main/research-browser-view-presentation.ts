import { randomUUID } from "node:crypto";
import type { Bounds } from "../shared";

export interface ResearchBrowserHostedView {
  setBounds(bounds: Bounds): void;
}

export interface ResearchBrowserHostedWindow<View extends ResearchBrowserHostedView> {
  isDestroyed(): boolean;
  contentView: {
    addChildView(view: View): void;
    removeChildView(view: View): void;
  };
}

export interface ResearchBrowserPresentedTab<View extends ResearchBrowserHostedView> {
  lastActiveAt: number;
  view: View | null;
}

export interface ResearchBrowserViewPresentationOptions<
  View extends ResearchBrowserHostedView,
  Tab extends ResearchBrowserPresentedTab<View>,
> {
  createView(tab: Tab): View;
  emitTabs(): void;
  getActiveTabId(): string | null;
  getBounds(): Bounds;
  getTab(tabId: string): Tab | undefined;
  getWindow(): ResearchBrowserHostedWindow<View> | null;
  setActiveTabId(tabId: string | null): void;
}

/**
 * Owns native view attachment and short-lived modal suspension leases.
 * Releasing a lease never reattaches a view; the renderer must explicitly
 * restore the active tab after its DOM dialog has unmounted.
 */
export class ResearchBrowserViewPresentation<
  View extends ResearchBrowserHostedView,
  Tab extends ResearchBrowserPresentedTab<View>,
> {
  private presentationVisible = false;
  private readonly suspensionIds = new Set<string>();

  constructor(private readonly options: ResearchBrowserViewPresentationOptions<View, Tab>) {}

  get suspended(): boolean {
    return this.suspensionIds.size > 0;
  }

  /** Update the selected tab; attach it only while the browser route is visible. */
  show(tabId: string, allowAttachment = true): void {
    const tab = this.options.getTab(tabId);
    const window = this.options.getWindow();
    if (!tab || !window || window.isDestroyed()) return;
    this.detachActive();
    if (!tab.view) tab.view = this.options.createView(tab);
    tab.view.setBounds(this.options.getBounds());
    tab.lastActiveAt = Date.now();
    this.options.setActiveTabId(tabId);
    if (allowAttachment && this.presentationVisible && !this.suspended) {
      window.contentView.addChildView(tab.view);
    }
    this.options.emitTabs();
  }

  /** Select a renderer-requested tab; its host must explicitly activate it. */
  select(tabId: string): void {
    this.show(tabId, false);
  }

  /** Explicit renderer activation makes the browser route eligible for attachment again. */
  present(tabId: string): void {
    this.presentationVisible = true;
    this.show(tabId);
  }

  hide(): void {
    this.presentationVisible = false;
    this.detachActive();
  }

  private detachActive(): void {
    const activeTabId = this.options.getActiveTabId();
    const view = activeTabId ? this.options.getTab(activeTabId)?.view : null;
    if (view) this.detach(view);
  }

  detach(view: View): void {
    const window = this.options.getWindow();
    if (!window || window.isDestroyed()) return;
    window.contentView.removeChildView(view);
  }

  suspend(): string {
    const suspensionId = randomUUID();
    this.suspensionIds.add(suspensionId);
    try {
      this.detachActive();
      return suspensionId;
    } catch (error) {
      this.suspensionIds.delete(suspensionId);
      throw error;
    }
  }

  resume(suspensionId: unknown): boolean {
    return typeof suspensionId === "string" && this.suspensionIds.delete(suspensionId);
  }

  clear(): void {
    this.presentationVisible = false;
    this.suspensionIds.clear();
  }
}
