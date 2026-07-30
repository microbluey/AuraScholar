declare const discoveryImportLeaseTokenBrand: unique symbol;

export type DiscoveryImportLeaseToken = symbol & {
  readonly [discoveryImportLeaseTokenBrand]: true;
};

export interface DiscoveryImportLeaseGrant<Result> {
  readonly result: Result;
  readonly token: DiscoveryImportLeaseToken;
}

/**
 * A synchronous, single-owner lease shared by every result handled by one
 * import controller. Only the token returned to the owner can release it.
 */
export class DiscoveryImportLease<Result> {
  private activeGrant: DiscoveryImportLeaseGrant<Result> | null = null;

  tryAcquire(result: Result): DiscoveryImportLeaseGrant<Result> | null {
    if (this.activeGrant) return null;

    const grant = Object.freeze({
      result,
      token: Symbol("discovery-import") as DiscoveryImportLeaseToken,
    });
    this.activeGrant = grant;
    return grant;
  }

  release(token: DiscoveryImportLeaseToken): boolean {
    if (this.activeGrant?.token !== token) return false;
    this.activeGrant = null;
    return true;
  }

  get current(): DiscoveryImportLeaseGrant<Result> | null {
    return this.activeGrant;
  }
}

export interface DiscoveryImportSnapshot<Result> {
  activeResult: Result | null;
  importing: boolean;
}

export type DiscoveryImportOperationResult<Persisted> =
  | { status: "applied"; value: Persisted }
  | { status: "persisted"; value: Persisted }
  | { status: "failed"; error: Error }
  | { status: "skipped"; reason: "busy" | "inactive" };

interface DiscoveryImportControllerCallbacks<Result, Persisted> {
  onApplied?(result: Result, persisted: Persisted): void;
  onFailed?(result: Result, error: Error): void;
  onPersisted?(result: Result, persisted: Persisted): void;
  onStarted?(result: Result): void;
  persist(result: Result): Promise<Persisted>;
  toError?(error: unknown): Error;
}

export type DiscoveryImportControllerDependencies<Result, Persisted> =
  DiscoveryImportControllerCallbacks<Result, Persisted> &
    (
      | {
          isSameResult(left: Result, right: Result): boolean;
          resultKey?(result: Result): PropertyKey;
        }
      | {
          isSameResult?: never;
          resultKey(result: Result): PropertyKey;
        }
    );

export function isSameDiscoveryImportResult<Result, Persisted>(
  dependencies: DiscoveryImportControllerDependencies<Result, Persisted>,
  left: Result,
  right: Result,
): boolean {
  if (dependencies.isSameResult) return dependencies.isSameResult(left, right);
  return Object.is(dependencies.resultKey(left), dependencies.resultKey(right));
}

export function toDiscoveryImportError(
  error: unknown,
  normalize?: (error: unknown) => Error,
): Error {
  try {
    if (normalize) return normalize(error);
  } catch (normalizationFailure) {
    return normalizationFailure instanceof Error
      ? normalizationFailure
      : new Error("Discovery import failed");
  }
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Discovery import failed");
}
