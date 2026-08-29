import { describe, expect, it, vi } from "vitest";
import type { LibraryWorkInspectorDetail } from "../../services/library-page-data";
import {
  SelectedWorkDetailCoordinator,
  selectedWorkDetailKey,
  type LibraryWorkDetailLoader,
} from "./useSelectedWorkDetail";

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

function detail(doi: string): LibraryWorkInspectorDetail {
  return {
    abstract: "A bounded inspector detail",
    doi,
    edition: null,
    isbn: null,
    issn: null,
    issue: null,
    language: null,
    pages: null,
    place_published: null,
    publisher: null,
    volume: null,
  };
}

describe("SelectedWorkDetailCoordinator", () => {
  it("accepts the latest detail without publishing a stale response", async () => {
    const slow = deferred<LibraryWorkInspectorDetail | null>();
    const latest = deferred<LibraryWorkInspectorDetail | null>();
    const load = vi.fn<LibraryWorkDetailLoader>((workId) =>
      workId === "work-a" ? slow.promise : latest.promise,
    );
    const coordinator = new SelectedWorkDetailCoordinator();
    const first = coordinator.request({ runtimeVersion: 1, workId: "work-a" }, load);
    const second = coordinator.request({ runtimeVersion: 2, workId: "work-b" }, load);

    await expect(first.result).resolves.toEqual({
      key: selectedWorkDetailKey({ runtimeVersion: 1, workId: "work-a" }),
      status: "stale",
    });
    expect(load).toHaveBeenCalledTimes(1);

    slow.resolve(detail("10.1/old"));
    await Promise.resolve();
    expect(load).toHaveBeenCalledWith("work-b");

    latest.resolve(detail("10.1/latest"));
    await expect(second.result).resolves.toEqual({
      key: selectedWorkDetailKey({ runtimeVersion: 2, workId: "work-b" }),
      status: "accepted",
      value: expect.objectContaining({ doi: "10.1/latest" }),
    });
  });

  it("starts only the latest queued selection after an in-flight detail completes", async () => {
    const firstDetail = deferred<LibraryWorkInspectorDetail | null>();
    const latestDetail = deferred<LibraryWorkInspectorDetail | null>();
    const load = vi.fn<LibraryWorkDetailLoader>((workId) =>
      workId === "work-a" ? firstDetail.promise : latestDetail.promise,
    );
    const coordinator = new SelectedWorkDetailCoordinator();
    const first = coordinator.request({ runtimeVersion: 1, workId: "work-a" }, load);
    const skipped = coordinator.request({ runtimeVersion: 1, workId: "work-b" }, load);
    const latest = coordinator.request({ runtimeVersion: 1, workId: "work-c" }, load);

    await expect(first.result).resolves.toMatchObject({ status: "stale" });
    await expect(skipped.result).resolves.toMatchObject({ status: "stale" });
    expect(load.mock.calls.map(([workId]) => workId)).toEqual(["work-a"]);

    firstDetail.resolve(detail("10.1/a"));
    await Promise.resolve();
    expect(load.mock.calls.map(([workId]) => workId)).toEqual(["work-a", "work-c"]);

    latestDetail.resolve(detail("10.1/c"));
    await expect(latest.result).resolves.toMatchObject({
      status: "accepted",
      value: expect.objectContaining({ doi: "10.1/c" }),
    });
  });

  it("publishes a failure only while its detail request remains current", async () => {
    const pending = deferred<LibraryWorkInspectorDetail | null>();
    const coordinator = new SelectedWorkDetailCoordinator();
    const request = coordinator.request(
      { runtimeVersion: 1, workId: "work-a" },
      () => pending.promise,
    );

    pending.reject(new Error("metadata unavailable"));

    await expect(request.result).resolves.toEqual({
      key: selectedWorkDetailKey({ runtimeVersion: 1, workId: "work-a" }),
      status: "failed",
    });
  });
});
