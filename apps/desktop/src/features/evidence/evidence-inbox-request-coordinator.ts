import type { EvidenceInboxFilters } from "./model";

export interface EvidenceReadLease {
  controller: AbortController;
  epoch: number;
}

/** Owns query epochs so stale reads and ABA view transitions cannot commit after a write. */
export class EvidenceInboxRequestCoordinator {
  private baseController: AbortController | null = null;
  private epoch = 0;
  private loadMoreController: AbortController | null = null;

  beginBaseRequest(): EvidenceReadLease {
    this.baseController?.abort();
    this.loadMoreController?.abort();
    const controller = new AbortController();
    this.baseController = controller;
    this.epoch += 1;
    return { controller, epoch: this.epoch };
  }

  beginLoadMoreRequest(): EvidenceReadLease {
    this.baseController?.abort();
    this.loadMoreController?.abort();
    const controller = new AbortController();
    this.loadMoreController = controller;
    this.epoch += 1;
    return { controller, epoch: this.epoch };
  }

  invalidatePendingReads(): number {
    this.epoch += 1;
    this.baseController?.abort();
    this.loadMoreController?.abort();
    return this.epoch;
  }

  isCurrentEpoch(epoch: number): boolean {
    return epoch === this.epoch;
  }

  getCurrentEpoch(): number {
    return this.epoch;
  }

  isCurrentBase(lease: EvidenceReadLease): boolean {
    return (
      this.baseController === lease.controller &&
      !lease.controller.signal.aborted &&
      this.isCurrentEpoch(lease.epoch)
    );
  }

  isCurrentLoadMore(lease: EvidenceReadLease): boolean {
    return (
      this.loadMoreController === lease.controller &&
      !lease.controller.signal.aborted &&
      this.isCurrentEpoch(lease.epoch)
    );
  }

  settleBase(lease: EvidenceReadLease): boolean {
    if (this.baseController !== lease.controller) return false;
    this.baseController = null;
    return true;
  }

  settleLoadMore(lease: EvidenceReadLease): boolean {
    if (this.loadMoreController !== lease.controller) return false;
    this.loadMoreController = null;
    return true;
  }

  abortAll(): void {
    this.invalidatePendingReads();
    this.baseController = null;
    this.loadMoreController = null;
  }
}

export function evidenceInboxViewSignature(filters: EvidenceInboxFilters): string {
  return JSON.stringify({
    evidenceKind: filters.evidenceKind,
    query: filters.query,
    scope: filters.scope,
    source: filters.source,
  });
}

export function shouldApplyEvidenceMutationPatch(input: {
  currentEpoch: number;
  currentViewSignature: string;
  startedEpoch: number;
  startedViewSignature: string;
}): boolean {
  return (
    input.startedEpoch === input.currentEpoch &&
    input.startedViewSignature === input.currentViewSignature
  );
}
