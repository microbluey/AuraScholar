import {
  SentinelRepo,
  type SentinelCreateInput,
  type SentinelCreateResult,
  type SentinelEventRow,
  type SentinelTaskRow,
} from "@aurascholar/db/repos/sentinel";
import { getLibraryDb } from "./aura-db";
import { describeSafeError } from "./sensitive-text";

export type {
  SentinelCreateInput,
  SentinelCreateResult,
  SentinelEventRow,
  SentinelTaskRow,
} from "@aurascholar/db/repos/sentinel";

export type SentinelTaskStatus = "active" | "paused" | "done";

export interface SentinelPageSnapshot {
  eventsByTask: Map<string, SentinelEventRow[]>;
  tasks: SentinelTaskRow[];
}

export type SentinelPageRepository = Pick<
  SentinelRepo,
  "createOrRestore" | "events" | "list" | "restore" | "setStatus" | "softDelete"
>;

export interface SentinelPageDataSource {
  open: () => Promise<SentinelPageRepository>;
}

const defaultDataSource: SentinelPageDataSource = {
  async open() {
    const { db, libraryId } = await getLibraryDb();
    const repository = new SentinelRepo(db, libraryId);
    return {
      createOrRestore: (input) =>
        window.aura.data.command("sentinel.createOrRestore", { ...input, libraryId }),
      events: (taskId) => repository.events(taskId),
      list: () => repository.list(),
      restore: async (taskId) => {
        await window.aura.data.command("sentinel.restore", { libraryId, taskId });
      },
      setStatus: async (taskId, status) => {
        await window.aura.data.command("sentinel.setStatus", { libraryId, status, taskId });
      },
      softDelete: async (taskId) => {
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
): Promise<SentinelPageRepository> {
  throwIfAborted(signal);
  const repository = await dataSource.open();
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

export async function createOrRestoreSentinelTask(
  input: SentinelCreateInput,
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<SentinelCreateResult> {
  const repository = await openRepository(signal, dataSource);
  return repository.createOrRestore(input);
}

export async function setSentinelTaskStatus(
  taskId: string,
  status: SentinelTaskStatus,
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<void> {
  const repository = await openRepository(signal, dataSource);
  await repository.setStatus(taskId, status);
}

export async function deleteSentinelTask(
  taskId: string,
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<void> {
  const repository = await openRepository(signal, dataSource);
  await repository.softDelete(taskId);
}

export async function restoreSentinelTask(
  taskId: string,
  signal?: AbortSignal,
  dataSource: SentinelPageDataSource = defaultDataSource,
): Promise<void> {
  const repository = await openRepository(signal, dataSource);
  await repository.restore(taskId);
}
