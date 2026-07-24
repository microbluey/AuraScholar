import { describe, expect, it } from "vitest";
import { CANVAS_SCHEMA_VERSION, type CanvasWorkspaceDocument } from "@aurascholar/core";
import { flushLatestCanvasWorkspace, waitForCanvasWorkspaceLoad } from "./workspace-load";

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
