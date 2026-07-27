import { describe, expect, it } from "vitest";
import { CANVAS_SCHEMA_VERSION, type CanvasWorkspaceDocument } from "@aurascholar/core";
import {
  flushCanvasWorkspaceCollection,
  flushLatestCanvasWorkspace,
  navigateAfterCanvasWorkspaceFlush,
  persistCurrentCanvasWorkspaceSnapshot,
  waitForCanvasWorkspaceLoad,
} from "./workspace-load";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function workspace(version: number): CanvasWorkspaceDocument {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: "workspace-a",
    name: "Research",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    createdAt: 1,
    updatedAt: version,
  };
}

describe("flushLatestCanvasWorkspace", () => {
  it("rechecks and persists the latest snapshot after an older save finishes", async () => {
    const older = workspace(1);
    const latest = workspace(2);
    const pendingOlderSave = deferred();
    let lastPersisted = JSON.stringify(latest);
    let inFlightSave: Promise<void> | undefined = pendingOlderSave.promise
      .then(() => {
        lastPersisted = JSON.stringify(older);
      })
      .finally(() => {
        inFlightSave = undefined;
      });
    const persisted: CanvasWorkspaceDocument[] = [];
    let flushSettled = false;

    const flush = flushLatestCanvasWorkspace({
      cancelPendingSave: () => undefined,
      getInFlightSave: () => inFlightSave,
      getLastPersisted: () => lastPersisted,
      getLatestDocument: () => latest,
      isRetired: () => false,
      persistDocument: async (document) => {
        persisted.push(document);
        lastPersisted = JSON.stringify(document);
      },
    });
    void flush.then(() => {
      flushSettled = true;
    });
    await Promise.resolve();
    expect(flushSettled).toBe(false);

    pendingOlderSave.resolve();
    await flush;

    expect(persisted).toEqual([latest]);
    expect(lastPersisted).toBe(JSON.stringify(latest));
  });

  it("loops to a newer document that appears while its own write is pending", async () => {
    const older = workspace(1);
    const latest = workspace(2);
    const pendingWrite = deferred();
    let current = older;
    let lastPersisted: string | undefined;
    const writes: CanvasWorkspaceDocument[] = [];

    const flush = flushLatestCanvasWorkspace({
      cancelPendingSave: () => undefined,
      getInFlightSave: () => undefined,
      getLastPersisted: () => lastPersisted,
      getLatestDocument: () => current,
      isRetired: () => false,
      persistDocument: async (document) => {
        writes.push(document);
        if (document === older) await pendingWrite.promise;
        lastPersisted = JSON.stringify(document);
      },
    });
    await Promise.resolve();
    current = latest;
    pendingWrite.resolve();
    await flush;

    expect(writes).toEqual([older, latest]);
    expect(lastPersisted).toBe(JSON.stringify(latest));
  });

  it("allows a later flush to retry after persistence rejects", async () => {
    const latest = workspace(2);
    let attempts = 0;
    let lastPersisted: string | undefined;
    const barrier = () =>
      flushLatestCanvasWorkspace({
        cancelPendingSave: () => undefined,
        getInFlightSave: () => undefined,
        getLastPersisted: () => lastPersisted,
        getLatestDocument: () => latest,
        isRetired: () => false,
        persistDocument: async (document) => {
          attempts += 1;
          if (attempts === 1) throw new Error("disk unavailable");
          lastPersisted = JSON.stringify(document);
        },
      });

    await expect(barrier()).rejects.toThrow("disk unavailable");
    await expect(barrier()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
    expect(lastPersisted).toBe(JSON.stringify(latest));
  });
});

describe("flushCanvasWorkspaceCollection", () => {
  it("deduplicates workspace ids and waits for every save", async () => {
    const first = deferred();
    const second = deferred();
    const calls: string[] = [];
    let settled = false;

    const flush = flushCanvasWorkspaceCollection({
      workspaceIds: ["workspace-a", "workspace-b", "workspace-a", ""],
      flushWorkspace: (workspaceId) => {
        calls.push(workspaceId);
        return workspaceId === "workspace-a" ? first.promise : second.promise;
      },
    });
    void flush.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(calls).toEqual(["workspace-a", "workspace-b"]);
    first.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    second.resolve();
    await flush;
    expect(settled).toBe(true);
  });

  it("waits for all saves before surfacing failures", async () => {
    const successful = deferred();
    const failed = deferred();
    let settled = false;

    const flush = flushCanvasWorkspaceCollection({
      workspaceIds: ["workspace-a", "workspace-b"],
      flushWorkspace: (workspaceId) =>
        workspaceId === "workspace-a"
          ? failed.promise.then(() => {
              throw new Error("disk unavailable");
            })
          : successful.promise,
    });
    void flush.catch(() => {
      settled = true;
    });

    failed.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    successful.resolve();
    await expect(flush).rejects.toThrow("disk unavailable");
  });

  it("preserves every failure in workspace order", async () => {
    const first = new Error("workspace a failed");
    const second = new Error("workspace b failed");

    const flush = flushCanvasWorkspaceCollection({
      workspaceIds: ["workspace-a", "workspace-b"],
      flushWorkspace: async (workspaceId) => {
        throw workspaceId === "workspace-a" ? first : second;
      },
    });

    await expect(flush).rejects.toMatchObject({
      errors: [first, second],
      message: "2 个白板保存失败",
    });
  });
});

describe("navigateAfterCanvasWorkspaceFlush", () => {
  it("does not navigate until the active workspace is durable", async () => {
    const pending = deferred();
    const calls: string[] = [];
    const navigation = navigateAfterCanvasWorkspaceFlush({
      workspaceId: "workspace-a",
      flushWorkspace: async (workspaceId) => {
        calls.push(`flush:${workspaceId}`);
        await pending.promise;
      },
      navigate: () => calls.push("navigate"),
    });

    await Promise.resolve();
    expect(calls).toEqual(["flush:workspace-a"]);
    pending.resolve();
    await navigation;
    expect(calls).toEqual(["flush:workspace-a", "navigate"]);
  });

  it("keeps the current route when saving fails and supports a later retry", async () => {
    let attempts = 0;
    let navigations = 0;
    const request = () =>
      navigateAfterCanvasWorkspaceFlush({
        workspaceId: "workspace-a",
        flushWorkspace: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("disk unavailable");
        },
        navigate: () => {
          navigations += 1;
        },
      });

    await expect(request()).rejects.toThrow("disk unavailable");
    expect(navigations).toBe(0);
    await expect(request()).resolves.toBeUndefined();
    expect(navigations).toBe(1);
  });

  it("lets the latest navigation intent win while a shared flush is pending", async () => {
    const pending = deferred();
    const destinations: string[] = [];
    let sequence = 0;
    const request = (destination: string) => {
      sequence += 1;
      const requestSequence = sequence;
      return navigateAfterCanvasWorkspaceFlush({
        workspaceId: "workspace-a",
        flushWorkspace: () => pending.promise,
        navigate: () => {
          if (requestSequence === sequence) destinations.push(destination);
        },
      });
    };

    const first = request("/canvas/workspace-b");
    const latest = request("/library");
    pending.resolve();
    await Promise.all([first, latest]);

    expect(destinations).toEqual(["/library"]);
  });
});

