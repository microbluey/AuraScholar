import { describe, expect, it, vi } from "vitest";
import { createLibraryRefreshController } from "./library-refresh-controller";
import {
  createLibraryRouteRequest,
  ownsLibraryRouteRequest,
  type LibraryRouteRequest,
} from "./library-workspace-state";

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

function setup(load: (query: string) => Promise<string>) {
  let query = "first";
  const apply = vi.fn();
  const loadSpy = vi.fn(load);
  const reportFailure = vi.fn();
  const controller = createLibraryRefreshController({
    getQuery: () => query,
    load: loadSpy,
    apply,
    reportFailure,
  });
  return {
    apply,
    controller,
    load: loadSpy,
    reportFailure,
    setQuery: (next: string) => {
      query = next;
    },
  };
}

interface RouteRefreshQuery {
  routeKey: string | null;
  routeWorkId: string | null;
}

function routeQuery(request: LibraryRouteRequest | null): RouteRefreshQuery {
  return {
    routeKey: request?.key ?? null,
    routeWorkId: request?.workId ?? null,
  };
}

function isSameRouteQuery(left: RouteRefreshQuery, right: RouteRefreshQuery): boolean {
  return left.routeKey === right.routeKey && left.routeWorkId === right.routeWorkId;
}

describe("LibraryRefreshController", () => {
  it("ignores an old success and makes every waiter observe the newest failure", async () => {
    const oldLoad = deferred<string>();
    const newestLoad = deferred<string>();
    const state = setup((query) => (query === "first" ? oldLoad.promise : newestLoad.promise));
    state.controller.start();

    const first = state.controller.refresh();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledWith("first"));
    state.setQuery("newest");
    const merged = state.controller.refresh();
    expect(merged).toBe(first);

    oldLoad.resolve("stale data");
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledWith("newest"));
    expect(state.apply).not.toHaveBeenCalled();
    const failure = new Error("newest failed");
    newestLoad.reject(failure);

    await expect(first).resolves.toEqual({ status: "failed", query: "newest", error: failure });
    await expect(merged).resolves.toEqual({ status: "failed", query: "newest", error: failure });
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.reportFailure).toHaveBeenCalledOnce();
    expect(state.reportFailure).toHaveBeenCalledWith(failure, "newest");
  });

  it("ignores an old failure when the newest trailing query succeeds", async () => {
    const oldLoad = deferred<string>();
    const newestLoad = deferred<string>();
    const state = setup((query) => (query === "first" ? oldLoad.promise : newestLoad.promise));
    state.controller.start();

    const first = state.controller.refresh();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledOnce());
    state.setQuery("newest");
    const merged = state.controller.refresh();
    oldLoad.reject(new Error("stale failure"));
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledTimes(2));
    expect(state.reportFailure).not.toHaveBeenCalled();

    newestLoad.resolve("fresh data");
    const expected = { status: "applied", query: "newest", data: "fresh data" };
    await expect(first).resolves.toEqual(expected);
    await expect(merged).resolves.toEqual(expected);
    expect(state.apply).toHaveBeenCalledOnce();
    expect(state.apply).toHaveBeenCalledWith("fresh data", "newest");
    expect(state.reportFailure).not.toHaveBeenCalled();
  });

  it("detects a newer query after an old success without another refresh call", async () => {
    const oldLoad = deferred<string>();
    const newestLoad = deferred<string>();
    const state = setup((query) => (query === "first" ? oldLoad.promise : newestLoad.promise));
    state.controller.start();

    const refresh = state.controller.refresh();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledWith("first"));
    state.setQuery("newest");
    oldLoad.resolve("stale data");

    await vi.waitFor(() => expect(state.load).toHaveBeenCalledWith("newest"));
    expect(state.apply).not.toHaveBeenCalled();
    newestLoad.resolve("fresh data");
    await expect(refresh).resolves.toEqual({
      status: "applied",
      query: "newest",
      data: "fresh data",
    });
    expect(state.apply).toHaveBeenCalledOnce();
    expect(state.apply).toHaveBeenCalledWith("fresh data", "newest");
  });

  it("detects a newer query after an old failure without reporting the stale failure", async () => {
    const oldLoad = deferred<string>();
    const newestLoad = deferred<string>();
    const state = setup((query) => (query === "first" ? oldLoad.promise : newestLoad.promise));
    state.controller.start();

    const refresh = state.controller.refresh();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledWith("first"));
    state.setQuery("newest");
    oldLoad.reject(new Error("stale failure"));

    await vi.waitFor(() => expect(state.load).toHaveBeenCalledWith("newest"));
    expect(state.reportFailure).not.toHaveBeenCalled();
    newestLoad.resolve("fresh data");
    await expect(refresh).resolves.toEqual({
      status: "applied",
      query: "newest",
      data: "fresh data",
    });
    expect(state.reportFailure).not.toHaveBeenCalled();
    expect(state.apply).toHaveBeenCalledWith("fresh data", "newest");
  });

  it("coalesces three refreshes into the first and latest query", async () => {
    const firstLoad = deferred<string>();
    const latestLoad = deferred<string>();
    const state = setup((query) => (query === "first" ? firstLoad.promise : latestLoad.promise));
    state.controller.start();

    const first = state.controller.refresh();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledOnce());
    state.setQuery("second");
    const second = state.controller.refresh();
    state.setQuery("third");
    const third = state.controller.refresh();

    firstLoad.resolve("stale");
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledTimes(2));
    expect(state.load).toHaveBeenNthCalledWith(2, "third");
    expect(state.load).not.toHaveBeenCalledWith("second");
    latestLoad.resolve("latest");

    const results = await Promise.all([first, second, third]);
    expect(results).toEqual([
      { status: "applied", query: "third", data: "latest" },
      { status: "applied", query: "third", data: "latest" },
      { status: "applied", query: "third", data: "latest" },
    ]);
    expect(state.apply).toHaveBeenCalledOnce();
  });

  it("never runs library loads in parallel", async () => {
    const gates: Deferred<string>[] = [];
    let activeLoads = 0;
    let maximumActiveLoads = 0;
    const state = setup(async () => {
      const gate = deferred<string>();
      gates.push(gate);
      activeLoads += 1;
      maximumActiveLoads = Math.max(maximumActiveLoads, activeLoads);
      try {
        return await gate.promise;
      } finally {
        activeLoads -= 1;
      }
    });
    state.controller.start();

    const first = state.controller.refresh();
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    state.setQuery("second");
    state.controller.refresh();
    expect(gates).toHaveLength(1);

    gates[0]?.resolve("first");
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    state.setQuery("third");
    const third = state.controller.refresh();
    gates[1]?.resolve("second");
    await vi.waitFor(() => expect(gates).toHaveLength(3));
    gates[2]?.resolve("third");

    await Promise.all([first, third]);
    expect(maximumActiveLoads).toBe(1);
  });

  it("prevents an old completion from writing after stop and restart", async () => {
    const oldLoad = deferred<string>();
    const restartedLoad = deferred<string>();
    const state = setup((query) => (query === "first" ? oldLoad.promise : restartedLoad.promise));
    state.controller.start();

    const oldRefresh = state.controller.refresh();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledOnce());
    state.controller.stop();
    state.controller.start();
    state.setQuery("restarted");
    const restartedRefresh = state.controller.refresh();
    expect(state.load).toHaveBeenCalledOnce();

    oldLoad.resolve("stale");
    await expect(oldRefresh).resolves.toEqual({ status: "stopped", query: "first" });
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledTimes(2));
    expect(state.apply).not.toHaveBeenCalled();
    restartedLoad.resolve("fresh");

    await expect(restartedRefresh).resolves.toEqual({
      status: "applied",
      query: "restarted",
      data: "fresh",
    });
    expect(state.apply).toHaveBeenCalledOnce();
    expect(state.apply).toHaveBeenCalledWith("fresh", "restarted");
  });

  it("starts a new batch in the settled-before-finally cleanup window", async () => {
    const firstLoad = deferred<string>();
    const state = setup(
      vi
        .fn()
        .mockImplementationOnce(() => firstLoad.promise)
        .mockResolvedValueOnce("second data"),
    );
    state.controller.start();
    const first = state.controller.refresh();
    await vi.waitFor(() => expect(state.load).toHaveBeenCalledOnce());
    let lateRefresh: ReturnType<typeof state.controller.refresh> | undefined;

    firstLoad.resolve("first data");
    queueMicrotask(() => {
      state.setQuery("second");
      lateRefresh = state.controller.refresh();
    });
    await Promise.resolve();

    expect(lateRefresh).toBeDefined();
    await expect(first).resolves.toEqual({
      status: "applied",
      query: "first",
      data: "first data",
    });
    await expect(lateRefresh).resolves.toEqual({
      status: "applied",
      query: "second",
      data: "second data",
    });
    expect(state.load).toHaveBeenCalledTimes(2);
  });

  it("captures the current query and returns stopped without loading while inactive", async () => {
    const state = setup(async () => "unused");
    state.setQuery("inactive");

    await expect(state.controller.refresh()).resolves.toEqual({
      status: "stopped",
      query: "inactive",
    });
    expect(state.load).not.toHaveBeenCalled();
  });

  it("keeps normalization and reporting failures inside a typed result", async () => {
    const reportFailure = vi.fn(() => {
      throw new Error("reporting failed");
    });
    const controller = createLibraryRefreshController({
      getQuery: () => "query",
      load: async () => {
        throw new Error("load failed");
      },
      apply: vi.fn(),
      reportFailure,
      toError: () => {
        throw new Error("normalization failed");
      },
    });
    controller.start();

    const result = await controller.refresh();

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("Expected failed refresh result");
    expect(result.query).toBe("query");
    expect(result.error.message).toBe("normalization failed");
    expect(reportFailure).toHaveBeenCalledWith(result.error, "query");
  });

  it("rejects a deferred B result after dependencies advance to deep link C", async () => {
    const requestB = createLibraryRouteRequest({
      filter: "all",
      locationKey: "location-b",
      workId: "work-b",
    });
    const requestC = createLibraryRouteRequest({
      filter: "trash",
      locationKey: "location-c",
      workId: "work-c",
    });
    if (!requestB || !requestC) throw new Error("Expected route requests");
    const loadB = deferred<string>();
    const loadC = deferred<string>();
    const load = vi.fn((query: RouteRefreshQuery) =>
      query.routeKey === requestB.key ? loadB.promise : loadC.promise,
    );
    const applied = vi.fn();
    const dependenciesFor = (request: LibraryRouteRequest, query: RouteRefreshQuery) => ({
      apply: (data: string, loadedQuery: RouteRefreshQuery) => {
        if (ownsLibraryRouteRequest(loadedQuery.routeKey, request)) {
          applied(data, loadedQuery);
        }
      },
      getQuery: () => query,
      isSameQuery: isSameRouteQuery,
      load,
    });
    const queryB = routeQuery(requestB);
    const queryC = routeQuery(requestC);
    const controller = createLibraryRefreshController(dependenciesFor(requestB, queryB));
    controller.start();

    const refreshB = controller.refresh();
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(queryB));
    controller.updateDependencies(dependenciesFor(requestC, queryC));
    const refreshC = controller.refresh();
    expect(refreshC).toBe(refreshB);

    loadB.resolve("stale B");
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(queryC));
    expect(applied).not.toHaveBeenCalled();
    loadC.resolve("fresh C");

    await expect(refreshB).resolves.toEqual({ status: "applied", query: queryC, data: "fresh C" });
    expect(applied).toHaveBeenCalledOnce();
    expect(applied).toHaveBeenCalledWith("fresh C", queryC);
  });

  it("rejects a deferred deep-link result after the route is cancelled", async () => {
    const requestB = createLibraryRouteRequest({
      filter: "all",
      locationKey: "location-b",
      workId: "work-b",
    });
    if (!requestB) throw new Error("Expected route request");
    const loadB = deferred<string>();
    const browseLoad = deferred<string>();
    const load = vi.fn((query: RouteRefreshQuery) =>
      query.routeKey === requestB.key ? loadB.promise : browseLoad.promise,
    );
    const applied = vi.fn();
    const dependenciesFor = (request: LibraryRouteRequest | null, query: RouteRefreshQuery) => ({
      apply: (data: string, loadedQuery: RouteRefreshQuery) => {
        if (ownsLibraryRouteRequest(loadedQuery.routeKey, request)) {
          applied(data, loadedQuery);
        }
      },
      getQuery: () => query,
      isSameQuery: isSameRouteQuery,
      load,
    });
    const queryB = routeQuery(requestB);
    const browseQuery = routeQuery(null);
    const controller = createLibraryRefreshController(dependenciesFor(requestB, queryB));
    controller.start();

    const refreshB = controller.refresh();
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(queryB));
    controller.updateDependencies(dependenciesFor(null, browseQuery));
    const refreshAfterCancel = controller.refresh();
    expect(refreshAfterCancel).toBe(refreshB);

    loadB.resolve("stale B");
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(browseQuery));
    expect(applied).not.toHaveBeenCalled();
    browseLoad.resolve("fresh browse");

    await expect(refreshAfterCancel).resolves.toEqual({
      status: "applied",
      query: browseQuery,
      data: "fresh browse",
    });
    expect(applied).toHaveBeenCalledOnce();
    expect(applied).toHaveBeenCalledWith("fresh browse", browseQuery);
  });
});
