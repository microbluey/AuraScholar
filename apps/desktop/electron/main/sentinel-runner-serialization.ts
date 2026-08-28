import { Buffer } from "node:buffer";
import type { SentinelPollSummary } from "../sentinel-run-command-contract";

const MAX_SENTINEL_SUMMARY_OUTPUT_BYTES = 64 * 1024;

export const MAX_SENTINEL_EVENT_EVIDENCE_BYTES = 256 * 1024;
export const MAX_SENTINEL_FAILURE_TITLE_BYTES = 384;
export const MAX_SENTINEL_SUMMARY_FAILURES = 32;

export interface MainSentinelNotification {
  body: string;
  tag: string;
  title: string;
}

export interface MainSentinelNotifier {
  notify(notification: MainSentinelNotification): Promise<void>;
}

export function normalizeEventEvidence(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("Sentinel event evidence is not valid JSON");
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") > MAX_SENTINEL_EVENT_EVIDENCE_BYTES
  ) {
    throw new Error("Sentinel event evidence is too large");
  }
  return JSON.parse(serialized) as unknown;
}

export function requireBoundedPollSummary(summary: SentinelPollSummary): SentinelPollSummary {
  if (
    !Number.isSafeInteger(summary.checked) ||
    summary.checked < 0 ||
    !Number.isSafeInteger(summary.changes) ||
    summary.changes < 0 ||
    !Number.isSafeInteger(summary.failed) ||
    summary.failed < 0 ||
    summary.failures.length > MAX_SENTINEL_SUMMARY_FAILURES ||
    summary.failed < summary.failures.length
  ) {
    throw new Error("Sentinel poll summary is invalid");
  }
  const serialized = JSON.stringify(summary);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SENTINEL_SUMMARY_OUTPUT_BYTES) {
    throw new Error(
      `Sentinel poll output is limited to ${MAX_SENTINEL_SUMMARY_OUTPUT_BYTES} bytes`,
    );
  }
  return summary;
}

export async function notifyBestEffort(
  notifier: MainSentinelNotifier,
  notification: MainSentinelNotification,
): Promise<void> {
  try {
    await notifier.notify(notification);
  } catch {
    // Durable state/evidence has already committed; OS notifications are best-effort.
  }
}

export function shortText(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maximumBytes) return value;
  return Buffer.from(bytes.subarray(0, Math.max(0, maximumBytes - 3))).toString("utf8") + "...";
}
