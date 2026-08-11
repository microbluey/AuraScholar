const MAX_ACTIVE_SCHOLARLY_RUNS = 12;

/**
 * Main-owned cancellation registry for public scholarly API calls. Request ids
 * are opaque bounded tokens validated by the command parser; duplicate ids
 * never replace a live operation.
 */
export class MainScholarlyRunRegistry {
  private readonly runs = new Map<string, AbortController>();

  begin(requestId: string): AbortSignal {
    if (this.runs.has(requestId)) {
      throw new Error("Scholarly request id is already active");
    }
    if (this.runs.size >= MAX_ACTIVE_SCHOLARLY_RUNS) {
      throw new Error(`At most ${MAX_ACTIVE_SCHOLARLY_RUNS} scholarly requests may run at once`);
    }
    const controller = new AbortController();
    this.runs.set(requestId, controller);
    return controller.signal;
  }

  cancel(requestId: string): boolean {
    const controller = this.runs.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  end(requestId: string): void {
    this.runs.delete(requestId);
  }
}

export const mainScholarlyRunRegistry = new MainScholarlyRunRegistry();
