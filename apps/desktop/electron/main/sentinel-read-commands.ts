import { Buffer } from "node:buffer";
import { SENTINEL_STATES, type SentinelState } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type { SentinelTaskRow } from "@aurascholar/db/repos/sentinel";
import { describeSafeError } from "@aurascholar/platform";
import type {
  DataCommandOutput,
  DataCommandRequest,
  SentinelGetDuePollSnapshotCommandResult,
  SentinelGetEventEvidenceCommandInput,
  SentinelGetEventEvidenceCommandResult,
  SentinelGetPageSnapshotCommandResult,
  SentinelGetTaskPollSnapshotCommandInput,
  SentinelGetTaskPollSnapshotCommandResult,
  SentinelEventEvidenceStatus,
  SentinelPollTask,
  SentinelReadScopeCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";
import { MAX_SENTINEL_EVENT_EVIDENCE_BYTES } from "./sentinel-runner-serialization";

const MAX_SENTINEL_DUE_TASKS = 1_000;
const MAX_SENTINEL_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_SENTINEL_PAGE_EVENTS = 10_000;
const MAX_SENTINEL_PAGE_TASKS = 1_000;
const MAX_SENTINEL_REACHED_STATE_ROWS = MAX_SENTINEL_DUE_TASKS * SENTINEL_STATES.length;

type SentinelReadCommandName =
  | "sentinel.getDuePollSnapshot"
  | "sentinel.getEventEvidence"
  | "sentinel.getPageSnapshot"
  | "sentinel.getTaskPollSnapshot";

export type SentinelReadCommandRequest = Extract<
  DataCommandRequest,
  { name: SentinelReadCommandName }
>;

interface ReachedStateRow {
  task_id: string;
  to_state: string;
}

interface SentinelEventEvidenceRow {
  evidence_json: string | null;
}

interface SentinelEventEvidenceStatusRow {
  evidence_status: string;
}

interface SentinelPageEventRow {
  detected_at: number;
  evidence_status: string;
  from_state: string;
  id: string;
  task_id: string;
  to_state: string;
}

/**
 * Bounded, scoped Sentinel reads. The renderer receives only DTOs and main
 * derives the durable local Library identity under the read lease.
 */
export async function executeSentinelReadCommand(
  request: SentinelReadCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<SentinelReadCommandName>> {
  switch (request.name) {
    case "sentinel.getPageSnapshot": {
      parseSentinelReadScopeInput(request.input, request.name);
      return executeSentinelReadQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadSentinelPageSnapshot(database, libraryId);
      });
    }
    case "sentinel.getDuePollSnapshot": {
      parseSentinelReadScopeInput(request.input, request.name);
      return executeSentinelReadQuery(dependencies, request.name, async (database) => {
        return loadMainSentinelDuePollSnapshot(database);
      });
    }
    case "sentinel.getEventEvidence": {
      const input = parseSentinelEventEvidenceInput(request.input);
      return executeSentinelReadQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return loadSentinelEventEvidence(database, libraryId, input);
      });
    }
    case "sentinel.getTaskPollSnapshot": {
      const input = parseSentinelTaskPollSnapshotInput(request.input);
      return executeSentinelReadQuery(dependencies, request.name, async (database) => {
        return loadMainSentinelTaskPollSnapshot(database, input.taskId);
      });
    }
  }
}

function executeSentinelReadQuery<K extends SentinelReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function parseSentinelReadScopeInput(
  value: unknown,
  commandName: "sentinel.getDuePollSnapshot" | "sentinel.getPageSnapshot",
): SentinelReadScopeCommandInput {
  return requireExactSentinelReadInput(value, commandName, []) as SentinelReadScopeCommandInput;
}

function parseSentinelTaskPollSnapshotInput(
  value: unknown,
): SentinelGetTaskPollSnapshotCommandInput {
  const input = requireExactSentinelReadInput(value, "sentinel.getTaskPollSnapshot", ["taskId"]);
  return { taskId: requireRecordId(input.taskId, "Sentinel task id") };
}

function parseSentinelEventEvidenceInput(value: unknown): SentinelGetEventEvidenceCommandInput {
  const input = requireExactSentinelReadInput(value, "sentinel.getEventEvidence", ["eventId"]);
  return { eventId: requireRecordId(input.eventId, "Sentinel event id") };
}

