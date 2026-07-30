import type { DiscoverySource } from "@aurascholar/core";
import type { SavedSearchView } from "../../services/saved-searches";
import { describeSafeError } from "../../services/sensitive-text";
import {
  matchesSavedSearch,
  toDiscoverySavedSearchError,
  upsertSavedSearch,
} from "./discovery-saved-search-model";
import type {
  DiscoverySavedSearchActionPorts,
  DiscoverySavedSearchControllerDependencies,
  DiscoverySavedSearchFailureKind,
  DiscoverySavedSearchRowAction,
  DiscoverySavedSearchSnapshot,
} from "./discovery-saved-search-model";

type Listener = () => void;
type RowLease = { action: DiscoverySavedSearchRowAction; token: symbol };
type RefreshBatch = {
  dirty: boolean;
  lifecycle: number;
  promise: Promise<Error | null>;
  settled: boolean;
};

const INITIAL_SNAPSHOT: DiscoverySavedSearchSnapshot = {
  items: [],
  rowActions: new Map(),
  saving: false,
  undo: null,
  undoBusy: false,
};

export class DiscoverySavedSearchController {
  private active = false;
  private catalogMutationLease: symbol | null = null;
  private confirmingDeletes = new Map<string, symbol>();
  private lifecycle = 0;
  private listeners = new Set<Listener>();
  private refreshBatch: RefreshBatch | null = null;
  private rowLeases = new Map<string, RowLease>();
  private saveLease: symbol | null = null;
  private snapshot: DiscoverySavedSearchSnapshot = INITIAL_SNAPSHOT;
  private undoLease: symbol | null = null;

  constructor(private readonly dependencies: DiscoverySavedSearchControllerDependencies) {}

