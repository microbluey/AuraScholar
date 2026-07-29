import { describe, expect, it } from "vitest";
import {
  createReaderSessionCoordinator,
  libraryReaderRouteRequestKey,
  withReaderAttachmentSearchParam,
  type ReaderSessionScope,
} from "./reader-session-coordinator";

const libraryScope: ReaderSessionScope = {
  kind: "library",
  workId: "work-1",
  attachmentId: "attachment-1",
};

describe("reader session coordinator", () => {
  it("changes the route request key for a same-document reload", () => {
    expect(libraryReaderRouteRequestKey("work-a", "attachment-a", 0)).not.toBe(
      libraryReaderRouteRequestKey("work-a", "attachment-a", 1),
    );
    expect(libraryReaderRouteRequestKey(null, undefined, 0)).toBeNull();
  });

  it("replaces a repaired attachment in the reader route without losing deep-link state", () => {
    const current = new URLSearchParams(
      "work=work-a&attachment=broken-attachment&tab=annotations&page=3",
    );

    const next = withReaderAttachmentSearchParam(current, "repaired-attachment");

    expect(next.get("work")).toBe("work-a");
    expect(next.get("attachment")).toBe("repaired-attachment");
    expect(next.get("tab")).toBe("annotations");
    expect(next.get("page")).toBe("3");
    expect(current.get("attachment")).toBe("broken-attachment");
  });

  it("aborts lease A when session B begins", () => {
    const coordinator = createReaderSessionCoordinator();
    const leaseA = coordinator.begin(libraryScope);
    const leaseB = coordinator.begin({
      kind: "library",
      workId: "work-2",
      attachmentId: "attachment-2",
    });

    expect(leaseA.signal.aborted).toBe(true);
    expect(leaseA.isCurrent()).toBe(false);
    expect(coordinator.isCurrent(leaseA)).toBe(false);
    expect(leaseB.signal.aborted).toBe(false);
    expect(leaseB.isCurrent()).toBe(true);
  });

  it("issues a fresh generation when the same document is reloaded", () => {
    const coordinator = createReaderSessionCoordinator();
    const firstLoad = coordinator.begin(libraryScope);
    const reload = coordinator.begin(libraryScope);

    expect(firstLoad.signal.aborted).toBe(true);
    expect(reload.generation).not.toBe(firstLoad.generation);
    expect(firstLoad.isCurrent()).toBe(false);
    expect(reload.isCurrent()).toBe(true);
  });

  it("invalidates and aborts the current lease during unmount cleanup", () => {
    const coordinator = createReaderSessionCoordinator();
    const lease = coordinator.begin({
      kind: "local",
      replacementId: "local-file-selection-1",
    });

    coordinator.invalidate("reader unmounted");

    expect(lease.signal.aborted).toBe(true);
    expect(lease.isCurrent()).toBe(false);
    expect(coordinator.isCurrent(lease)).toBe(false);
  });

  it("aborts the active lease on demand", () => {
    const coordinator = createReaderSessionCoordinator();
    const lease = coordinator.begin(libraryScope);

    coordinator.abort("request cancelled");

    expect(lease.signal.aborted).toBe(true);
    expect(lease.isCurrent()).toBe(false);
  });

  it("never considers an old generation current after a later begin", () => {
    const coordinator = createReaderSessionCoordinator();
    const oldLease = coordinator.begin(libraryScope);
    const currentLease = coordinator.begin({
      kind: "local",
      replacementId: "replacement-2",
    });

    oldLease.abort();

    expect(oldLease.generation).not.toBe(currentLease.generation);
    expect(oldLease.isCurrent()).toBe(false);
    expect(currentLease.isCurrent()).toBe(true);
  });

  it("aborting an old lease cannot cancel its replacement", () => {
    const coordinator = createReaderSessionCoordinator();
    const oldLease = coordinator.begin(libraryScope);
    const currentLease = coordinator.begin(libraryScope);

    oldLease.abort("late cleanup");

    expect(currentLease.signal.aborted).toBe(false);
    expect(currentLease.isCurrent()).toBe(true);
  });
});
