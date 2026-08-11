import type {
  SentinelCancelRunCommandInput,
  SentinelRunCommandName,
  SentinelRunCommandOutput,
  SentinelRunCommandRequest,
  SentinelRunDuePollsCommandInput,
  SentinelRunTaskNowCommandInput,
} from "../sentinel-run-command-contract";
import { isRecord, requireRecordId } from "./data-command-runtime";
import { mainSentinelRunner, type MainSentinelRunner } from "./sentinel-runner";

const MAX_SENTINEL_RUN_REQUEST_ID_LENGTH = 128;
const SENTINEL_RUN_REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type SentinelRunCommandDependencies = Pick<
  MainSentinelRunner,
  "cancel" | "runDuePolls" | "runTaskNow"
>;

const defaultDependencies: SentinelRunCommandDependencies = mainSentinelRunner;

/**
 * Narrow command owner for main-process Sentinel egress. Input deliberately
 * contains no Library id, URL, headers, connector options, state transition,
 * evidence, or notification data; all of those remain durable/main-derived.
 */
export async function executeSentinelRunCommand(
  request: SentinelRunCommandRequest,
  dependencies: SentinelRunCommandDependencies = defaultDependencies,
): Promise<SentinelRunCommandOutput<SentinelRunCommandName>> {
  switch (request.name) {
    case "sentinel.cancelRun": {
      const input = parseSentinelCancelRunInput(request.input);
      return { cancelled: dependencies.cancel(input.requestId) };
    }
    case "sentinel.runDuePolls": {
      const input = parseSentinelRunDuePollsInput(request.input);
      return dependencies.runDuePolls(input.requestId);
    }
    case "sentinel.runTaskNow": {
      const input = parseSentinelRunTaskNowInput(request.input);
      return dependencies.runTaskNow(input.taskId, input.requestId);
    }
  }
}

export function parseSentinelRunDuePollsInput(value: unknown): SentinelRunDuePollsCommandInput {
  const input = requireExactSentinelRunInput(value, "sentinel.runDuePolls", ["requestId"]);
  return { requestId: requireSentinelRunRequestId(input.requestId) };
}

export function parseSentinelRunTaskNowInput(value: unknown): SentinelRunTaskNowCommandInput {
  const input = requireExactSentinelRunInput(value, "sentinel.runTaskNow", ["requestId", "taskId"]);
  return {
    requestId: requireSentinelRunRequestId(input.requestId),
    taskId: requireRecordId(input.taskId, "Sentinel task id"),
  };
}

export function parseSentinelCancelRunInput(value: unknown): SentinelCancelRunCommandInput {
  const input = requireExactSentinelRunInput(value, "sentinel.cancelRun", ["requestId"]);
  return { requestId: requireSentinelRunRequestId(input.requestId) };
}

function requireExactSentinelRunInput(
  value: unknown,
  commandName: SentinelRunCommandName,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireSentinelRunRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_SENTINEL_RUN_REQUEST_ID_LENGTH ||
    !SENTINEL_RUN_REQUEST_ID_RE.test(value)
  ) {
    throw new Error("Sentinel run request id is invalid");
  }
  return value;
}