  readonly getSnapshot = (): DiscoverySavedSearchSnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
    this.emit();
    void this.refresh();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.refreshBatch = null;
    this.catalogMutationLease = null;
    this.confirmingDeletes.clear();
    this.rowLeases.clear();
    this.saveLease = null;
    this.undoLease = null;
    this.snapshot = {
      ...this.snapshot,
      rowActions: new Map(),
      saving: false,
      undoBusy: false,
    };
  }

  async refresh(): Promise<Error | null> {
    if (!this.active || !this.dependencies.desktopRuntime) return null;
    const current = this.refreshBatch;
    if (current && current.lifecycle === this.lifecycle && !current.settled) {
      current.dirty = true;
      return current.promise;
    }
    const batch: RefreshBatch = {
      dirty: true,
      lifecycle: this.lifecycle,
      promise: Promise.resolve(null),
      settled: false,
    };
    batch.promise = this.drainRefresh(batch).finally(() => {
      if (this.refreshBatch === batch) this.refreshBatch = null;
    });
    this.refreshBatch = batch;
    return batch.promise;
  }

  async save(
    query: string,
    sources: readonly DiscoverySource[],
    ports: Pick<DiscoverySavedSearchActionPorts, "reportMessage">,
  ): Promise<void> {
    const normalizedQuery = query.trim();
    if (
      !this.active ||
      !this.dependencies.desktopRuntime ||
      !normalizedQuery ||
      this.saveLease ||
      this.catalogMutationLease
    ) {
      return;
    }
    const lease = Symbol("save");
    const lifecycle = this.lifecycle;
    const startedAt = this.now();
    this.saveLease = lease;
    this.catalogMutationLease = lease;
    this.update({ saving: true });
    try {
      const smokeFailure = this.dependencies.consumeFailure?.("save");
      if (smokeFailure) throw smokeFailure;
      if (!this.isCurrentLifecycle(lifecycle)) return;
      const deletedItem = this.snapshot.undo?.item ?? null;
      const restoreDeletedItem =
        deletedItem &&
        matchesSavedSearch(deletedItem, normalizedQuery, sources, this.dependencies.defaultSources)
          ? deletedItem
          : null;
      const result = restoreDeletedItem
        ? null
        : await this.dependencies.data.create(normalizedQuery, [...sources]);
      if (restoreDeletedItem) await this.dependencies.data.restore(restoreDeletedItem.id);
      await this.wait(startedAt, "save");
      if (!this.isCurrentLifecycle(lifecycle)) return;
      if (restoreDeletedItem) {
        this.update({
          items: upsertSavedSearch(this.snapshot.items, restoreDeletedItem),
          undo: null,
        });
      }
      const successMessage = restoreDeletedItem
        ? `已恢复检索订阅:“${normalizedQuery}”`
        : result?.created
          ? `已保存检索订阅:“${normalizedQuery}”,有新结果时会通知你`
          : `检索订阅已存在:“${normalizedQuery}”`;
      const refreshFailure = await this.refresh();
      this.reportCommitted(successMessage, refreshFailure, ports.reportMessage, lifecycle);
    } catch (error) {
      await this.wait(startedAt, "save");
      this.report(
        `保存订阅失败，检索条件仍保留，可重新保存:${this.describeError(error)}`,
        ports.reportMessage,
        lifecycle,
      );
    } finally {
      if (this.saveLease === lease) {
        this.saveLease = null;
        this.update({ saving: false });
      }
      this.releaseCatalogMutation(lease);
    }
  }

  async open(saved: SavedSearchView, ports: DiscoverySavedSearchActionPorts): Promise<void> {
    const lease = this.acquireRow(saved.id, "opening");
    if (!lease) return;
    const lifecycle = this.lifecycle;
    const startedAt = this.now();
    const sources =
      saved.sources && saved.sources.length > 0
        ? [...saved.sources]
        : [...this.dependencies.defaultSources];
    this.report(`正在打开订阅:“${saved.query}”...`, ports.reportMessage, lifecycle);
    try {
      let opened: boolean;
      try {
        opened = await ports.activateSearch({ query: saved.query, sources });
        await this.wait(startedAt, "opening");
      } catch (error) {
        await this.wait(startedAt, "opening");
        this.report(`打开订阅失败:${this.describeError(error)}`, ports.reportMessage, lifecycle);
        return;
      }
      if (!this.isCurrentLifecycle(lifecycle) || !opened || saved.newCount <= 0) return;
      try {
        await this.dependencies.data.clearBadge(saved.id);
      } catch (error) {
        this.report(
          `已打开订阅，但清除新结果标记失败，可重新打开后重试:${this.describeError(error)}`,
          ports.reportMessage,
          lifecycle,
        );
        return;
      }
      if (!this.isCurrentLifecycle(lifecycle)) return;
      this.patchItem(saved.id, (item) => ({ ...item, newCount: 0 }));
      const refreshFailure = await this.refresh();
      if (refreshFailure) {
        this.report(
          `已打开订阅，但新结果标记刷新失败，可稍后刷新:${this.describeError(refreshFailure)}`,
          ports.reportMessage,
          lifecycle,
        );
      }
    } finally {
      this.releaseRow(saved.id, lease);
    }
  }

  async check(
    id: string,
    ports: Pick<DiscoverySavedSearchActionPorts, "reportMessage">,
  ): Promise<void> {
    const lease = this.acquireRow(id, "checking");
    if (!lease) return;
    const lifecycle = this.lifecycle;
    const startedAt = this.now();
    const startingNewCount = this.snapshot.items.find((item) => item.id === id)?.newCount ?? 0;
    this.report("正在检查订阅的新结果...", ports.reportMessage, lifecycle);
    try {
      const freshCount = await this.dependencies.data.run(id);
      await this.wait(startedAt, "checking");
      if (!this.isCurrentLifecycle(lifecycle)) return;
      this.patchItem(id, (item) => ({
        ...item,
        lastError: null,
        lastRunAt: this.now(),
        newCount: Math.max(item.newCount, startingNewCount + freshCount),
      }));
      const successMessage = freshCount > 0 ? `发现 ${freshCount} 篇新结果` : "暂无新结果";
      const refreshFailure = await this.refresh();
      this.reportCommitted(successMessage, refreshFailure, ports.reportMessage, lifecycle);
    } catch (error) {
      await this.wait(startedAt, "checking");
      this.report(`检查订阅失败:${this.describeError(error)}`, ports.reportMessage, lifecycle);
    } finally {
      this.releaseRow(id, lease);
    }
  }

  async remove(saved: SavedSearchView, ports: DiscoverySavedSearchActionPorts): Promise<void> {
    if (!this.canReserveRow(saved.id) || this.catalogMutationLease) return;
    const mutationLease = Symbol("delete-mutation");
    const confirmationLease = Symbol("delete-confirmation");
    const lifecycle = this.lifecycle;
    this.catalogMutationLease = mutationLease;
    this.confirmingDeletes.set(saved.id, confirmationLease);
    try {
      let confirmed: boolean;
      try {
        confirmed = await ports.confirm({
          title: "删除检索订阅？",
          description: `将停止跟踪「${saved.query}」的新论文。`,
          details: [
            "已经入库的文献和当前检索结果不会被删除。",
            "之后可以用同样关键词重新保存订阅。",
          ],
          confirmLabel: "删除订阅",
          tone: "warning",
        });
      } finally {
        if (this.confirmingDeletes.get(saved.id) === confirmationLease) {
          this.confirmingDeletes.delete(saved.id);
        }
      }
      if (!confirmed || !this.isCurrentLifecycle(lifecycle)) return;

      const lease = this.acquireRow(saved.id, "deleting");
      if (!lease) return;
      const startedAt = this.now();
      this.report(`正在删除检索订阅:“${saved.query}”...`, ports.reportMessage, lifecycle);
      try {
        const smokeFailure = this.dependencies.consumeFailure?.("delete");
        if (smokeFailure) throw smokeFailure;
        await this.dependencies.data.delete(saved.id);
        await this.wait(startedAt, "deleting");
        if (!this.isCurrentLifecycle(lifecycle)) return;
        const undoMessage = `已删除检索订阅:“${saved.query}”`;
        this.update({
          items: this.snapshot.items.filter((item) => item.id !== saved.id),
          undo: { item: saved, message: undoMessage },
        });
        const refreshFailure = await this.refresh();
        this.reportCommitted(undoMessage, refreshFailure, ports.reportMessage, lifecycle);
      } catch (error) {
        await this.wait(startedAt, "deleting");
        this.report(
          `删除订阅失败，订阅仍保留，可重新删除:${this.describeError(error)}`,
          ports.reportMessage,
          lifecycle,
        );
      } finally {
        this.releaseRow(saved.id, lease);
      }
    } finally {
      this.releaseCatalogMutation(mutationLease);
    }
  }

  async undoDelete(ports: Pick<DiscoverySavedSearchActionPorts, "reportMessage">): Promise<void> {
    const undo = this.snapshot.undo;
    if (
      !this.active ||
      !this.dependencies.desktopRuntime ||
      !undo ||
      this.undoLease !== null ||
      this.catalogMutationLease
    ) {
      return;
    }
    const lease = Symbol("restore");
    const lifecycle = this.lifecycle;
    const startedAt = this.now();
    this.undoLease = lease;
    this.catalogMutationLease = lease;
    this.update({ undoBusy: true });
    this.report("正在撤销删除检索订阅...", ports.reportMessage, lifecycle);
    try {
      const smokeFailure = this.dependencies.consumeFailure?.("restore");
      if (smokeFailure) throw smokeFailure;
      await this.dependencies.data.restore(undo.item.id);
      await this.wait(startedAt, "restore");
      if (!this.isCurrentLifecycle(lifecycle)) return;
      this.update({
        items: upsertSavedSearch(this.snapshot.items, undo.item),
        undo: null,
      });
      const successMessage = "已撤销删除检索订阅";
      const refreshFailure = await this.refresh();
      this.reportCommitted(successMessage, refreshFailure, ports.reportMessage, lifecycle);
    } catch (error) {
      await this.wait(startedAt, "restore");
      this.report(
        `撤销删除订阅失败，撤销入口仍保留，可重新撤销:${this.describeError(error)}`,
        ports.reportMessage,
        lifecycle,
      );
    } finally {
      if (this.undoLease === lease) {
        this.undoLease = null;
        this.update({ undoBusy: false });
      }
      this.releaseCatalogMutation(lease);
    }
  }

  private acquireRow(id: string, action: DiscoverySavedSearchRowAction): symbol | null {
    if (!this.active || !this.canReserveRow(id)) return null;
    const token = Symbol(action);
    this.rowLeases.set(id, { action, token });
    this.publishRowActions();
    return token;
  }

  private canReserveRow(id: string): boolean {
    return !this.rowLeases.has(id) && !this.confirmingDeletes.has(id);
  }

  private releaseCatalogMutation(token: symbol): void {
    if (this.catalogMutationLease === token) this.catalogMutationLease = null;
  }

  private releaseRow(id: string, token: symbol): void {
    if (this.rowLeases.get(id)?.token !== token) return;
    this.rowLeases.delete(id);
    this.publishRowActions();
  }

  private publishRowActions(): void {
    this.update({
      rowActions: new Map([...this.rowLeases].map(([id, lease]) => [id, lease.action] as const)),
    });
  }

  private patchItem(id: string, updateItem: (item: SavedSearchView) => SavedSearchView): void {
    this.update({
      items: this.snapshot.items.map((item) => (item.id === id ? updateItem(item) : item)),
    });
  }

  private reportCommitted(
    successMessage: string,
    refreshFailure: Error | null,
    reportMessage: (message: string) => void,
    lifecycle: number,
  ): void {
    if (!refreshFailure) {
      this.report(successMessage, reportMessage, lifecycle);
      return;
    }
    this.report(
      `${successMessage}，但列表刷新失败，可稍后刷新:${this.describeError(refreshFailure)}`,
      reportMessage,
      lifecycle,
    );
  }

  private report(
    message: string,
    reportMessage: (message: string) => void,
    lifecycle = this.lifecycle,
  ): void {
    if (this.isCurrentLifecycle(lifecycle)) reportMessage(message);
  }

  private update(patch: Partial<DiscoverySavedSearchSnapshot>): void {
    if (!this.active) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private async drainRefresh(batch: RefreshBatch): Promise<Error | null> {
    try {
      let finalError: Error | null = null;
      while (this.isCurrentLifecycle(batch.lifecycle) && batch.dirty) {
        batch.dirty = false;
        let items: SavedSearchView[] | null = null;
        let loadError: Error | null = null;
        try {
          items = await this.dependencies.data.list();
        } catch (error) {
          loadError = toDiscoverySavedSearchError(error, this.describeError);
        }
        if (!this.isCurrentLifecycle(batch.lifecycle)) return null;
        if (batch.dirty) continue;
        if (loadError) {
          finalError = loadError;
        } else if (items) {
          finalError = null;
          this.update({ items });
        }
      }
      return finalError;
    } finally {
      batch.settled = true;
    }
  }

  private isCurrentLifecycle(lifecycle: number): boolean {
    return this.active && this.lifecycle === lifecycle;
  }

  private get now(): () => number {
    return this.dependencies.now ?? Date.now;
  }

  private get describeError(): (error: unknown) => string {
    return this.dependencies.describeError ?? describeSafeError;
  }

  private async wait(
    startedAt: number,
    action: DiscoverySavedSearchRowAction | DiscoverySavedSearchFailureKind,
  ): Promise<void> {
    await this.dependencies.waitForMinimumElapsed?.(startedAt, action);
  }
}

export function createDiscoverySavedSearchController(
  dependencies: DiscoverySavedSearchControllerDependencies,
): DiscoverySavedSearchController {
  return new DiscoverySavedSearchController(dependencies);
}
