import { Buffer } from "node:buffer";
import { SENTINEL_STATES, type SentinelCheckResult, type SentinelState } from "@aurascholar/core";
import { normalizeDoi } from "@aurascholar/db/ids";
import { describeSafeError } from "@aurascholar/platform";

const MAX_POLL_INTERVAL_SECONDS = 366 * 86_400;
const MAX_TARGET_FLAGS_BYTES = 16 * 1024;
const MAX_TITLE_MATCH_DOI_BYTES = 2_048;

export interface NormalizedSentinelCheckResult {
  highestState: SentinelState;
  newMilestones: Array<{ evidence: unknown; state: SentinelState }>;
}

export function parseTargetFlags(value: string | null): SentinelState[] {
  if (!value) return [];
  if (Buffer.byteLength(value, "utf8") > MAX_TARGET_FLAGS_BYTES) {
    throw new Error("监控目标配置过大");
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("监控目标配置不是有效 JSON 数组");
    return [...new Set(parsed.map(readSentinelState))];
  } catch (error) {
    throw new Error(`监控目标配置不是有效 JSON:${describeSafeError(error)}`, { cause: error });
  }
}

export function normalizeCheckResult(
  value: SentinelCheckResult,
  previousState: SentinelState,
): NormalizedSentinelCheckResult {
  const highestState = readSentinelState(value.highestState);
  if (!Array.isArray(value.newMilestones) || value.newMilestones.length > SENTINEL_STATES.length) {
    throw new Error("Sentinel check milestones are invalid");
  }
  const newMilestones = value.newMilestones.map((milestone, index) => {
    if (!milestone || typeof milestone !== "object") {
      throw new Error(`Sentinel check milestone ${index} is invalid`);
    }
    const record = milestone as { evidence?: unknown; state?: unknown };
    return { evidence: record.evidence, state: readSentinelState(record.state) };
  });
  if (new Set(newMilestones.map((milestone) => milestone.state)).size !== newMilestones.length) {
    throw new Error("Sentinel check milestones must be unique");
  }
  if (
    highestState === previousState &&
    newMilestones.some((milestone) => milestone.state === previousState)
  ) {
    throw new Error("Sentinel check cannot re-record the current state");
  }
  return { highestState, newMilestones };
}

export function readSentinelState(value: unknown): SentinelState {
  if (typeof value !== "string" || !(SENTINEL_STATES as readonly string[]).includes(value)) {
    throw new Error("Sentinel state is invalid");
  }
  return value as SentinelState;
}

export function readTaskDoi(value: unknown): string | null {
  if (value === null) return null;
  return readMatchedDoi(value);
}

export function readMatchedDoi(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_TITLE_MATCH_DOI_BYTES) {
    throw new Error("Sentinel DOI is invalid");
  }
  const doi = normalizeDoi(value);
  if (!doi) throw new Error("Sentinel DOI is invalid");
  return doi;
}

export function readExpectedUpdatedAt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Expected Sentinel task revision is invalid");
  }
  return value as number;
}

export function readPollInterval(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > MAX_POLL_INTERVAL_SECONDS
  ) {
    throw new Error("Sentinel poll interval is invalid");
  }
  return value as number;
}
