export interface ResearchViewSuspensionLeaseOptions {
  acquire(): Promise<string | null>;
  release(suspensionId: string): Promise<boolean>;
}

/**
 * Serializes one renderer-owned native-view suspension lease.
 *
 * A new admission waits for an in-flight release, so it cannot enqueue a
 * confirmation behind a lease that is about to be removed.
 */
export class ResearchViewSuspensionLease {
  private acquisition: Promise<boolean> | null = null;
  private disposeAfterAcquisition = false;
  private releaseOperation: Promise<boolean> | null = null;
  private suspensionId: string | null = null;

  constructor(private readonly options: ResearchViewSuspensionLeaseOptions) {}

  get blocking(): boolean {
    return Boolean(this.suspensionId || this.acquisition || this.releaseOperation);
  }

  acquire(): Promise<boolean> {
    if (this.acquisition) return this.acquisition;
    const priorRelease = this.releaseOperation;
    const pending = (async () => {
      try {
        if (priorRelease && !(await priorRelease)) return false;
        if (this.suspensionId) return true;
        const suspensionId = await this.options.acquire();
        if (!suspensionId) return false;
        this.suspensionId = suspensionId;
        if (!this.disposeAfterAcquisition) return true;
        this.disposeAfterAcquisition = false;
        await this.startRelease(suspensionId);
        return false;
      } finally {
        this.disposeAfterAcquisition = false;
      }
    })();
    this.acquisition = pending;
    void pending.then(
      () => {
        if (this.acquisition === pending) this.acquisition = null;
      },
      () => {
        if (this.acquisition === pending) this.acquisition = null;
      },
    );
    return pending;
  }

  release(): Promise<boolean> {
    if (this.releaseOperation) return this.releaseOperation;
    const suspensionId = this.suspensionId;
    return suspensionId ? this.startRelease(suspensionId) : Promise.resolve(true);
  }

  /** Release a token that arrives after the caller has already left its UI. */
  dispose(): Promise<boolean> {
    const pendingAdmission = this.acquisition;
    if (!pendingAdmission) return this.release();
    this.disposeAfterAcquisition = true;
    return pendingAdmission.then((admitted) => (admitted ? this.release() : true));
  }

  private startRelease(suspensionId: string): Promise<boolean> {
    const pending = this.options.release(suspensionId).then((released) => {
      if (released && this.suspensionId === suspensionId) this.suspensionId = null;
      return released;
    });
    this.releaseOperation = pending;
    void pending.then(
      () => {
        if (this.releaseOperation === pending) this.releaseOperation = null;
      },
      () => {
        if (this.releaseOperation === pending) this.releaseOperation = null;
      },
    );
    return pending;
  }
}
