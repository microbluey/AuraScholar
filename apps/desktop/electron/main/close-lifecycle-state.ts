import type { AppCloseDecision, AppCloseIntent, AppCloseRequest } from "../shared";

export interface AppCloseRequestChange {
  changed: boolean;
  request: AppCloseRequest;
}

export type AppCloseResolution =
  | { kind: "ignored" }
  | { kind: "cancel"; request: AppCloseRequest }
  | {
      decision: Exclude<AppCloseDecision, "cancel">;
      kind: "replay";
      request: AppCloseRequest;
    };

/**
 * Pure state machine for Electron's two re-entrant close paths.
 *
 * BrowserWindow.close() emits "close" again, while app.quit() emits
 * "before-quit" again and then closes the window. The two one-shot permits
 * make those replayed events pass exactly once without leaving a permanent
 * escape hatch around renderer persistence.
 */
export class AppCloseLifecycleState {
  private pendingRequest: AppCloseRequest | null = null;
  private replayRequest: (AppCloseRequest & { decision: "ready" | "force" }) | null = null;
  private heldRequestId: string | null = null;
  private permitNextQuit = false;
  private permitNextWindowClose = false;

  begin(intent: AppCloseIntent, requestId: () => string): AppCloseRequestChange {
    if (this.pendingRequest) {
      if (intent === "quit" && this.pendingRequest.intent === "window") {
        this.pendingRequest = { ...this.pendingRequest, intent: "quit" };
        return { changed: true, request: this.pendingRequest };
      }
      return { changed: false, request: this.pendingRequest };
    }

    if (this.replayRequest) {
      if (intent === "quit" && this.replayRequest.intent === "window") {
        this.replayRequest = { ...this.replayRequest, intent: "quit" };
        this.permitNextQuit = true;
      }
      return {
        changed: false,
        request: {
          intent: this.replayRequest.intent,
          requestId: this.replayRequest.requestId,
        },
      };
    }

    const request = { intent, requestId: requestId() };
    this.pendingRequest = request;
    this.heldRequestId = null;
    return { changed: true, request };
  }

  currentRequest(): AppCloseRequest | null {
    return this.pendingRequest;
  }

  holdPending(requestId: string): boolean {
    if (this.pendingRequest?.requestId !== requestId) return false;
    this.heldRequestId = requestId;
    return true;
  }

  isPendingHeld(requestId: string): boolean {
    return this.pendingRequest?.requestId === requestId && this.heldRequestId === requestId;
  }

  resolve(requestId: string, decision: AppCloseDecision): AppCloseResolution {
    const request = this.pendingRequest;
    if (!request || request.requestId !== requestId) return { kind: "ignored" };

    this.pendingRequest = null;
    this.heldRequestId = null;
    if (decision === "cancel") {
      this.clearReplay();
      return { kind: "cancel", request };
    }

    this.replayRequest = { ...request, decision };
    this.permitNextWindowClose = true;
    this.permitNextQuit = request.intent === "quit";
    return { decision, kind: "replay", request };
  }

  cancelPending(requestId: string): AppCloseRequest | null {
    const request = this.pendingRequest;
    if (!request || request.requestId !== requestId) return null;
    this.pendingRequest = null;
    this.heldRequestId = null;
    this.clearReplay();
    return request;
  }

  consumeQuitPermit(): boolean {
    if (!this.permitNextQuit) return false;
    this.permitNextQuit = false;
    return true;
  }

  consumeWindowClosePermit(): boolean {
    if (!this.permitNextWindowClose) return false;
    this.permitNextWindowClose = false;
    return true;
  }

  preventedUnload(): AppCloseRequest | null {
    const request = this.replayRequest;
    if (!request) return null;
    const cancelledRequest = { intent: request.intent, requestId: request.requestId };
    this.clearReplay();
    return cancelledRequest;
  }

  shouldForcePreventedUnload(): boolean {
    return this.replayRequest?.decision === "force";
  }

  replayRequestFor(requestId: string): AppCloseRequest | null {
    const request = this.replayRequest;
    if (!request || request.requestId !== requestId) return null;
    return { intent: request.intent, requestId: request.requestId };
  }

  finishReplay(requestId?: string): void {
    if (requestId && this.replayRequest?.requestId !== requestId) return;
    this.clearReplay();
  }

  reset(): void {
    this.pendingRequest = null;
    this.heldRequestId = null;
    this.clearReplay();
  }

  private clearReplay(): void {
    this.replayRequest = null;
    this.permitNextQuit = false;
    this.permitNextWindowClose = false;
  }
}
