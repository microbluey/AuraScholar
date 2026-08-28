import { describe, expect, it, vi } from "vitest";
import type { DiscoveryQuery, DiscoverySource } from "@aurascholar/core";
import type { SavedSearchView } from "../../services/saved-searches";
import { createDiscoverySavedSearchController } from "./discovery-saved-search-controller";
import type {
  DiscoverySavedSearchActionPorts,
  DiscoverySavedSearchDataSource,
} from "./discovery-saved-search-model";

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

function savedSearch(overrides: Partial<SavedSearchView> = {}): SavedSearchView {
  return {
    id: "saved-1",
    query: "retrieval augmented generation",
    sources: ["openalex"],
    newCount: 0,
    lastRunAt: 100,
    lastError: null,
    ...overrides,
    criteria: overrides.criteria ?? { text: overrides.query ?? "retrieval augmented generation" },
  };
}

function dataSource() {
  return {
    clearBadge: vi.fn(async (_id: string): Promise<void> => undefined),
    create: vi.fn(async (_criteria: DiscoveryQuery, _sources: DiscoverySource[]) => ({
      created: true,
      id: "saved-1",
    })),
    delete: vi.fn(async (_id: string): Promise<void> => undefined),
    list: vi.fn(async (): Promise<SavedSearchView[]> => []),
    restore: vi.fn(async (_id: string): Promise<void> => undefined),
    run: vi.fn(async (_id: string) => 0),
  } satisfies DiscoverySavedSearchDataSource;
}

function actionPorts(
  overrides: Partial<DiscoverySavedSearchActionPorts> = {},
): DiscoverySavedSearchActionPorts {
  return {
    activateSearch: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
    reportMessage: vi.fn(),
    ...overrides,
  };
}

function controller(data: DiscoverySavedSearchDataSource) {
  return createDiscoverySavedSearchController({
    data,
    defaultSources: ["openalex", "crossref", "s2", "arxiv"],
    desktopRuntime: true,
    now: vi.fn(() => 1_000),
    waitForMinimumElapsed: vi.fn(async () => undefined),
  });
}

async function startWith(data: ReturnType<typeof dataSource>, items: SavedSearchView[]) {
  data.list.mockResolvedValue(items);
  const instance = controller(data);
  instance.start();
  await vi.waitFor(() => expect(instance.getSnapshot().items).toEqual(items));
  return instance;
}

