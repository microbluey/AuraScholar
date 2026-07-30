import { describe, expect, it, vi } from "vitest";
import { createDiscoveryImportController } from "./discovery-import-controller";

interface Result {
  id: string;
  identities: string[];
}

interface Persisted {
  workId: string;
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

function result(id: string, identities = [id]): Result {
  return { id, identities };
}

function setup(persist: (result: Result) => Promise<Persisted>) {
  const callbacks = {
    onApplied: vi.fn(),
    onFailed: vi.fn(),
    onPersisted: vi.fn(),
    onStarted: vi.fn(),
  };
  const persistSpy = vi.fn(persist);
  const controller = createDiscoveryImportController({
    isSameResult: (left: Result, right: Result) =>
      left.identities.some((identity) => right.identities.includes(identity)),
    persist: persistSpy,
    ...callbacks,
  });
  return { callbacks, controller, persist: persistSpy };
}

describe("DiscoveryImportController", () => {
  it("is an inactive external store with a stable snapshot until started", async () => {
    const state = setup(async () => ({ workId: "unused" }));
    const snapshot = state.controller.getSnapshot();
    const listener = vi.fn();
    state.controller.subscribe(listener);

    await expect(state.controller.import(result("paper"))).resolves.toEqual({
      status: "skipped",
      reason: "inactive",
    });
    state.controller.start();

    expect(state.controller.getSnapshot()).toBe(snapshot);
    expect(state.controller.getSnapshot()).toBe(state.controller.getSnapshot());
    expect(listener).not.toHaveBeenCalled();
    expect(state.persist).not.toHaveBeenCalled();
  });

  it("coalesces one logical result by Promise identity and skips a different busy result", async () => {
    const pending = deferred<Persisted>();
    const state = setup(() => pending.promise);
    const original = result("alias", ["doi:paper"]);
    const canonical = result("canonical", ["source:id", "doi:paper"]);
    const listener = vi.fn();
    state.controller.subscribe(listener);
    state.controller.start();

    const first = state.controller.import(original);
    const duplicate = state.controller.import(canonical);
    const busy = state.controller.import(result("other"));

    expect(duplicate).toBe(first);
    await expect(busy).resolves.toEqual({ status: "skipped", reason: "busy" });
    expect(state.callbacks.onStarted).toHaveBeenCalledOnce();
    expect(state.callbacks.onStarted).toHaveBeenCalledWith(original);
    expect(state.persist).toHaveBeenCalledOnce();
    expect(state.persist).toHaveBeenCalledWith(original);
    expect(state.controller.getSnapshot()).toEqual({
      activeResult: original,
      importing: true,
    });
    expect(state.controller.getSnapshot()).toBe(state.controller.getSnapshot());

    pending.resolve({ workId: "library-paper" });
    await expect(first).resolves.toEqual({
      status: "applied",
      value: { workId: "library-paper" },
    });
    expect(state.callbacks.onPersisted.mock.invocationCallOrder[0]!).toBeLessThan(
      state.callbacks.onApplied.mock.invocationCallOrder[0]!,
    );
    expect(state.callbacks.onPersisted).toHaveBeenCalledWith(original, {
      workId: "library-paper",
    });
    expect(state.callbacks.onApplied).toHaveBeenCalledWith(original, {
      workId: "library-paper",
    });
    expect(state.controller.getSnapshot()).toEqual({
      activeResult: null,
      importing: false,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("lets persistence and its global notification finish after stop without UI callbacks", async () => {
    const pending = deferred<Persisted>();
    const state = setup(() => pending.promise);
    const importing = result("paper");
    state.controller.start();

    const operation = state.controller.import(importing);
    state.controller.stop();
    expect(state.controller.getSnapshot()).toEqual({
      activeResult: null,
      importing: false,
    });

    state.controller.start();
    pending.resolve({ workId: "persisted-paper" });

    await expect(operation).resolves.toEqual({
      status: "persisted",
      value: { workId: "persisted-paper" },
    });
    expect(state.callbacks.onPersisted).toHaveBeenCalledOnce();
    expect(state.callbacks.onPersisted).toHaveBeenCalledWith(importing, {
      workId: "persisted-paper",
    });
    expect(state.callbacks.onApplied).not.toHaveBeenCalled();
    expect(state.callbacks.onFailed).not.toHaveBeenCalled();
  });

  it("keeps an old flight leased across stop and restart until persistence settles", async () => {
    const first = deferred<Persisted>();
    const state = setup(
      vi
        .fn<(result: Result) => Promise<Persisted>>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ workId: "next-paper" }),
    );
    const original = result("alias", ["doi:paper"]);
    const canonical = result("canonical", ["source:id", "doi:paper"]);
    state.controller.start();

    const oldFlight = state.controller.import(original);
    state.controller.stop();
    state.controller.start();

    expect(state.controller.import(canonical)).toBe(oldFlight);
    await expect(state.controller.import(result("other"))).resolves.toEqual({
      status: "skipped",
      reason: "busy",
    });
    expect(state.persist).toHaveBeenCalledOnce();
    expect(state.controller.getSnapshot()).toEqual({
      activeResult: null,
      importing: false,
    });

    first.resolve({ workId: "old-paper" });
    await expect(oldFlight).resolves.toEqual({
      status: "persisted",
      value: { workId: "old-paper" },
    });
    expect(state.callbacks.onPersisted).toHaveBeenCalledWith(original, {
      workId: "old-paper",
    });
    expect(state.callbacks.onApplied).not.toHaveBeenCalled();

    await expect(state.controller.import(result("other"))).resolves.toEqual({
      status: "applied",
      value: { workId: "next-paper" },
    });
    expect(state.persist).toHaveBeenCalledTimes(2);
    expect(state.callbacks.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ id: "other" }),
      { workId: "next-paper" },
    );
  });

  it("suppresses onApplied when onPersisted synchronously stops the controller", async () => {
    const callbacks = {
      onApplied: vi.fn(),
      onPersisted: vi.fn(),
    };
    const controller = createDiscoveryImportController({
      isSameResult: (left: Result, right: Result) => left.id === right.id,
      persist: async () => ({ workId: "paper" }),
      ...callbacks,
    });
    callbacks.onPersisted.mockImplementation(() => controller.stop());
    controller.start();

    await expect(controller.import(result("paper"))).resolves.toEqual({
      status: "persisted",
      value: { workId: "paper" },
    });
    expect(callbacks.onPersisted).toHaveBeenCalledOnce();
    expect(callbacks.onApplied).not.toHaveBeenCalled();
  });

  it("releases a failed flight for retry and reports failure only to its active lifecycle", async () => {
    const first = deferred<Persisted>();
    const second = deferred<Persisted>();
    const state = setup(
      vi
        .fn<(result: Result) => Promise<Persisted>>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    );
    state.controller.start();

    const initial = state.controller.import(result("paper"));
    const failure = new Error("write failed");
    first.reject(failure);

    await expect(initial).resolves.toEqual({ status: "failed", error: failure });
    expect(state.callbacks.onFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "paper" }),
      failure,
    );
    expect(state.controller.getSnapshot().importing).toBe(false);

    const retry = state.controller.import(result("paper-retry", ["paper"]));
    expect(retry).not.toBe(initial);
    expect(state.callbacks.onStarted).toHaveBeenCalledTimes(2);
    second.resolve({ workId: "paper" });
    await expect(retry).resolves.toMatchObject({ status: "applied" });
    expect(state.persist).toHaveBeenCalledTimes(2);
  });

  it("suppresses a stopped failure callback and releases its lease for a later retry", async () => {
    const first = deferred<Persisted>();
    const state = setup(
      vi
        .fn<(result: Result) => Promise<Persisted>>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ workId: "retried" }),
    );
    state.controller.start();

    const initial = state.controller.import(result("paper"));
    state.controller.stop();
    first.reject("write failed");

    await expect(initial).resolves.toEqual({
      status: "failed",
      error: new Error("write failed"),
    });
    expect(state.callbacks.onFailed).not.toHaveBeenCalled();

    state.controller.start();
    await expect(state.controller.import(result("paper"))).resolves.toMatchObject({
      status: "applied",
    });
    expect(state.persist).toHaveBeenCalledTimes(2);
  });
});
