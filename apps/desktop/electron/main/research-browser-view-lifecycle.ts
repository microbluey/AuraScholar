export const RESEARCH_BROWSER_ARCHIVE_MS = 30 * 60 * 1000;
export const RESEARCH_BROWSER_SWEEP_INTERVAL_MS = 60 * 1000;

export interface ResearchBrowserViewLifecycleWebContents {
  close(options?: { waitForBeforeUnload: boolean }): void;
  getURL(): string;
  isDestroyed(): boolean;
}

export interface ResearchBrowserViewLifecycleView {
  webContents: ResearchBrowserViewLifecycleWebContents;
}

export interface ResearchBrowserViewLifecycleTab {
  lastActiveAt: number;
  tabId: string;
  url: string;
  view: ResearchBrowserViewLifecycleView | null;
}

type SweepTimer = ReturnType<typeof setInterval>;

export interface ResearchBrowserViewLifecycleOptions<T extends ResearchBrowserViewLifecycleTab> {
  acceptUrl(rawUrl: unknown): string | null;
  activeTabId(): string | null;
  clearInterval?(timer: SweepTimer): void;
  detachView(view: NonNullable<T["view"]>): void;
  emitTabs(): void;
  now?(): number;
  setInterval?(callback: () => void, delayMs: number): SweepTimer;
  tabs: Map<string, T>;
}

/** Own the interval and WebContents teardown for a research-browser window. */
export class ResearchBrowserViewLifecycle<T extends ResearchBrowserViewLifecycleTab> {
  private sweepTimer: SweepTimer | null = null;

  constructor(private readonly options: ResearchBrowserViewLifecycleOptions<T>) {}

  start(): void {
    if (this.sweepTimer !== null) return;
    const schedule = this.options.setInterval ?? setInterval;
    this.sweepTimer = schedule(() => this.sweep(), RESEARCH_BROWSER_SWEEP_INTERVAL_MS);
  }

  stop(): void {
    if (this.sweepTimer === null) return;
    const cancel = this.options.clearInterval ?? clearInterval;
    cancel(this.sweepTimer);
    this.sweepTimer = null;
  }

  disposeTab(tab: T, preserveCurrentUrl = false): void {
    const view = tab.view;
    if (!view) return;
    const contents = view.webContents;
    if (preserveCurrentUrl && !contents.isDestroyed()) {
      try {
        const currentUrl = this.options.acceptUrl(contents.getURL());
        if (currentUrl) tab.url = currentUrl;
      } catch {
        // Continue teardown even if a renderer exits while being archived.
      }
    }
    tab.view = null;
    try {
      this.options.detachView(view);
    } catch {
      // A closing BrowserWindow can already have released its content view.
    }
    if (contents.isDestroyed()) return;
    try {
      contents.close({ waitForBeforeUnload: false });
    } catch {
      // Another teardown path may have destroyed the renderer first.
    }
  }

  disposeAll(): void {
    this.stop();
    for (const tab of this.options.tabs.values()) this.disposeTab(tab);
  }

  private sweep(): void {
    const now = (this.options.now ?? Date.now)();
    const activeTabId = this.options.activeTabId();
    for (const tab of this.options.tabs.values()) {
      if (
        tab.tabId !== activeTabId &&
        tab.view &&
        now - tab.lastActiveAt > RESEARCH_BROWSER_ARCHIVE_MS
      ) {
        this.disposeTab(tab, true);
      }
    }
    this.options.emitTabs();
  }
}
