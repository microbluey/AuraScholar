import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppCloseRequest } from "../../electron/shared";
import { cancelExitBarriers, registerExitBarrier, runExitBarriers } from "./exit-barriers";

const REQUEST: AppCloseRequest = {
  requestId: "close-request-1",
  intent: "window",
};

const unregisterAfterEachTest: Array<() => void> = [];

function register(
  barrier: Parameters<typeof registerExitBarrier>[0],
  options?: Parameters<typeof registerExitBarrier>[1],
): ReturnType<typeof registerExitBarrier> {
  const unregister = registerExitBarrier(barrier, options);
  unregisterAfterEachTest.push(unregister);
  return unregister;
}

afterEach(() => {
  for (const unregister of unregisterAfterEachTest.splice(0)) unregister();
});

describe("exit barriers", () => {
  it("is ready when no barrier is registered", async () => {
    await expect(runExitBarriers(REQUEST)).resolves.toBe("ready");
  });

  it("returns cancel when any barrier cancels", async () => {
    const later = vi.fn(() => "ready" as const);
    register(() => "ready");
    register(() => "cancel");
    register(later);

    await expect(runExitBarriers(REQUEST)).resolves.toBe("cancel");
    expect(later).not.toHaveBeenCalled();
  });

  it("continues after force so remaining barriers can finish", async () => {
    const calls: string[] = [];
    register(() => {
      calls.push("force");
      return "force";
    });
    register(async () => {
      calls.push("save");
      return "ready" as const;
    });

    await expect(runExitBarriers(REQUEST)).resolves.toBe("force");
    expect(calls).toEqual(["force", "save"]);
  });

  it("runs local editor preparation before document persistence", async () => {
    const calls: string[] = [];
    register(
      () => {
        calls.push("persist");
        return "ready";
      },
      { priority: 100 },
    );
    register(
      () => {
        calls.push("editor");
        return "ready";
      },
      { priority: 0 },
    );

    await expect(runExitBarriers(REQUEST)).resolves.toBe("ready");
    expect(calls).toEqual(["editor", "persist"]);
  });

  it("lets persistence observe the document committed by an editor barrier", async () => {
    let activeDocument = { label: "rendered value" };
    const inputDraft = { label: "latest input value" };
    const persistedDocuments: Array<{ label: string }> = [];
    register(
      () => {
        persistedDocuments.push(activeDocument);
        return "ready";
      },
      { priority: 100 },
    );
    register(
      () => {
        activeDocument = { ...inputDraft };
        return "ready";
      },
      { priority: 0 },
    );

    await expect(runExitBarriers(REQUEST)).resolves.toBe("ready");
    expect(persistedDocuments).toEqual([{ label: "latest input value" }]);
  });

  it("lets a later cancel override an earlier force", async () => {
    register(() => "force");
    register(() => "cancel");

    await expect(runExitBarriers(REQUEST)).resolves.toBe("cancel");
  });

  it("converts a thrown or rejected barrier into cancel", async () => {
    register(async () => {
      throw new Error("save failed");
    });

    await expect(runExitBarriers(REQUEST)).resolves.toBe("cancel");
  });

  it("deduplicates the same request while it is in flight", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((settle) => {
      resolve = settle;
    });
    const barrier = vi.fn(async () => {
      await pending;
      return "ready" as const;
    });
    register(barrier);

    const first = runExitBarriers(REQUEST);
    const duplicate = runExitBarriers({ ...REQUEST });

    expect(duplicate).toBe(first);
    expect(barrier).toHaveBeenCalledTimes(1);
    resolve();
    await expect(first).resolves.toBe("ready");
  });

  it("runs a completed request again if Electron reuses its id", async () => {
    const barrier = vi.fn(() => "ready" as const);
    register(barrier);

    await runExitBarriers(REQUEST);
    await runExitBarriers(REQUEST);

    expect(barrier).toHaveBeenCalledTimes(2);
  });

  it("does not enter later barriers after Electron cancels a pending request", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const persistenceBarrier = vi.fn(() => "ready" as const);
    register(
      async () => {
        await pending;
        return "ready" as const;
      },
      { priority: 0 },
    );
    register(persistenceBarrier, { priority: 100 });

    const run = runExitBarriers(REQUEST);
    await Promise.resolve();
    cancelExitBarriers(REQUEST.requestId);
    release();

    await expect(run).resolves.toBe("cancel");
    expect(persistenceBarrier).not.toHaveBeenCalled();
  });

  it("unregisters barriers and snapshots registrations for an active run", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const second = vi.fn(() => "ready" as const);
    register(async () => {
      await pending;
      return "ready" as const;
    });
    const unregisterSecond = register(second);

    const run = runExitBarriers(REQUEST);
    unregisterSecond();
    release();

    await expect(run).resolves.toBe("ready");
    expect(second).toHaveBeenCalledTimes(1);

    await runExitBarriers({ ...REQUEST, requestId: "close-request-2" });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
