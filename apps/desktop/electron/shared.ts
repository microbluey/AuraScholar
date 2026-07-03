// Shared IPC contract between the Electron main process, the preload bridge,
// and the renderer. Channel names live here so both sides can't drift.

export const CH = {
  http: "platform:http",
  httpCancel: "platform:http:cancel",
  fsRead: "platform:fs:read",
  fsWrite: "platform:fs:write",
  fsDelete: "platform:fs:delete",
  fsExists: "platform:fs:exists",
  fsListDir: "platform:fs:listDir",
  fsMkdirp: "platform:fs:mkdirp",
  notify: "platform:notify",
  clipboardReadText: "platform:clipboard:readText",
  clipboardWriteText: "platform:clipboard:writeText",
  openExternal: "platform:openExternal",
  secretGet: "platform:secret:get",
  secretSet: "platform:secret:set",
  secretDelete: "platform:secret:delete",
  deviceId: "platform:deviceId",

  dbQuery: "db:query",
  dbRun: "db:run",
  dbExec: "db:exec",
  dbScalar: "db:scalar",

  researchOpen: "research:open",
  researchSetProxy: "research:setProxy",
  researchActivate: "research:activate",
  researchNavigate: "research:navigate",
  researchGoBack: "research:goBack",
  researchGoForward: "research:goForward",
  researchReload: "research:reload",
  researchClose: "research:close",
  researchHide: "research:hide",
  researchSetBounds: "research:setBounds",
  researchList: "research:list",
  researchCapture: "research:capture",
  researchClearSiteData: "research:clearSiteData",
  researchSiteData: "research:siteData",

  citationBridgePort: "citation-bridge:port",
} as const;

// Events emitted main → renderer (via webContents.send).
export const EV = {
  researchDownloadStarted: "research://download-started",
  researchDownloadFinished: "research://download-finished",
  researchLoaded: "research://loaded",
  researchTabsChanged: "research://tabs-changed",
} as const;

export interface HttpRequestDTO {
  requestId?: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  timeoutMs?: number;
}

export interface HttpResponseDTO {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface ResearchTab {
  tabId: string;
  siteId: string;
  url: string;
  title: string;
  archived: boolean;
  active: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Scholarly identity sniffed from a page's `citation_*` / Dublin Core / PRISM
 * meta tags. Carried alongside a download so the renderer can resolve
 * authoritative metadata from the identifier instead of guessing a DOI from the
 * PDF body (which picks up cited-reference DOIs and mis-files the paper).
 */
export interface ScholarIdentity {
  doi?: string;
  arxivId?: string;
  title?: string;
  /** citation_pdf_url, absolutized against the page URL. */
  pdfUrl?: string;
  /** Page URL the identity was sniffed from. */
  sourceUrl?: string;
}

export interface DownloadFinishedPayload {
  tabId: string;
  fileName: string;
  relPath: string;
  success: boolean;
  /** Page identity sniffed from the originating tab, when available. */
  scholar?: ScholarIdentity;
}

export interface CaptureResult {
  /** "download" = a real file stream was intercepted (emits download-finished);
   *  "print" = the page was rendered to PDF and ingested directly. */
  kind: "download" | "print" | "none";
  /** Set for kind "print": the saved file, relative to userData. */
  relPath?: string;
  fileName?: string;
  error?: string;
}
