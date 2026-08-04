import { describe, expect, it, vi } from "vitest";
import type { WorkRuntimeMeta } from "../../services/library-page-data";
import {
  SelectedWorkRuntimeMetaCoordinator,
  selectedWorkRuntimeMetaKey,
  type LibraryWorkRuntimeMetaLoader,
} from "./useSelectedWorkRuntimeMeta";

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    reject = nextReject;
    resolve = nextResolve;
  });
  return { promise, reject, resolve };
}

function meta(pdfCount: number): WorkRuntimeMeta {
  return {
    annotationCount: 0,
    notePreviews: [],
    pdfCount,
    pdfPreview: null,
    sentinelState: null,
    sentinelStatus: null,
    sentinelTaskCount: 0,
  };
}

describe("SelectedWorkRuntimeMetaCoordinator", () => {
  it("accepts fast B and rejects slow A after the selection changes", async () => {
    const slowA = deferred<WorkRuntimeMeta>();
    const fastB = deferred<WorkRuntimeMeta>();
    const load = vi.fn<LibraryWorkRuntimeMetaLoader>((workId) =>
      workId === "work-a" ? slowA.promise : fastB.promise,
    );
    const coordinator = new SelectedWorkRuntimeMetaCoordinator();

    const requestA = coordinator.request(
      { annotationCount: 1, runtimeVersion: "version-a", workId: "work-a" },
      load,
    );
    const requestB = coordinator.request(
      { annotationCount: 2, runtimeVersion: "version-b", workId: "work-b" },
      load,
    );

    fastB.resolve(meta(2));
    await expect(requestB.result).resolves.toEqual({
      loaded: {
        key: selectedWorkRuntimeMetaKey({ runtimeVersion: "version-b", workId: "work-b" }),
        value: meta(2),
      },
      status: "accepted",
    });

    slowA.resolve(meta(1));
    await expect(requestA.result).resolves.toEqual({
      key: selectedWorkRuntimeMetaKey({ runtimeVersion: "version-a", workId: "work-a" }),
      status: "stale",
    });
  });

  it("does not let an old rejection clear the newer accepted value", async () => {
    const oldFailure = deferred<WorkRuntimeMeta>();
    const latest = deferred<WorkRuntimeMeta>();
    const load = vi.fn<LibraryWorkRuntimeMetaLoader>((workId) =>
      workId === "work-old" ? oldFailure.promise : latest.promise,
    );
    const coordinator = new SelectedWorkRuntimeMetaCoordinator();

    const oldRequest = coordinator.request(
      { annotationCount: 0, runtimeVersion: "old", workId: "work-old" },
      load,
    );
    const latestRequest = coordinator.request(
      { annotationCount: 0, runtimeVersion: "latest", workId: "work-latest" },
      load,
    );

    latest.resolve(meta(3));
    await expect(latestRequest.result).resolves.toMatchObject({ status: "accepted" });
    oldFailure.reject(new Error("old metadata failed"));
    await expect(oldRequest.result).resolves.toMatchObject({ status: "stale" });
  });

  it("publishes a current failure instead of leaving the view in a loading state", async () => {
    const failure = deferred<WorkRuntimeMeta>();
    const coordinator = new SelectedWorkRuntimeMetaCoordinator();
    const request = coordinator.request(
      { annotationCount: 0, runtimeVersion: "current", workId: "work-current" },
      () => failure.promise,
    );

    failure.reject(new Error("runtime metadata unavailable"));

    await expect(request.result).resolves.toEqual({
      key: selectedWorkRuntimeMetaKey({
        runtimeVersion: "current",
        workId: "work-current",
      }),
      status: "failed",
    });
  });

  it("treats a cancelled request as stale when its read eventually completes", async () => {
    const pending = deferred<WorkRuntimeMeta>();
    const coordinator = new SelectedWorkRuntimeMetaCoordinator();
    const request = coordinator.request(
      { annotationCount: 0, runtimeVersion: "selected", workId: "work-selected" },
      () => pending.promise,
    );

    request.cancel();
    pending.resolve(meta(1));

    await expect(request.result).resolves.toEqual({
      key: selectedWorkRuntimeMetaKey({
        runtimeVersion: "selected",
        workId: "work-selected",
      }),
      status: "stale",
    });
  });

  it("uses runtimeVersion to supersede an older read for the same work", async () => {
    const oldVersion = deferred<WorkRuntimeMeta>();
    const newVersion = deferred<WorkRuntimeMeta>();
    const load = vi
      .fn<LibraryWorkRuntimeMetaLoader>()
      .mockImplementationOnce(() => oldVersion.promise)
      .mockImplementationOnce(() => newVersion.promise);
    const coordinator = new SelectedWorkRuntimeMetaCoordinator();

    const oldRequest = coordinator.request(
      { annotationCount: 4, runtimeVersion: "pdf:1", workId: "same-work" },
      load,
    );
    const newRequest = coordinator.request(
      { annotationCount: 4, runtimeVersion: "pdf:2", workId: "same-work" },
      load,
    );

    newVersion.resolve(meta(2));
    await expect(newRequest.result).resolves.toMatchObject({
      loaded: { key: "same-work\u0000pdf:2" },
      status: "accepted",
    });
    oldVersion.resolve(meta(1));
    await expect(oldRequest.result).resolves.toEqual({
      key: "same-work\u0000pdf:1",
      status: "stale",
    });
    expect(load).toHaveBeenNthCalledWith(1, "same-work", 4);
    expect(load).toHaveBeenNthCalledWith(2, "same-work", 4);
  });
});
