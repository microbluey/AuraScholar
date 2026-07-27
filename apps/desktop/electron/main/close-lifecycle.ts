import { randomUUID } from "node:crypto";
import { app, dialog, type BrowserWindow } from "electron";
import {
  CH,
  EV,
  type AppCloseDecision,
  type AppCloseRequest,
  type AppCloseResponse,
} from "../shared";
import { handle } from "./ipc";
import { AppCloseLifecycleState } from "./close-lifecycle-state";

const CLOSE_RESPONSE_TIMEOUT_MS = 10_000;
const state = new AppCloseLifecycleState();

let activeWindow: BrowserWindow | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let timeoutDialogRequestId: string | null = null;
let registered = false;

export function registerCloseLifecycleHandlers(): void {
  if (registered) return;
  registered = true;

  handle(CH.appCloseHold, (_event, value: unknown) => {
    if (typeof value !== "string" || value.trim() === "") return false;
    if (timeoutDialogRequestId === value || !state.holdPending(value)) return false;
    clearCloseTimer();
    return true;
  });

  handle(CH.appCloseRespond, (_event, value: unknown) => {
    const response = parseCloseResponse(value);
    const resolution = state.resolve(response.requestId, response.decision);
    if (resolution.kind === "ignored") return false;

    clearCloseTimer();
    if (resolution.kind === "cancel") {
      notifyCloseCancelled(resolution.request);
      return true;
    }

    // Let ipcRenderer.invoke receive its reply before replaying a close that
    // may tear down the sender.
    setImmediate(() => replayClose(resolution.request.requestId));
    return true;
  });

  app.on("before-quit", (event) => {
    if (state.consumeQuitPermit()) return;
    const win = usableActiveWindow();
    if (!win) return;
    event.preventDefault();
    requestClose(win, "quit");
  });
}

export function attachCloseLifecycle(window: BrowserWindow): void {
  activeWindow = window;

  window.on("close", (event) => {
    if (state.consumeWindowClosePermit()) return;
    event.preventDefault();
    requestClose(window, "window");
  });

  window.webContents.on("will-prevent-unload", (event) => {
    if (state.shouldForcePreventedUnload()) {
      // Electron's will-prevent-unload event is inverted: preventing this
      // event explicitly ignores the page's beforeunload veto.
      event.preventDefault();
      return;
    }

    const request = state.preventedUnload();
    if (request) notifyCloseCancelled(request);
  });

  window.once("closed", () => {
    if (activeWindow === window) activeWindow = null;
    clearCloseTimer();
    state.reset();
  });
}

function requestClose(window: BrowserWindow, intent: "window" | "quit"): void {
  const change = state.begin(intent, randomUUID);
  if (!change.changed) return;

  if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(EV.lifecycleCloseRequested, change.request);
  }
  if (!state.isPendingHeld(change.request.requestId)) {
    armCloseTimer(change.request);
  }
}

function replayClose(requestId: string): void {
  const request = state.replayRequestFor(requestId);
  if (!request) return;
  const win = usableActiveWindow();
  if (!win) {
    state.finishReplay(requestId);
    return;
  }

  if (request.intent === "quit") {
    app.quit();
  } else {
    win.close();
  }
}

function armCloseTimer(request: AppCloseRequest): void {
  clearCloseTimer();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    void showCloseTimeoutDialog(request.requestId);
  }, CLOSE_RESPONSE_TIMEOUT_MS);
}

function clearCloseTimer(): void {
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

async function showCloseTimeoutDialog(requestId: string): Promise<void> {
  if (timeoutDialogRequestId !== null) return;
  const request = state.currentRequest();
  const win = usableActiveWindow();
  if (!request || request.requestId !== requestId || !win) return;

  timeoutDialogRequestId = requestId;
  try {
    const result = await dialog.showMessageBox(win, {
      type: "warning",
      title: request.intent === "quit" ? "AuraScholar 尚未准备好退出" : "白板仍在保存",
      message:
        request.intent === "quit"
          ? "AuraScholar 仍在等待当前内容保存完成。"
          : "当前窗口仍在等待白板内容保存完成。",
      detail: "留在应用不会丢失当前编辑。只有明确选择“强制关闭”才会跳过页面的退出保护。",
      buttons: ["留在应用", "继续等待", "强制关闭"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    const latest = state.currentRequest();
    if (!latest || latest.requestId !== requestId) return;

    if (result.response === 1) {
      armCloseTimer(latest);
      return;
    }

    if (result.response === 2) {
      const resolution = state.resolve(requestId, "force");
      if (resolution.kind === "replay") {
        setImmediate(() => replayClose(resolution.request.requestId));
      }
      return;
    }

    const cancelled = state.cancelPending(requestId);
    if (cancelled) notifyCloseCancelled(cancelled);
  } catch {
    // A native-dialog failure must default to keeping the application open.
    const cancelled = state.cancelPending(requestId);
    if (cancelled) notifyCloseCancelled(cancelled);
  } finally {
    if (timeoutDialogRequestId === requestId) timeoutDialogRequestId = null;
  }
}

function notifyCloseCancelled(request: AppCloseRequest): void {
  const win = usableActiveWindow();
  if (!win || win.webContents.isDestroyed()) return;
  win.webContents.send(EV.lifecycleCloseCancelled, request);
}

function usableActiveWindow(): BrowserWindow | null {
  return activeWindow && !activeWindow.isDestroyed() ? activeWindow : null;
}

function parseCloseResponse(value: unknown): AppCloseResponse {
  if (!isRecord(value)) throw new Error("Invalid application close response");
  const requestId = value.requestId;
  const decision = value.decision;
  if (typeof requestId !== "string" || requestId.trim() === "") {
    throw new Error("Invalid application close request id");
  }
  if (!isAppCloseDecision(decision)) {
    throw new Error("Invalid application close decision");
  }
  return { decision, requestId };
}

function isAppCloseDecision(value: unknown): value is AppCloseDecision {
  return value === "ready" || value === "cancel" || value === "force";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
