import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { CH } from "./shared";
import { registerPlatformHandlers } from "./main/platform";
import { registerDbHandlers } from "./main/db";
import {
  initResearchBrowser,
  registerResearchHandlers,
} from "./main/research-browser";
import { startCitationBridge, citationBridgePort } from "./main/citation-bridge";

// electron-vite injects these env vars during dev; they're undefined in prod.
const DEV_URL = process.env.ELECTRON_RENDERER_URL;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
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
  ipcMain.handle(CH.citationBridgePort, () => citationBridgePort());
  startCitationBridge();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
