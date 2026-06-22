// Multi-tab research browser, main-process side. Each tab is a WebContentsView
// with a per-site persistent session partition (cookies/login isolated and
// kept across restarts). Bounds are driven from here (the renderer only reports
// the content-area rectangle), which is what makes the embedded view sit
// exactly in place. Arc-style archiving reclaims memory from tabs left idle
// past ARCHIVE_MS by destroying the view while keeping the tab entry; clicking
// an archived tab recreates it at its stored URL.
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { app, BrowserWindow, ipcMain, session, WebContentsView, type Session } from "electron";
import {
  CH,
  EV,
  type Bounds,
  type CaptureResult,
  type ResearchTab,
  type ScholarIdentity,
} from "../shared";

const ARCHIVE_MS = 30 * 60 * 1000; // 30 minutes idle → archive
const DOWNLOAD_SUBDIR = "research-downloads";

interface Tab {
  tabId: string;
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
// Maps a sniffed `citation_pdf_url` back to the page identity it came from.
// Clicking "Paper" navigates away from the abstract page (or opens the PDF in a
// new tab), so by download time the tab no longer holds the identity. The PDF
// URL is the stable link between the two — see resolveDownloadIdentity.
const identityByPdfUrl = new Map<string, ScholarIdentity>();

function partitionFor(siteId: string): string {
  return `persist:research-${siteId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

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
  mkdirSync(join(app.getPath("userData"), DOWNLOAD_SUBDIR), { recursive: true });
}

/** Wire download interception once per site session. */
function wireSession(sess: Session, siteId: string): void {
  const key = partitionFor(siteId);
  if (wiredSessions.has(key)) return;
  wiredSessions.add(key);
  sess.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  sess.on("will-download", (_e, item, sourceWebContents) => {
    ensureDownloadDir();
    const sourceTab = [...tabs.values()].find((t) => t.view?.webContents === sourceWebContents);
    const sourceTabId = sourceTab?.tabId ?? activeTabId ?? "";
    const scholar = resolveDownloadIdentity(sourceTab, item.getURL());
    const stamp = Date.now();
    const safe = item.getFilename().replace(/[^a-zA-Z0-9._-]/g, "-");
    // Tell the renderer a download is in flight so it can show progress while
    // the file streams + metadata is resolved (can be several seconds).
    win?.webContents.send(EV.researchDownloadStarted, { fileName: safe });
    const fileName = `${stamp}-${safe}`;
    const relPath = `${DOWNLOAD_SUBDIR}/${fileName}`;
    const abs = join(app.getPath("userData"), DOWNLOAD_SUBDIR, fileName);
    item.setSavePath(abs);
    item.once("done", (_ev, state) => {
      win?.webContents.send(EV.researchDownloadFinished, {
        tabId: sourceTabId,
        fileName,
        relPath,
        success: state === "completed",
        scholar,
      });
    });
  });
}

function detachActiveView(): void {
  const cur = activeTabId ? tabs.get(activeTabId) : null;
  if (cur?.view && win) win.contentView.removeChildView(cur.view);
}

async function applyProxy(sess: Session, proxy: string): Promise<void> {
  // Per-session proxy: only this site's traffic is routed through `proxy`,
  // leaving the system network (e.g. a campus VPN) untouched for other sites.
  if (proxy) {
    await sess.setProxy({ proxyRules: proxy });
  } else {
    await sess.setProxy({ mode: "direct" });
  }
}

const DOI_RE = /10\.\d{4,9}\/[^\s"'<>]+/;

/** Normalize sniffed meta tags into a scholarly identity (pure, no network). */
function normalizeScholarMeta(
  meta: Record<string, string[]>,
  pageUrl: string,
): ScholarIdentity | undefined {
  const first = (key: string): string | undefined => meta[key]?.[0]?.trim() || undefined;

  // DOI: citation_doi is authoritative; dc.identifier / prism.doi may carry it
  // with a "doi:" / "info:doi/" / URL prefix, so extract the bare DOI.
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

/**
 * Read scholarly `<meta>` tags from the tab's page. Runs a read-only DOM
 * collector in the view's isolated world and returns plain strings — it never
 * evals page-provided values. Failures (about:blank, cross-origin, CSP) resolve
 * to no-op so a download still falls back to PDF-body extraction.
 */
async function sniffScholar(tab: Tab): Promise<void> {
  const wc = tab.view?.webContents;
  if (!wc) return;
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
  if (!meta || typeof meta !== "object") return;
  const identity = normalizeScholarMeta(meta as Record<string, string[]>, wc.getURL());
  tab.scholar = identity;
  // Remember the identity keyed by its full-text URL so a download triggered
  // after navigating to that URL (same tab or a new one) can recover it.
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

/**
 * Best identity for a download: the originating tab's current identity, else a
 * match by the download URL against a previously sniffed citation_pdf_url.
 * Covers "click Paper → navigate to PDF → download" where the tab no longer
 * carries the abstract page's meta.
 */
function resolveDownloadIdentity(tab: Tab | undefined, downloadUrl: string): ScholarIdentity | undefined {
  if (tab?.scholar) return tab.scholar;
  return identityForUrl(downloadUrl);
}

function createView(tab: Tab): WebContentsView {
  const sess = session.fromPartition(partitionFor(tab.siteId));
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
    // target=_blank / window.open — publishers open PDFs and full-text in a new
    // window. Open them in a fresh tab (same site session, so login/cookies
    // carry over) instead of hijacking the current page, which would strip the
    // user of their search-results context with no way back.
    if (/^https?:\/\//i.test(url)) spawnTab(tab.siteId, url, tab.proxy);
    return { action: "deny" };
  });
  view.webContents.on("page-title-updated", (_e, title) => {
    tab.title = title;
    emitTabs();
  });
  view.webContents.on("did-finish-load", () => {
    tab.url = view.webContents.getURL() || tab.url;
    win?.webContents.send(EV.researchLoaded, { tabId: tab.tabId, url: tab.url });
    emitTabs();
    void sniffScholar(tab);
  });
  // Navigation within the page updates url + back/forward availability.
  view.webContents.on("did-navigate", () => {
    tab.url = view.webContents.getURL() || tab.url;
    // Clicking "Paper" navigates to the full-text URL we sniffed earlier — carry
    // that page's identity over so the download attaches to the right work.
    // Otherwise this is a new document: drop the stale identity.
    tab.scholar = identityForUrl(tab.url);
    emitTabs();
  });
  // SPA route changes can swap the head meta without a full load.
  view.webContents.on("did-navigate-in-page", () => {
    emitTabs();
    void sniffScholar(tab);
  });
  void view.webContents.loadURL(tab.url);
  return view;
}

/**
 * Create a new tab for a site and make it active. Shared by the researchOpen
 * IPC handler and by in-page window.open / target=_blank navigations so that
 * external links open beside the current page instead of replacing it.
 */
function spawnTab(siteId: string, url: string, proxy: string): string {
  const tabId = randomUUID();
  tabs.set(tabId, {
    tabId,
    siteId,
    url,
    title: "",
    proxy,
    lastActiveAt: Date.now(),
    view: null,
    // Opening a known full-text URL in a new tab (target=_blank "Paper" link)
    // inherits the abstract page's identity so its download attaches correctly.
    scholar: identityForUrl(url),
  });
  showTab(tabId);
  return tabId;
}

function showTab(tabId: string): void {
  const tab = tabs.get(tabId);
  if (!tab || !win) return;
  detachActiveView();
  if (!tab.view) tab.view = createView(tab); // un-archive
  win.contentView.addChildView(tab.view);
  tab.view.setBounds(bounds);
  tab.lastActiveAt = Date.now();
  activeTabId = tabId;
  emitTabs();
}

/** Periodic sweep: archive tabs idle past the threshold (never the active one). */
function sweep(): void {
  const now = Date.now();
  for (const tab of tabs.values()) {
    if (tab.tabId === activeTabId || !tab.view) continue;
    if (now - tab.lastActiveAt > ARCHIVE_MS) {
      if (win) win.contentView.removeChildView(tab.view);
      tab.url = tab.view.webContents.getURL() || tab.url;
      // WebContentsView has no destroy(); dropping the reference + removing it
      // from the tree lets it be GC'd and its renderer process torn down.
      tab.view = null;
    }
  }
  emitTabs();
}

export function initResearchBrowser(window: BrowserWindow): void {
  win = window;
  ensureDownloadDir();
  setInterval(sweep, 60_000);
}

export function hideResearchViews(): void {
  detachActiveView();
}

export function registerResearchHandlers(): void {
  ipcMain.handle(CH.researchOpen, (_e, siteId: string, url: string, proxy: string) => {
    // Reuse an existing tab for the same site if present.
    const existing = [...tabs.values()].find((t) => t.siteId === siteId);
    if (existing) {
      existing.proxy = proxy;
      showTab(existing.tabId);
      return existing.tabId;
    }
    return spawnTab(siteId, url, proxy);
  });

  ipcMain.handle(CH.researchActivate, (_e, tabId: string) => {
    showTab(tabId);
  });

  ipcMain.handle(CH.researchGoBack, () => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (tab?.view?.webContents.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    }
  });

  ipcMain.handle(CH.researchGoForward, () => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (tab?.view?.webContents.navigationHistory.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    }
  });

  ipcMain.handle(CH.researchReload, () => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    tab?.view?.webContents.reload();
  });

  // null arg = read the active tab's current URL; a string = navigate to it.
  ipcMain.handle(CH.researchNavigate, (_e, url: string | null) => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return "";
    if (url === null) {
      return tab.view ? tab.view.webContents.getURL() : tab.url;
    }
    tab.url = url;
    if (tab.view) void tab.view.webContents.loadURL(url);
    return url;
  });

  ipcMain.handle(CH.researchClose, (_e, tabId: string) => {
    const tab = tabs.get(tabId);
    if (!tab) return;
    if (tab.view && win) win.contentView.removeChildView(tab.view);
    tabs.delete(tabId);
    if (activeTabId === tabId) {
      activeTabId = null;
      const next = [...tabs.keys()][0];
      if (next) showTab(next);
    }
    emitTabs();
  });

  ipcMain.handle(CH.researchHide, () => {
    detachActiveView();
  });

  ipcMain.handle(CH.researchSetBounds, (_e, b: Bounds) => {
    bounds = b;
    const cur = activeTabId ? tabs.get(activeTabId) : null;
    cur?.view?.setBounds(b);
  });

  ipcMain.handle(CH.researchList, () => snapshot());

  // Capture the active tab for ingest. Many publishers render full-text inline
  // (Content-Disposition: inline, an embedded viewer, or a blob: URL) so the
  // will-download interceptor never fires. This gives the user an explicit
  // "capture" action with two strategies:
  //   • a direct .pdf URL → downloadURL() reuses the authed session + the
  //     existing will-download → ingest pipeline (emits download-finished);
  //   • anything else → printToPDF() renders the page as it stands (behind any
  //     paywall the user already cleared) and we hand the bytes straight to the
  //     renderer to ingest.
  ipcMain.handle(CH.researchCapture, async (): Promise<CaptureResult> => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab?.view) return { kind: "none", error: "no active page" };
    const wc = tab.view.webContents;
    const url = wc.getURL();

    // Refresh the page identity so both capture paths carry the latest meta.
    await sniffScholar(tab);

    if (/\.pdf(\?|#|$)/i.test(url)) {
      wc.downloadURL(url);
      return { kind: "download" };
    }

    try {
      ensureDownloadDir();
      const pdf = await wc.printToPDF({ printBackground: true });
      const stamp = Date.now();
      const base = (wc.getTitle() || "page").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
      const fileName = `${stamp}-${base}.pdf`;
      const relPath = `${DOWNLOAD_SUBDIR}/${fileName}`;
      writeFileSync(join(app.getPath("userData"), DOWNLOAD_SUBDIR, fileName), pdf);
      win?.webContents.send(EV.researchDownloadFinished, {
        tabId: tab.tabId,
        fileName,
        relPath,
        success: true,
        scholar: tab.scholar,
      });
      return { kind: "print", relPath, fileName };
    } catch (e) {
      return { kind: "none", error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(CH.researchClearSiteData, async (_e, siteId: string) => {
    await session.fromPartition(partitionFor(siteId)).clearStorageData();
  });

  ipcMain.handle(CH.researchSiteData, async (_e, siteIds: string[]) => {
    const withData: string[] = [];
    for (const id of siteIds) {
      const cookies = await session.fromPartition(partitionFor(id)).cookies.get({});
      if (cookies.length > 0) withData.push(id);
    }
    return withData;
  });
}
