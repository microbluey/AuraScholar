import { contextBridge, ipcRenderer } from "electron";
import {
  CH,
  EV,
  type AppCloseRequest,
  type Bounds,
  type CaptureResult,
  type ConsumeResearchDownloadInput,
  type DownloadFinishedPayload,
  type DownloadStartedPayload,
  type RecoverEvidenceSourceInput,
  type RecoverEvidenceSourceResult,
  type ResearchTab,
} from "./shared";
import type { DataCommandInput, DataCommandName, DataCommandOutput } from "./data-command-contract";
import type {
  InstallLocalEmbeddingArtifactResult,
  RemoveLocalEmbeddingArtifactResult,
} from "./main/embedding-artifact-commands";
import type { LocalEmbeddingArtifactCatalogStatus } from "./main/local-embedding-artifact-catalog";
import type { LocalEmbeddingArtifactStatus } from "./main/local-embedding-artifact-installer";
import {
  AppCloseRequestCoordinator,
  type AppCloseRequestCallback,
} from "./preload/close-lifecycle";
import { hasPreloadSmokeBridge } from "./smoke-mode";

// Raw SQL exists only to seed and inspect the isolated end-to-end smoke app.
// Main grants this startup argument only for an unpackaged smoke process. Do
// not rely on AURASCHOLAR_SMOKE here: a packaged process may inherit it.
const SMOKE_MODE = hasPreloadSmokeBridge(process.argv);

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
  files: {
    readBlobPdf(sha256: string): Promise<Uint8Array> {
      return ipcRenderer.invoke(CH.fsReadBlobPdf, sha256);
    },
  },
  notify(title: string, body?: string): Promise<void> {
    return ipcRenderer.invoke(CH.notify, title, body);
  },
  clipboard: {
    writeText(text: string): Promise<void> {
      return ipcRenderer.invoke(CH.clipboardWriteText, text);
    },
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
  data: {
    command<K extends DataCommandName>(
      name: K,
      input: DataCommandInput<K>,
    ): Promise<DataCommandOutput<K>> {
      return ipcRenderer.invoke(CH.dataCommand, { name, input });
    },
  },
  embedding: {
    artifactCatalogStatus(): Promise<LocalEmbeddingArtifactCatalogStatus> {
      return ipcRenderer.invoke(CH.embeddingArtifactCatalogStatus);
    },
    artifactStatus(): Promise<LocalEmbeddingArtifactStatus> {
      return ipcRenderer.invoke(CH.embeddingArtifactStatus);
    },
    installArtifact(): Promise<InstallLocalEmbeddingArtifactResult> {
      return ipcRenderer.invoke(CH.embeddingArtifactInstall);
    },
    removeArtifact(): Promise<RemoveLocalEmbeddingArtifactResult> {
      return ipcRenderer.invoke(CH.embeddingArtifactRemove);
    },
  },
  evidence: {
    recoverSource(input: RecoverEvidenceSourceInput): Promise<RecoverEvidenceSourceResult> {
      return ipcRenderer.invoke(CH.evidenceRecoverSource, input);
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
    consumeDownload(input: ConsumeResearchDownloadInput): Promise<Uint8Array> {
      return ipcRenderer.invoke(CH.researchConsumeDownload, input);
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
};

// Do not include this property in `AuraApi`: production renderer code must
// not be able to type-check against a raw database capability. Smoke scripts
// are main-owned strings and run only when the main process registers matching
// IPC handlers.
if (SMOKE_MODE) {
  Object.assign(api, {
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
  });
}

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
