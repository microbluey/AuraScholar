import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { CH } from "./shared";
import { handle, setTrustedSender } from "./main/ipc";
import { openExternalUrl, registerPlatformHandlers } from "./main/platform";
import { registerDbHandlers } from "./main/db";
import {
  initResearchBrowser,
  registerResearchHandlers,
} from "./main/research-browser";
import { startCitationBridge, citationBridgePort } from "./main/citation-bridge";

// electron-vite injects these env vars during dev; they're undefined in prod.
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const USER_DATA_DIR = process.env.AURASCHOLAR_USER_DATA_DIR;
const SMOKE_MODE = process.env.AURASCHOLAR_SMOKE === "1";

if (USER_DATA_DIR) {
  app.setPath("userData", USER_DATA_DIR);
}

if (SMOKE_MODE) {
  app.commandLine.appendSwitch("disable-gpu");
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    show: !SMOKE_MODE,
    title: "AuraScholar",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload (.mjs) requires the sandbox off; we still keep context
      // isolation on and expose only the whitelisted bridge.
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url).catch(() => {});
    return { action: "deny" };
  });

  setTrustedSender(win.webContents);

  if (SMOKE_MODE) {
    // Lazy chunk: the ~6k-line harness never loads in a normal launch.
    const { setupSmokeHarness } = await import("./main/smoke");
    setupSmokeHarness(win);
  }

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  initResearchBrowser(win);
}

app.whenReady().then(() => {
  registerPlatformHandlers();
  registerDbHandlers();
  registerResearchHandlers();
  handle(CH.citationBridgePort, () => citationBridgePort());
  startCitationBridge();

  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
