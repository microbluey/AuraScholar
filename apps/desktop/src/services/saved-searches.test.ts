import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverySource } from "@aurascholar/core";
import type { SavedSearchReadRow } from "../../electron/data-command-contract";
import type { DiscoverySearchReportWithLibrary } from "./discovery";
import {
  createSavedSearchService,
  type SavedSearchReadRepository,
  type SavedSearchServiceDependencies,
  type SavedSearchWriteGateway,
} from "./saved-searches";

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function savedSearch(overrides: Partial<SavedSearchReadRow> = {}): SavedSearchReadRow {
  return {
    id: "saved-1",
    query: "retrieval augmented generation",
    sources_json: JSON.stringify(["openalex"]),
    new_count: 0,
    last_run_at: 50,
    last_error: null,
    updated_at: 71,
    deleted_at: null,
    ...overrides,
    criteria_json: overrides.criteria_json ?? null,
  };
}

function discoveryReport(
  dois: string[] = ["10.1000/new"],
  status: "done" | "empty" | "timeout" | "error" | "rate_limited" | "aborted" = "done",
): DiscoverySearchReportWithLibrary {
  const sources = ["arxiv", "crossref", "openalex", "s2"] as const;
  return {
    cursors: Object.fromEntries(
      sources.map((source) => [source, { hasMore: false, page: 1 }]),
    ) as DiscoverySearchReportWithLibrary["cursors"],
    results: dois.map((doi, index) => ({
      id: `result-${index}`,
      inLibrary: false,
      matchedSources: ["openalex" as DiscoverySource],
      score: 100 - index,
      source: "openalex" as const,
      work: {
        authors: [],
        doi,
        source: "openalex" as const,
        title: `Result ${index}`,
        type: "article" as const,
      },
    })),
    sources: Object.fromEntries(
      sources.map((source) => [
        source,
        {
          count: source === "openalex" ? dois.length : 0,
          source,
          status: source === "openalex" ? status : "empty",
        },
      ]),
    ) as DiscoverySearchReportWithLibrary["sources"],
  };
}

function writeGateway(overrides: Partial<SavedSearchWriteGateway> = {}): SavedSearchWriteGateway {
  return {
    clearNew: vi.fn(async () => ({ updated: 1 })),
    create: vi.fn(async () => ({ created: false, id: "saved-1" })),
    delete: vi.fn(async () => ({ updated: 1 })),
    recordError: vi.fn(async () => ({ committed: true, updatedAt: 73 })),
    recordRun: vi.fn(async () => ({ committed: true, freshCount: 1, updatedAt: 72 })),
    restore: vi.fn(async () => ({ updated: 1 })),
    ...overrides,
  };
}

function dependencies(
  options: {
    due?: SavedSearchReadRow[];
    list?: SavedSearchReadRow[];
    overrides?: Partial<SavedSearchServiceDependencies>;
    repository?: SavedSearchReadRepository;
    writes?: SavedSearchWriteGateway;
  } = {},
): SavedSearchServiceDependencies {
  const list = options.list ?? [savedSearch()];
  const repository: SavedSearchReadRepository = options.repository ?? {
    due: vi.fn(async () => options.due ?? list),
    get: vi.fn(async (id) => list.find((row) => row.id === id) ?? null),
    list: vi.fn(async () => list),
  };
  return {
    clearTimer: vi.fn(),
    dispatchUpdated: vi.fn(),
    loopIntervalMs: 60,
    nextRunDelayMs: 1_000,
    notify: vi.fn(async () => undefined),
    now: vi.fn(() => 1_000),
    onLoopError: vi.fn(),
    openScope: vi.fn(async () => ({ libraryId: "library-1", repository })),
    schedule: vi.fn((callback) => globalThis.setTimeout(callback, 60)),
    search: vi.fn(async () => discoveryReport()),
    writes: options.writes ?? writeGateway(),
    ...options.overrides,
  };
}

