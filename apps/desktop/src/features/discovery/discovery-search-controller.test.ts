import { describe, expect, it, vi } from "vitest";
import {
  createDiscoverySearchController,
  type DiscoverySourceLoadInput,
} from "./discovery-search-controller";

type Source = "alpha" | "beta";
type Status = "idle" | "searching" | "done" | "error" | "stopped";

interface Query {
  text: string;
}

interface Result {
  id: string;
  identity?: string;
  title: string;
}

interface Cursor {
  hasMore: boolean;
  page: number;
}

interface Report {
  cursor?: Cursor;
  results: Result[];
  status: Status;
}

interface Deferred<Value> {
  promise: Promise<Value>;
  reject(reason?: unknown): void;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function report(id: string, page = 1, hasMore = false, status: Status = "done"): Report {
  return {
    cursor: { hasMore, page },
    results: [{ id, title: id }],
    status,
  };
}

function request(text: string, sources: Source[] = ["alpha"]) {
  return { query: { text }, sources };
}

function harness(
  loadSource: (input: DiscoverySourceLoadInput<Query, Source, Cursor>) => Promise<Report>,
  overrides: {
    initialSnapshot?: {
      cursors?: Partial<Record<Source, Cursor>>;
      results?: readonly Result[];
      selectedId?: string | null;
      sourceStatus?: Partial<Record<Source, Status>>;
    };
    mergeResults?: (results: readonly Result[]) => readonly Result[];
    resultKeys?: (result: Result) => readonly string[];
    waitForMinimumElapsed?: (startedAt: number, kind: "search" | "load-more") => Promise<void>;
  } = {},
) {
  const reportMessage = vi.fn();
  const loadSourceMock = vi.fn(loadSource);
  const instance = createDiscoverySearchController({
    allSources: ["alpha", "beta"] as const,
    describeError: (error: Error) => error.message,
    getCursor: (value: Report) => value.cursor,
    getResults: (value: Report) => value.results,
    getSourceStatus: (value: Report) => value.status,
    hasMore: (cursor: Cursor) => cursor.hasMore,
    initialSnapshot: overrides.initialSnapshot,
    loadSource: loadSourceMock,
    mergeResults:
      overrides.mergeResults ??
      ((results: readonly Result[]) => [
        ...new Map(results.map((result) => [result.id, result])).values(),
      ]),
    messages: {
      loadMoreFailed: (error: Error) => `more failed:${error.message}`,
      searchFailed: (error: Error) => `search failed:${error.message}`,
      searchSucceeded: (results: readonly Result[]) => `found:${results.length}`,
    },
    now: () => 100,
    reportMessage,
    resultId: (result: Result) => result.id,
    resultKeys: overrides.resultKeys,
    statuses: {
      error: "error" as const,
      idle: "idle" as const,
      searching: "searching" as const,
      stopped: "stopped" as const,
    },
    waitForMinimumElapsed: overrides.waitForMinimumElapsed ?? vi.fn(async () => undefined),
  });
  return {
    instance,
    loadSource: loadSourceMock,
    reportMessage,
  };
}

describe("DiscoverySearchController", () => {
  it("hydrates preview state without an empty first snapshot", () => {
    const { instance } = harness(async () => report("unused"), {
      initialSnapshot: {
        cursors: { alpha: { hasMore: true, page: 1 } },
        results: [{ id: "sample", title: "Sample" }],
        selectedId: "missing",
        sourceStatus: { alpha: "done" },
      },
    });

    expect(instance.getSnapshot()).toMatchObject({
      cursors: { alpha: { hasMore: true, page: 1 } },
      results: [{ id: "sample", title: "Sample" }],
      selectedId: "sample",
      sourceStatus: { alpha: "done", beta: "idle" },
    });
  });

  it("publishes an immutable external-store snapshot and canonical selected id", async () => {
    const mergeResults = (results: readonly Result[]) => [
      ...new Map(
        results
          .map((result) =>
            result.id === "alias" ? { ...result, id: "canonical", title: "Canonical" } : result,
          )
          .map((result) => [result.id, result]),
      ).values(),
    ];
    const { instance, reportMessage } = harness(async () => report("alias", 1, true), {
      mergeResults,
    });
    const listener = vi.fn();
    const unsubscribe = instance.subscribe(listener);
    instance.start();

    const result = await instance.search(request("first"));
    const snapshot = instance.getSnapshot();

    expect(result).toEqual({ status: "applied" });
    expect(snapshot.results).toEqual([{ id: "canonical", title: "Canonical" }]);
    expect(snapshot.selectedId).toBe("canonical");
    expect(snapshot.cursors.alpha).toEqual({ hasMore: true, page: 1 });
    expect(snapshot.sourceStatus).toEqual({ alpha: "done", beta: "idle" });
    expect(snapshot.searching).toBe(false);
    expect(reportMessage).toHaveBeenLastCalledWith("found:1");
    expect(listener).toHaveBeenCalled();

    const stableSnapshot = instance.getSnapshot();
    expect(instance.getSnapshot()).toBe(stableSnapshot);
    unsubscribe();
  });

  it("publishes fast source results and preserves their selection while siblings finish", async () => {
    const slowSource = deferred<Report>();
    const { instance } = harness(async (input) =>
      input.source === "alpha" ? report("fast-result") : slowSource.promise,
    );
    instance.start();

    const pending = instance.search(request("streamed", ["alpha", "beta"]));
    await vi.waitFor(() =>
      expect(instance.getSnapshot()).toMatchObject({
        results: [{ id: "fast-result", title: "fast-result" }],
        searching: true,
        selectedId: "fast-result",
        sourceStatus: { alpha: "done", beta: "searching" },
      }),
    );
    instance.select("fast-result");

    slowSource.resolve(report("slow-result"));
    await expect(pending).resolves.toEqual({ status: "applied" });
    expect(instance.getSnapshot().results.map((item) => item.id)).toEqual([
      "fast-result",
      "slow-result",
    ]);
    expect(instance.getSnapshot().selectedId).toBe("fast-result");
  });

  it("keeps a streamed selection when a slower source replaces its result id", async () => {
    const slowSource = deferred<Report>();
    const mergeResults = (results: readonly Result[]) => {
      const byIdentity = new Map<string, Result>();
      for (const result of results) {
        const identity = result.identity ?? result.id;
        const existing = byIdentity.get(identity);
        if (!existing || result.id === "canonical-paper") byIdentity.set(identity, result);
      }
      return [...byIdentity.values()];
    };
    const { instance } = harness(
      async (input) =>
        input.source === "alpha"
          ? {
              results: [
                { id: "unrelated", identity: "unrelated", title: "Unrelated" },
                { id: "alias-paper", identity: "paper", title: "Paper" },
              ],
              status: "done",
            }
          : slowSource.promise,
      {
        mergeResults,
        resultKeys: (result) => [result.identity ?? result.id],
      },
    );
    instance.start();

    const pending = instance.search(request("streamed", ["alpha", "beta"]));
    await vi.waitFor(() =>
      expect(instance.getSnapshot().results.map((item) => item.id)).toEqual([
        "unrelated",
        "alias-paper",
      ]),
    );
    instance.select("alias-paper");

    slowSource.resolve({
      results: [{ id: "canonical-paper", identity: "paper", title: "Paper enriched" }],
      status: "done",
    });
    await expect(pending).resolves.toEqual({ status: "applied" });
    expect(instance.getSnapshot().results.map((item) => item.id)).toEqual([
      "unrelated",
      "canonical-paper",
    ]);
    expect(instance.getSnapshot().selectedId).toBe("canonical-paper");
  });

  it("blocks pagination until every initial-search source has settled", async () => {
    const slowSource = deferred<Report>();
    const { instance, loadSource } = harness(async (input) => {
      if (input.kind === "load-more") return report("page-2", 2, false);
      return input.source === "alpha" ? report("fast-page-1", 1, true) : slowSource.promise;
    });
    instance.start();

    const pendingSearch = instance.search(request("streamed", ["alpha", "beta"]));
    await vi.waitFor(() =>
      expect(instance.getSnapshot()).toMatchObject({
        cursors: { alpha: { hasMore: true, page: 1 } },
        searching: true,
      }),
    );

    await expect(instance.loadMore()).resolves.toEqual({
      status: "skipped",
      reason: "searching",
    });
    expect(loadSource).toHaveBeenCalledTimes(2);

    slowSource.resolve(report("slow-page-1", 1, false));
    await expect(pendingSearch).resolves.toEqual({ status: "applied" });
    await expect(instance.loadMore()).resolves.toEqual({ status: "applied" });
    expect(instance.getSnapshot().cursors.alpha).toEqual({ hasMore: false, page: 2 });
    expect(instance.getSnapshot().results.map((item) => item.id)).toContain("page-2");
  });

  it("does not let an old search clear a replacement during the minimum-busy wait", async () => {
    const firstLoad = deferred<Report>();
    const secondLoad = deferred<Report>();
    const firstWait = deferred<void>();
    let waitCalls = 0;
    const { instance, loadSource } = harness(
      (input) => (input.query.text === "old" ? firstLoad.promise : secondLoad.promise),
      {
        waitForMinimumElapsed: async () => {
          waitCalls += 1;
          if (waitCalls === 1) await firstWait.promise;
        },
      },
    );
    instance.start();

    const oldSearch = instance.search(request("old"));
    firstLoad.resolve(report("old-result"));
    await vi.waitFor(() => expect(waitCalls).toBe(1));

    const replacement = instance.search(request("new"));
    expect(instance.getSnapshot().searching).toBe(true);
    expect(loadSource).toHaveBeenCalledTimes(2);
    firstWait.resolve();
    await expect(oldSearch).resolves.toEqual({ status: "stopped" });

    expect(instance.getSnapshot().searching).toBe(true);
    expect(instance.getSnapshot().results).toEqual([]);

    secondLoad.resolve(report("new-result"));
    await expect(replacement).resolves.toEqual({ status: "applied" });
    expect(instance.getSnapshot().searching).toBe(false);
    expect(instance.getSnapshot().results.map((item) => item.id)).toEqual(["new-result"]);
  });

  it("aborts load-more and rejects its late publication when a fresh search starts", async () => {
    const oldPage = deferred<Report>();
    let loadMoreSignal: AbortSignal | null = null;
    const { instance } = harness(async (input) => {
      if (input.kind === "search" && input.query.text === "old") {
        return report("old-1", 1, true);
      }
      if (input.kind === "load-more") {
        loadMoreSignal = input.signal;
        return oldPage.promise;
      }
      return report("new-1", 1, false);
    });
    instance.start();
    await instance.search(request("old"));

    const loadMore = instance.loadMore();
    await vi.waitFor(() => expect(loadMoreSignal).not.toBeNull());
    const replacement = instance.search(request("new"));
    expect(loadMoreSignal).not.toBeNull();
    expect((loadMoreSignal as unknown as AbortSignal).aborted).toBe(true);
    await replacement;

    oldPage.resolve(report("old-2", 2, false));
    await expect(loadMore).resolves.toEqual({ status: "stopped" });
    expect(instance.getSnapshot().results.map((item) => item.id)).toEqual(["new-1"]);
    expect(instance.getSnapshot().cursors.alpha).toEqual({ hasMore: false, page: 1 });
    expect(instance.getSnapshot().loadingMore).toBe(false);
  });

  it("keeps clear authoritative when a load-more request finishes late", async () => {
    const page = deferred<Report>();
    const { instance } = harness(async (input) =>
      input.kind === "search" ? report("first", 1, true) : page.promise,
    );
    instance.start();
    await instance.search(request("topic"));

    const loadMore = instance.loadMore();
    instance.clear();
    page.resolve(report("late", 2, false));
    await expect(loadMore).resolves.toEqual({ status: "stopped" });

    expect(instance.getSnapshot()).toMatchObject({
      cursors: {},
      loadingMore: false,
      loadMoreError: null,
      results: [],
      searchError: null,
      searching: false,
      selectedId: null,
      sourceStatus: { alpha: "idle", beta: "idle" },
    });
  });

  it("keeps stop authoritative when search and load-more dependencies ignore abort", async () => {
    const searchLoad = deferred<Report>();
    const loadMoreLoad = deferred<Report>();
    const { instance } = harness(async (input) => {
      if (input.query.text === "slow-search") return searchLoad.promise;
      if (input.kind === "search") return report("seed", 1, true);
      return loadMoreLoad.promise;
    });
    instance.start();
    const slowSearch = instance.search(request("slow-search"));
    instance.stop();
    searchLoad.resolve(report("late-search"));
    await expect(slowSearch).resolves.toEqual({ status: "stopped" });
    expect(instance.getSnapshot().results).toEqual([]);
    expect(instance.getSnapshot().searching).toBe(false);

    instance.start();
    await instance.search(request("seed-search"));
    const beforeStop = instance.getSnapshot().results;
    const loadMore = instance.loadMore();
    instance.stop();
    loadMoreLoad.resolve(report("late-page", 2, false));
    await expect(loadMore).resolves.toEqual({ status: "stopped" });
    expect(instance.getSnapshot().results).toEqual(beforeStop);
    expect(instance.getSnapshot().loadingMore).toBe(false);
  });

  it("cancels current work without deactivating the controller", async () => {
    const pending = deferred<Report>();
    const { instance } = harness(async (input) =>
      input.query.text === "cancelled" ? pending.promise : report("replacement"),
    );
    instance.start();
    const cancelled = instance.search(request("cancelled"));
    instance.cancel();

    expect(instance.getSnapshot().searching).toBe(false);
    expect(instance.getSnapshot().sourceStatus.alpha).toBe("stopped");
    pending.resolve(report("late"));
    await expect(cancelled).resolves.toEqual({ status: "stopped" });
    await expect(instance.search(request("next"))).resolves.toEqual({ status: "applied" });
    expect(instance.getSnapshot().results.map((item) => item.id)).toEqual(["replacement"]);
  });

  it("coalesces same-tick load-more calls onto one immutable cursor snapshot", async () => {
    const page = deferred<Report>();
    const seenCursors: Array<Cursor | undefined> = [];
    const { instance, loadSource } = harness(async (input) => {
      if (input.kind === "search") return report("first", 1, true);
      seenCursors.push(input.cursor);
      return page.promise;
    });
    instance.start();
    await instance.search(request("topic"));

    const first = instance.loadMore();
    const second = instance.loadMore();
    expect(second).toBe(first);
    expect(instance.getSnapshot().loadingMore).toBe(true);
    expect(loadSource).toHaveBeenCalledTimes(2);

    page.resolve(report("second", 2, false));
    await expect(first).resolves.toEqual({ status: "applied" });
    expect(seenCursors).toEqual([{ hasMore: true, page: 1 }]);
    expect(instance.getSnapshot().results.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("preserves the prior cursor and results when load-more fails", async () => {
    const { instance, reportMessage } = harness(async (input) => {
      if (input.kind === "search") return report("first", 1, true);
      throw new Error("page offline");
    });
    instance.start();
    await instance.search(request("topic"));
    const previousCursor = instance.getSnapshot().cursors.alpha;
    const previousResults = instance.getSnapshot().results;

    const result = await instance.loadMore();

    expect(result).toMatchObject({ status: "failed" });
    expect(instance.getSnapshot().cursors.alpha).toBe(previousCursor);
    expect(instance.getSnapshot().results).toBe(previousResults);
    expect(instance.getSnapshot().loadMoreError).toBe("page offline");
    expect(instance.getSnapshot().loadingMore).toBe(false);
    expect(reportMessage).toHaveBeenLastCalledWith("more failed:page offline");
  });

  it("streams a successful next page while retaining a failed source cursor for retry", async () => {
    const failedPage = deferred<Report>();
    const { instance } = harness(async (input) => {
      if (input.kind === "search") {
        return report(`${input.source}-page-1`, 1, true);
      }
      if (input.source === "alpha") return report("alpha-page-2", 2, false);
      return failedPage.promise;
    });
    instance.start();
    await instance.search(request("topic", ["alpha", "beta"]));

    const pending = instance.loadMore();
    await vi.waitFor(() => {
      expect(instance.getSnapshot().results.map((item) => item.id)).toContain("alpha-page-2");
      expect(instance.getSnapshot()).toMatchObject({
        cursors: { alpha: { hasMore: false, page: 2 }, beta: { hasMore: true, page: 1 } },
        loadingMore: true,
      });
    });
    failedPage.reject(new Error("beta page offline"));

    await expect(pending).resolves.toMatchObject({ status: "failed" });
    expect(instance.getSnapshot()).toMatchObject({
      cursors: { alpha: { hasMore: false, page: 2 }, beta: { hasMore: true, page: 1 } },
      loadingMore: false,
      loadMoreError: "beta page offline",
      sourceStatus: { alpha: "done", beta: "error" },
    });
    expect(instance.getSnapshot().results.map((item) => item.id)).toEqual([
      "alpha-page-1",
      "beta-page-1",
      "alpha-page-2",
    ]);
  });

  it("keeps selection on a canonical id across pagination and id-changing updates", async () => {
    const { instance } = harness(async (input) => {
      if (input.kind === "search" && input.source === "alpha") {
        return {
          cursor: { hasMore: true, page: 1 },
          results: [
            { id: "first", title: "First" },
            { id: "second", title: "Second" },
          ],
          status: "done",
        };
      }
      return report("third", 2, false);
    });
    instance.start();
    await instance.search(request("topic"));
    instance.select("second");
    await instance.loadMore();

    expect(instance.getSnapshot().selectedId).toBe("second");
    instance.updateResult("second", (result) => ({
      ...result,
      id: "second-canonical",
      title: "Updated",
    }));
    expect(instance.getSnapshot().selectedId).toBe("second-canonical");
    expect(instance.getSnapshot().results.find((item) => item.id === "second-canonical")).toEqual({
      id: "second-canonical",
      title: "Updated",
    });

    instance.select("missing");
    expect(instance.getSnapshot().selectedId).toBe("second-canonical");
  });

  it("keeps selection on the same paper when a later merge replaces its result id", async () => {
    const mergeResults = (results: readonly Result[]) => {
      const byIdentity = new Map<string, Result>();
      for (const result of results) {
        const identity = result.identity ?? result.id;
        const existing = byIdentity.get(identity);
        if (!existing || result.id === "canonical-paper") byIdentity.set(identity, result);
      }
      return [...byIdentity.values()];
    };
    const { instance } = harness(
      async (input) => {
        if (input.kind === "search") {
          return {
            cursor: { hasMore: true, page: 1 },
            results: [
              { id: "unrelated", identity: "unrelated", title: "Unrelated" },
              { id: "alias-paper", identity: "paper", title: "Paper" },
            ],
            status: "done",
          };
        }
        return {
          cursor: { hasMore: false, page: 2 },
          results: [{ id: "canonical-paper", identity: "paper", title: "Paper enriched" }],
          status: "done",
        };
      },
      {
        mergeResults,
        resultKeys: (result) => [result.identity ?? result.id],
      },
    );
    instance.start();
    await instance.search(request("topic"));
    instance.select("alias-paper");

    await instance.loadMore();

    expect(instance.getSnapshot().results.map((item) => item.id)).toEqual([
      "unrelated",
      "canonical-paper",
    ]);
    expect(instance.getSnapshot().selectedId).toBe("canonical-paper");
  });

  it("waits for sibling sources and preserves their result when another source rejects", async () => {
    const sibling = deferred<Report>();
    const { instance, reportMessage } = harness(async (input) => {
      if (input.source === "alpha") throw new Error("alpha failed");
      return sibling.promise;
    });
    instance.start();
    const pending = instance.search(request("topic", ["alpha", "beta"]));
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    sibling.resolve(report("must-not-publish"));
    await expect(pending).resolves.toMatchObject({ status: "partial" });

    expect(instance.getSnapshot().results.map((item) => item.id)).toEqual(["must-not-publish"]);
    expect(instance.getSnapshot().sourceStatus).toEqual({
      alpha: "error",
      beta: "done",
    });
    expect(instance.getSnapshot().searchError).toBeNull();
    expect(reportMessage).toHaveBeenLastCalledWith("found:1");
  });
});
