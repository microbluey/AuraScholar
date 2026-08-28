// Multi-tab research browser with persistent per-site sessions and archivable views.
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, session, WebContentsView, type Session } from "electron";
import { handle } from "./ipc";
import {
  isAllowedResearchUrl,
  MAX_RESEARCH_TABS,
  parseResearchBounds,
  parseResearchNavigateInput,
  parseResearchOpenInput,
  parseResearchSiteIds,
  researchPartition,
  validateResearchUrl,
  validateResearchSiteId,
  validateResearchTabId,
} from "./research-browser-policy";
import {
  acceptResearchMainFrameUrl,
  commitResearchMainFrameUrl,
  guardResearchNavigation,
} from "./research-browser-navigation-policy";
import {
  loadResearchBrowserViewAfterProxy,
  openResearchTabAfterProxy,
} from "./research-browser-proxy-bootstrap";
import { normalizeResearchScholarMeta } from "./research-browser-scholar-meta";
import { ResearchBrowserViewPresentation } from "./research-browser-view-presentation";
import { ResearchBrowserViewLifecycle } from "./research-browser-view-lifecycle";
import {
  CH,
  EV,
  type Bounds,
  type CaptureResult,
  type ResearchTab,
  type ScholarIdentity,
} from "../shared";
import {
  assertResearchDownloadConsumeInput,
  consumeResearchDownload,
  ensureSafeResearchDownloadDirectory,
  openResearchDownloads,
} from "./research-download-store";
import { wireResearchDownloadSession } from "./research-download-events";
import { captureResearchPrint } from "./research-print-capture";
import {
  notifyResearchDownloadCaptureExpired,
  startResearchDownloadCapture,
} from "./research-download-user-intent";

interface Tab {
  tabId: string;
  ownerTabId: string;
  siteId: string;
  url: string;
  title: string;
  proxy: string; // "" = direct; else proxyRules for this site's session
  proxyPrepared: boolean;
  proxyStartup: Promise<boolean> | null;
  lastActiveAt: number;
  view: WebContentsView | null; // null when archived
  scholar?: ScholarIdentity; // most recent page identity sniffed from meta tags
}

let win: BrowserWindow | null = null;
let bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
let activeTabId: string | null = null;
const tabs = new Map<string, Tab>();
const wiredSessions = new Set<string>();
// Map citation_pdf_url values back to abstract-page identity for downloads.
const identityByPdfUrl = new Map<string, ScholarIdentity>();

function snapshot(): ResearchTab[] {
  return [...tabs.values()].map((t) => ({
    tabId: t.tabId,
    siteId: t.siteId,
    url: t.url,
    title: t.title || t.url,
    archived: t.view === null,
    active: t.tabId === activeTabId,
    canGoBack: t.view ? t.view.webContents.navigationHistory.canGoBack() : false,
    canGoForward: t.view ? t.view.webContents.navigationHistory.canGoForward() : false,
  }));
}

function emitTabs(): void {
  win?.webContents.send(EV.researchTabsChanged, snapshot());
}

function ensureDownloadDir(): void {
  ensureSafeResearchDownloadDirectory(app.getPath("userData"));
}

function wireSession(sess: Session, siteId: string): void {
  const key = researchPartition(siteId);
  if (wiredSessions.has(key)) return;
  wiredSessions.add(key);
  wireResearchDownloadSession(sess, {
    findSourceTab: (sourceWebContents) =>
      [...tabs.values()].find((tab) => tab.view?.webContents === sourceWebContents),
    getWindow: () => win,
    resolveIdentity: resolveDownloadIdentity,
  });
}

const viewPresentation = new ResearchBrowserViewPresentation<WebContentsView, Tab>({
  createView: (tab) => createView(tab),
  emitTabs,
  getActiveTabId: () => activeTabId,
  getBounds: () => bounds,
  getTab: (tabId) => tabs.get(tabId),
  getWindow: () => win,
  setActiveTabId: (tabId) => (activeTabId = tabId),
});
const viewLifecycle = new ResearchBrowserViewLifecycle({
  acceptUrl: (url) => acceptResearchMainFrameUrl(url, true),
  activeTabId: () => activeTabId,
  detachView: (view) => viewPresentation.detach(view),
  emitTabs,
  tabs,
});

