// Multi-tab research browser with persistent per-site sessions and archivable views.
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, session, WebContentsView, type Session } from "electron";
import { describeSafeError } from "@aurascholar/platform";
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
  discardResearchDownload,
  ensureSafeResearchDownloadDirectory,
  openResearchDownloads,
  registerResearchDownload,
} from "./research-download-store";
import { wireResearchDownloadSession } from "./research-download-events";
import { writeResearchPrintedFile } from "./research-download-print-file";

interface Tab {
  tabId: string;
  ownerTabId: string;
  siteId: string;
  url: string;
  title: string;
  proxy: string; // "" = direct; else proxyRules for this site's session
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

function detachActiveView(): void {
  const cur = activeTabId ? tabs.get(activeTabId) : null;
  if (cur?.view) detachView(cur.view);
}

function detachView(view: WebContentsView): void {
  if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
}

const viewLifecycle = new ResearchBrowserViewLifecycle({
  acceptUrl: (url) => acceptResearchMainFrameUrl(url, true),
  activeTabId: () => activeTabId,
  detachView,
  emitTabs,
  tabs,
});

async function applyProxy(sess: Session, proxy: string): Promise<void> {
  if (proxy) {
    await sess.setProxy({ proxyRules: proxy });
  } else {
    await sess.setProxy({ mode: "direct" });
  }
}

const DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/;

function normalizeScholarMeta(
  meta: Record<string, string[]>,
  pageUrl: string,
): ScholarIdentity | undefined {
  const first = (key: string): string | undefined => meta[key]?.[0]?.trim() || undefined;
  let doi: string | undefined;
  for (const candidate of [
    ...(meta["citation_doi"] ?? []),
    ...(meta["dc.identifier"] ?? []),
    ...(meta["prism.doi"] ?? []),
  ]) {
    const match = candidate.match(DOI_RE);
    if (match) {
      doi = match[0].replace(/[).,;]+$/, "").toLowerCase();
      break;
    }
  }
  let arxivId = first("citation_arxiv_id");
  if (!arxivId) {
    const fromUrl = pageUrl.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/i);
    if (fromUrl) arxivId = fromUrl[1]!.replace(/\.pdf$/i, "");
  }

  const title = first("citation_title");
  let pdfUrl: string | undefined;
  const rawPdf = first("citation_pdf_url");
  if (rawPdf) {
    try {
      pdfUrl = new URL(rawPdf, pageUrl).href;
    } catch {
      // ignore malformed URL
    }
  }
  if (!doi && !arxivId && !title && !pdfUrl) return undefined;
  return { doi, arxivId, title, pdfUrl, sourceUrl: pageUrl };
}

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
  const identity = normalizeScholarMeta(meta as Record<string, string[]>, settledUrl);
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
  void applyProxy(sess, tab.proxy);
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
  void view.webContents.loadURL(tab.url);
  return view;
}

/** Create and activate a tab for IPC opens and in-page target=_blank links. */
function spawnTab(siteId: string, url: string, proxy: string, ownerTabId?: string): string {
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
    lastActiveAt: Date.now(),
    view: null,
    // Opening a known full-text URL in a new tab (target=_blank "Paper" link)
    // inherits the abstract page's identity so its download attaches correctly.
    scholar: identityForUrl(safeUrl),
  });
  showTab(tabId);
  return tabId;
}

function showTab(tabId: string): void {
  const tab = tabs.get(tabId);
  if (!tab || !win || win.isDestroyed()) return;
  detachActiveView();
  if (!tab.view) tab.view = createView(tab); // un-archive
  win.contentView.addChildView(tab.view);
  tab.view.setBounds(bounds);
  tab.lastActiveAt = Date.now();
  activeTabId = tabId;
  emitTabs();
}

function disposeResearchBrowser(): void {
  viewLifecycle.disposeAll();
  // DownloadItem completion can outlive a closed view. Its admission remains
  // reserved until the download event's terminal cleanup releases it.
  tabs.clear();
  identityByPdfUrl.clear();
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
  detachActiveView();
}

export function registerResearchHandlers(): void {
  handle(CH.researchOpen, (_e, siteId: unknown, url: unknown, proxy: unknown, options: unknown) => {
    const input = parseResearchOpenInput(siteId, url, proxy, options);
    // Reuse an existing tab for the same site unless this is an isolated task.
    const existing =
      input.options?.reuseExisting === false
        ? undefined
        : [...tabs.values()].find((t) => t.siteId === input.siteId);
    if (existing) {
      existing.proxy = input.proxy;
      showTab(existing.tabId);
      return existing.tabId;
    }
    return spawnTab(input.siteId, input.url, input.proxy);
  });

  handle(CH.researchActivate, (_e, tabId: unknown) => {
    const validTabId = validateResearchTabId(tabId);
    showTab(validTabId);
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
  handle(CH.researchNavigate, (_e, url: unknown) => {
    const parsedUrl = parseResearchNavigateInput(url);
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return "";
    if (parsedUrl === null) {
      return tab.view ? tab.view.webContents.getURL() : tab.url;
    }
    const safeUrl = parsedUrl;
    tab.url = safeUrl;
    if (tab.view) void tab.view.webContents.loadURL(safeUrl);
    return safeUrl;
  });

  handle(CH.researchClose, (_e, tabId: unknown) => {
    const validTabId = validateResearchTabId(tabId);
    const tab = tabs.get(validTabId);
    if (!tab) return;
    viewLifecycle.disposeTab(tab);
    tabs.delete(validTabId);
    if (activeTabId === validTabId) {
      activeTabId = null;
      const next = [...tabs.keys()][0];
      if (next) showTab(next);
    }
    emitTabs();
  });

  handle(CH.researchHide, () => {
    detachActiveView();
  });

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
    if (wc.isDestroyed()) return { kind: "none", error: "研究浏览器当前页面地址不受支持" };
    if (!acceptResearchMainFrameUrl(wc.getURL(), true)) {
      return { kind: "none", error: "研究浏览器当前页面地址不受支持" };
    }

    await sniffScholar(tab);
    if (tab.view !== view || wc.isDestroyed()) {
      return { kind: "none", error: "研究浏览器当前页面地址不受支持" };
    }
    const url = acceptResearchMainFrameUrl(wc.getURL(), true);
    if (!url) return { kind: "none", error: "研究浏览器当前页面地址不受支持" };

    if (/\.pdf(\?|#|$)/i.test(url)) {
      wc.downloadURL(url);
      return { kind: "download" };
    }

    let fileName: string | undefined;
    let wroteFile = false;
    try {
      if (!acceptResearchMainFrameUrl(wc.getURL(), true))
        return { kind: "none", error: "研究浏览器当前页面地址不受支持" };
      ensureDownloadDir();
      const pdf = await wc.printToPDF({ printBackground: true });
      const base =
        (wc.getTitle() || "page").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "page";
      fileName = writeResearchPrintedFile(app.getPath("userData"), `${base}.pdf`, pdf);
      wroteFile = true;
      const { downloadId } = await registerResearchDownload(fileName, tab.ownerTabId);
      win?.webContents.send(EV.researchDownloadFinished, {
        tabId: tab.tabId,
        ownerTabId: tab.ownerTabId,
        fileName,
        downloadId,
        success: true,
        scholar: tab.scholar,
      });
      return { kind: "print", downloadId, fileName };
    } catch (e) {
      if (fileName && wroteFile) void discardResearchDownload(fileName).catch(() => {});
      return { kind: "none", error: describeSafeError(e) };
    }
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
