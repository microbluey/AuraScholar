import { SENTINEL_STATES } from "@aurascholar/core";
import {
  SentinelRepo,
  SentinelTaskInactiveError,
  type SentinelCreateInput,
  type SentinelEventInput,
} from "@aurascholar/db/repos/sentinel";
import type {
  CreateOrRestoreSentinelCommandInput,
  DataCommandOutput,
  DataCommandRequest,
  LinkSentinelWorkCommandInput,
  RecordSentinelCheckCommandInput,
  SentinelTaskCommandInput,
  SetSentinelTaskStatusCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_DOI_LENGTH = 2_048;
const MAX_EVENT_EVIDENCE_JSON_LENGTH = 256 * 1_024;
const MAX_HINT_LENGTH = 512;
const MAX_PERSISTED_ERROR_LENGTH = 16_384;
const MAX_POLL_INTERVAL_SECONDS = 366 * 86_400;
const MAX_SENTINEL_TITLE_LENGTH = 4_096;

type SentinelCommandName =
  | "sentinel.createOrRestore"
  | "sentinel.delete"
  | "sentinel.linkWork"
  | "sentinel.recordCheck"
  | "sentinel.restore"
  | "sentinel.setStatus";

export type SentinelCommandRequest = Extract<DataCommandRequest, { name: SentinelCommandName }>;

export async function executeSentinelCommand(
  request: SentinelCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<SentinelCommandName>> {
  switch (request.name) {
    case "sentinel.createOrRestore": {
      const input = parseCreateOrRestoreInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const { libraryId, ...createInput } = input;
        return new SentinelRepo(database, libraryId).createOrRestore(createInput);
      });
    }
    case "sentinel.delete": {
      const input = parseSentinelTaskInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await new SentinelRepo(database, input.libraryId).softDelete(input.taskId);
        return { updated: 1 };
      });
    }
    case "sentinel.linkWork": {
      const input = parseLinkSentinelWorkInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const committed = await new SentinelRepo(database, input.libraryId).linkWorkIfCurrent(
          input.taskId,
          input.workId,
          input.expectedUpdatedAt,
        );
        return { committed };
      });
    }
    case "sentinel.recordCheck": {
      const input = parseRecordSentinelCheckInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        try {
          const repository = new SentinelRepo(database, input.libraryId);
          const eventIds = await repository.recordCheckWithEvents(input.taskId, input.update);
          const task = await repository.get(input.taskId);
          if (!task) throw new Error("Committed Sentinel task is unavailable");
          return { committed: true, eventIds, updatedAt: task.updated_at };
        } catch (error) {
          if (error instanceof SentinelTaskInactiveError) {
            return { committed: false, eventIds: [], updatedAt: null };
          }
          throw error;
        }
      });
    }
    case "sentinel.restore": {
      const input = parseSentinelTaskInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await new SentinelRepo(database, input.libraryId).restore(input.taskId);
        return { updated: 1 };
      });
    }
    case "sentinel.setStatus": {
      const input = parseSetSentinelTaskStatusInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await new SentinelRepo(database, input.libraryId).setStatus(input.taskId, input.status);
        return { updated: 1 };
      });
    }
  }
}

function parseCreateOrRestoreInput(value: unknown): CreateOrRestoreSentinelCommandInput {
  if (!isRecord(value)) throw new Error("Invalid sentinel.createOrRestore input");
  return {
    doi: optionalBoundedText(value.doi, "DOI", MAX_DOI_LENGTH, true),
    hintAuthor: optionalBoundedText(value.hintAuthor, "Author hint", MAX_HINT_LENGTH) ?? undefined,
    hintVenue: optionalBoundedText(value.hintVenue, "Venue hint", MAX_HINT_LENGTH) ?? undefined,
    libraryId: requireRecordId(value.libraryId, "Library id"),
    targets: parseSentinelTargets(value.targets),
    title: boundedText(value.title, "Sentinel title", MAX_SENTINEL_TITLE_LENGTH),
    workId: value.workId === undefined ? undefined : requireRecordId(value.workId, "Work id"),
  };
}

function parseSentinelTaskInput(
  value: unknown,
  commandName: "sentinel.delete" | "sentinel.restore",
): SentinelTaskCommandInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    taskId: requireRecordId(value.taskId, "Sentinel task id"),
  };
}

function parseLinkSentinelWorkInput(value: unknown): LinkSentinelWorkCommandInput {
  if (!isRecord(value)) throw new Error("Invalid sentinel.linkWork input");
  return {
    expectedUpdatedAt: requireExpectedUpdatedAt(value.expectedUpdatedAt),
    libraryId: requireRecordId(value.libraryId, "Library id"),
    taskId: requireRecordId(value.taskId, "Sentinel task id"),
    workId: requireRecordId(value.workId, "Work id"),
  };
}

