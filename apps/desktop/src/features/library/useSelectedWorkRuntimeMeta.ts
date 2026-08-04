import { useEffect, useState } from "react";
import { type WorkRuntimeMeta, type WorkTableMeta } from "../../services/library-page-data";

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

export function selectedWorkRuntimeMetaKey(
  request: Pick<SelectedWorkRuntimeMetaRequest, "runtimeVersion" | "workId">,
): string {
  return `${request.workId}\u0000${request.runtimeVersion}`;
}

/**
 * Owns the latest selected-work metadata request without depending on React.
 *
 * The underlying database read is not abortable, so cancellation is a logical
 * lease: only the newest, still-active request may publish a result. A rejected
 * current request publishes an explicit failure; a rejected stale request stays
 * stale and therefore cannot clear newer metadata.
 */
export class SelectedWorkRuntimeMetaCoordinator {
  private activeToken: symbol | null = null;

  request(
    request: SelectedWorkRuntimeMetaRequest,
    load: LibraryWorkRuntimeMetaLoader,
  ): SelectedWorkRuntimeMetaLease {
    const key = selectedWorkRuntimeMetaKey(request);
    const token = Symbol("selected-work-runtime-meta");
    this.activeToken = token;

    let pending: Promise<WorkRuntimeMeta>;
    try {
      pending = load(request.workId, request.annotationCount);
    } catch (error) {
      pending = Promise.reject(error);
    }

    const accept = (value: WorkRuntimeMeta): SelectedWorkRuntimeMetaResult => {
      if (this.activeToken !== token) return { key, status: "stale" };
      return { loaded: { key, value }, status: "accepted" };
    };
    const fail = (): SelectedWorkRuntimeMetaResult => {
      if (this.activeToken !== token) return { key, status: "stale" };
      return { key, status: "failed" };
    };
    const result = pending.then(
      (value) => accept(value),
      () => fail(),
    );

    return {
      cancel: () => {
        if (this.activeToken === token) this.activeToken = null;
      },
      result,
    };
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
    const lease = coordinator.request({ annotationCount, runtimeVersion, workId }, load);
    void lease.result.then((result) => {
      if (result.status === "accepted") {
        setSettled({ key: result.loaded.key, status: "ready", value: result.loaded.value });
      } else if (result.status === "failed") {
        setSettled({ key: result.key, status: "error" });
      }
    });
    return lease.cancel;
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