describe("saved-search polling service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps HTTP outside the command and commits observed ids against the read revision", async () => {
    const order: string[] = [];
    const writes = writeGateway({
      recordRun: vi.fn(async (input) => {
        order.push("recordRun");
        expect(input).toEqual({
          expectedUpdatedAt: 71,
          libraryId: "library-1",
          nextRunAt: 2_000,
          observedIds: ["doi:10.1000/new"],
          savedSearchId: "saved-1",
        });
        return { committed: true, freshCount: 2, updatedAt: 72 };
      }),
    });
    const deps = dependencies({
      overrides: {
        dispatchUpdated: vi.fn(() => order.push("event")),
        notify: vi.fn(async () => {
          order.push("notify");
        }),
        search: vi.fn(async (_query, _sources, signal) => {
          expect(signal.aborted).toBe(false);
          order.push("search");
          return discoveryReport();
        }),
      },
      writes,
    });

    await expect(createSavedSearchService(deps).run("saved-1")).resolves.toBe(2);

    expect(order).toEqual(["search", "recordRun", "event", "notify"]);
    expect(writes.recordError).not.toHaveBeenCalled();
  });

  it("coalesces a manual check and a due cycle for the same Library row", async () => {
    const pendingSearch = deferred<DiscoverySearchReportWithLibrary>();
    const writes = writeGateway({
      recordRun: vi.fn(async () => ({ committed: true, freshCount: 3, updatedAt: 72 })),
    });
    const deps = dependencies({
      due: [savedSearch()],
      overrides: {
        search: vi.fn(() => pendingSearch.promise),
      },
      writes,
    });
    const service = createSavedSearchService(deps);

    const manual = service.run("saved-1");
    const due = service.runDue();
    await vi.waitFor(() => expect(deps.search).toHaveBeenCalledTimes(1));
    pendingSearch.resolve(discoveryReport());

    await expect(Promise.all([manual, due])).resolves.toEqual([3, 3]);
    expect(deps.search).toHaveBeenCalledTimes(1);
    expect(writes.recordRun).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it("lets a coalesced caller cancel its own wait without aborting the shared poll", async () => {
    const pendingSearch = deferred<DiscoverySearchReportWithLibrary>();
    const joiningList = deferred<SavedSearchReadRow[]>();
    const row = savedSearch();
    let listCalls = 0;
    const observation: { signal?: AbortSignal } = {};
    const repository: SavedSearchReadRepository = {
      due: vi.fn(async () => [row]),
      get: vi.fn(async () => row),
      list: vi.fn(() => {
        listCalls += 1;
        return listCalls === 1 ? Promise.resolve([row]) : joiningList.promise;
      }),
    };
    const writes = writeGateway({
      recordRun: vi.fn(async () => ({ committed: true, freshCount: 3, updatedAt: 72 })),
    });
    const deps = dependencies({
      overrides: {
        search: vi.fn((_query, _sources, signal) => {
          observation.signal = signal;
          return pendingSearch.promise;
        }),
      },
      repository,
      writes,
    });
    const service = createSavedSearchService(deps);

    const survivor = service.run("saved-1", { silent: true });
    await vi.waitFor(() => expect(deps.search).toHaveBeenCalledTimes(1));
    const caller = new AbortController();
    const cancelled = service.run("saved-1", { signal: caller.signal });
    await vi.waitFor(() => expect(repository.list).toHaveBeenCalledTimes(2));
    joiningList.resolve([row]);
    await Promise.resolve();
    caller.abort();

    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(observation.signal?.aborted).toBe(false);

    pendingSearch.resolve(discoveryReport());
    await expect(survivor).resolves.toBe(3);
    expect(deps.search).toHaveBeenCalledTimes(1);
    expect(writes.recordRun).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it("does not let a stopped loop cancel a manual poll that it joined", async () => {
    const pendingSearch = deferred<DiscoverySearchReportWithLibrary>();
    const joiningRow = deferred<SavedSearchReadRow | null>();
    const row = savedSearch();
    const observation: { signal?: AbortSignal } = {};
    const repository: SavedSearchReadRepository = {
      due: vi.fn(async () => [row]),
      get: vi.fn(() => joiningRow.promise),
      list: vi.fn(async () => [row]),
    };
    const deps = dependencies({
      overrides: {
        search: vi.fn((_query, _sources, signal) => {
          observation.signal = signal;
          return pendingSearch.promise;
        }),
      },
      repository,
    });
    const service = createSavedSearchService(deps);

    const manual = service.run("saved-1", { silent: true });
    await vi.waitFor(() => expect(deps.search).toHaveBeenCalledTimes(1));
    const stop = service.startLoop();
    await vi.waitFor(() => expect(repository.get).toHaveBeenCalledTimes(1));
    joiningRow.resolve(row);
    await Promise.resolve();
    stop();

    expect(observation.signal?.aborted).toBe(false);
    pendingSearch.resolve(discoveryReport());
    await expect(manual).resolves.toBe(1);
    expect(deps.search).toHaveBeenCalledTimes(1);
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it("keeps each coalesced caller's error policy", async () => {
    const pendingSearch = deferred<DiscoverySearchReportWithLibrary>();
    const order: string[] = [];
    const writes = writeGateway({
      recordError: vi.fn(async (input) => {
        order.push("recordError");
        expect(input).toEqual({
          error: "OpenAlex offline",
          expectedUpdatedAt: 71,
          libraryId: "library-1",
          nextRunAt: 2_000,
          savedSearchId: "saved-1",
        });
        return { committed: true, updatedAt: 72 };
      }),
    });
    const deps = dependencies({
      due: [savedSearch()],
      overrides: {
        dispatchUpdated: vi.fn(() => order.push("event")),
        search: vi.fn(() => {
          order.push("search");
          return pendingSearch.promise;
        }),
      },
      writes,
    });
    const service = createSavedSearchService(deps);

    const background = service.runDue();
    const manual = service.run("saved-1");
    await vi.waitFor(() => expect(deps.search).toHaveBeenCalledTimes(1));
    pendingSearch.reject(new Error("OpenAlex offline"));

    await expect(background).resolves.toBe(0);
    await expect(manual).rejects.toThrow("OpenAlex offline");
    expect(writes.recordError).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["search", "recordError", "event"]);
  });

  it("treats stale success and error commits as no-ops without events or notifications", async () => {
    const successWrites = writeGateway({
      recordRun: vi.fn(async () => ({ committed: false, freshCount: 9, updatedAt: null })),
    });
    const successDeps = dependencies({ writes: successWrites });

    await expect(createSavedSearchService(successDeps).run("saved-1")).resolves.toBe(0);
    expect(successDeps.dispatchUpdated).not.toHaveBeenCalled();
    expect(successDeps.notify).not.toHaveBeenCalled();

    const errorWrites = writeGateway({
      recordError: vi.fn(async () => ({ committed: false, updatedAt: null })),
    });
    const errorDeps = dependencies({
      overrides: {
        search: vi.fn(async () => {
          throw new Error("stale failure");
        }),
      },
      writes: errorWrites,
    });

    await expect(createSavedSearchService(errorDeps).run("saved-1")).resolves.toBe(0);
    expect(errorDeps.dispatchUpdated).not.toHaveBeenCalled();
    expect(errorDeps.notify).not.toHaveBeenCalled();
  });

  it("keeps committed poll state successful when OS notification delivery fails", async () => {
    const deps = dependencies({
      overrides: {
        notify: vi.fn(async () => {
          throw new Error("notification unavailable");
        }),
      },
      writes: writeGateway({
        recordRun: vi.fn(async () => ({ committed: true, freshCount: 1, updatedAt: 72 })),
      }),
    });

    await expect(createSavedSearchService(deps).run("saved-1")).resolves.toBe(1);
    expect(deps.dispatchUpdated).toHaveBeenCalledTimes(1);
  });

  it("routes create, delete, restore, and badge writes through the write gateway", async () => {
    const order: string[] = [];
    const writes = writeGateway({
      clearNew: vi.fn(async () => {
        order.push("clear");
        return { updated: 1 };
      }),
      create: vi.fn(async () => {
        order.push("create");
        return { created: false, id: "saved-existing" };
      }),
      delete: vi.fn(async () => {
        order.push("delete");
        return { updated: 1 };
      }),
      restore: vi.fn(async () => {
        order.push("restore");
        return { updated: 1 };
      }),
    });
    const service = createSavedSearchService(dependencies({ writes }));

    await expect(
      service.create({ text: "  Retrieval   Augmented Generation  " }, [
        "openalex",
        "crossref",
        "s2",
        "arxiv",
      ]),
    ).resolves.toEqual({ created: false, id: "saved-existing" });
    await service.delete("saved-1");
    await service.restore("saved-1");
    await service.clearBadge("saved-1");

    expect(order).toEqual(["create", "delete", "restore", "clear"]);
    expect(writes.create).toHaveBeenCalledWith({
      libraryId: "library-1",
      query: "Retrieval Augmented Generation",
      criteria: { text: "Retrieval Augmented Generation" },
      sources: null,
    });
  });

  it("evicts an aborted generation so delete, restore, and rerun cannot join stale work", async () => {
    const oldSearch = deferred<DiscoverySearchReportWithLibrary>();
    const newSearch = deferred<DiscoverySearchReportWithLibrary>();
    const row = savedSearch();
    const oldPoll: { signal?: AbortSignal } = {};
    const writes = writeGateway({
      delete: vi.fn(async () => {
        row.deleted_at = 1_001;
        row.updated_at = 72;
        return { updated: 1 };
      }),
      recordRun: vi.fn(async (input) => {
        expect(input.expectedUpdatedAt).toBe(73);
        return { committed: true, freshCount: 2, updatedAt: 74 };
      }),
      restore: vi.fn(async () => {
        row.deleted_at = null;
        row.updated_at = 73;
        return { updated: 1 };
      }),
    });
    const deps = dependencies({
      list: [row],
      overrides: {
        search: vi
          .fn()
          .mockImplementationOnce((_query, _sources, signal: AbortSignal) => {
            oldPoll.signal = signal;
            return oldSearch.promise;
          })
          .mockImplementationOnce(() => newSearch.promise),
      },
      writes,
    });
    const service = createSavedSearchService(deps);

    const staleRun = service.run("saved-1");
    await vi.waitFor(() => expect(deps.search).toHaveBeenCalledTimes(1));
    await service.delete("saved-1");
    expect(oldPoll.signal?.aborted).toBe(true);
    await service.restore("saved-1");

    const currentRun = service.run("saved-1");
    await vi.waitFor(() => expect(deps.search).toHaveBeenCalledTimes(2));
    newSearch.resolve(discoveryReport());
    await expect(currentRun).resolves.toBe(2);

    oldSearch.resolve(discoveryReport(["10.1000/stale"]));
    await expect(staleRun).resolves.toBe(0);
    expect(writes.recordRun).toHaveBeenCalledTimes(1);
    expect(deps.dispatchUpdated).toHaveBeenCalledTimes(1);
  });

  it("skips a queued due snapshot invalidated by delete and restore", async () => {
    const activeSearch = deferred<DiscoverySearchReportWithLibrary>();
    const first = savedSearch({
      id: "saved-active",
      query: "active queued search",
      updated_at: 71,
    });
    const queued = savedSearch({
      id: "saved-queued",
      query: "invalidated queued search",
      updated_at: 81,
    });
    let currentQueued = queued;
    const repository: SavedSearchReadRepository = {
      due: vi.fn(async () => [first, queued]),
      get: vi.fn(async (id) => {
        if (id === first.id) return first;
        return id === currentQueued.id ? currentQueued : null;
      }),
      list: vi.fn(async () => [first, currentQueued]),
    };
    const writes = writeGateway({
      delete: vi.fn(async () => {
        currentQueued = { ...currentQueued, deleted_at: 1_001, updated_at: 82 };
        return { updated: 1 };
      }),
      recordRun: vi.fn(async (input) => {
        if (input.savedSearchId === first.id) {
          return { committed: true, freshCount: 1, updatedAt: 72 };
        }
        expect(input.savedSearchId).toBe(queued.id);
        expect(input.expectedUpdatedAt).toBe(83);
        return { committed: true, freshCount: 2, updatedAt: 84 };
      }),
      restore: vi.fn(async () => {
        currentQueued = { ...currentQueued, deleted_at: null, updated_at: 83 };
        return { updated: 1 };
      }),
    });
    const deps = dependencies({
      overrides: {
        search: vi.fn((query) =>
          query.text === first.query ? activeSearch.promise : Promise.resolve(discoveryReport()),
        ),
      },
      repository,
      writes,
    });
    const service = createSavedSearchService(deps);

    const due = service.runDue();
    await vi.waitFor(() => expect(deps.search).toHaveBeenCalledTimes(1));
    await service.delete(queued.id);
    await service.restore(queued.id);
    activeSearch.resolve(discoveryReport());

    await expect(due).resolves.toBe(1);
    expect(deps.search).toHaveBeenCalledTimes(1);

    await expect(service.run(queued.id)).resolves.toBe(2);
    expect(deps.search).toHaveBeenCalledTimes(2);
    expect(writes.recordRun).toHaveBeenCalledTimes(2);
  });

  it("suppresses stale UI side effects when deletion wins after a poll commit starts", async () => {
    const pendingCommit = deferred<{ committed: boolean; freshCount: number; updatedAt: number }>();
    const writes = writeGateway({
      recordRun: vi.fn(() => pendingCommit.promise),
    });
    const deps = dependencies({ writes });
    const service = createSavedSearchService(deps);

    const poll = service.run("saved-1");
    await vi.waitFor(() => expect(writes.recordRun).toHaveBeenCalledTimes(1));
    await service.delete("saved-1");
    pendingCommit.resolve({ committed: true, freshCount: 2, updatedAt: 72 });

    await expect(poll).resolves.toBe(0);
    expect(deps.dispatchUpdated).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("schedules the next cycle only after completion and clears it on stop", async () => {
    const pendingSearch = deferred<DiscoverySearchReportWithLibrary>();
    let scheduledCallback: (() => void) | null = null;
    const timer = 42 as unknown as ReturnType<typeof globalThis.setTimeout>;
    const deps = dependencies({
      due: [savedSearch()],
      overrides: {
        schedule: vi.fn((callback) => {
          scheduledCallback = callback;
          return timer;
        }),
        search: vi.fn(() => pendingSearch.promise),
      },
    });
    const service = createSavedSearchService(deps);

    const stop = service.startLoop();
    await vi.waitFor(() => expect(deps.search).toHaveBeenCalledTimes(1));
    expect(deps.schedule).not.toHaveBeenCalled();

    pendingSearch.resolve(discoveryReport());
    await vi.waitFor(() => expect(deps.schedule).toHaveBeenCalledTimes(1));
    expect(scheduledCallback).not.toBeNull();

    stop();
    expect(deps.clearTimer).toHaveBeenCalledWith(timer);
  });

  it("aborts an active scheduled search without recording a polling error", async () => {
    let observedSignal: AbortSignal | null = null;
    const writes = writeGateway();
    const deps = dependencies({
      due: [savedSearch()],
      overrides: {
        search: vi.fn(
          (_query, _sources, signal) =>
            new Promise<DiscoverySearchReportWithLibrary>((_resolve, reject) => {
              observedSignal = signal;
              signal.addEventListener(
                "abort",
                () => reject(new DOMException("Stopped", "AbortError")),
                { once: true },
              );
            }),
        ),
      },
      writes,
    });
    const service = createSavedSearchService(deps);

    const stop = service.startLoop();
    await vi.waitFor(() => expect(observedSignal).not.toBeNull());
    stop();
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));

    expect(writes.recordError).not.toHaveBeenCalled();
    expect(deps.schedule).not.toHaveBeenCalled();
  });
});
