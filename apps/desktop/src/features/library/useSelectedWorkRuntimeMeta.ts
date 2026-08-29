import { useEffect, useState } from "react";
import { type WorkRuntimeMeta, type WorkTableMeta } from "../../services/library-page-data";

const SELECTED_WORK_RUNTIME_META_DEBOUNCE_MS = 120;

export type LibraryWorkRuntimeMetaLoader = (
  workId: string,
  annotationCount: number,
) => Promise<WorkRuntimeMeta>;

export interface SelectedWorkRuntimeMetaRequest {
  annotationCount: number;
  runtimeVersion: string;
  workId: string;
}

export interface LoadedRuntimeMeta {
  key: string;
  value: WorkRuntimeMeta;
}

export type SelectedWorkRuntimeMetaResult =
  | {
      loaded: LoadedRuntimeMeta;
      status: "accepted";
    }
  | {
      key: string;
      status: "failed";
    }
  | {
      key: string;
      status: "stale";
    };

export interface SelectedWorkRuntimeMetaLease {
  cancel(): void;
  result: Promise<SelectedWorkRuntimeMetaResult>;
}

interface SelectedWorkRuntimeMetaSubscription {
  key: string;
  resolve(result: SelectedWorkRuntimeMetaResult): void;
  settled: boolean;
}

interface SelectedWorkRuntimeMetaJob {
  annotationCount: number;
  key: string;
  load: LibraryWorkRuntimeMetaLoader;
  subscribers: Set<SelectedWorkRuntimeMetaSubscription>;
  workId: string;
}

export function selectedWorkRuntimeMetaKey(
  request: Pick<SelectedWorkRuntimeMetaRequest, "runtimeVersion" | "workId">,
): string {
  return `${request.workId}\u0000${request.runtimeVersion}`;
}

/**
 * Admits one metadata read at a time and retains only the latest queued
 * selection. IPC invokes cannot be aborted, but stale selections never build
 * an unbounded main-process database queue.
 *
 * The underlying database read is not abortable, so cancellation is a logical
 * lease. A rejected current request publishes an explicit failure; a rejected
 * stale request stays stale and therefore cannot clear newer metadata.
 */
export class SelectedWorkRuntimeMetaCoordinator {
  private active: SelectedWorkRuntimeMetaJob | null = null;
  private pending: SelectedWorkRuntimeMetaJob | null = null;

  request(
    request: SelectedWorkRuntimeMetaRequest,
    load: LibraryWorkRuntimeMetaLoader,
  ): SelectedWorkRuntimeMetaLease {
    const key = selectedWorkRuntimeMetaKey(request);
    const subscription = this.createSubscription(key);
    if (this.active?.key === key) {
      this.staleJob(this.pending);
      this.pending = null;
      this.active.subscribers.add(subscription);
      return this.lease(this.active, subscription);
    }
    if (this.pending?.key === key) {
      this.pending.subscribers.add(subscription);
      return this.lease(this.pending, subscription);
    }

    this.staleJob(this.pending);
    const job: SelectedWorkRuntimeMetaJob = {
      annotationCount: request.annotationCount,
      key,
      load,
      subscribers: new Set([subscription]),
      workId: request.workId,
    };
    this.pending = job;
    this.staleJob(this.active);
    this.startNext();
    return this.lease(job, subscription);
  }

  private createSubscription(
    key: string,
  ): SelectedWorkRuntimeMetaSubscription & { result: Promise<SelectedWorkRuntimeMetaResult> } {
    let resolve!: (result: SelectedWorkRuntimeMetaResult) => void;
    const result = new Promise<SelectedWorkRuntimeMetaResult>((nextResolve) => {
      resolve = nextResolve;
    });
    return { key, resolve, result, settled: false };
  }

  private lease(
    job: SelectedWorkRuntimeMetaJob,
    subscription: SelectedWorkRuntimeMetaSubscription & {
      result: Promise<SelectedWorkRuntimeMetaResult>;
    },
  ): SelectedWorkRuntimeMetaLease {
    return {
      cancel: () => this.cancel(job, subscription),
      result: subscription.result,
    };
  }

  private cancel(
    job: SelectedWorkRuntimeMetaJob,
    subscription: SelectedWorkRuntimeMetaSubscription,
  ): void {
    job.subscribers.delete(subscription);
    this.settle(subscription, { key: subscription.key, status: "stale" });
    if (this.pending === job && job.subscribers.size === 0) this.pending = null;
  }