function parseRecordSentinelCheckInput(value: unknown): RecordSentinelCheckCommandInput {
  if (!isRecord(value) || !isRecord(value.update)) {
    throw new Error("Invalid sentinel.recordCheck input");
  }
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    taskId: requireRecordId(value.taskId, "Sentinel task id"),
    update: parseSentinelCheckUpdate(value.update),
  };
}

function parseSetSentinelTaskStatusInput(value: unknown): SetSentinelTaskStatusCommandInput {
  if (!isRecord(value)) throw new Error("Invalid sentinel.setStatus input");
  const input = {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    taskId: requireRecordId(value.taskId, "Sentinel task id"),
  };
  if (value.status !== "active" && value.status !== "paused" && value.status !== "done") {
    throw new Error("Sentinel task status is invalid");
  }
  return { ...input, status: value.status };
}

function parseSentinelCheckUpdate(
  value: Record<string, unknown>,
): RecordSentinelCheckCommandInput["update"] {
  if (
    !Number.isSafeInteger(value.nextPollS) ||
    (value.nextPollS as number) <= 0 ||
    (value.nextPollS as number) > MAX_POLL_INTERVAL_SECONDS
  ) {
    throw new Error("Sentinel poll interval is invalid");
  }
  if (typeof value.errored !== "boolean") {
    throw new Error("Sentinel check error state must be a boolean");
  }
  const update: RecordSentinelCheckCommandInput["update"] = {
    errored: value.errored,
    expectedUpdatedAt: requireExpectedUpdatedAt(value.expectedUpdatedAt),
    nextPollS: value.nextPollS as number,
  };
  if (value.newState !== undefined) update.newState = requireSentinelState(value.newState);
  if (value.error !== undefined) {
    update.error = optionalCheckText(
      value.error,
      "Sentinel check error",
      MAX_PERSISTED_ERROR_LENGTH,
    );
  }
  if (value.done !== undefined) {
    if (typeof value.done !== "boolean") throw new Error("Sentinel done state must be a boolean");
    update.done = value.done;
  }
  if (value.doi !== undefined) {
    update.doi = optionalCheckDoi(value.doi);
  }
  if (value.events !== undefined) update.events = parseSentinelEvents(value.events);
  return update;
}

function requireExpectedUpdatedAt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Expected Sentinel task revision is invalid");
  }
  return value as number;
}

function parseSentinelEvents(value: unknown): SentinelEventInput[] {
  if (!Array.isArray(value) || value.length > SENTINEL_STATES.length) {
    throw new Error("Sentinel check events are invalid");
  }
  return value.map((event, index) => {
    if (!isRecord(event)) throw new Error(`Sentinel event at index ${index} is invalid`);
    return {
      evidence: normalizeEventEvidence(event.evidence, index),
      fromState: requireSentinelState(event.fromState),
      toState: requireSentinelState(event.toState),
    };
  });
}

function normalizeEventEvidence(value: unknown, index: number): unknown {
  if (value === undefined || value === null) return null;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`Sentinel event evidence at index ${index} is not valid JSON`);
  }
  if (serialized === undefined) {
    throw new Error(`Sentinel event evidence at index ${index} is not valid JSON`);
  }
  if (serialized.length > MAX_EVENT_EVIDENCE_JSON_LENGTH) {
    throw new Error(`Sentinel event evidence at index ${index} is too large`);
  }
  return JSON.parse(serialized) as unknown;
}

function requireSentinelState(value: unknown): string {
  const allowed = SENTINEL_STATES as readonly string[];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error("Sentinel state is invalid");
  }
  return value;
}

function optionalCheckText(value: unknown, label: string, maxLength: number): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  if (value.length > maxLength) throw new Error(`${label} is too long`);
  return value;
}

function optionalCheckDoi(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("DOI is invalid");
  const doi = value.trim();
  if (!doi) return null;
  if (doi.length > MAX_DOI_LENGTH) throw new Error("DOI is too long");
  return doi;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label} is too long`);
  return text;
}

function optionalBoundedText(
  value: unknown,
  label: string,
  maxLength: number,
  emptyAsNull = false,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return emptyAsNull ? null : undefined;
  return boundedText(value, label, maxLength);
}

function parseSentinelTargets(value: unknown): SentinelCreateInput["targets"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Sentinel targets must be an array");
  const allowed = SENTINEL_STATES as readonly string[];
  const targets = value.map((target) => {
    if (typeof target !== "string" || !allowed.includes(target)) {
      throw new Error("Sentinel target is invalid");
    }
    return target;
  });
  if (new Set(targets).size !== targets.length) {
    throw new Error("Sentinel targets must be unique");
  }
  return targets;
}
