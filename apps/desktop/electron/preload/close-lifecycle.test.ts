import { describe, expect, it } from "vitest";
import type { AppCloseResponse } from "../shared";
import { AppCloseRequestCoordinator } from "./close-lifecycle";

function deferred<T = void>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve();
  }
}

describe("AppCloseRequestCoordinator", () => {
  it("delivers a request that arrived before the renderer subscribed", async () => {
    const responses: AppCloseResponse[] = [];
    const coordinator = new AppCloseRequestCoordinator(async (response) => {
      responses.push(response);
    });
    coordinator.receive({ intent: "window", requestId: "close-1" });
    coordinator.subscribe(() => "ready");

    await drainMicrotasks();

    expect(responses).toEqual([{ decision: "ready", requestId: "close-1" }]);
  });

  it("retires a hanging request so a later close can run immediately", async () => {
    const first = deferred<"ready">();
    const second = deferred<"ready">();
    const calls: string[] = [];
    const responses: AppCloseResponse[] = [];
    const coordinator = new AppCloseRequestCoordinator(async (response) => {
      responses.push(response);
    });
    coordinator.subscribe((request) => {
      calls.push(request.requestId);
      return request.requestId === "close-1" ? first.promise : second.promise;
    });

    coordinator.receive({ intent: "window", requestId: "close-1" });
    await drainMicrotasks();
    coordinator.cancel("close-1");
    coordinator.receive({ intent: "window", requestId: "close-2" });
    await drainMicrotasks();

    expect(calls).toEqual(["close-1", "close-2"]);
    second.resolve("ready");
    await drainMicrotasks();
    expect(responses).toEqual([{ decision: "ready", requestId: "close-2" }]);

    first.resolve("ready");
    await drainMicrotasks();
    expect(responses).toEqual([{ decision: "ready", requestId: "close-2" }]);
  });

  it("does not deliver an intent upgrade twice for the same active request id", async () => {
    const pending = deferred<"ready">();
    let calls = 0;
    const responses: AppCloseResponse[] = [];
    const coordinator = new AppCloseRequestCoordinator(async (response) => {
      responses.push(response);
    });
    coordinator.subscribe(() => {
      calls += 1;
      return pending.promise;
    });

    coordinator.receive({ intent: "window", requestId: "close-1" });
    coordinator.receive({ intent: "quit", requestId: "close-1" });
    await drainMicrotasks();
    expect(calls).toBe(1);

    pending.resolve("ready");
    await drainMicrotasks();
    expect(responses).toEqual([{ decision: "ready", requestId: "close-1" }]);
  });

  it("turns callback failures and invalid decisions into cancellation", async () => {
    const responses: AppCloseResponse[] = [];
    const coordinator = new AppCloseRequestCoordinator(async (response) => {
      responses.push(response);
    });
    coordinator.subscribe(async (request) => {
      if (request.requestId === "close-1") throw new Error("save failed");
      return "invalid" as "ready";
    });

    coordinator.receive({ intent: "window", requestId: "close-1" });
    await drainMicrotasks();
    coordinator.receive({ intent: "window", requestId: "close-2" });
    await drainMicrotasks();

    expect(responses).toEqual([
      { decision: "cancel", requestId: "close-1" },
      { decision: "cancel", requestId: "close-2" },
    ]);
  });
});
