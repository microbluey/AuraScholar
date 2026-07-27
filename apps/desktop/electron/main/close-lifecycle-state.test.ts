import { describe, expect, it } from "vitest";
import { AppCloseLifecycleState } from "./close-lifecycle-state";

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `request-${index}`;
}

describe("AppCloseLifecycleState", () => {
  it("coalesces repeated window closes into one request", () => {
    const state = new AppCloseLifecycleState();
    const nextId = ids("close-1", "close-2");

    expect(state.begin("window", nextId)).toEqual({
      changed: true,
      request: { intent: "window", requestId: "close-1" },
    });
    expect(state.begin("window", nextId)).toEqual({
      changed: false,
      request: { intent: "window", requestId: "close-1" },
    });
  });

  it("upgrades a pending window close when the app is asked to quit", () => {
    const state = new AppCloseLifecycleState();
    state.begin("window", ids("close-1"));

    expect(state.begin("quit", ids("unused"))).toEqual({
      changed: true,
      request: { intent: "quit", requestId: "close-1" },
    });
    expect(state.currentRequest()).toEqual({ intent: "quit", requestId: "close-1" });
  });

  it("keeps a held renderer prompt held when window close upgrades to quit", () => {
    const state = new AppCloseLifecycleState();
    state.begin("window", ids("close-1"));

    expect(state.holdPending("close-1")).toBe(true);
    expect(state.isPendingHeld("close-1")).toBe(true);
    expect(state.begin("quit", ids("unused"))).toEqual({
      changed: true,
      request: { intent: "quit", requestId: "close-1" },
    });
    expect(state.isPendingHeld("close-1")).toBe(true);

    state.resolve("close-1", "cancel");
    expect(state.isPendingHeld("close-1")).toBe(false);
    expect(state.begin("window", ids("close-2"))).toEqual({
      changed: true,
      request: { intent: "window", requestId: "close-2" },
    });
    expect(state.isPendingHeld("close-2")).toBe(false);
  });

  it("ignores stale decisions without changing the active request", () => {
    const state = new AppCloseLifecycleState();
    state.begin("window", ids("close-1"));

    expect(state.resolve("stale", "ready")).toEqual({ kind: "ignored" });
    expect(state.currentRequest()).toEqual({ intent: "window", requestId: "close-1" });
    expect(state.consumeWindowClosePermit()).toBe(false);
  });

  it("grants exactly one window-close replay after a ready decision", () => {
    const state = new AppCloseLifecycleState();
    state.begin("window", ids("close-1"));

    expect(state.resolve("close-1", "ready")).toEqual({
      decision: "ready",
      kind: "replay",
      request: { intent: "window", requestId: "close-1" },
    });
    expect(state.consumeWindowClosePermit()).toBe(true);
    expect(state.consumeWindowClosePermit()).toBe(false);
    expect(state.consumeQuitPermit()).toBe(false);
  });

  it("grants one quit and one window replay for an app quit", () => {
    const state = new AppCloseLifecycleState();
    state.begin("quit", ids("quit-1"));
    state.resolve("quit-1", "ready");

    expect(state.consumeQuitPermit()).toBe(true);
    expect(state.consumeQuitPermit()).toBe(false);
    expect(state.consumeWindowClosePermit()).toBe(true);
    expect(state.consumeWindowClosePermit()).toBe(false);
  });

  it("upgrades a resolved window replay when quit arrives before replay", () => {
    const state = new AppCloseLifecycleState();
    state.begin("window", ids("close-1"));
    state.resolve("close-1", "ready");

    expect(state.begin("quit", ids("unused"))).toEqual({
      changed: false,
      request: { intent: "quit", requestId: "close-1" },
    });
    expect(state.replayRequestFor("close-1")).toEqual({
      intent: "quit",
      requestId: "close-1",
    });
    expect(state.consumeQuitPermit()).toBe(true);
    expect(state.consumeWindowClosePermit()).toBe(true);
  });

  it("clears every bypass when beforeunload prevents the replay", () => {
    const state = new AppCloseLifecycleState();
    state.begin("quit", ids("quit-1"));
    state.resolve("quit-1", "ready");
    expect(state.consumeQuitPermit()).toBe(true);
    expect(state.consumeWindowClosePermit()).toBe(true);

    expect(state.preventedUnload()).toEqual({ intent: "quit", requestId: "quit-1" });
    expect(state.consumeQuitPermit()).toBe(false);
    expect(state.consumeWindowClosePermit()).toBe(false);

    expect(state.begin("window", ids("close-2"))).toEqual({
      changed: true,
      request: { intent: "window", requestId: "close-2" },
    });
  });

  it("marks only an explicit force decision as allowed to bypass beforeunload", () => {
    const state = new AppCloseLifecycleState();
    state.begin("window", ids("close-1"));
    state.resolve("close-1", "ready");
    expect(state.shouldForcePreventedUnload()).toBe(false);

    state.preventedUnload();
    state.begin("window", ids("close-2"));
    state.resolve("close-2", "force");
    expect(state.shouldForcePreventedUnload()).toBe(true);
  });

  it("cancels only the matching pending request", () => {
    const state = new AppCloseLifecycleState();
    state.begin("window", ids("close-1"));

    expect(state.cancelPending("stale")).toBeNull();
    expect(state.cancelPending("close-1")).toEqual({
      intent: "window",
      requestId: "close-1",
    });
    expect(state.currentRequest()).toBeNull();
  });
});
