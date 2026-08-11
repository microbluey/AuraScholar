import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { setTrustedSender } from "./main/ipc";
import { attachCloseLifecycle, registerCloseLifecycleHandlers } from "./main/close-lifecycle";
import { openExternalUrl, registerPlatformHandlers } from "./main/platform";
import { registerSmokeDbHandlers } from "./main/db";
import { registerDataCommandHandlers } from "./main/data-commands";
import { registerEvidenceSourceRecoveryHandlers } from "./main/evidence-source-recovery";
import { registerEmbeddingArtifactHandlers } from "./main/embedding-artifact-commands";
import { clearLibraryPdfStaging, recoverLibraryPdfStaging } from "./main/library-pdf-staging";
import { knowledgeOutboxDispatcher } from "./main/knowledge-outbox-dispatcher";
import { initResearchBrowser, registerResearchHandlers } from "./main/research-browser";
import { startCitationBridge } from "./main/citation-bridge";
import { isMainSmokeMode, SMOKE_PRELOAD_ARGUMENT } from "./smoke-mode";

// electron-vite injects these env vars during dev; they're undefined in prod.
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const USER_DATA_DIR = process.env.AURASCHOLAR_USER_DATA_DIR;
const SMOKE_REQUESTED = process.env.AURASCHOLAR_SMOKE === "1";
const SMOKE_MODE = isMainSmokeMode(process.env.AURASCHOLAR_SMOKE, app.isPackaged);
const RENDERER_ENTRY = join(__dirname, "../renderer/index.html");

if (SMOKE_REQUESTED && app.isPackaged) {
  console.warn("AuraScholar ignores AURASCHOLAR_SMOKE in packaged builds.");
}

if (USER_DATA_DIR) {
  app.setPath("userData", USER_DATA_DIR);
}

if (SMOKE_MODE) {
  app.commandLine.appendSwitch("disable-gpu");
}

const hasSingleInstanceLock = SMOKE_MODE || app.requestSingleInstanceLock();

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    show: !SMOKE_MODE,
    title: "AuraScholar",
    webPreferences: {
      backgroundThrottling: !SMOKE_MODE,
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload (.mjs) requires the sandbox off; we still keep context
      // isolation on and expose only the whitelisted bridge.
      sandbox: false,
      // A packaged build never receives this argument, even if its launch
      // environment has AURASCHOLAR_SMOKE=1. The preload must not trust that
      // environment value directly because it controls the raw smoke bridge.
      additionalArguments: SMOKE_MODE ? [SMOKE_PRELOAD_ARGUMENT] : [],
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url).catch(() => {});
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isAllowedAppNavigation(url)) return;
    event.preventDefault();
    void openExternalUrl(url).catch(() => {});
  });

  setTrustedSender(win.webContents);
  win.once("closed", () => {
    void clearLibraryPdfStaging().catch(() => {});
  });
  attachCloseLifecycle(win);

  if (SMOKE_MODE) {
    // Lazy chunk: the smoke harness never loads in a normal launch.
    const { setupSmokeHarness } = await import("./main/smoke");
    setupSmokeHarness(win);
  }

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(RENDERER_ENTRY);
  }

  initResearchBrowser(win);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", focusPrimaryWindow);

  app.whenReady().then(async () => {
    registerPlatformHandlers();
    // Resolve stale SHA-only staging journal entries before any typed command
    // or window can create a fresh receipt. Recovery never revives receipts.
    await recoverLibraryPdfStaging();
    if (SMOKE_MODE) {
      registerSmokeDbHandlers();
    }
    registerDataCommandHandlers();
    registerEvidenceSourceRecoveryHandlers();
    registerEmbeddingArtifactHandlers();
    knowledgeOutboxDispatcher.start();
    registerResearchHandlers();
    registerCloseLifecycleHandlers();
    startCitationBridge();

    void createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  knowledgeOutboxDispatcher.stop();
});

function focusPrimaryWindow(): void {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) {
    if (app.isReady()) void createWindow();
    return;
  }

  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function isAllowedAppNavigation(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (DEV_URL) {
    try {
      return url.origin === new URL(DEV_URL).origin;
    } catch {
      return false;
    }
  }

  if (url.protocol !== "file:") return false;
  try {
    return fileURLToPath(url) === RENDERER_ENTRY;
  } catch {
    return false;
  }
}