function requireExactSentinelReadInput(
  value: unknown,
  commandName: SentinelReadCommandName,
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

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

/**
 * Main-only polling snapshot. Both the renderer read command and the
 * main-owned runner reuse this so due policy, active-Library derivation, row
 * bounds, and reached-state normalization cannot drift.
 */
export async function loadMainSentinelDuePollSnapshot(
  database: Database,
): Promise<SentinelGetDuePollSnapshotCommandResult> {
  const libraryId = await requireActiveLocalLibraryId(database);
  // Current-time policy intentionally belongs to the main process so neither
  // renderer IPC nor a background runner can inject a stale due cutoff.
  return loadDuePollSnapshot(database, libraryId, Date.now());
}

/** Same scope and bounds as the public task snapshot, without opening IPC. */
export async function loadMainSentinelTaskPollSnapshot(
  database: Database,
  taskId: string,
): Promise<SentinelGetTaskPollSnapshotCommandResult> {
  const libraryId = await requireActiveLocalLibraryId(database);
  return loadTaskPollSnapshot(database, libraryId, { taskId });
}

async function loadSentinelPageSnapshot(
  database: Database,
  libraryId: string,
): Promise<SentinelGetPageSnapshotCommandResult> {
  const taskRows = await database.query<SentinelTaskRow>(
    `SELECT *
     FROM sentinel_tasks
     WHERE library_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [libraryId, MAX_SENTINEL_PAGE_TASKS + 1],
  );
  const tasks = requireBoundedRows(taskRows, MAX_SENTINEL_PAGE_TASKS, "Sentinel page tasks");
  const eventRows = await database.query<SentinelPageEventRow>(
    `SELECT e.id, e.task_id, e.from_state, e.to_state, e.detected_at,
            CASE
              WHEN e.evidence_json IS NULL OR e.evidence_json = '' THEN 'none'
              WHEN length(CAST(e.evidence_json AS BLOB)) > ? THEN 'too_large'
              ELSE 'available'
            END AS evidence_status
     FROM sentinel_events e
     JOIN sentinel_tasks t ON t.id = e.task_id
     WHERE t.library_id = ? AND t.deleted_at IS NULL
     ORDER BY e.task_id, e.detected_at, e.id
     LIMIT ?`,
    [MAX_SENTINEL_EVENT_EVIDENCE_BYTES, libraryId, MAX_SENTINEL_PAGE_EVENTS + 1],
  );
  const events = requireBoundedRows(
    eventRows,
    MAX_SENTINEL_PAGE_EVENTS,
    "Sentinel page events",
  ).map(toSentinelPageEvent);

  return requireBoundedSentinelOutput({
    events,
    tasks: tasks.map(redactPageTaskError),
  });
}

async function loadSentinelEventEvidence(
  database: Database,
  libraryId: string,
  input: SentinelGetEventEvidenceCommandInput,
): Promise<SentinelGetEventEvidenceCommandResult> {
  const statusRows = await database.query<SentinelEventEvidenceStatusRow>(
    `SELECT CASE
              WHEN e.evidence_json IS NULL OR e.evidence_json = '' THEN 'none'
              WHEN length(CAST(e.evidence_json AS BLOB)) > ? THEN 'too_large'
              ELSE 'available'
            END AS evidence_status
     FROM sentinel_events e
     JOIN sentinel_tasks t ON t.id = e.task_id
     WHERE e.id = ? AND t.library_id = ? AND t.deleted_at IS NULL
     LIMIT 1`,
    [MAX_SENTINEL_EVENT_EVIDENCE_BYTES, input.eventId, libraryId],
  );
  const status = sentinelEventEvidenceStatus(statusRows[0]?.evidence_status);
  if (status !== "available") return { evidenceJson: null, status };

  const evidenceRows = await database.query<SentinelEventEvidenceRow>(
    `SELECT e.evidence_json
     FROM sentinel_events e
     JOIN sentinel_tasks t ON t.id = e.task_id
     WHERE e.id = ?
       AND t.library_id = ?
       AND t.deleted_at IS NULL
       AND e.evidence_json IS NOT NULL
       AND e.evidence_json <> ''
     LIMIT 1`,
    [input.eventId, libraryId],
  );
  const evidenceJson = evidenceRows[0]?.evidence_json ?? null;
  if (evidenceJson === null) return { evidenceJson: null, status: "none" };
  if (Buffer.byteLength(evidenceJson, "utf8") > MAX_SENTINEL_EVENT_EVIDENCE_BYTES) {
    return { evidenceJson: null, status: "too_large" };
  }
  return requireBoundedSentinelOutput({ evidenceJson, status: "available" });
}

async function loadDuePollSnapshot(
  database: Database,
  libraryId: string,
  now: number,
): Promise<SentinelGetDuePollSnapshotCommandResult> {
  const taskRows = await database.query<SentinelPollTask>(
    `SELECT id, work_id, doi, title, hint_venue, hint_author, current_state, target_flags,
            error_count, status, updated_at
     FROM sentinel_tasks
     WHERE library_id = ?
       AND status = 'active'
       AND deleted_at IS NULL
       AND next_poll_at <= ?
     ORDER BY next_poll_at, id
     LIMIT ?`,
    [libraryId, now, MAX_SENTINEL_DUE_TASKS + 1],
  );
  const tasks = requireBoundedRows(taskRows, MAX_SENTINEL_DUE_TASKS, "Due Sentinel tasks");
  const reachedStatesByTask = await loadReachedStatesForTasks(
    database,
    libraryId,
    tasks.map((task) => task.id),
  );

  return requireBoundedSentinelOutput({
    libraryId,
    tasks: tasks.map((task) => ({
      reachedStates: reachedStatesByTask.get(task.id) ?? [],
      task,
    })),
  });
}

async function loadTaskPollSnapshot(
  database: Database,
  libraryId: string,
  input: SentinelGetTaskPollSnapshotCommandInput,
): Promise<SentinelGetTaskPollSnapshotCommandResult> {
  const rows = await database.query<SentinelPollTask>(
    `SELECT id, work_id, doi, title, hint_venue, hint_author, current_state, target_flags,
            error_count, status, updated_at
     FROM sentinel_tasks
     WHERE id = ? AND library_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [input.taskId, libraryId],
  );
  const task = rows[0] ?? null;
  // A paused or terminal task remains observable to the caller, but it must
  // never get historic milestones fed into an attempted poll.
  const reachedStates =
    task?.status === "active"
      ? ((await loadReachedStatesForTasks(database, libraryId, [task.id])).get(task.id) ?? [])
      : [];

  return requireBoundedSentinelOutput({ libraryId, reachedStates, task });
}

async function loadReachedStatesForTasks(
  database: Database,
  libraryId: string,
  taskIds: string[],
): Promise<Map<string, SentinelState[]>> {
  if (taskIds.length === 0) return new Map();
  const taskPlaceholders = taskIds.map(() => "?").join(",");
  const statePlaceholders = SENTINEL_STATES.map(() => "?").join(",");
  const rows = await database.query<ReachedStateRow>(
    `SELECT DISTINCT e.task_id, e.to_state
     FROM sentinel_events e
     JOIN sentinel_tasks t ON t.id = e.task_id
     WHERE t.library_id = ?
       AND t.deleted_at IS NULL
       AND e.task_id IN (${taskPlaceholders})
       AND e.to_state IN (${statePlaceholders})
     LIMIT ?`,
    [libraryId, ...taskIds, ...SENTINEL_STATES, MAX_SENTINEL_REACHED_STATE_ROWS + 1],
  );
  requireBoundedRows(rows, MAX_SENTINEL_REACHED_STATE_ROWS, "Sentinel reached states");

  const statesByTask = new Map<string, Set<SentinelState>>();
  for (const row of rows) {
    if (!isSentinelState(row.to_state)) continue;
    const reachedStates = statesByTask.get(row.task_id) ?? new Set<SentinelState>();
    reachedStates.add(row.to_state);
    statesByTask.set(row.task_id, reachedStates);
  }
  return new Map(
    Array.from(statesByTask, ([taskId, reachedStates]) => [
      taskId,
      SENTINEL_STATES.filter((state) => reachedStates.has(state)),
    ]),
  );
}

function redactPageTaskError(task: SentinelTaskRow): SentinelTaskRow {
  return task.last_error === null
    ? task
    : { ...task, last_error: describeSafeError(task.last_error) };
}

function toSentinelPageEvent(row: SentinelPageEventRow) {
  return {
    detected_at: row.detected_at,
    evidenceStatus: sentinelEventEvidenceStatus(row.evidence_status),
    from_state: row.from_state,
    id: row.id,
    task_id: row.task_id,
    to_state: row.to_state,
  };
}

function sentinelEventEvidenceStatus(value: string | undefined): SentinelEventEvidenceStatus {
  if (value === "available" || value === "too_large") return value;
  return "none";
}

function requireBoundedRows<T>(rows: T[], maximum: number, label: string): T[] {
  if (rows.length > maximum) throw new Error(`${label} are limited to ${maximum}`);
  return rows;
}

function requireBoundedSentinelOutput<T>(output: T): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    throw new Error("Sentinel output cannot be serialized");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SENTINEL_OUTPUT_BYTES) {
    throw new Error(`Sentinel output is limited to ${MAX_SENTINEL_OUTPUT_BYTES} bytes`);
  }
  return output;
}

function isSentinelState(value: string): value is SentinelState {
  return (SENTINEL_STATES as readonly string[]).includes(value);
}
