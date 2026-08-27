import { MAX_RESEARCH_DOWNLOAD_BYTES } from "./research-download-limits";

export const MAX_CONCURRENT_RESEARCH_DOWNLOAD_CONSUMES = 1;
export const MAX_CONSUMING_RESEARCH_DOWNLOAD_BYTES = MAX_RESEARCH_DOWNLOAD_BYTES;

export interface ResearchDownloadConsumeAdmission {
  /** Return this reservation exactly once; repeated calls are safe. */
  release(): void;
}

export interface ResearchDownloadConsumeGate {
  /** Reserve one bounded main-process/IPC consume operation, or reject it. */
  admit(byteSize: number): ResearchDownloadConsumeAdmission | null;
}

export interface ResearchDownloadConsumeGateOptions {
  maxConsumes?: number;
  maxBytes?: number;
}

type Permit = { active: boolean; byteSize: number };

function positiveSafeInteger(value: number | undefined, label: string, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return resolved;
}

/**
 * A small, non-queuing backstop for direct preload calls. The renderer broker
 * serializes normal end-to-end processing; this prevents a bypass from making
 * simultaneous complete-file Buffer and IPC allocations in the main process.
 */
export function createResearchDownloadConsumeGate(
  options: ResearchDownloadConsumeGateOptions = {},
): ResearchDownloadConsumeGate {
  const maxConsumes = positiveSafeInteger(
    options.maxConsumes,
    "Research download consume count limit",
    MAX_CONCURRENT_RESEARCH_DOWNLOAD_CONSUMES,
  );
  const maxBytes = positiveSafeInteger(
    options.maxBytes,
    "Research download consume byte limit",
    MAX_CONSUMING_RESEARCH_DOWNLOAD_BYTES,
  );
  const permits = new Set<Permit>();
  let reservedBytes = 0;

  return {
    admit(byteSize) {
      if (
        !Number.isSafeInteger(byteSize) ||
        byteSize < 0 ||
        permits.size >= maxConsumes ||
        byteSize > maxBytes - reservedBytes
      ) {
        return null;
      }
      const permit: Permit = { active: true, byteSize };
      permits.add(permit);
      reservedBytes += byteSize;
      return {
        release() {
          if (!permit.active || !permits.delete(permit)) return;
          permit.active = false;
          reservedBytes -= permit.byteSize;
        },
      };
    },
  };
}

/** Process-wide default used by the one main-process receipt store. */
export const defaultResearchDownloadConsumeGate = createResearchDownloadConsumeGate();
