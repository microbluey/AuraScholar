const MAX_ACTIVE_AI_RUNS = 4;

/**
 * Main-owned cancellation registry for provider calls. Renderer request ids
 * are opaque, bounded tokens; a duplicate never replaces an active run.
 */
export class MainAiRunRegistry {
  private readonly runs = new Map<string, AbortController>();

  begin(requestId: string): AbortSignal {
    if (this.runs.has(requestId)) {
      throw new Error("AI request id is already active");
    }
    if (this.runs.size >= MAX_ACTIVE_AI_RUNS) {
      throw new Error(`At most ${MAX_ACTIVE_AI_RUNS} AI requests may run at once`);
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

export const mainAiRunRegistry = new MainAiRunRegistry();
