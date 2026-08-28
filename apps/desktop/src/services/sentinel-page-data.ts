import {
  type SentinelCreateInput,
  type SentinelCreateResult,
  type SentinelTaskRow,
} from "@aurascholar/db/repos/sentinel";
import type {
  SentinelGetEventEvidenceCommandResult,
  SentinelGetPageSnapshotCommandResult,
  SentinelPageEvent,
} from "../../electron/data-command-contract";
import { getActiveLibraryCommandScope } from "./library-command-scope";
import { describeSafeError } from "./sensitive-text";

export type {
  SentinelCreateInput,
  SentinelCreateResult,
  SentinelTaskRow,
} from "@aurascholar/db/repos/sentinel";
export type { SentinelPageEvent } from "../../electron/data-command-contract";

export type SentinelTaskStatus = "active" | "paused" | "done";
export type SentinelEventEvidenceResult = SentinelGetEventEvidenceCommandResult;

export interface SentinelPageSnapshot {
  eventsByTask: Map<string, SentinelPageEvent[]>;
  tasks: SentinelTaskRow[];
}

/**
 * Renderer-testable façade for the Sentinel page. Production reads use one
 * bounded main-process snapshot; keeping this small interface lets callers
 * retain their existing cancellation and committed-write behavior in tests.
 */
export interface SentinelPageRepository {
  createOrRestore: (input: SentinelCreateInput) => Promise<SentinelCreateResult>;
  events: (taskId: string) => Promise<SentinelPageEvent[]>;
  list: () => Promise<SentinelTaskRow[]>;
  readEvidence: (eventId: string) => Promise<SentinelEventEvidenceResult>;
  restore: (taskId: string) => Promise<void>;
  setStatus: (taskId: string, status: SentinelTaskStatus) => Promise<void>;
  softDelete: (taskId: string) => Promise<void>;
}

export interface SentinelPageDataSource {
  open: (options?: { resolveMutationScope?: boolean }) => Promise<SentinelPageRepository>;
}

const defaultDataSource: SentinelPageDataSource = {
  async open({ resolveMutationScope = false } = {}) {
    // Resolve the mutation scope while the caller's abort fence is still
    // active. Reads intentionally skip it because their main-process command
    // derives the active Library itself.
    const mutationLibraryId = resolveMutationScope ? await getActiveLibraryCommandScope() : null;
    let pageSnapshot: Promise<SentinelGetPageSnapshotCommandResult> | undefined;
    const getPageSnapshot = () =>
      (pageSnapshot ??= window.aura.data.command("sentinel.getPageSnapshot", {}));
    const getLibraryId = () => mutationLibraryId ?? getActiveLibraryCommandScope();
    return {
      createOrRestore: async (input) => {
        const libraryId = await getLibraryId();
        return window.aura.data.command("sentinel.createOrRestore", { ...input, libraryId });
      },
      events: async (taskId) =>
        (await getPageSnapshot()).events.filter((event) => event.task_id === taskId),
      list: async () => (await getPageSnapshot()).tasks,
      readEvidence: async (eventId) =>
        window.aura.data.command("sentinel.getEventEvidence", { eventId }),
      restore: async (taskId) => {
        const libraryId = await getLibraryId();
        await window.aura.data.command("sentinel.restore", { libraryId, taskId });
      },
      setStatus: async (taskId, status) => {
        const libraryId = await getLibraryId();
        await window.aura.data.command("sentinel.setStatus", { libraryId, status, taskId });
      },
      softDelete: async (taskId) => {
        const libraryId = await getLibraryId();
        await window.aura.data.command("sentinel.delete", { libraryId, taskId });
      },
    };
  },
};

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function openRepository(
  signal: AbortSignal | undefined,
  dataSource: SentinelPageDataSource,
  resolveMutationScope = false,
): Promise<SentinelPageRepository> {
  throwIfAborted(signal);
  const repository = await dataSource.open({ resolveMutationScope });
  throwIfAborted(signal);
  return repository;
}

export async function loadSentinelPageSnapshot(
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<SentinelPageSnapshot> {
  const repository = await openRepository(signal, dataSource);
  const tasks = (await repository.list()).map((task) =>
    task.last_error ? { ...task, last_error: describeSafeError(task.last_error) } : task,
  );
  throwIfAborted(signal);
  const eventPairs = await Promise.all(
    tasks.map(async (task) => [task.id, await repository.events(task.id)] as const),
  );
  throwIfAborted(signal);
  return { eventsByTask: new Map(eventPairs), tasks };
}

export async function loadSentinelEventEvidence(
  eventId: string,
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<SentinelEventEvidenceResult> {
  const repository = await openRepository(signal, dataSource);
  const evidence = await repository.readEvidence(eventId);
  throwIfAborted(signal);
  return evidence;
}

export async function createOrRestoreSentinelTask(
  input: SentinelCreateInput,
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<SentinelCreateResult> {
  const repository = await openRepository(signal, dataSource, true);
  return repository.createOrRestore(input);
}

export async function setSentinelTaskStatus(
  taskId: string,
  status: SentinelTaskStatus,
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<void> {
  const repository = await openRepository(signal, dataSource, true);
  await repository.setStatus(taskId, status);
}

export async function deleteSentinelTask(
  taskId: string,
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<void> {
  const repository = await openRepository(signal, dataSource, true);
  await repository.softDelete(taskId);
}

export async function restoreSentinelTask(
  taskId: string,
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<void> {
  const repository = await openRepository(signal, dataSource, true);
  await repository.restore(taskId);
}
