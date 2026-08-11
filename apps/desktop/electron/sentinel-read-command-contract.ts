import type { SentinelState } from "@aurascholar/core";
import type { SentinelEventRow, SentinelTaskRow } from "@aurascholar/db/repos/sentinel";

export type { SentinelEventRow, SentinelTaskRow } from "@aurascholar/db/repos/sentinel";

/** Sentinel page and polling reads always resolve the active local Library in main. */
export type SentinelReadScopeCommandInput = Record<string, never>;

/**
 * Page data is returned in flat form so the renderer can build its own
 * presentation index without issuing one query per task.
 */
export interface SentinelGetPageSnapshotCommandResult {
  events: SentinelEventRow[];
  tasks: SentinelTaskRow[];
}

/** The poller only needs the durable fields required to make its next CAS write. */
export type SentinelPollTask = Pick<
  SentinelTaskRow,
  | "current_state"
  | "doi"
  | "error_count"
  | "hint_author"
  | "hint_venue"
  | "id"
  | "status"
  | "target_flags"
  | "title"
  | "updated_at"
  | "work_id"
>;

export interface SentinelPollTaskSnapshot {
  reachedStates: SentinelState[];
  task: SentinelPollTask;
}

/** Main owns the current-time policy for startup and periodic due polling. */
export type SentinelGetDuePollSnapshotCommandInput = SentinelReadScopeCommandInput;

export interface SentinelGetDuePollSnapshotCommandResult {
  libraryId: string;
  tasks: SentinelPollTaskSnapshot[];
}

export interface SentinelGetTaskPollSnapshotCommandInput {
  taskId: string;
}

export interface SentinelGetTaskPollSnapshotCommandResult {
  libraryId: string;
  reachedStates: SentinelState[];
  task: SentinelPollTask | null;
}

/** Typed Sentinel read commands. Mutations remain in sentinel-commands.ts. */
export interface SentinelReadDataCommandMap {
  "sentinel.getDuePollSnapshot": {
    input: SentinelGetDuePollSnapshotCommandInput;
    output: SentinelGetDuePollSnapshotCommandResult;
  };
  "sentinel.getPageSnapshot": {
    input: SentinelReadScopeCommandInput;
    output: SentinelGetPageSnapshotCommandResult;
  };
  "sentinel.getTaskPollSnapshot": {
    input: SentinelGetTaskPollSnapshotCommandInput;
    output: SentinelGetTaskPollSnapshotCommandResult;
  };
}