/** Read scholarly meta tags in the isolated world; failures are a no-op. */
async function sniffScholar(tab: Tab): Promise<void> {
  const view = tab.view;
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const pageUrl = acceptResearchMainFrameUrl(wc.getURL(), true);
  if (!pageUrl) return;
  const meta = await wc
    .executeJavaScript(
      `(() => {
        const out = {};
        for (const m of document.querySelectorAll('meta[name]')) {
          const n = (m.getAttribute('name') || '').toLowerCase();
          const c = m.getAttribute('content');
          if (!c) continue;
          if (/^(citation_doi|citation_title|citation_pdf_url|citation_arxiv_id|dc\\.identifier|prism\\.doi)$/.test(n)) {
            (out[n] = out[n] || []).push(c);
          }
        }
        return out;
      })()`,
    )
    .catch(() => null);
  if (!meta || typeof meta !== "object" || wc.isDestroyed() || tab.view !== view) return;
  const settledUrl = acceptResearchMainFrameUrl(wc.getURL(), true);
  if (!settledUrl || settledUrl !== pageUrl) return;
  const identity = normalizeResearchScholarMeta(meta as Record<string, string[]>, settledUrl);
  tab.scholar = identity;
  if (identity?.pdfUrl) identityByPdfUrl.set(identity.pdfUrl, identity);
}

/** Normalize a URL for matching: drop hash, trailing slash, force https host. */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.host}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Look up a sniffed identity by full-text URL, tolerant of minor URL drift. */
function identityForUrl(url: string): ScholarIdentity | undefined {
  const direct = identityByPdfUrl.get(url);
  if (direct) return direct;
  const key = urlKey(url);
  for (const [pdfUrl, identity] of identityByPdfUrl) {
    if (urlKey(pdfUrl) === key) return identity;
  }
  return undefined;
}

/** Prefer the tab identity, then match a previously sniffed PDF URL. */
function resolveDownloadIdentity(
  tab: Tab | undefined,
  downloadUrl: string,
): ScholarIdentity | undefined {
  if (tab?.scholar) return tab.scholar;
  return identityForUrl(downloadUrl);
}

function createView(tab: Tab): WebContentsView {
  const sess = session.fromPartition(researchPartition(tab.siteId));
  wireSession(sess, tab.siteId);
  const view = new WebContentsView({
    webPreferences: {
      session: sess,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  tab.view = view;
  view.webContents.setWindowOpenHandler(({ url }) => {
    // Open publisher target=_blank/PDF links in a fresh tab with the same session.
    if (isAllowedResearchUrl(url) && tabs.size < MAX_RESEARCH_TABS) {
      try {
        spawnTab(tab.siteId, url, tab.proxy, tab.ownerTabId);
      } catch {
        // Fail closed if a concurrent tab limit or URL-policy check changes
        // between the guard above and the synchronous tab creation.
      }
    }
    return { action: "deny" };
  });
  view.webContents.on("will-frame-navigate", guardResearchNavigation);
  view.webContents.on("will-redirect", guardResearchNavigation);
  view.webContents.on("will-navigate", guardResearchNavigation);
  view.webContents.once("destroyed", () => {
    if (tab.view !== view) return;
    tab.view = null;
    emitTabs();
  });
  view.webContents.on("page-title-updated", (_e, title) => {
    tab.title = title;
    emitTabs();
  });
  view.webContents.on("did-finish-load", () => {
    const safeUrl = commitResearchMainFrameUrl(tab, view.webContents.getURL(), true);
    if (!safeUrl) return;
    win?.webContents.send(EV.researchLoaded, { tabId: tab.tabId, url: safeUrl });
    emitTabs();
    void sniffScholar(tab);
  });
  // Navigation within the page updates url + back/forward availability.
  view.webContents.on("did-navigate", (_event, url) => {
    const safeUrl = commitResearchMainFrameUrl(tab, url, true);
    if (!safeUrl) return;
    // Clicking "Paper" navigates to the full-text URL we sniffed earlier — carry
    // that page's identity over so the download attaches to the right work.
    // Otherwise this is a new document: drop the stale identity.
    tab.scholar = identityForUrl(safeUrl);
    emitTabs();
  });
  // SPA route changes can swap the head meta without a full load.
  view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!commitResearchMainFrameUrl(tab, url, isMainFrame)) return;
    emitTabs();
    void sniffScholar(tab);
  });
  const proxyPrepared = tab.proxyPrepared;
  tab.proxyPrepared = false;
  tab.proxyStartup = loadResearchBrowserViewAfterProxy(
    sess,
    tab.proxy,
    proxyPrepared,
    () => tabs.get(tab.tabId) === tab && tab.view === view && !view.webContents.isDestroyed(),
    () => void view.webContents.loadURL(tab.url),
  );
  void tab.proxyStartup.catch(() => {
    if (tab.view !== view) return;
    viewLifecycle.disposeTab(tab);
    if (activeTabId === tab.tabId) activeTabId = null;
    emitTabs();
  });
  return view;
}

