declare const readerSessionGenerationBrand: unique symbol;

export type ReaderSessionGeneration = number & {
  readonly [readerSessionGenerationBrand]: "ReaderSessionGeneration";
};

export type ReaderSessionScope =
  | {
      readonly kind: "library";
      readonly workId: string;
      readonly attachmentId: string | null;
    }
  | {
      readonly kind: "local";
      readonly replacementId: string;
    };

export interface ReaderSessionLease {
  readonly generation: ReaderSessionGeneration;
  readonly scope: Readonly<ReaderSessionScope>;
  readonly signal: AbortSignal;
  abort: (reason?: unknown) => void;
  isCurrent: () => boolean;
}

export interface ReaderSessionCoordinator {
  abort: (reason?: unknown) => void;
  begin: (scope: ReaderSessionScope) => ReaderSessionLease;
  invalidate: (reason?: unknown) => void;
  isCurrent: (lease: ReaderSessionLease) => boolean;
}

export function libraryReaderRouteRequestKey(
  workId: string | null,
  attachmentId: string | undefined,
  reloadSequence: number,
): string | null {
  return workId ? `${workId}\u0000${attachmentId ?? ""}\u0000${reloadSequence}` : null;
}

export function withReaderAttachmentSearchParam(
  current: URLSearchParams,
  attachmentId: string,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set("attachment", attachmentId);
  return next;
}

export function applyReaderSessionCompletion(
  lease: ReaderSessionLease,
  apply: () => void,
): boolean {
  if (!lease.isCurrent()) return false;
  apply();
  return true;
}

function nextGeneration(current: ReaderSessionGeneration): ReaderSessionGeneration {
  return (current + 1) as ReaderSessionGeneration;
}

function immutableScope(scope: ReaderSessionScope): Readonly<ReaderSessionScope> {
  return Object.freeze({ ...scope });
}

/**
 * Owns the lifetime of asynchronous work associated with the document currently
 * shown by a reader. Every begin call creates a fresh lease, even when the same
 * document is being reloaded, so a previous completion can never regain
 * ownership merely because its work and attachment identities still match.
 */
export function createReaderSessionCoordinator(): ReaderSessionCoordinator {
  let generation = 0 as ReaderSessionGeneration;
  let activeLease: ReaderSessionLease | null = null;

  const isCurrent = (lease: ReaderSessionLease): boolean =>
    activeLease === lease && !lease.signal.aborted;

  const begin = (scope: ReaderSessionScope): ReaderSessionLease => {
    activeLease?.abort();
    generation = nextGeneration(generation);

    const controller = new AbortController();
    const lease: ReaderSessionLease = Object.freeze({
      generation,
      scope: immutableScope(scope),
      signal: controller.signal,
      abort: (reason?: unknown) => controller.abort(reason),
      isCurrent: () => isCurrent(lease),
    });
    activeLease = lease;
    return lease;
  };

  const abort = (reason?: unknown): void => {
    activeLease?.abort(reason);
  };

  const invalidate = (reason?: unknown): void => {
    activeLease?.abort(reason);
    activeLease = null;
    generation = nextGeneration(generation);
  };

  return Object.freeze({ abort, begin, invalidate, isCurrent });
}
