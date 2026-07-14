import { contextBridge, ipcRenderer } from "electron";
import { describeSafeError } from "@aurascholar/platform";
import {
  CH,
  EV,
  type Bounds,
  type CaptureResult,
  type DownloadFinishedPayload,
  type HttpRequestDTO,
  type HttpResultDTO,
  type ResearchTab,
} from "./shared";

// The single, whitelisted surface the renderer may touch. No nodeIntegration;
// everything funnels through these typed calls.
const api = {
  http(req: HttpRequestDTO): Promise<HttpResultDTO> {
    return ipcRenderer.invoke(CH.http, req);
  },
  cancelHttp(requestId: string): Promise<void> {
    return ipcRenderer.invoke(CH.httpCancel, requestId);
  },
  fs: {
    readFile(path: string): Promise<Uint8Array> {
      return ipcRenderer.invoke(CH.fsRead, path);
    },
    writeFile(path: string, data: Uint8Array): Promise<void> {
      return ipcRenderer.invoke(CH.fsWrite, path, data);
    },
    deleteFile(path: string): Promise<void> {
      return ipcRenderer.invoke(CH.fsDelete, path);
    },
    exists(path: string): Promise<boolean> {
      return ipcRenderer.invoke(CH.fsExists, path);
    },
    listDir(path: string): Promise<string[]> {
      return ipcRenderer.invoke(CH.fsListDir, path);
    },
    mkdirp(path: string): Promise<void> {
      return ipcRenderer.invoke(CH.fsMkdirp, path);
    },
  },
  notify(title: string, body?: string): Promise<void> {
    return ipcRenderer.invoke(CH.notify, title, body);
  },
  clipboard: {
    readText(): Promise<string> {
      return ipcRenderer.invoke(CH.clipboardReadText);
    },
    writeText(text: string): Promise<void> {
      return ipcRenderer.invoke(CH.clipboardWriteText, text);
    },
  },
  async openExternal(url: string): Promise<void> {
    const error = await ipcRenderer.invoke(CH.openExternal, url);
    if (error) throw new Error(describeSafeError(error));
  },
  secrets: {
    get(key: string): Promise<string | null> {
      return ipcRenderer.invoke(CH.secretGet, key);
    },
    set(key: string, value: string): Promise<void> {
      return ipcRenderer.invoke(CH.secretSet, key, value);
    },
    delete(key: string): Promise<void> {
      return ipcRenderer.invoke(CH.secretDelete, key);
    },
  },
  deviceId(): Promise<string> {
    return ipcRenderer.invoke(CH.deviceId);
  },
  db: {
    query<T>(sql: string, params: unknown[]): Promise<T[]> {
      return ipcRenderer.invoke(CH.dbQuery, sql, params);
    },
    run(sql: string, params: unknown[]): Promise<number> {
      return ipcRenderer.invoke(CH.dbRun, sql, params);
    },
    exec(sql: string): Promise<void> {
      return ipcRenderer.invoke(CH.dbExec, sql);
    },
    queryScalar(sql: string): Promise<unknown> {
      return ipcRenderer.invoke(CH.dbScalar, sql);
    },
  },
  research: {
    open(siteId: string, url: string, proxy?: string): Promise<string> {
      return ipcRenderer.invoke(CH.researchOpen, siteId, url, proxy ?? "");
    },
    activate(tabId: string): Promise<void> {
      return ipcRenderer.invoke(CH.researchActivate, tabId);
    },
    /** Returns the active tab's current URL, or "" if none. */
    activeUrl(): Promise<string> {
      return ipcRenderer.invoke(CH.researchNavigate, null);
    },
    /** Load a URL into the active tab. */
    navigate(url: string): Promise<void> {
      return ipcRenderer.invoke(CH.researchNavigate, url);
    },
    goBack(): Promise<void> {
      return ipcRenderer.invoke(CH.researchGoBack);
    },
    goForward(): Promise<void> {
      return ipcRenderer.invoke(CH.researchGoForward);
    },
    reload(): Promise<void> {
      return ipcRenderer.invoke(CH.researchReload);
    },
    close(tabId: string): Promise<void> {
      return ipcRenderer.invoke(CH.researchClose, tabId);
    },
    hide(): Promise<void> {
      return ipcRenderer.invoke(CH.researchHide);
    },
    setBounds(b: Bounds): Promise<void> {
      return ipcRenderer.invoke(CH.researchSetBounds, b);
    },
    list(): Promise<ResearchTab[]> {
      return ipcRenderer.invoke(CH.researchList);
    },
    /** Capture the active tab as a PDF for ingest (direct download or print-to-PDF). */
    capture(): Promise<CaptureResult> {
      return ipcRenderer.invoke(CH.researchCapture);
    },
    clearSiteData(siteId: string): Promise<void> {
      return ipcRenderer.invoke(CH.researchClearSiteData, siteId);
    },
    siteData(siteIds: string[]): Promise<string[]> {
      return ipcRenderer.invoke(CH.researchSiteData, siteIds);
    },
    onDownloadStarted(cb: (p: { fileName: string }) => void): () => void {
      const listener = (_: unknown, p: { fileName: string }) => cb(p);
      ipcRenderer.on(EV.researchDownloadStarted, listener);
      return () => ipcRenderer.off(EV.researchDownloadStarted, listener);
    },
    onDownloadFinished(cb: (p: DownloadFinishedPayload) => void): () => void {
      const listener = (_: unknown, p: DownloadFinishedPayload) => cb(p);
      ipcRenderer.on(EV.researchDownloadFinished, listener);
      return () => ipcRenderer.off(EV.researchDownloadFinished, listener);
    },
    onLoaded(cb: (p: { tabId: string; url: string }) => void): () => void {
      const listener = (_: unknown, p: { tabId: string; url: string }) => cb(p);
      ipcRenderer.on(EV.researchLoaded, listener);
      return () => ipcRenderer.off(EV.researchLoaded, listener);
    },
    onTabsChanged(cb: (tabs: ResearchTab[]) => void): () => void {
      const listener = (_: unknown, tabs: ResearchTab[]) => cb(tabs);
      ipcRenderer.on(EV.researchTabsChanged, listener);
      return () => ipcRenderer.off(EV.researchTabsChanged, listener);
    },
  },
  citationBridgePort(): Promise<number | null> {
    return ipcRenderer.invoke(CH.citationBridgePort);
  },
};

contextBridge.exposeInMainWorld("aura", api);

export type AuraApi = typeof api;
