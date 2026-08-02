import { describe, expect, it } from "vitest";
import {
  EvidenceInboxRequestCoordinator,
  evidenceInboxViewSignature,
  shouldApplyEvidenceMutationPatch,
} from "./evidence-inbox-request-coordinator";
import type { EvidenceInboxFilters } from "./model";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function filters(overrides: Partial<EvidenceInboxFilters> = {}): EvidenceInboxFilters {
  return {
    evidenceKind: "all",
    query: "",
    scope: { kind: "inbox" },
    source: "all",
    ...overrides,
  };
}

describe("EvidenceInboxRequestCoordinator", () => {
  it("aborts in-flight load-more whenever a base query starts and lets its finally clear state", () => {
    const coordinator = new EvidenceInboxRequestCoordinator();
    coordinator.beginBaseRequest();
    const loadMore = coordinator.beginLoadMoreRequest();

    const nextBase = coordinator.beginBaseRequest();

    expect(loadMore.controller.signal.aborted).toBe(true);
    expect(coordinator.isCurrentLoadMore(loadMore)).toBe(false);
    expect(coordinator.settleLoadMore(loadMore)).toBe(true);
    expect(coordinator.isCurrentBase(nextBase)).toBe(true);
  });

  it("does not let an older load-more finally clear a newer load-more request", () => {
    const coordinator = new EvidenceInboxRequestCoordinator();
    coordinator.beginBaseRequest();
    const first = coordinator.beginLoadMoreRequest();
    const second = coordinator.beginLoadMoreRequest();

    expect(first.controller.signal.aborted).toBe(true);
    expect(coordinator.settleLoadMore(first)).toBe(false);
    expect(coordinator.isCurrentLoadMore(second)).toBe(true);
    expect(coordinator.settleLoadMore(second)).toBe(true);
  });

  it("invalidates pending base and pagination results before an authoritative refetch", () => {
    const coordinator = new EvidenceInboxRequestCoordinator();
    const staleBase = coordinator.beginBaseRequest();
    const staleLoadMore = coordinator.beginLoadMoreRequest();

    coordinator.invalidatePendingReads();

    expect(staleBase.controller.signal.aborted).toBe(true);
    expect(staleLoadMore.controller.signal.aborted).toBe(true);
    expect(coordinator.isCurrentBase(staleBase)).toBe(false);
    expect(coordinator.isCurrentLoadMore(staleLoadMore)).toBe(false);

    const authoritativeBase = coordinator.beginBaseRequest();
    expect(coordinator.isCurrentBase(authoritativeBase)).toBe(true);
    expect(coordinator.isCurrentBase(staleBase)).toBe(false);
  });

  it("rejects an optimistic mutation patch when filters change during a deferred write", async () => {
    const coordinator = new EvidenceInboxRequestCoordinator();
    const base = coordinator.beginBaseRequest();
    const loadMore = coordinator.beginLoadMoreRequest();
    const write = deferred<void>();
    const startedView = evidenceInboxViewSignature(filters());
    const startedEpoch = coordinator.invalidatePendingReads();
    let currentView = startedView;

    const completion = write.promise.then(() => {
      const apply = shouldApplyEvidenceMutationPatch({
        currentEpoch: coordinator.getCurrentEpoch(),
        currentViewSignature: currentView,
        startedEpoch,
        startedViewSignature: startedView,
      });
      coordinator.invalidatePendingReads();
      return apply;
    });

    currentView = evidenceInboxViewSignature(
      filters({ query: "causal", scope: { kind: "library" } }),
    );
    write.resolve();

    await expect(completion).resolves.toBe(false);
    expect(base.controller.signal.aborted).toBe(true);
    expect(loadMore.controller.signal.aborted).toBe(true);
    expect(coordinator.settleLoadMore(loadMore)).toBe(true);
  });

  it("allows an optimistic patch only when the full scope and filter signature is unchanged", () => {
    const inbox = evidenceInboxViewSignature(filters());
    const sameInbox = evidenceInboxViewSignature(filters());
    const project = evidenceInboxViewSignature(
      filters({ scope: { kind: "project", projectId: "project:a" } }),
    );

    expect(
      shouldApplyEvidenceMutationPatch({
        currentEpoch: 4,
        currentViewSignature: sameInbox,
        startedEpoch: 4,
        startedViewSignature: inbox,
      }),
    ).toBe(true);
    expect(
      shouldApplyEvidenceMutationPatch({
        currentEpoch: 4,
        currentViewSignature: project,
        startedEpoch: 4,
        startedViewSignature: inbox,
      }),
    ).toBe(false);
  });

  it("rejects Inbox to Library to Inbox ABA transitions even when the signature returns", () => {
    const coordinator = new EvidenceInboxRequestCoordinator();
    const inbox = evidenceInboxViewSignature(filters());
    const mutationEpoch = coordinator.invalidatePendingReads();

    coordinator.invalidatePendingReads();
    coordinator.invalidatePendingReads();

    expect(
      shouldApplyEvidenceMutationPatch({
        currentEpoch: coordinator.getCurrentEpoch(),
        currentViewSignature: inbox,
        startedEpoch: mutationEpoch,
        startedViewSignature: inbox,
      }),
    ).toBe(false);
  });

  it("does not decrement an optimistic total after a same-signature read starts", () => {
    const coordinator = new EvidenceInboxRequestCoordinator();
    const inbox = evidenceInboxViewSignature(filters());
    const mutationEpoch = coordinator.invalidatePendingReads();
    let total = 2;

    coordinator.beginBaseRequest();
    const apply = shouldApplyEvidenceMutationPatch({
      currentEpoch: coordinator.getCurrentEpoch(),
      currentViewSignature: inbox,
      startedEpoch: mutationEpoch,
      startedViewSignature: inbox,
    });
    if (apply) total -= 1;

    expect(apply).toBe(false);
    expect(total).toBe(2);
  });
});
