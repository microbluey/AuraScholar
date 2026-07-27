import { type AppCloseDecision, type AppCloseRequest, type AppCloseResponse } from "../shared";

export type AppCloseRequestCallback = (
  request: AppCloseRequest,
) => AppCloseDecision | Promise<AppCloseDecision>;

interface ActiveCloseRequest {
  retired: boolean;
}

/**
 * Keeps renderer close requests isolated by request id.
 *
 * A timed-out request may leave application work running. Retiring that
 * request must not block a later retry, and its eventual result must never
 * acknowledge the newer close attempt.
 */
export class AppCloseRequestCoordinator {
  private readonly activeRequests = new Map<string, ActiveCloseRequest>();
  private callback: AppCloseRequestCallback | null = null;
  private pendingRequest: AppCloseRequest | null = null;

  constructor(private readonly respond: (response: AppCloseResponse) => Promise<unknown>) {}

  receive(request: AppCloseRequest): void {
    if (this.activeRequests.has(request.requestId)) return;
    this.pendingRequest = request;
    this.deliverPending();
  }

  cancel(requestId: string): void {
    if (this.pendingRequest?.requestId === requestId) {
      this.pendingRequest = null;
    }
    const active = this.activeRequests.get(requestId);
    if (active) active.retired = true;
  }

  subscribe(callback: AppCloseRequestCallback): () => void {
    this.callback = callback;
    queueMicrotask(() => {
      if (this.callback === callback) this.deliverPending();
    });
    return () => {
      if (this.callback === callback) this.callback = null;
    };
  }

  private deliverPending(): void {
    const request = this.pendingRequest;
    const callback = this.callback;
    if (!request || !callback || this.activeRequests.has(request.requestId)) return;

    this.pendingRequest = null;
    const active: ActiveCloseRequest = { retired: false };
    this.activeRequests.set(request.requestId, active);
    void Promise.resolve()
      .then(() => callback(request))
      .then((decision): AppCloseDecision => (isAppCloseDecision(decision) ? decision : "cancel"))
      .catch((): AppCloseDecision => "cancel")
      .then(async (decision) => {
        if (active.retired) return;
        await this.respond({ decision, requestId: request.requestId });
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.activeRequests.get(request.requestId) === active) {
          this.activeRequests.delete(request.requestId);
        }
        this.deliverPending();
      });
  }
}

function isAppCloseDecision(value: unknown): value is AppCloseDecision {
  return value === "ready" || value === "cancel" || value === "force";
}
