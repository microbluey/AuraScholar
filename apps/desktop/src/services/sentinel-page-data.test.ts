import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLibraryDb: vi.fn(),
}));

vi.mock("./aura-db", () => ({
  getLibraryDb: mocks.getLibraryDb,
}));

import {
  createOrRestoreSentinelTask,
  deleteSentinelTask,
  loadSentinelPageSnapshot,
  restoreSentinelTask,
  setSentinelTaskStatus,
  type SentinelPageDataSource,
  type SentinelPageRepository,
  type SentinelTaskRow,
} from "./sentinel-page-data";

function task(id: string): SentinelTaskRow {
  return {
    id,
    library_id: "library-1",
    work_id: null,
    doi: `10.1000/${id}`,
    title: `Task ${id}`,
    hint_venue: null,
    hint_author: null,
    current_state: "accepted",
    target_flags: null,
    poll_interval_s: 86_400,
    next_poll_at: 1,
    last_polled_at: null,
    error_count: 0,
    last_error: null,
    status: "active",
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
  };
}

function repository(overrides: Partial<SentinelPageRepository> = {}): SentinelPageRepository {
  return {
    createOrRestore: vi.fn(async (input) => {
      const created = task("created");
      return {
        id: created.id,
        status: "created" as const,
        task: { ...created, title: input.title },
      };
    }),
    events: vi.fn(async () => []),
    list: vi.fn(async () => []),
    restore: vi.fn(async () => undefined),
    setStatus: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => undefined),
    ...overrides,
  };
}

function dataSource(repo: SentinelPageRepository): SentinelPageDataSource {
  return { open: vi.fn(async () => repo) };
}

describe("sentinel page data gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLibraryDb.mockResolvedValue({ db: {}, libraryId: "library-1" });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
  });

  it("loads tasks and their evidence with one repository scope", async () => {
    const first = task("first");
    const second = { ...task("second"), last_error: "Authorization: Bearer secret-token" };
    const repo = repository({
      list: vi.fn(async () => [first, second]),
      events: vi.fn(async (taskId) => [
        {
          id: `event-${taskId}`,
          task_id: taskId,
          from_state: "accepted",
          to_state: "registered",
          evidence_json: null,
          detected_at: 2,
          notified_at: null,
        },
      ]),
    });
    const source = dataSource(repo);

    const snapshot = await loadSentinelPageSnapshot(undefined, source);

    expect(source.open).toHaveBeenCalledTimes(1);
    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(repo.events).toHaveBeenCalledTimes(2);
    expect(snapshot.tasks).toEqual([first, { ...second, last_error: "Authorization: [redacted]" }]);
    expect(snapshot.eventsByTask.get("first")?.[0]?.id).toBe("event-first");
    expect(snapshot.eventsByTask.get("second")?.[0]?.id).toBe("event-second");
  });

  it("does not open the repository when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = dataSource(repository());

    await expect(loadSentinelPageSnapshot(controller.signal, source)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(source.open).not.toHaveBeenCalled();
  });

  it("stops a stale snapshot before loading evidence", async () => {
    const controller = new AbortController();
    const repo = repository({
      list: vi.fn(async () => {
        controller.abort();
        return [task("stale")];
      }),
    });

    await expect(
      loadSentinelPageSnapshot(controller.signal, dataSource(repo)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(repo.events).not.toHaveBeenCalled();
  });

  it("does not start a write when the scope expires while opening the repository", async () => {
    const controller = new AbortController();
    const repo = repository();
    const source: SentinelPageDataSource = {
      open: vi.fn(async () => {
        controller.abort();
        return repo;
      }),
    };

    await expect(
      createOrRestoreSentinelTask({ title: "Expired" }, controller.signal, source),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(repo.createOrRestore).not.toHaveBeenCalled();
  });

  it("returns a committed create result even when cancellation happens during the write", async () => {
    const controller = new AbortController();
    const created = task("committed");
    const result = { id: created.id, status: "created" as const, task: created };
    const repo = repository({
      createOrRestore: vi.fn(async () => {
        controller.abort();
        return result;
      }),
    });

    await expect(
      createOrRestoreSentinelTask({ title: created.title }, controller.signal, dataSource(repo)),
    ).resolves.toEqual(result);
  });

  it("preserves committed status, delete, and restore writes after cancellation", async () => {
    for (const operation of [
      (signal: AbortSignal, source: SentinelPageDataSource) =>
        setSentinelTaskStatus("task-1", "paused", signal, source),
      (signal: AbortSignal, source: SentinelPageDataSource) =>
        deleteSentinelTask("task-1", signal, source),
      (signal: AbortSignal, source: SentinelPageDataSource) =>
        restoreSentinelTask("task-1", signal, source),
    ]) {
      const controller = new AbortController();
      const abortOnCommit = vi.fn(async () => {
        controller.abort();
      });
      const repo = repository({
        restore: abortOnCommit,
        setStatus: abortOnCommit,
        softDelete: abortOnCommit,
      });

      await expect(operation(controller.signal, dataSource(repo))).resolves.toBeUndefined();
    }
  });

  it("routes default writes through typed main-process commands", async () => {
    const created = task("command-created");
    const result = { id: created.id, status: "created" as const, task: created };
    command.mockResolvedValueOnce(result);
    command.mockResolvedValue(undefined);

    await expect(
      createOrRestoreSentinelTask({ doi: created.doi ?? undefined, title: created.title }),
    ).resolves.toEqual(result);
    await setSentinelTaskStatus(created.id, "paused");
    await deleteSentinelTask(created.id);
    await restoreSentinelTask(created.id);

    expect(command.mock.calls).toEqual([
      [
        "sentinel.createOrRestore",
        { doi: created.doi, libraryId: "library-1", title: created.title },
      ],
      ["sentinel.setStatus", { libraryId: "library-1", status: "paused", taskId: created.id }],
      ["sentinel.delete", { libraryId: "library-1", taskId: created.id }],
      ["sentinel.restore", { libraryId: "library-1", taskId: created.id }],
    ]);
  });
});
