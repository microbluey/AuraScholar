export interface ResearchDownloadCleanupTracker {
  has(path: string): boolean;
  hold(path: string): void;
  settle(path: string, pathCleared: boolean, retainFailure?: boolean): void;
}

/** Tracks overlapping cleanup work and failed consume cleanup tombstones. */
export function createResearchDownloadCleanupTracker(): ResearchDownloadCleanupTracker {
  const active = new Map<string, number>();
  const failed = new Set<string>();

  return {
    has(path) {
      return active.has(path) || failed.has(path);
    },
    hold(path) {
      active.set(path, (active.get(path) ?? 0) + 1);
    },
    settle(path, pathCleared, retainFailure = false) {
      const count = active.get(path);
      if (!count) return;
      if (pathCleared) failed.delete(path);
      else if (retainFailure) failed.add(path);
      if (count === 1) active.delete(path);
      else active.set(path, count - 1);
    },
  };
}
