// Renderer facade for the main-owned Sentinel runner. The renderer requests a
// bounded semantic operation and refreshes its view; it never receives a
// connector, chooses an endpoint, writes Sentinel evidence, or sends OS
// notifications itself.
import type { SentinelPollSummary } from "../../electron/sentinel-run-command-contract";

export type {
  SentinelPollFailure,
  SentinelPollSummary,
} from "../../electron/sentinel-run-command-contract";

export interface SentinelPollOptions {
  signal?: AbortSignal;
}

/** Small injectable seam for renderer tests; production stays typed IPC-only. */
export interface SentinelPollDataSource {
  cancelRun: (requestId: string) => Promise<{ cancelled: boolean }>;
  runDuePolls: (requestId: string) => Promise<SentinelPollSummary>;
  runTaskNow: (taskId: string, requestId: string) => Promise<SentinelPollSummary>;
}

const defaultDataSource: SentinelPollDataSource = {
  cancelRun: (requestId) => window.aura.data.command("sentinel.cancelRun", { requestId }),
  runDuePolls: (requestId) => window.aura.data.command("sentinel.runDuePolls", { requestId }),
  runTaskNow: (taskId, requestId) =>
    window.aura.data.command("sentinel.runTaskNow", { requestId, taskId }),
};

/** Polls every due task once. Returns the number of durable state changes found. */
export async function runDuePolls(
  options: SentinelPollOptions = {},
  dataSource: SentinelPollDataSource = defaultDataSource,
): Promise<number> {
  return (await runDuePollsDetailed(options, dataSource)).changes;
}

export async function runDuePollsDetailed(
  options: SentinelPollOptions = {},
  dataSource: SentinelPollDataSource = defaultDataSource,
): Promise<SentinelPollSummary> {
  const summary = await invokeDueSentinelRun(options.signal, dataSource);
  notifySentinelUpdated();
  return summary;
}

export async function runSentinelTaskNow(
  taskId: string,
  options: SentinelPollOptions = {},
  dataSource: SentinelPollDataSource = defaultDataSource,
): Promise<SentinelPollSummary> {
  const summary = await invokeTaskSentinelRun(taskId, options.signal, dataSource);
  notifySentinelUpdated();
  return summary;
}

function notifySentinelUpdated(): void {
  window.dispatchEvent(new Event("aurascholar:sentinel-updated"));
}

async function invokeDueSentinelRun(
  signal: AbortSignal | undefined,
  dataSource: SentinelPollDataSource,
): Promise<SentinelPollSummary> {
  return invokeCancellableSentinelRun(signal, dataSource, (requestId) =>
    dataSource.runDuePolls(requestId),
  );
}

async function invokeTaskSentinelRun(
  taskId: string,
  signal: AbortSignal | undefined,
  dataSource: SentinelPollDataSource,
): Promise<SentinelPollSummary> {
  return invokeCancellableSentinelRun(signal, dataSource, (requestId) =>
    dataSource.runTaskNow(taskId, requestId),
  );
}

async function invokeCancellableSentinelRun(
  signal: AbortSignal | undefined,
  dataSource: SentinelPollDataSource,
  invoke: (requestId: string) => Promise<SentinelPollSummary>,
): Promise<SentinelPollSummary> {
  if (signal?.aborted) throw abortError();
  const requestId = newSentinelRunRequestId();
  let cancellationRequested = false;
  const cancel = () => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    // The original request remains authoritative. Main may have entered its
    // short commit boundary when this best-effort cancellation arrives.
    void dataSource.cancelRun(requestId).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await invoke(requestId);
    if (signal?.aborted) throw abortError();
    return result;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

function newSentinelRunRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sentinel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortError(): Error {
  const error = new Error("Sentinel request cancelled");
  error.name = "AbortError";
  return error;
}

let started = false;

/** Startup catch-up + hourly re-check while the app is open. Egress is in main. */
export function startSentinelLoop(): void {
  if (started) return;
  started = true;
  void runDuePolls();
  setInterval(() => void runDuePolls(), 60 * 60 * 1000);
}
