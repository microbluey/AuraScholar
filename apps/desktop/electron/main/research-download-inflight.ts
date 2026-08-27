import {
  MAX_PENDING_RESEARCH_DOWNLOAD_BYTES,
  MAX_RESEARCH_DOWNLOAD_BYTES,
} from "./research-download-limits";

/**
 * A conservative global budget for transfers that have started but have not
 * yet reached the main-process receipt store.  Unknown transfer lengths
 * reserve one complete file slot so they cannot bypass the byte budget.
 */
export const MAX_IN_FLIGHT_RESEARCH_DOWNLOADS = Math.floor(
  MAX_PENDING_RESEARCH_DOWNLOAD_BYTES / MAX_RESEARCH_DOWNLOAD_BYTES,
);
export const MAX_IN_FLIGHT_RESEARCH_DOWNLOAD_BYTES = MAX_PENDING_RESEARCH_DOWNLOAD_BYTES;

export interface ResearchDownloadInFlightOptions {
  maxDownloads?: number;
  maxBytes?: number;
  maxDownloadBytes?: number;
}

export interface ResearchDownloadInFlightAdmission {
  /**
   * Reconcile Electron's latest transfer counters with this reservation.
   * Returning false means the caller must cancel the download and eventually
   * call release after its terminal event.
   */
  observe(receivedBytes: number, totalBytes: number): boolean;
  /** Return this reservation exactly once; it is safe to call repeatedly. */
  release(): void;
}

/** Backward-compatible descriptive alias for an admitted transfer. */
export type ResearchDownloadInFlightPermit = ResearchDownloadInFlightAdmission;

export interface ResearchDownloadInFlightGate {
  /** Admit a transfer synchronously, or reject it before allocating a target. */
  admit(totalBytes: number): ResearchDownloadInFlightAdmission | null;
  /** Drop all current reservations when their owning browser session closes. */
  clear(): void;
}

type PermitState = {
  active: boolean;
  blocked: boolean;
  reservedBytes: number;
};

function assertPositiveSafeInteger(
  value: number | undefined,
  label: string,
  fallback: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return resolved;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function reservationFor(totalBytes: unknown, maxDownloadBytes: number): number | null {
  if (!isNonNegativeSafeInteger(totalBytes) || totalBytes > maxDownloadBytes) return null;
  return totalBytes === 0 ? maxDownloadBytes : totalBytes;
}

/**
 * Create an isolated in-flight gate.  This is intentionally pure: Electron
 * event wiring owns cancellation and terminal cleanup, while this module only
 * owns bounded reservations.
 */
export function createResearchDownloadInFlightGate(
  options: ResearchDownloadInFlightOptions = {},
): ResearchDownloadInFlightGate {
  const maxDownloads = assertPositiveSafeInteger(
    options.maxDownloads,
    "Research download in-flight count limit",
    MAX_IN_FLIGHT_RESEARCH_DOWNLOADS,
  );
  const maxBytes = assertPositiveSafeInteger(
    options.maxBytes,
    "Research download in-flight byte limit",
    MAX_IN_FLIGHT_RESEARCH_DOWNLOAD_BYTES,
  );
  const maxDownloadBytes = assertPositiveSafeInteger(
    options.maxDownloadBytes,
    "Research download byte limit",
    MAX_RESEARCH_DOWNLOAD_BYTES,
  );
  const permits = new Set<PermitState>();
  let reservedBytes = 0;

  function release(state: PermitState): void {
    if (!state.active || !permits.delete(state)) {
      state.active = false;
      return;
    }
    state.active = false;
    reservedBytes -= state.reservedBytes;
  }

  function block(state: PermitState): false {
    state.blocked = true;
    return false;
  }

  function observe(state: PermitState, receivedBytes: number, totalBytes: number): boolean {
    if (!state.active || !permits.has(state) || state.blocked) return false;
    if (!isNonNegativeSafeInteger(receivedBytes) || receivedBytes > maxDownloadBytes) {
      return block(state);
    }

    const reportedReservation = reservationFor(totalBytes, maxDownloadBytes);
    if (reportedReservation === null) return block(state);
    if (totalBytes !== 0 && receivedBytes > totalBytes) return block(state);

    // Reservations never shrink.  A changed Content-Length can only expand a
    // transfer's budget and must fit alongside all other active transfers.
    const requiredReservation = Math.max(state.reservedBytes, reportedReservation, receivedBytes);
    if (requiredReservation === state.reservedBytes) return true;

    const otherReservedBytes = reservedBytes - state.reservedBytes;
    if (requiredReservation > maxBytes - otherReservedBytes) return block(state);
    reservedBytes = otherReservedBytes + requiredReservation;
    state.reservedBytes = requiredReservation;
    return true;
  }

  return {
    admit(totalBytes) {
      const reservedForTransfer = reservationFor(totalBytes, maxDownloadBytes);
      if (reservedForTransfer === null) return null;
      if (permits.size >= maxDownloads || reservedForTransfer > maxBytes - reservedBytes) {
        return null;
      }

      const state: PermitState = {
        active: true,
        blocked: false,
        reservedBytes: reservedForTransfer,
      };
      permits.add(state);
      reservedBytes += reservedForTransfer;
      return {
        observe: (receivedBytes, observedTotalBytes) =>
          observe(state, receivedBytes, observedTotalBytes),
        release: () => release(state),
      };
    },
    clear() {
      for (const state of permits) {
        state.active = false;
        state.blocked = true;
      }
      permits.clear();
      reservedBytes = 0;
    },
  };
}

const defaultResearchDownloadInFlightGate = createResearchDownloadInFlightGate();

/** Admit through the process-wide research-browser transfer gate. */
export function admitResearchDownloadInFlight(
  totalBytes: number,
): ResearchDownloadInFlightAdmission | null {
  return defaultResearchDownloadInFlightGate.admit(totalBytes);
}
