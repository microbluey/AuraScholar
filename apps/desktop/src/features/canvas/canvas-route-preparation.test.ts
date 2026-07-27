import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasCanvasEditorPreparers,
  planCanvasEditorPreparation,
  prepareCanvasEditors,
  prepareStableCanvasNavigation,
  registerCanvasEditorPreparer,
  settleLatestCanvasBlockedNavigation,
  type CanvasBlockedNavigation,
} from "./canvas-route-preparation";

const unregisterAfterEachTest: Array<() => void> = [];

function register(
  prepare: Parameters<typeof registerCanvasEditorPreparer>[0],
): ReturnType<typeof registerCanvasEditorPreparer> {
  const unregister = registerCanvasEditorPreparer(prepare);
  unregisterAfterEachTest.push(unregister);
  return unregister;
}

afterEach(() => {
  for (const unregister of unregisterAfterEachTest.splice(0)) unregister();
});

describe("Canvas editor preparation", () => {
  it("tracks active preparers and runs them in registration order", async () => {
    const calls: string[] = [];
    expect(hasCanvasEditorPreparers()).toBe(false);
    register(() => {
      calls.push("note");
      return "ready";
    });
    register(async ({ reason }) => {
      calls.push(`edge:${reason}`);
      return "ready" as const;
    });

    expect(hasCanvasEditorPreparers()).toBe(true);
    await expect(prepareCanvasEditors({ reason: "navigation" })).resolves.toBe("ready");
    expect(calls).toEqual(["note", "edge:navigation"]);
  });

  it("stops after cancellation and treats failures as cancellation", async () => {
    const later = vi.fn(() => "ready" as const);
    register(() => "cancel");
    register(later);

    await expect(prepareCanvasEditors({ reason: "app-exit" })).resolves.toBe("cancel");
    expect(later).not.toHaveBeenCalled();

    for (const unregister of unregisterAfterEachTest.splice(0)) unregister();
    register(async () => {
      throw new Error("editor unavailable");
    });
    await expect(prepareCanvasEditors({ reason: "navigation" })).resolves.toBe("cancel");
  });

  it.each(["navigation", "app-exit"] as const)(
    "passes the %s reason through unchanged",
    async (reason) => {
      const observed: string[] = [];
      register((context) => {
        observed.push(context.reason);
        return "ready";
      });

      await expect(prepareCanvasEditors({ reason })).resolves.toBe("ready");
      expect(observed).toEqual([reason]);
    },
  );
});

describe("prepareStableCanvasNavigation", () => {
  it("reruns preparation and persistence when editors change during a flush", async () => {
    let revision = 1;
    let flushes = 0;
    const prepareEditors = vi.fn(async () => "ready" as const);

    await expect(
      prepareStableCanvasNavigation({
        getRevision: () => revision,
        prepareEditors,
        flush: async () => {
          flushes += 1;
          if (flushes === 1) revision += 1;
        },
      }),
    ).resolves.toBe("ready");

    expect(prepareEditors).toHaveBeenCalledTimes(2);
    expect(flushes).toBe(2);
  });

  it("does not persist when an editor cancels navigation", async () => {
    const flush = vi.fn(async () => undefined);

    await expect(
      prepareStableCanvasNavigation({
        flush,
        prepareEditors: async () => "cancel",
      }),
    ).resolves.toBe("cancel");
    expect(flush).not.toHaveBeenCalled();
  });

  it("surfaces persistence failures so the router can stay on Canvas", async () => {
    await expect(
      prepareStableCanvasNavigation({
        flush: async () => {
          throw new Error("disk unavailable");
        },
        prepareEditors: async () => "ready",
      }),
    ).rejects.toThrow("disk unavailable");
  });

  it("fails closed if editor registrations never stabilize", async () => {
    let revision = 0;

    await expect(
      prepareStableCanvasNavigation({
        getRevision: () => revision,
        maxPasses: 3,
        prepareEditors: async () => "ready",
        flush: async () => {
          revision += 1;
        },
      }),
    ).resolves.toBe("cancel");
  });

  it("uses the real registry revision to prepare a replacement editor", async () => {
    const calls: string[] = [];
    const unregisterFirst = register(() => {
      calls.push("first");
      return "ready";
    });
    let replaced = false;

    await expect(
      prepareStableCanvasNavigation({
        flush: async () => {
          if (replaced) return;
          replaced = true;
          unregisterFirst();
          register(() => {
            calls.push("replacement");
            return "ready";
          });
        },
      }),
    ).resolves.toBe("ready");

    expect(calls).toEqual(["first", "replacement"]);
  });
});