/** Create and activate a tab for IPC opens and in-page target=_blank links. */
function spawnTab(
  siteId: string,
  url: string,
  proxy: string,
  ownerTabId?: string,
  allowAttachment = true,
  proxyPrepared = false,
): string {
  if (tabs.size >= MAX_RESEARCH_TABS) {
    throw new Error(`Research tabs are limited to ${MAX_RESEARCH_TABS}`);
  }
  const safeUrl = validateResearchUrl(url).toString();
  const tabId = randomUUID();
  tabs.set(tabId, {
    tabId,
    ownerTabId: ownerTabId ?? tabId,
    siteId,
    url: safeUrl,
    title: "",
    proxy,
    proxyPrepared,
    proxyStartup: null,
    lastActiveAt: Date.now(),
    view: null,
    // Opening a known full-text URL in a new tab (target=_blank "Paper" link)
    // inherits the abstract page's identity so its download attaches correctly.
    scholar: identityForUrl(safeUrl),
  });
  if (allowAttachment) viewPresentation.show(tabId);
  else viewPresentation.select(tabId);
  return tabId;
}

function disposeResearchBrowser(): void {
  viewLifecycle.disposeAll();
  // DownloadItem completion can outlive a closed view. Its admission remains
  // reserved until the download event's terminal cleanup releases it.
  tabs.clear();
  identityByPdfUrl.clear();
  viewPresentation.clear();
  activeTabId = null;
  win = null;
}

export function initResearchBrowser(window: BrowserWindow): void {
  if (win === window) return;
  if (win) disposeResearchBrowser();
  win = window;
  openResearchDownloads();
  ensureDownloadDir();
  viewLifecycle.start();
  window.once("closed", () => {
    if (win === window) disposeResearchBrowser();
  });
}

export function hideResearchViews(): void {
  viewPresentation.hide();
}