describe("DiscoverySavedSearchController", () => {
  it("lets only the newest refresh publish and ignores a completion after stop", async () => {
    const oldRefresh = deferred<SavedSearchView[]>();
    const newestRefresh = deferred<SavedSearchView[]>();
    const stoppedRefresh = deferred<SavedSearchView[]>();
    const data = dataSource();
    data.list
      .mockImplementationOnce(() => oldRefresh.promise)
      .mockImplementationOnce(() => newestRefresh.promise)
      .mockImplementationOnce(() => stoppedRefresh.promise);
    const instance = controller(data);
    const newest = savedSearch({ id: "newest", query: "newest" });

    instance.start();
    const current = instance.refresh();
    oldRefresh.resolve([savedSearch({ id: "stale", query: "stale" })]);
    await vi.waitFor(() => expect(data.list).toHaveBeenCalledTimes(2));
    expect(instance.getSnapshot().items).toEqual([]);

    newestRefresh.resolve([newest]);
    await current;
    expect(instance.getSnapshot().items).toEqual([newest]);

    const stopped = instance.refresh();
    await vi.waitFor(() => expect(data.list).toHaveBeenCalledTimes(3));
    instance.stop();
    stoppedRefresh.resolve([savedSearch({ id: "after-stop" })]);
    await stopped;
    expect(instance.getSnapshot().items).toEqual([newest]);
  });

  it("starts a new refresh in the settled-before-cleanup microtask window", async () => {
    const firstRefresh = deferred<SavedSearchView[]>();
    const data = dataSource();
    data.list.mockImplementationOnce(() => firstRefresh.promise).mockResolvedValue([]);
    const instance = controller(data);
    instance.start();
    let lateRefresh: Promise<Error | null> | undefined;

    firstRefresh.resolve([]);
    queueMicrotask(() => {
      lateRefresh = instance.refresh();
    });
    await Promise.resolve();

    expect(lateRefresh).toBeDefined();
    await lateRefresh;
    expect(data.list).toHaveBeenCalledTimes(2);
  });

  it("coalesces a double save and reports created, duplicate, and retryable failure messages", async () => {
    const pendingCreate = deferred<{ created: boolean; id: string }>();
    const data = dataSource();
    data.list.mockResolvedValueOnce([]).mockResolvedValue([savedSearch()]);
    data.create
      .mockImplementationOnce(() => pendingCreate.promise)
      .mockResolvedValueOnce({ created: false, id: "saved-1" })
      .mockRejectedValueOnce(new Error("write unavailable"));
    const instance = controller(data);
    instance.start();
    await vi.waitFor(() => expect(data.list).toHaveBeenCalledTimes(1));
    const reportMessage = vi.fn();

    const first = instance.save("  new topic  ", ["openalex"], { reportMessage });
    const duplicateSubmit = instance.save("  new topic  ", ["openalex"], { reportMessage });
    expect(instance.getSnapshot().saving).toBe(true);
    expect(data.create).toHaveBeenCalledTimes(1);

    pendingCreate.resolve({ created: true, id: "saved-1" });
    await Promise.all([first, duplicateSubmit]);
    expect(instance.getSnapshot().saving).toBe(false);
    expect(reportMessage).toHaveBeenLastCalledWith("已保存检索订阅:“new topic”,有新结果时会通知你");

    await instance.save("new topic", ["openalex"], { reportMessage });
    expect(reportMessage).toHaveBeenLastCalledWith("检索订阅已存在:“new topic”");

    await instance.save("failed topic", ["openalex"], { reportMessage });
    expect(reportMessage).toHaveBeenLastCalledWith(
      "保存订阅失败，检索条件仍保留，可重新保存:write unavailable",
    );
    expect(instance.getSnapshot().saving).toBe(false);
    expect(data.create).toHaveBeenCalledTimes(3);
  });

  it("serializes open, check, and delete confirmation for the same subscription", async () => {
    const item = savedSearch();
    const data = dataSource();
    const instance = await startWith(data, [item]);
    const opening = deferred<boolean>();
    const confirmDelete = deferred<boolean>();
    const ports = actionPorts({
      activateSearch: vi.fn(() => opening.promise),
      confirm: vi.fn(() => confirmDelete.promise),
    });

    const open = instance.open(item, ports);
    expect(instance.getSnapshot().rowActions.get(item.id)).toBe("opening");
    await Promise.all([instance.check(item.id, ports), instance.remove(item, ports)]);
    expect(data.run).not.toHaveBeenCalled();
    expect(ports.confirm).not.toHaveBeenCalled();

    opening.resolve(false);
    await open;
    const checking = deferred<number>();
    data.run.mockImplementationOnce(() => checking.promise);
    const check = instance.check(item.id, ports);
    expect(instance.getSnapshot().rowActions.get(item.id)).toBe("checking");
    await Promise.all([instance.open(item, ports), instance.remove(item, ports)]);
    expect(ports.activateSearch).toHaveBeenCalledTimes(1);
    expect(ports.confirm).not.toHaveBeenCalled();

    checking.resolve(0);
    await check;
    const remove = instance.remove(item, ports);
    await vi.waitFor(() => expect(ports.confirm).toHaveBeenCalledTimes(1));
    await Promise.all([instance.open(item, ports), instance.check(item.id, ports)]);
    expect(ports.activateSearch).toHaveBeenCalledTimes(1);
    expect(data.run).toHaveBeenCalledTimes(1);

    confirmDelete.resolve(false);
    await remove;
    expect(data.delete).not.toHaveBeenCalled();
    expect(instance.getSnapshot().rowActions.size).toBe(0);
  });

  it("uses default sources and clears the badge only after a successful open", async () => {
    const item = savedSearch({ sources: null, newCount: 2 });
    const data = dataSource();
    data.list
      .mockResolvedValueOnce([item])
      .mockResolvedValue([savedSearch({ ...item, newCount: 0 })]);
    const instance = controller(data);
    instance.start();
    await vi.waitFor(() => expect(instance.getSnapshot().items).toEqual([item]));
    const activateSearch = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const ports = actionPorts({ activateSearch });

    await instance.open(item, ports);
    expect(activateSearch).toHaveBeenLastCalledWith({
      criteria: item.criteria,
      sources: ["openalex", "crossref", "s2", "arxiv"],
    });
    expect(data.clearBadge).not.toHaveBeenCalled();

    await instance.open(item, ports);
    expect(data.clearBadge).toHaveBeenCalledOnce();
    expect(data.clearBadge).toHaveBeenCalledWith(item.id);
    expect(instance.getSnapshot().items[0]?.newCount).toBe(0);
    expect(instance.getSnapshot().rowActions.size).toBe(0);
  });

  it("keeps committed delete state and undo when the following refresh fails", async () => {
    const item = savedSearch();
    const pendingDelete = deferred<void>();
    const data = dataSource();
    data.list.mockResolvedValueOnce([item]).mockRejectedValueOnce(new Error("refresh offline"));
    data.delete.mockImplementationOnce(() => pendingDelete.promise);
    const instance = controller(data);
    instance.start();
    await vi.waitFor(() => expect(instance.getSnapshot().items).toEqual([item]));
    const ports = actionPorts();

    const remove = instance.remove(item, ports);
    await vi.waitFor(() => expect(instance.getSnapshot().rowActions.get(item.id)).toBe("deleting"));
    await Promise.all([instance.open(item, ports), instance.check(item.id, ports)]);
    expect(ports.activateSearch).not.toHaveBeenCalled();
    expect(data.run).not.toHaveBeenCalled();

    pendingDelete.resolve();
    await remove;
    expect(instance.getSnapshot()).toMatchObject({
      items: [],
      undo: {
        item,
        message: `已删除检索订阅:“${item.query}”`,
      },
    });
    expect(instance.getSnapshot().rowActions.size).toBe(0);
    expect(ports.reportMessage).toHaveBeenLastCalledWith(
      `已删除检索订阅:“${item.query}”，但列表刷新失败，可稍后刷新:refresh offline`,
    );
  });

  it("retains undo after restore failure and clears it after a successful retry", async () => {
    const item = savedSearch();
    let persisted: SavedSearchView[] = [item];
    const data = dataSource();
    data.list.mockImplementation(async () => persisted);
    data.delete.mockImplementation(async () => {
      persisted = [];
    });
    data.restore
      .mockRejectedValueOnce(new Error("restore unavailable"))
      .mockImplementationOnce(async () => {
        persisted = [item];
      });
    const instance = await startWith(data, persisted);
    const ports = actionPorts();
    await instance.remove(item, ports);
    expect(instance.getSnapshot().undo?.item).toEqual(item);

    await instance.undoDelete(ports);
    expect(instance.getSnapshot().undo?.item).toEqual(item);
    expect(instance.getSnapshot().undoBusy).toBe(false);
    expect(ports.reportMessage).toHaveBeenLastCalledWith(
      "撤销删除订阅失败，撤销入口仍保留，可重新撤销:restore unavailable",
    );

    await instance.undoDelete(ports);
    expect(data.restore).toHaveBeenCalledTimes(2);
    expect(instance.getSnapshot().undo).toBeNull();
    expect(instance.getSnapshot().undoBusy).toBe(false);
    expect(instance.getSnapshot().items).toEqual([item]);
    expect(ports.reportMessage).toHaveBeenLastCalledWith("已撤销删除检索订阅");
  });

  it("reports positive, empty, and failed checks and always releases the row", async () => {
    const item = savedSearch();
    const data = dataSource();
    data.list.mockResolvedValue([item]);
    data.run
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error("connector offline"));
    const instance = await startWith(data, [item]);
    const ports = actionPorts();

    await instance.check(item.id, ports);
    expect(ports.reportMessage).toHaveBeenLastCalledWith("发现 3 篇新结果");
    expect(instance.getSnapshot().rowActions.size).toBe(0);

    await instance.check(item.id, ports);
    expect(ports.reportMessage).toHaveBeenLastCalledWith("暂无新结果");
    expect(instance.getSnapshot().rowActions.size).toBe(0);

    await instance.check(item.id, ports);
    expect(ports.reportMessage).toHaveBeenLastCalledWith("检查订阅失败:connector offline");
    expect(instance.getSnapshot().rowActions.size).toBe(0);
    expect(data.run).toHaveBeenCalledTimes(3);
  });

  it("invalidates pending confirmation and action projections across stop and restart", async () => {
    const item = savedSearch();
    const data = dataSource();
    const instance = await startWith(data, [item]);
    const confirmation = deferred<boolean>();
    const ports = actionPorts({ confirm: vi.fn(() => confirmation.promise) });

    const remove = instance.remove(item, ports);
    await vi.waitFor(() => expect(ports.confirm).toHaveBeenCalledOnce());
    instance.stop();
    instance.start();
    confirmation.resolve(true);
    await remove;
    expect(data.delete).not.toHaveBeenCalled();
    expect(instance.getSnapshot().rowActions.size).toBe(0);

    const pendingCheck = deferred<number>();
    data.run.mockImplementationOnce(() => pendingCheck.promise).mockResolvedValueOnce(0);
    const check = instance.check(item.id, ports);
    expect(instance.getSnapshot().rowActions.get(item.id)).toBe("checking");
    instance.stop();
    instance.start();
    vi.mocked(ports.reportMessage).mockClear();
    pendingCheck.resolve(4);
    await check;
    expect(ports.reportMessage).not.toHaveBeenCalled();
    expect(instance.getSnapshot().rowActions.size).toBe(0);

    await instance.check(item.id, ports);
    expect(data.run).toHaveBeenCalledTimes(2);
    expect(ports.reportMessage).toHaveBeenLastCalledWith("暂无新结果");
  });

  it("serializes save, delete, and restore without losing an earlier undo", async () => {
    const first = savedSearch({ id: "first", query: "first query" });
    const second = savedSearch({ id: "second", query: "second query" });
    let persisted = [first, second];
    const secondDelete = deferred<void>();
    const restore = deferred<void>();
    const data = dataSource();
    data.list.mockImplementation(async () => persisted);
    data.delete.mockImplementation(async (id) => {
      if (id === second.id) return secondDelete.promise;
      persisted = persisted.filter((item) => item.id !== id);
    });
    data.restore.mockImplementation(async () => {
      await restore.promise;
      persisted = [first, ...persisted];
    });
    const instance = await startWith(data, persisted);
    const ports = actionPorts();

    await instance.remove(first, ports);
    expect(instance.getSnapshot().undo?.item).toEqual(first);

    const removingSecond = instance.remove(second, ports);
    await vi.waitFor(() => expect(data.delete).toHaveBeenCalledWith(second.id));
    await Promise.all([
      instance.undoDelete(ports),
      instance.save("new query", ["openalex"], ports),
    ]);
    expect(data.restore).not.toHaveBeenCalled();
    expect(data.create).not.toHaveBeenCalled();

    secondDelete.reject(new Error("second delete failed"));
    await removingSecond;
    expect(instance.getSnapshot().undo?.item).toEqual(first);

    const restoringFirst = instance.undoDelete(ports);
    await vi.waitFor(() => expect(data.restore).toHaveBeenCalledOnce());
    await Promise.all([
      instance.remove(second, ports),
      instance.save("another query", ["openalex"], ports),
    ]);
    expect(data.delete).toHaveBeenCalledTimes(2);
    expect(data.create).not.toHaveBeenCalled();
    restore.resolve();
    await restoringFirst;
    expect(instance.getSnapshot().undo).toBeNull();
  });

  it("restores an equivalent pending delete instead of creating a duplicate", async () => {
    const item = savedSearch({
      query: "Graph Neural Retrieval",
      sources: ["crossref", "openalex"],
    });
    let persisted = [item];
    const data = dataSource();
    data.list.mockImplementation(async () => persisted);
    data.delete.mockImplementation(async () => {
      persisted = [];
    });
    data.restore.mockImplementation(async () => {
      persisted = [item];
    });
    const instance = await startWith(data, persisted);
    const ports = actionPorts();

    await instance.remove(item, ports);
    expect(instance.getSnapshot().undo?.item).toEqual(item);

    await instance.save("  graph   neural retrieval ", ["openalex", "crossref"], ports);

    expect(data.create).not.toHaveBeenCalled();
    expect(data.restore).toHaveBeenCalledOnce();
    expect(instance.getSnapshot().undo).toBeNull();
    expect(instance.getSnapshot().items).toEqual([item]);
    expect(ports.reportMessage).toHaveBeenLastCalledWith(
      "已恢复检索订阅:“graph   neural retrieval”",
    );

    await instance.undoDelete(ports);
    expect(data.restore).toHaveBeenCalledOnce();
  });

  it("blocks delete and restore while a save mutation is pending", async () => {
    const first = savedSearch({ id: "first", query: "first query" });
    const second = savedSearch({ id: "second", query: "second query" });
    let persisted = [first, second];
    const pendingCreate = deferred<{ created: boolean; id: string }>();
    const data = dataSource();
    data.list.mockImplementation(async () => persisted);
    data.delete.mockImplementation(async (id) => {
      persisted = persisted.filter((item) => item.id !== id);
    });
    data.create.mockImplementationOnce(() => pendingCreate.promise);
    const instance = await startWith(data, persisted);
    const ports = actionPorts();
    await instance.remove(first, ports);
    expect(instance.getSnapshot().undo?.item).toEqual(first);
    vi.mocked(ports.confirm).mockClear();

    const save = instance.save("different query", ["s2"], ports);
    await vi.waitFor(() => expect(data.create).toHaveBeenCalledOnce());
    await Promise.all([instance.remove(second, ports), instance.undoDelete(ports)]);
    expect(ports.confirm).not.toHaveBeenCalled();
    expect(data.restore).not.toHaveBeenCalled();

    pendingCreate.resolve({ created: true, id: "different" });
    await save;
    expect(instance.getSnapshot().undo?.item).toEqual(first);
  });

  it("waits for a trailing refresh and reports its failure after a committed save", async () => {
    const initial = savedSearch({ id: "initial" });
    const staleRefresh = deferred<SavedSearchView[]>();
    const latestRefresh = deferred<SavedSearchView[]>();
    const data = dataSource();
    data.list
      .mockResolvedValueOnce([initial])
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockImplementationOnce(() => latestRefresh.promise);
    const instance = controller(data);
    instance.start();
    await vi.waitFor(() => expect(instance.getSnapshot().items).toEqual([initial]));
    const ports = actionPorts();

    const save = instance.save("committed query", ["openalex"], ports);
    await vi.waitFor(() => expect(data.list).toHaveBeenCalledTimes(2));
    const trailingRefresh = instance.refresh();
    staleRefresh.resolve([savedSearch({ id: "stale" })]);
    await vi.waitFor(() => expect(data.list).toHaveBeenCalledTimes(3));
    latestRefresh.reject(new Error("latest refresh failed"));
    await Promise.all([save, trailingRefresh]);

    expect(data.create).toHaveBeenCalledOnce();
    expect(instance.getSnapshot().items).toEqual([initial]);
    expect(ports.reportMessage).toHaveBeenLastCalledWith(
      "已保存检索订阅:“committed query”,有新结果时会通知你，但列表刷新失败，可稍后刷新:latest refresh failed",
    );
  });

  it("does not describe badge cleanup failure as an open failure", async () => {
    const item = savedSearch({ newCount: 2 });
    const data = dataSource();
    data.clearBadge.mockRejectedValueOnce(new Error("badge write failed"));
    const instance = await startWith(data, [item]);
    const ports = actionPorts();

    await instance.open(item, ports);

    expect(ports.activateSearch).toHaveBeenCalledOnce();
    expect(ports.reportMessage).toHaveBeenLastCalledWith(
      "已打开订阅，但清除新结果标记失败，可重新打开后重试:badge write failed",
    );
    expect(instance.getSnapshot().items[0]?.newCount).toBe(2);
  });
});