describe("persistCurrentCanvasWorkspaceSnapshot", () => {
  it("skips a queued snapshot that was superseded before its write begins", async () => {
    const stale = workspace(1);
    const latest = workspace(2);
    const writes: CanvasWorkspaceDocument[] = [];

    await expect(
      persistCurrentCanvasWorkspaceSnapshot({
        snapshot: stale,
        getLatestDocument: () => latest,
        isRetired: () => false,
        persist: async (document) => {
          writes.push(document);
        },
      }),
    ).resolves.toBe("superseded");
    expect(writes).toEqual([]);
  });

  it("does not report an in-flight snapshot as persisted after it is invalidated", async () => {
    const candidate = workspace(1);
    const rollback = workspace(2);
    const pendingWrite = deferred();
    let latest = candidate;

    const result = persistCurrentCanvasWorkspaceSnapshot({
      snapshot: candidate,
      getLatestDocument: () => latest,
      isRetired: () => false,
      persist: () => pendingWrite.promise,
    });
    latest = rollback;
    pendingWrite.resolve();

    await expect(result).resolves.toBe("superseded");
  });
});

describe("waitForCanvasWorkspaceLoad", () => {
  it("flushes the previous workspace and then the target before allowing a load", async () => {
    const calls: string[] = [];
    const ready = await waitForCanvasWorkspaceLoad({
      previousWorkspaceId: "workspace-a",
      targetWorkspaceId: "workspace-b",
      flushWorkspace: async (workspaceId) => {
        calls.push(workspaceId);
      },
      isCurrentRequest: () => true,
    });

    expect(ready).toBe(true);
    expect(calls).toEqual(["workspace-a", "workspace-b"]);
  });

  it("keeps a fast A to B to A sequence behind A's pending save and retires B", async () => {
    const pendingSaveA = deferred();
    const calls: string[] = [];
    let activeRequest = 1;
    const flushWorkspace = (workspaceId: string): Promise<void> => {
      calls.push(workspaceId);
      return workspaceId === "workspace-a" ? pendingSaveA.promise : Promise.resolve();
    };

    const routeToB = waitForCanvasWorkspaceLoad({
      previousWorkspaceId: "workspace-a",
      targetWorkspaceId: "workspace-b",
      flushWorkspace,
      isCurrentRequest: () => activeRequest === 1,
    });
    await Promise.resolve();

    activeRequest = 2;
    const routeBackToA = waitForCanvasWorkspaceLoad({
      previousWorkspaceId: "workspace-a",
      targetWorkspaceId: "workspace-a",
      flushWorkspace,
      isCurrentRequest: () => activeRequest === 2,
    });
    await Promise.resolve();

    expect(calls).toEqual(["workspace-a", "workspace-a"]);
    let routeBackSettled = false;
    void routeBackToA.then(() => {
      routeBackSettled = true;
    });
    await Promise.resolve();
    expect(routeBackSettled).toBe(false);

    pendingSaveA.resolve();
    await expect(routeToB).resolves.toBe(false);
    await expect(routeBackToA).resolves.toBe(true);
    expect(calls).not.toContain("workspace-b");
  });
});