export function registerResearchHandlers(): void {
  handle(
    CH.researchOpen,
    async (_e, siteId: unknown, url: unknown, proxy: unknown, options: unknown) => {
      const input = parseResearchOpenInput(siteId, url, proxy, options);
      const originWindow = win;
      const sess = session.fromPartition(researchPartition(input.siteId));
      return openResearchTabAfterProxy(sess, input.proxy, () => {
        if (!originWindow || win !== originWindow || originWindow.isDestroyed()) {
          throw new Error("研究浏览器已关闭");
        }
        // Reuse an existing tab for the same site unless this is an isolated task.
        const existing =
          input.options?.reuseExisting === false
            ? undefined
            : [...tabs.values()].find((t) => t.siteId === input.siteId);
        if (existing) {
          existing.proxy = input.proxy;
          existing.proxyPrepared = existing.view === null;
          viewPresentation.select(existing.tabId);
          return existing.tabId;
        }
        return spawnTab(input.siteId, input.url, input.proxy, undefined, false, true);
      });
    },
  );

  handle(CH.researchActivate, async (_e, tabId: unknown) => {
    const validTabId = validateResearchTabId(tabId);
    viewPresentation.present(validTabId);
    await tabs.get(validTabId)?.proxyStartup;
  });

  handle(CH.researchGoBack, () => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (tab?.view?.webContents.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    }
  });

  handle(CH.researchGoForward, () => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (tab?.view?.webContents.navigationHistory.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    }
  });

  handle(CH.researchReload, () => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    tab?.view?.webContents.reload();
  });

  // null arg = read the active tab's current URL; a string = navigate to it.
  handle(CH.researchNavigate, async (_e, url: unknown) => {
    const parsedUrl = parseResearchNavigateInput(url);
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return "";
    if (parsedUrl === null) {
      return tab.view ? tab.view.webContents.getURL() : tab.url;
    }
    const safeUrl = parsedUrl;
    const view = tab.view;
    if (view) await tab.proxyStartup;
    tab.url = safeUrl;
    if (view && tab.view === view && !view.webContents.isDestroyed()) {
      void view.webContents.loadURL(safeUrl);
    }
    return safeUrl;
  });

  handle(CH.researchClose, async (_e, tabId: unknown) => {
    const validTabId = validateResearchTabId(tabId);
    const tab = tabs.get(validTabId);
    if (!tab) return;
    viewLifecycle.disposeTab(tab);
    tabs.delete(validTabId);
    if (activeTabId === validTabId) {
      activeTabId = null;
      const next = [...tabs.keys()][0];
      if (next) {
        viewPresentation.show(next);
        await tabs.get(next)?.proxyStartup;
      }
    }
    emitTabs();
  });

  handle(CH.researchHide, () => {
    viewPresentation.hide();
  });

  handle(CH.researchSuspend, () => viewPresentation.suspend());

  handle(CH.researchResume, (_e, suspensionId: unknown) => viewPresentation.resume(suspensionId));

  handle(CH.researchSetBounds, (_e, b: unknown) => {
    bounds = parseResearchBounds(b);
    const cur = activeTabId ? tabs.get(activeTabId) : null;
    cur?.view?.setBounds(bounds);
  });

  handle(CH.researchList, () => snapshot());

  handle(CH.researchConsumeDownload, (_e, input: unknown) => {
    const { downloadId } = assertResearchDownloadConsumeInput(input);
    return consumeResearchDownload(downloadId);
  });

  // Capture inline/embedded full-text pages through downloadURL or printToPDF.
  handle(CH.researchCapture, async (): Promise<CaptureResult> => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    const view = tab?.view;
    if (!tab || !view) return { kind: "none", error: "no active page" };
    const wc = view.webContents;
    const originWindow = win;
    const originStillLive = (): boolean =>
      !!originWindow &&
      win === originWindow &&
      !originWindow.isDestroyed() &&
      tabs.get(tab.tabId) === tab &&
      tab.view === view &&
      !wc.isDestroyed();
    if (!originWindow || !originStillLive()) {
      return { kind: "none", error: "研究浏览器当前页面地址不受支持" };
    }
    if (!acceptResearchMainFrameUrl(wc.getURL(), true)) {
      return { kind: "none", error: "研究浏览器当前页面地址不受支持" };
    }

    await sniffScholar(tab);
    if (!originStillLive()) {
      return { kind: "none", error: "研究浏览器当前页面地址不受支持" };
    }
    const url = acceptResearchMainFrameUrl(wc.getURL(), true);
    if (!url) return { kind: "none", error: "研究浏览器当前页面地址不受支持" };

    if (/\.pdf(\?|#|$)/i.test(url)) {
      startResearchDownloadCapture(wc, url, {
        onExpired: notifyResearchDownloadCaptureExpired.bind(null, originWindow, tab),
      });
      return { kind: "download" };
    }

    return captureResearchPrint({
      ensureDownloadDirectory: ensureDownloadDir,
      getTitle: () => wc.getTitle(),
      isOriginLive: originStillLive,
      originWindow,
      ownerTabId: tab.ownerTabId,
      printToPdf: () => wc.printToPDF({ printBackground: true }),
      scholar: tab.scholar,
      tabId: tab.tabId,
      userDataRoot: () => app.getPath("userData"),
    });
  });

  handle(CH.researchClearSiteData, async (_e, siteId: unknown) => {
    const validSiteId = validateResearchSiteId(siteId);
    await session.fromPartition(researchPartition(validSiteId)).clearStorageData();
  });

  handle(CH.researchSiteData, async (_e, siteIds: unknown) => {
    const validSiteIds = parseResearchSiteIds(siteIds);
    const withData: string[] = [];
    for (const id of validSiteIds) {
      const cookies = await session.fromPartition(researchPartition(id)).cookies.get({});
      if (cookies.length > 0) withData.push(id);
    }
    return withData;
  });
}
