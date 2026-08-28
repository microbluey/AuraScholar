import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOrRestoreSentinelTask,
  deleteSentinelTask,
  loadSentinelEventEvidence,
  loadSentinelPageSnapshot,
  restoreSentinelTask,
  setSentinelTaskStatus,
  type SentinelPageDataSource,
  type SentinelPageEvent,
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

function pageEvent(
  taskId: string,
  id = `event-${taskId}`,
  evidenceStatus: SentinelPageEvent["evidenceStatus"] = "none",
): SentinelPageEvent {
  return {
    detected_at: 2,
    evidenceStatus,
    from_state: "accepted",
    id,
    task_id: taskId,
    to_state: "registered",
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
    readEvidence: vi.fn(async () => ({ evidenceJson: null, status: "none" as const })),
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
      events: vi.fn(async (taskId) => [pageEvent(taskId)]),
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

  it("loads the default page through one typed snapshot command", async () => {
    const first = task("first");
    const second = { ...task("second"), last_error: "Authorization: Bearer secret-token" };
    command.mockResolvedValue({
      events: [
        pageEvent(first.id, "event-first", "available"),
        {
          ...pageEvent(second.id, "event-second", "none"),
          detected_at: 3,
          from_state: "registered",
          to_state: "online",
        },
      ],
      tasks: [first, second],
    });

    const snapshot = await loadSentinelPageSnapshot();

    expect(command.mock.calls).toEqual([["sentinel.getPageSnapshot", {}]]);
    expect(snapshot.tasks).toEqual([first, { ...second, last_error: "Authorization: [redacted]" }]);
    expect(snapshot.eventsByTask.get(first.id)?.map((event) => event.id)).toEqual(["event-first"]);
    expect(snapshot.eventsByTask.get(second.id)?.map((event) => event.id)).toEqual([
      "event-second",
    ]);
  });

  it("reads event evidence only when explicitly requested", async () => {
    command.mockResolvedValue({ evidenceJson: '{"source":"on-demand"}', status: "available" });

    await expect(loadSentinelEventEvidence("event-on-demand")).resolves.toEqual({
      evidenceJson: '{"source":"on-demand"}',
      status: "available",
    });
    expect(command.mock.calls).toEqual([
      ["sentinel.getEventEvidence", { eventId: "event-on-demand" }],
    ]);
  });

  it("does not read evidence when cancellation already won", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(loadSentinelEventEvidence("event-cancelled", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(command).not.toHaveBeenCalled();
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

  it("does not start a default write when cancellation wins during mutation scope resolution", async () => {
    const controller = new AbortController();
    let resolveScope!: (value: { libraryId: string }) => void;
    command.mockImplementation((name: string) => {
      if (name === "library.getScope") {
        return new Promise<{ libraryId: string }>((resolve) => {
          resolveScope = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const pending = createOrRestoreSentinelTask({ title: "Expired" }, controller.signal);
    await Promise.resolve();
    controller.abort();
    resolveScope({ libraryId: "library-1" });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(command.mock.calls).toEqual([["library.getScope", {}]]);
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
    command.mockImplementation((name: string) => {
      if (name === "library.getScope") return Promise.resolve({ libraryId: "library-1" });
      if (name === "sentinel.createOrRestore") return Promise.resolve(result);
      return Promise.resolve(undefined);
    });

    await expect(
      createOrRestoreSentinelTask({ doi: created.doi ?? undefined, title: created.title }),
    ).resolves.toEqual(result);
    await setSentinelTaskStatus(created.id, "paused");
    await deleteSentinelTask(created.id);
    await restoreSentinelTask(created.id);

    expect(command.mock.calls).toEqual([
      ["library.getScope", {}],
      [
        "sentinel.createOrRestore",
        { doi: created.doi, libraryId: "library-1", title: created.title },
      ],
      ["library.getScope", {}],
      ["sentinel.setStatus", { libraryId: "library-1", status: "paused", taskId: created.id }],
      ["library.getScope", {}],
      ["sentinel.delete", { libraryId: "library-1", taskId: created.id }],
      ["library.getScope", {}],
      ["sentinel.restore", { libraryId: "library-1", taskId: created.id }],
    ]);
  });
});
