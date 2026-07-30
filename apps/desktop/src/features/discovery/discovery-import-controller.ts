import {
  DiscoveryImportLease,
  isSameDiscoveryImportResult,
  toDiscoveryImportError,
} from "./discovery-import-controller-model";
import type {
  DiscoveryImportControllerDependencies,
  DiscoveryImportLeaseGrant,
  DiscoveryImportOperationResult,
  DiscoveryImportSnapshot,
} from "./discovery-import-controller-model";

export type {
  DiscoveryImportControllerDependencies,
  DiscoveryImportLeaseGrant,
  DiscoveryImportLeaseToken,
  DiscoveryImportOperationResult,
  DiscoveryImportSnapshot,
} from "./discovery-import-controller-model";

type Listener = () => void;

interface DiscoveryImportFlight<Result, Persisted> {
  readonly grant: DiscoveryImportLeaseGrant<Result>;
  readonly lifecycle: number;
  readonly promise: Promise<DiscoveryImportOperationResult<Persisted>>;
  readonly resolve: (result: DiscoveryImportOperationResult<Persisted>) => void;
}

/**
 * Owns one global discovery-result import flight.
 *
 * Acquiring the lease and publishing the busy snapshot are synchronous. An
 * unmount stops UI callbacks, but deliberately does not cancel persistence or
 * suppress the process-wide persisted notification.
 */
export class DiscoveryImportController<Result, Persisted> {
  private active = false;
  private activeFlight: DiscoveryImportFlight<Result, Persisted> | null = null;
  private readonly lease = new DiscoveryImportLease<Result>();
  private lifecycle = 0;
  private readonly listeners = new Set<Listener>();
  private snapshot: DiscoveryImportSnapshot<Result> = {
    activeResult: null,
    importing: false,
  };

  constructor(
    private readonly dependencies: DiscoveryImportControllerDependencies<Result, Persisted>,
  ) {}

  readonly getSnapshot = (): DiscoveryImportSnapshot<Result> => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.update({ activeResult: null, importing: false });
  }

  import(result: Result): Promise<DiscoveryImportOperationResult<Persisted>> {
    if (!this.active) {
      return Promise.resolve({ status: "skipped", reason: "inactive" });
    }

    const activeFlight = this.activeFlight;
    if (activeFlight) {
      if (this.sameResult(activeFlight.grant.result, result)) return activeFlight.promise;
      return Promise.resolve({ status: "skipped", reason: "busy" });
    }

    const grant = this.lease.tryAcquire(result);
    if (!grant) return Promise.resolve({ status: "skipped", reason: "busy" });

    let resolve!: (outcome: DiscoveryImportOperationResult<Persisted>) => void;
    const promise = new Promise<DiscoveryImportOperationResult<Persisted>>((nextResolve) => {
      resolve = nextResolve;
    });
    const flight: DiscoveryImportFlight<Result, Persisted> = {
      grant,
      lifecycle: this.lifecycle,
      promise,
      resolve,
    };
    this.activeFlight = flight;
    this.update({ activeResult: result, importing: true });
    this.observe(() => this.dependencies.onStarted?.(result));
    void this.execute(flight);
    return promise;
  }

  private async execute(flight: DiscoveryImportFlight<Result, Persisted>): Promise<void> {
    let outcome: DiscoveryImportOperationResult<Persisted>;
    try {
      const persisted = await this.dependencies.persist(flight.grant.result);
      this.observe(() => this.dependencies.onPersisted?.(flight.grant.result, persisted));
      if (this.isUiCurrent(flight)) {
        this.observe(() => this.dependencies.onApplied?.(flight.grant.result, persisted));
        outcome = { status: "applied", value: persisted };
      } else {
        outcome = { status: "persisted", value: persisted };
      }
    } catch (cause) {
      const error = toDiscoveryImportError(cause, this.dependencies.toError);
      if (this.isUiCurrent(flight)) {
        this.observe(() => this.dependencies.onFailed?.(flight.grant.result, error));
      }
      outcome = { status: "failed", error };
    } finally {
      const shouldClearSnapshot = this.isUiCurrent(flight);
      if (this.lease.release(flight.grant.token)) {
        if (this.activeFlight === flight) this.activeFlight = null;
        if (shouldClearSnapshot) {
          this.update({ activeResult: null, importing: false });
        }
      }
    }
    flight.resolve(outcome);
  }

  private emit(): void {
    for (const listener of this.listeners) this.observe(listener);
  }

  private isUiCurrent(flight: DiscoveryImportFlight<Result, Persisted>): boolean {
    return (
      this.active &&
      this.activeFlight === flight &&
      flight.lifecycle === this.lifecycle &&
      this.lease.current?.token === flight.grant.token
    );
  }

  private observe(callback: () => void): void {
    try {
      callback();
    } catch {
      // UI feedback and external-store observers cannot corrupt persistence.
    }
  }

  private sameResult(left: Result, right: Result): boolean {
    try {
      return isSameDiscoveryImportResult(this.dependencies, left, right);
    } catch {
      return false;
    }
  }

  private update(next: DiscoveryImportSnapshot<Result>): void {
    if (
      this.snapshot.importing === next.importing &&
      this.snapshot.activeResult === next.activeResult
    ) {
      return;
    }
    this.snapshot = next;
    this.emit();
  }
}

export function createDiscoveryImportController<Result, Persisted>(
  dependencies: DiscoveryImportControllerDependencies<Result, Persisted>,
): DiscoveryImportController<Result, Persisted> {
  return new DiscoveryImportController(dependencies);
}