  private staleJob(job: SelectedWorkRuntimeMetaJob | null): void {
    if (!job) return;
    for (const subscription of job.subscribers) {
      this.settle(subscription, { key: subscription.key, status: "stale" });
    }
    job.subscribers.clear();
  }

  private startNext(): void {
    if (this.active || !this.pending) return;
    const job = this.pending;
    this.pending = null;
    if (job.subscribers.size === 0) return this.startNext();
    this.active = job;

    let metadata: Promise<WorkRuntimeMeta>;
    try {
      metadata = job.load(job.workId, job.annotationCount);
    } catch (error) {
      metadata = Promise.reject(error);
    }
    void metadata.then(
      (value) => this.finish(job, { loaded: { key: job.key, value }, status: "accepted" }),
      () => this.finish(job, { key: job.key, status: "failed" }),
    );
  }

  private finish(job: SelectedWorkRuntimeMetaJob, result: SelectedWorkRuntimeMetaResult): void {
    if (this.active !== job) return;
    this.active = null;
    for (const subscription of job.subscribers) this.settle(subscription, result);
    job.subscribers.clear();
    this.startNext();
  }

  private settle(
    subscription: SelectedWorkRuntimeMetaSubscription,
    result: SelectedWorkRuntimeMetaResult,
  ): void {
    if (subscription.settled) return;
    subscription.settled = true;
    subscription.resolve(result);
  }
}

export function mergePreviewWorkRuntimeMeta(
  previewMeta: WorkRuntimeMeta | null,
  tableMeta: WorkTableMeta | undefined,
): WorkRuntimeMeta | null {
  if (!previewMeta) return null;
  return {
    ...previewMeta,
    sentinelTaskCount: tableMeta?.sentinelTaskCount ?? previewMeta.sentinelTaskCount,
    sentinelStatus: tableMeta?.sentinelStatus ?? previewMeta.sentinelStatus,
    sentinelState: tableMeta?.sentinelState ?? previewMeta.sentinelState,
  };
}

export type SelectedWorkRuntimeMetaStatus = "idle" | "loading" | "ready" | "error";

export interface SelectedWorkRuntimeMetaSnapshot {
  meta: WorkRuntimeMeta | null;
  status: SelectedWorkRuntimeMetaStatus;
}

type SettledRuntimeMeta =
  | { key: string; status: "error" }
  | { key: string; status: "ready"; value: WorkRuntimeMeta };

export function useSelectedWorkRuntimeMeta(input: {
  annotationCount: number;
  desktopRuntime: boolean;
  load: LibraryWorkRuntimeMetaLoader;
  previewMeta: WorkRuntimeMeta | null;
  runtimeVersion: string;
  tableMeta: WorkTableMeta | undefined;
  workId: string | null;
}): SelectedWorkRuntimeMetaSnapshot {
  const { annotationCount, desktopRuntime, load, previewMeta, runtimeVersion, tableMeta, workId } =
    input;
  const requestKey = workId ? selectedWorkRuntimeMetaKey({ runtimeVersion, workId }) : null;
  const [settled, setSettled] = useState<SettledRuntimeMeta | null>(null);
  const [coordinator] = useState(() => new SelectedWorkRuntimeMetaCoordinator());

  useEffect(() => {
    if (!desktopRuntime || !workId || !requestKey) return;
    let lease: SelectedWorkRuntimeMetaLease | null = null;
    const timer = setTimeout(() => {
      lease = coordinator.request({ annotationCount, runtimeVersion, workId }, load);
      void lease.result.then((result) => {
        if (result.status === "accepted") {
          setSettled({ key: result.loaded.key, status: "ready", value: result.loaded.value });
        } else if (result.status === "failed") {
          setSettled({ key: result.key, status: "error" });
        }
      });
    }, SELECTED_WORK_RUNTIME_META_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      lease?.cancel();
    };
  }, [annotationCount, coordinator, desktopRuntime, load, requestKey, runtimeVersion, workId]);

  if (!workId) return { meta: null, status: "idle" };
  if (!desktopRuntime) {
    const meta = mergePreviewWorkRuntimeMeta(previewMeta, tableMeta);
    return { meta, status: meta ? "ready" : "error" };
  }
  if (settled?.key !== requestKey) return { meta: null, status: "loading" };
  if (settled.status === "error") return { meta: null, status: "error" };
  return { meta: settled.value, status: "ready" };
}
