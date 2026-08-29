import { useEffect, useState } from "react";
import type { WorkWithAuthors } from "@aurascholar/db";
import { isDesktopRuntime } from "../../services/aura-platform";
import {
  loadLibraryWorkInspectorDetail,
  type LibraryWorkInspectorDetail,
} from "../../services/library-page-data";

const SELECTED_WORK_DETAIL_DEBOUNCE_MS = 120;

export type LibraryWorkDetailLoader = (
  workId: string,
) => Promise<LibraryWorkInspectorDetail | null>;
export type SelectedWorkDetailStatus = "idle" | "loading" | "ready" | "error";

interface SelectedWorkDetailRequest {
  runtimeVersion: number;
  workId: string;
}

type SelectedWorkDetailResult =
  | { key: string; status: "failed" | "stale" }
  | { key: string; status: "accepted"; value: LibraryWorkInspectorDetail | null };

interface SelectedWorkDetailSubscription {
  key: string;
  settled: boolean;
  resolve(result: SelectedWorkDetailResult): void;
}

interface SelectedWorkDetailJob {
  key: string;
  load: LibraryWorkDetailLoader;
  subscribers: Set<SelectedWorkDetailSubscription>;
  workId: string;
}

export interface SelectedWorkDetailLease {
  cancel(): void;
  result: Promise<SelectedWorkDetailResult>;
}

/**
 * Admits one inspector read at a time and retains only the latest queued
 * selection. IPC invokes cannot be aborted, but stale selections never build
 * an unbounded main-process database queue.
 */
export class SelectedWorkDetailCoordinator {
  private active: SelectedWorkDetailJob | null = null;
  private pending: SelectedWorkDetailJob | null = null;

  request(
    request: SelectedWorkDetailRequest,
    load: LibraryWorkDetailLoader,
  ): SelectedWorkDetailLease {
    const key = selectedWorkDetailKey(request);
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
    const job: SelectedWorkDetailJob = {
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
  ): SelectedWorkDetailSubscription & { result: Promise<SelectedWorkDetailResult> } {
    let resolve!: (result: SelectedWorkDetailResult) => void;
    const result = new Promise<SelectedWorkDetailResult>((nextResolve) => {
      resolve = nextResolve;
    });
    return { key, result, resolve, settled: false };
  }

  private lease(
    job: SelectedWorkDetailJob,
    subscription: SelectedWorkDetailSubscription & { result: Promise<SelectedWorkDetailResult> },
  ): SelectedWorkDetailLease {
    return {
      cancel: () => this.cancel(job, subscription),
      result: subscription.result,
    };
  }

  private cancel(job: SelectedWorkDetailJob, subscription: SelectedWorkDetailSubscription): void {
    job.subscribers.delete(subscription);
    this.settle(subscription, { key: subscription.key, status: "stale" });
    if (this.pending === job && job.subscribers.size === 0) this.pending = null;
  }

  private staleJob(job: SelectedWorkDetailJob | null): void {
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
    let detail: Promise<LibraryWorkInspectorDetail | null>;
    try {
      detail = job.load(job.workId);
    } catch (error) {
      detail = Promise.reject(error);
    }
    void detail.then(
      (value) => this.finish(job, { key: job.key, status: "accepted", value }),
      () => this.finish(job, { key: job.key, status: "failed" }),
    );
  }

  private finish(job: SelectedWorkDetailJob, result: SelectedWorkDetailResult): void {
    if (this.active !== job) return;
    this.active = null;
    for (const subscription of job.subscribers) this.settle(subscription, result);
    job.subscribers.clear();
    this.startNext();
  }

  private settle(
    subscription: SelectedWorkDetailSubscription,
    result: SelectedWorkDetailResult,
  ): void {
    if (subscription.settled) return;
    subscription.settled = true;
    subscription.resolve(result);
  }
}

export function selectedWorkDetailKey(
  request: Pick<SelectedWorkDetailRequest, "runtimeVersion" | "workId">,
): string {
  return `${request.workId}\u0000${request.runtimeVersion}`;
}

export function useSelectedWorkDetail(input: {
  previewWork: WorkWithAuthors | null;
  runtimeVersion: number;
  workId: string | null;
}): { status: SelectedWorkDetailStatus; work: LibraryWorkInspectorDetail | null } {
  const { previewWork, runtimeVersion, workId } = input;
  const desktopRuntime = isDesktopRuntime();
  const requestKey = workId ? selectedWorkDetailKey({ runtimeVersion, workId }) : null;
  const [settled, setSettled] = useState<
    | { key: string; status: "error" }
    | { key: string; status: "ready"; value: LibraryWorkInspectorDetail | null }
    | null
  >(null);
  const [coordinator] = useState(() => new SelectedWorkDetailCoordinator());

  useEffect(() => {
    if (!desktopRuntime || !workId || !requestKey) return;
    let lease: SelectedWorkDetailLease | null = null;
    const timer = setTimeout(() => {
      lease = coordinator.request({ runtimeVersion, workId }, loadLibraryWorkInspectorDetail);
      void lease.result.then((result) => {
        if (result.status === "accepted")
          setSettled({ key: result.key, status: "ready", value: result.value });
        else if (result.status === "failed") setSettled({ key: result.key, status: "error" });
      });
    }, SELECTED_WORK_DETAIL_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      lease?.cancel();
    };
  }, [coordinator, desktopRuntime, requestKey, runtimeVersion, workId]);

  if (!workId) return { status: "idle", work: null };
  if (!desktopRuntime)
    return previewWork
      ? { status: "ready", work: inspectorDetailFromPreviewWork(previewWork) }
      : { status: "error", work: null };
  if (settled?.key !== requestKey) return { status: "loading", work: null };
  return settled.status === "error"
    ? { status: "error", work: null }
    : settled.value
      ? { status: "ready", work: settled.value }
      : { status: "error", work: null };
}

function inspectorDetailFromPreviewWork(work: WorkWithAuthors): LibraryWorkInspectorDetail {
  return {
    abstract: work.abstract,
    doi: work.doi,
    edition: work.edition,
    isbn: work.isbn,
    issn: work.issn,
    issue: work.issue,
    language: work.language,
    pages: work.pages,
    place_published: work.place_published,
    publisher: work.publisher,
    volume: work.volume,
  };
}
