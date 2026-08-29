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
  it("accepts B after its superseded A read completes", async () => {
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

    await expect(requestA.result).resolves.toEqual({
      key: selectedWorkRuntimeMetaKey({ runtimeVersion: "version-a", workId: "work-a" }),
      status: "stale",
    });
    expect(load).toHaveBeenCalledTimes(1);

    slowA.resolve(meta(1));
    await Promise.resolve();
    expect(load).toHaveBeenNthCalledWith(2, "work-b", 2);

    fastB.resolve(meta(2));
    await expect(requestB.result).resolves.toEqual({
      loaded: {
        key: selectedWorkRuntimeMetaKey({ runtimeVersion: "version-b", workId: "work-b" }),
        value: meta(2),
      },
      status: "accepted",
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

    await expect(oldRequest.result).resolves.toMatchObject({ status: "stale" });
    oldFailure.reject(new Error("old metadata failed"));
    await Promise.resolve();
    latest.resolve(meta(3));
    await expect(latestRequest.result).resolves.toMatchObject({ status: "accepted" });
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

    await expect(oldRequest.result).resolves.toEqual({
      key: "same-work\u0000pdf:1",
      status: "stale",
    });
    oldVersion.resolve(meta(1));
    await Promise.resolve();
    expect(load).toHaveBeenNthCalledWith(2, "same-work", 4);

    newVersion.resolve(meta(2));
    await expect(newRequest.result).resolves.toMatchObject({
      loaded: { key: "same-work\u0000pdf:2" },
      status: "accepted",
    });
    expect(load).toHaveBeenNthCalledWith(1, "same-work", 4);
    expect(load).toHaveBeenNthCalledWith(2, "same-work", 4);
  });

  it("starts A then only the latest C during a rapid A/B/C selection sequence", async () => {
    const activeA = deferred<WorkRuntimeMeta>();
    const latestC = deferred<WorkRuntimeMeta>();
    const load = vi.fn<LibraryWorkRuntimeMetaLoader>((workId) =>
      workId === "work-a" ? activeA.promise : latestC.promise,
    );
    const coordinator = new SelectedWorkRuntimeMetaCoordinator();

    const requestA = coordinator.request(
      { annotationCount: 1, runtimeVersion: "v1", workId: "work-a" },
      load,
    );
    const requestB = coordinator.request(
      { annotationCount: 2, runtimeVersion: "v1", workId: "work-b" },
      load,
    );
    const requestC = coordinator.request(
      { annotationCount: 3, runtimeVersion: "v1", workId: "work-c" },
      load,
    );

    await expect(requestA.result).resolves.toMatchObject({ status: "stale" });
    await expect(requestB.result).resolves.toMatchObject({ status: "stale" });
    expect(load.mock.calls.map(([workId]) => workId)).toEqual(["work-a"]);

    activeA.resolve(meta(1));
    await Promise.resolve();
    expect(load.mock.calls.map(([workId]) => workId)).toEqual(["work-a", "work-c"]);
    expect(load).toHaveBeenNthCalledWith(2, "work-c", 3);

    latestC.resolve(meta(3));
    await expect(requestC.result).resolves.toEqual({
      loaded: {
        key: selectedWorkRuntimeMetaKey({ runtimeVersion: "v1", workId: "work-c" }),
        value: meta(3),
      },
      status: "accepted",
    });
  });
});
