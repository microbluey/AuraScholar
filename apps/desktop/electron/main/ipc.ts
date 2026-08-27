// Gatekeeper for every ipcMain.handle registration. Only the app's own
// renderer (the main BrowserWindow, which is the only webContents that gets
// the preload bridge) may invoke privileged channels. Research-browser
// WebContentsViews load arbitrary publisher pages — they have no preload and
// thus no ipcRenderer, but defense in depth costs one comparison. Checking the
// frame as well as the WebContents matters because a compromised or
// future-enabled subframe must not inherit the top-level renderer's bridge.
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";

let trustedSender: WebContents | null = null;

/** Called by createWindow whenever the (single) app window is (re)created. */
export function setTrustedSender(wc: WebContents): void {
  trustedSender = wc;
  wc.once("destroyed", () => {
    if (trustedSender === wc) trustedSender = null;
  });
}

type Handler = (event: IpcMainInvokeEvent, ...args: never[]) => unknown;

/** Drop-in for ipcMain.handle that rejects calls from any other webContents. */
export function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, (event, ...args) => {
    const sender = trustedSender;
    if (
      sender === null ||
      sender.isDestroyed() ||
      event.sender !== sender ||
      event.senderFrame === null ||
      event.senderFrame !== sender.mainFrame
    ) {
      throw new Error(`IPC ${channel}: rejected untrusted sender`);
    }
    return (handler as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown)(event, ...args);
  });
}
