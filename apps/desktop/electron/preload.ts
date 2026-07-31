import { contextBridge, ipcRenderer } from "electron";
import { describeSafeError } from "@aurascholar/platform";
import {
  CH,
  EV,
  type AppCloseRequest,
  type Bounds,
  type CaptureResult,
  type DownloadFinishedPayload,
  type DownloadStartedPayload,
  type HttpRequestDTO,
  type HttpResultDTO,
  type ResearchTab,
} from "./shared";
import type { DataCommandInput, DataCommandName, DataCommandOutput } from "./data-command-contract";
import {
  AppCloseRequestCoordinator,
  type AppCloseRequestCallback,
} from "./preload/close-lifecycle";

const appCloseRequestCoordinator = new AppCloseRequestCoordinator((response) =>
  ipcRenderer.invoke(CH.appCloseRespond, response),
);
const appCloseCancelledCallbacks = new Set<(request: AppCloseRequest) => void>();

ipcRenderer.on(EV.lifecycleCloseRequested, (_event, value: unknown) => {
  const request = parseAppCloseRequest(value);
  if (!request) return;
  appCloseRequestCoordinator.receive(request);
});

ipcRenderer.on(EV.lifecycleCloseCancelled, (_event, value: unknown) => {
  const request = parseAppCloseRequest(value);
  if (!request) return;
  appCloseRequestCoordinator.cancel(request.requestId);
  for (const callback of appCloseCancelledCallbacks) {
    try {
      callback(request);
    } catch {
      // A lifecycle observer must not keep later observers from unlocking.
    }
  }
});

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
  lifecycle: {
    holdClose(requestId: string): Promise<boolean> {
      return ipcRenderer.invoke(CH.appCloseHold, requestId);
    },
    onCloseRequested(callback: AppCloseRequestCallback): () => void {
      return appCloseRequestCoordinator.subscribe(callback);
    },
    onCloseCancelled(callback: (request: AppCloseRequest) => void): () => void {
      appCloseCancelledCallbacks.add(callback);
      return () => {
        appCloseCancelledCallbacks.delete(callback);
      };
    },
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
  data: {
    command<K extends DataCommandName>(
      name: K,
      input: DataCommandInput<K>,
    ): Promise<DataCommandOutput<K>> {
      return ipcRenderer.invoke(CH.dataCommand, { name, input });
    },
  },
  research: {
    open(
      siteId: string,
      url: string,
      proxy?: string,
      options?: { reuseExisting?: boolean },
    ): Promise<string> {
      return ipcRenderer.invoke(CH.researchOpen, siteId, url, proxy ?? "", options);
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
    onDownloadStarted(cb: (p: DownloadStartedPayload) => void): () => void {
      const listener = (_: unknown, p: DownloadStartedPayload) => cb(p);
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

function parseAppCloseRequest(value: unknown): AppCloseRequest | null {
  if (!isRecord(value)) return null;
  const requestId = value.requestId;
  const intent = value.intent;
  if (typeof requestId !== "string" || requestId.trim() === "") return null;
  if (intent !== "window" && intent !== "quit") return null;
  return { intent, requestId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
