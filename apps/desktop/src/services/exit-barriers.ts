import type { AppCloseDecision, AppCloseRequest } from "../../electron/shared";

export type ExitBarrier = (
  request: AppCloseRequest,
) => AppCloseDecision | Promise<AppCloseDecision>;

export interface ExitBarrierOptions {
  priority?: number;
}

interface RegisteredExitBarrier {
  barrier: ExitBarrier;
  order: number;
  priority: number;
}

const barriers = new Set<RegisteredExitBarrier>();
const inFlightRequests = new Map<string, Promise<AppCloseDecision>>();
const cancelledRequestIds = new Set<string>();
let barrierOrder = 0;

/**
 * Registers work that must settle before the native window may close.
 *
 * A snapshot of the registered barriers is used for each request so mounting
 * or unmounting another feature while a close is being prepared cannot alter
 * the decision halfway through that request.
 */
export function registerExitBarrier(
  barrier: ExitBarrier,
  options: ExitBarrierOptions = {},
): () => void {
  const registered = {
    barrier,
    order: barrierOrder,
    priority: options.priority ?? 50,
  };
  barrierOrder += 1;
  barriers.add(registered);
  return () => {
    barriers.delete(registered);
  };
}

async function executeExitBarriers(request: AppCloseRequest): Promise<AppCloseDecision> {
  let decision: AppCloseDecision = "ready";

  const registeredBarriers = [...barriers].sort(
    (left, right) => left.priority - right.priority || left.order - right.order,
  );
  for (const { barrier } of registeredBarriers) {
    if (cancelledRequestIds.has(request.requestId)) return "cancel";
    let barrierDecision: AppCloseDecision;
    try {
      barrierDecision = await barrier(request);
    } catch {
      return "cancel";
    }

    if (cancelledRequestIds.has(request.requestId)) return "cancel";
    if (barrierDecision === "cancel") return "cancel";
    if (barrierDecision === "force") decision = "force";
  }

  return decision;
}

/**
 * Runs every registered close barrier once for a native close request.
 *
 * Electron may emit the same request more than once while its decision is
 * pending. Returning the existing promise prevents duplicate saves or prompts.
 */
export function runExitBarriers(request: AppCloseRequest): Promise<AppCloseDecision> {
  const existing = inFlightRequests.get(request.requestId);
  if (existing) return existing;

  const run = executeExitBarriers(request);
  inFlightRequests.set(request.requestId, run);
  void run
    .finally(() => {
      if (inFlightRequests.get(request.requestId) === run) {
        inFlightRequests.delete(request.requestId);
      }
      cancelledRequestIds.delete(request.requestId);
    })
    .catch(() => undefined);
  return run;
}

/** Stops a timed-out native-close request before it can enter later barriers. */
export function cancelExitBarriers(requestId: string): void {
  if (!inFlightRequests.has(requestId)) return;
  cancelledRequestIds.add(requestId);
}