describe("planCanvasEditorPreparation", () => {
  it.each([
    {
      expected: "ready",
      state: {
        composing: false,
        conflict: false,
        dirty: false,
        reason: "navigation",
        saving: false,
      },
    },
    {
      expected: "cancel",
      state: { composing: true, conflict: false, dirty: true, reason: "navigation", saving: false },
    },
    {
      expected: "cancel",
      state: { composing: false, conflict: false, dirty: true, reason: "navigation", saving: true },
    },
    {
      expected: "prompt",
      state: {
        composing: false,
        conflict: false,
        dirty: true,
        reason: "navigation",
        saving: false,
      },
    },
    {
      expected: "prompt",
      state: { composing: false, conflict: true, dirty: true, reason: "navigation", saving: false },
    },
    {
      expected: "prompt",
      state: {
        composing: false,
        conflict: true,
        dirty: false,
        reason: "navigation",
        saving: false,
      },
    },
    {
      expected: "save",
      state: { composing: false, conflict: false, dirty: true, reason: "app-exit", saving: false },
    },
    {
      expected: "cancel",
      state: { composing: false, conflict: true, dirty: true, reason: "app-exit", saving: false },
    },
    {
      expected: "cancel",
      state: {
        composing: false,
        conflict: true,
        dirty: false,
        reason: "app-exit",
        saving: false,
      },
    },
  ] as const)("$expected for $state", ({ expected, state }) => {
    expect(planCanvasEditorPreparation(state)).toBe(expected);
  });
});

describe("settleLatestCanvasBlockedNavigation", () => {
  function blocker() {
    return {
      state: "blocked",
      proceed: vi.fn(),
      reset: vi.fn(),
    } satisfies CanvasBlockedNavigation;
  }

  it("waits for preparation and proceeds only the latest blocked target", async () => {
    let resolvePreparation: ((decision: "ready") => void) | undefined;
    const preparation = new Promise<"ready">((resolve) => {
      resolvePreparation = resolve;
    });
    const first = blocker();
    const latest = blocker();
    let current: CanvasBlockedNavigation | null = first;
    const run = settleLatestCanvasBlockedNavigation({
      getLatest: () => current,
      prepare: () => preparation,
    });

    current = latest;
    expect(first.proceed).not.toHaveBeenCalled();
    expect(latest.proceed).not.toHaveBeenCalled();
    resolvePreparation?.("ready");
    await run;

    expect(first.proceed).not.toHaveBeenCalled();
    expect(first.reset).not.toHaveBeenCalled();
    expect(latest.proceed).toHaveBeenCalledOnce();
    expect(latest.reset).not.toHaveBeenCalled();
  });

  it("resets on cancellation and reports then resets on failure", async () => {
    const cancelled = blocker();
    const onCancel = vi.fn();
    await settleLatestCanvasBlockedNavigation({
      getLatest: () => cancelled,
      onCancel,
      prepare: async () => "cancel",
    });
    expect(cancelled.reset).toHaveBeenCalledOnce();
    expect(cancelled.proceed).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();

    const failed = blocker();
    const onError = vi.fn();
    const error = new Error("disk unavailable");
    await settleLatestCanvasBlockedNavigation({
      getLatest: () => failed,
      onError,
      prepare: async () => {
        throw error;
      },
    });
    expect(onError).toHaveBeenCalledWith(error);
    expect(failed.reset).toHaveBeenCalledOnce();
    expect(failed.proceed).not.toHaveBeenCalled();
  });

  it("does not surface an obsolete failure after its blocked target was replaced", async () => {
    const onError = vi.fn();
    await settleLatestCanvasBlockedNavigation({
      getLatest: () => null,
      onError,
      prepare: async () => {
        throw new Error("obsolete write failed");
      },
    });

    expect(onError).not.toHaveBeenCalled();
  });
});
