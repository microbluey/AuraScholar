/**
 * Main-owned Sentinel polling commands. The renderer can request a bounded
 * poll and cancel its own opaque request id, but never supplies a Library
 * scope, network target, connector configuration, or durable check update.
 */

export interface SentinelRunDuePollsCommandInput {
  requestId: string;
}

export interface SentinelRunTaskNowCommandInput {
  requestId: string;
  taskId: string;
}

export interface SentinelCancelRunCommandInput {
  requestId: string;
}

/**
 * The first failures are retained for UI feedback. `failed` remains the full
 * count so truncating the bounded IPC payload never understates a run.
 */
export interface SentinelPollFailure {
  error: string;
  taskId: string;
  title: string;
}

export interface SentinelPollSummary {
  changes: number;
  checked: number;
  failed: number;
  failures: SentinelPollFailure[];
}

export interface SentinelRunDataCommandMap {
  "sentinel.cancelRun": {
    input: SentinelCancelRunCommandInput;
    output: { cancelled: boolean };
  };
  "sentinel.runDuePolls": {
    input: SentinelRunDuePollsCommandInput;
    output: SentinelPollSummary;
  };
  "sentinel.runTaskNow": {
    input: SentinelRunTaskNowCommandInput;
    output: SentinelPollSummary;
  };
}

export type SentinelRunCommandName = keyof SentinelRunDataCommandMap;

export type SentinelRunCommandInput<K extends SentinelRunCommandName> =
  SentinelRunDataCommandMap[K]["input"];

export type SentinelRunCommandOutput<K extends SentinelRunCommandName> =
  SentinelRunDataCommandMap[K]["output"];

/** Kept standalone until the central data-command map deliberately opts in. */
export type SentinelRunCommandRequest = {
  [K in SentinelRunCommandName]: {
    input: SentinelRunCommandInput<K>;
    name: K;
  };
}[SentinelRunCommandName];
