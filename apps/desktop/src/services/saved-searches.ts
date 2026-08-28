// Saved-search runner: re-runs stored open-source queries on a schedule and
// surfaces newly-published matches. Network work stays in the renderer, while
// every durable mutation crosses the typed main-process command boundary.
import type { DiscoveryQuery, DiscoverySource } from "@aurascholar/core";
import type { SavedSearchReadRow } from "../../electron/data-command-contract";
import {
  normalizeSavedSearchCriteria,
  parseSavedSearchCriteria,
} from "../shared/saved-search-criteria";
import type { DiscoveryResultWithLibrary } from "./discovery";
import {
  canonicalSavedSearchSources,
  parseSavedSearchSources,
  savedSearchResultId,
  toSavedSearchView,
  type SavedSearchView,
} from "./saved-search-model";
import { savedSearchPollKey, waitForSavedSearchPoll } from "./saved-search-polling";
import {
  isSavedSearchReportUnavailable,
  savedSearchReportErrorMessage,
} from "./saved-search-report";
import { createDefaultSavedSearchServiceDependencies } from "./saved-search-runtime";
import type {
  CreateSavedSearchResult,
  SavedSearchNotification,
  SavedSearchScope,
  SavedSearchServiceDependencies,
  SavedSearchTimer,
} from "./saved-search-service-contract";
import { describeSafeError } from "./sensitive-text";

export type { SavedSearchView } from "./saved-search-model";
export type {
  CreateSavedSearchResult,
  SavedSearchReadRepository,
  SavedSearchServiceDependencies,
  SavedSearchWriteGateway,
} from "./saved-search-service-contract";

interface PollOutcome {
  committed: boolean;
  error?: { cause: unknown; message: string };
  freshCount: number;
}

interface PollEntry {
  controller: AbortController;
  notifyRequested: boolean;
  promise: Promise<PollOutcome>;
  waiters: number;
}

interface LoopState {
  controller: AbortController | null;
  stopped: boolean;
  timer: SavedSearchTimer | null;
}

export class SavedSearchService {
  private readonly generations = new Map<string, number>();
  private readonly inFlight = new Map<string, PollEntry>();
  private loop: LoopState | null = null;

  constructor(private readonly dependencies: SavedSearchServiceDependencies) {}

  async list(): Promise<SavedSearchView[]> {
    const scope = await this.dependencies.openScope();
    return (await scope.repository.list()).map(toSavedSearchView);
  }

  async create(
    criteria: DiscoveryQuery,
    sources?: DiscoverySource[],
  ): Promise<CreateSavedSearchResult> {
    const scope = await this.dependencies.openScope();
    const normalizedCriteria = normalizeSavedSearchCriteria(criteria);
    const result = await this.dependencies.writes.create({
      libraryId: scope.libraryId,
      query: normalizedCriteria.text,
      criteria: normalizedCriteria,
      sources: canonicalSavedSearchSources(sources),
    });
    if (result.created) {
      await this.run(result.id, { silent: true });
    }
    return result;
  }

  async delete(id: string): Promise<void> {
    const scope = await this.dependencies.openScope();
    this.invalidatePollGeneration(scope.libraryId, id);
    try {
      await this.dependencies.writes.delete({
        libraryId: scope.libraryId,
        savedSearchId: id,
      });
    } catch (error) {
      this.publishUpdateBestEffort();
      throw error;
    }
  }

  async restore(id: string): Promise<void> {
    const scope = await this.dependencies.openScope();
    await this.dependencies.writes.restore({
      libraryId: scope.libraryId,
      savedSearchId: id,
    });
  }

  async clearBadge(id: string): Promise<void> {
    const scope = await this.dependencies.openScope();
    await this.dependencies.writes.clearNew({
      libraryId: scope.libraryId,
      savedSearchId: id,
    });
  }

  async run(id: string, options: { signal?: AbortSignal; silent?: boolean } = {}): Promise<number> {
    const scope = await this.dependencies.openScope();
    options.signal?.throwIfAborted();
    const row = (await scope.repository.list()).find((candidate) => candidate.id === id);
    options.signal?.throwIfAborted();
    if (!row) return 0;
    return this.runRow(scope, row, {
      signal: options.signal,
      silent: options.silent ?? false,
      throwOnError: !(options.silent ?? false),
    });
  }

  async runDue(signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted();
    const scope = await this.dependencies.openScope();
    signal?.throwIfAborted();
    const due = (await scope.repository.due()).map((row) => ({
      generation: this.pollGeneration(scope.libraryId, row.id),
      row,
    }));
    signal?.throwIfAborted();
    let total = 0;
    for (const candidate of due) {
      if (signal?.aborted) break;
      const current = await scope.repository.get(candidate.row.id);
      if (signal?.aborted) break;
      if (
        !current ||
        current.deleted_at !== null ||
        current.updated_at !== candidate.row.updated_at ||
        this.pollGeneration(scope.libraryId, current.id) !== candidate.generation
      ) {
        continue;
      }
      total += await this.runRow(scope, current, {
        signal,
        silent: false,
        throwOnError: false,
      });
    }
    return total;
  }

  startLoop(): () => void {
    if (this.loop) return () => this.stopLoop();

    const state: LoopState = { controller: null, stopped: false, timer: null };
    this.loop = state;

    const runCycle = async () => {
      if (state.stopped || this.loop !== state) return;
      const controller = new AbortController();
      state.controller = controller;
      try {
        await this.runDue(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) this.dependencies.onLoopError(error);
      } finally {
        if (state.controller === controller) state.controller = null;
        if (!state.stopped && this.loop === state) {
          state.timer = this.dependencies.schedule(() => {
            state.timer = null;
            void runCycle();
          }, this.dependencies.loopIntervalMs);
        }
      }
    };

    void runCycle();
    return () => {
      if (this.loop === state) this.stopLoop();
    };
  }

  stopLoop(): void {
    const state = this.loop;
    if (!state) return;
    this.loop = null;
    state.stopped = true;
    state.controller?.abort();
    if (state.timer !== null) this.dependencies.clearTimer(state.timer);
    state.controller = null;
    state.timer = null;
  }

  private async runRow(
    scope: SavedSearchScope,
    row: SavedSearchReadRow,
    options: {
      signal?: AbortSignal;
      silent: boolean;
      throwOnError: boolean;
    },
  ): Promise<number> {
    const key = savedSearchPollKey(scope.libraryId, row.id);
    let entry = this.inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = {
        controller,
        notifyRequested: !options.silent,
        promise: Promise.resolve({ committed: false, freshCount: 0 }),
        waiters: 0,
      };
      const currentEntry = entry;
      entry.promise = this.executePoll(scope, row, currentEntry).finally(() => {
        if (this.inFlight.get(key) === currentEntry) this.inFlight.delete(key);
      });
      this.inFlight.set(key, entry);
    } else if (!options.silent) {
      entry.notifyRequested = true;
    }

    entry.waiters += 1;
    try {
      const outcome = await waitForSavedSearchPoll(entry.promise, options.signal);
      if (outcome.error && options.throwOnError) {
        throw new Error(outcome.error.message, { cause: outcome.error.cause });
      }
      return outcome.freshCount;
    } finally {
      entry.waiters -= 1;
      if (entry.waiters === 0 && this.inFlight.get(key) === entry) {
        this.inFlight.delete(key);
        entry.controller.abort();
      }
    }
  }

  private async executePoll(
    scope: SavedSearchScope,
    row: SavedSearchReadRow,
    entry: PollEntry,
  ): Promise<PollOutcome> {
    const criteria = parseSavedSearchCriteria(row.criteria_json, row.query);
    const sources = parseSavedSearchSources(row.sources_json) ?? undefined;
    let results: DiscoveryResultWithLibrary[];
    try {
      // This network request deliberately happens before the main-process
      // command. The command opens only the short CAS transaction.
      const report = await this.dependencies.search(criteria, sources, entry.controller.signal);
      if (entry.controller.signal.aborted) return cancelledOutcome();
      if (isSavedSearchReportUnavailable(report)) {
        throw new Error(savedSearchReportErrorMessage(report));
      }
      results = report.results;
    } catch (error) {
      if (entry.controller.signal.aborted) return cancelledOutcome();
      const message = describeSafeError(error);
      const commit = await this.dependencies.writes.recordError({
        error: message,
        expectedUpdatedAt: row.updated_at,
        libraryId: scope.libraryId,
        nextRunAt: this.dependencies.now() + this.dependencies.nextRunDelayMs,
        savedSearchId: row.id,
      });
      if (!commit.committed) return staleOutcome();
      if (!this.isCurrentEntry(scope.libraryId, row.id, entry)) return cancelledOutcome();
      this.publishUpdateBestEffort();
      return { committed: true, error: { cause: error, message }, freshCount: 0 };
    }

    if (entry.controller.signal.aborted) return cancelledOutcome();
    const observedIds = [...new Set(results.map((result) => savedSearchResultId(result.work)))];
    const commit = await this.dependencies.writes.recordRun({
      expectedUpdatedAt: row.updated_at,
      libraryId: scope.libraryId,
      nextRunAt: this.dependencies.now() + this.dependencies.nextRunDelayMs,
      observedIds,
      savedSearchId: row.id,
    });
    if (!commit.committed) return staleOutcome();
    if (!this.isCurrentEntry(scope.libraryId, row.id, entry)) return cancelledOutcome();

    this.publishUpdateBestEffort();
    if (entry.notifyRequested && commit.freshCount > 0) {
      await this.notifyBestEffort({
        title: `🔎 检索订阅有 ${commit.freshCount} 篇新结果`,
        body: row.query,
        tag: `saved-search:${row.id}`,
      });
    }
    return { committed: true, freshCount: commit.freshCount };
  }

  private invalidatePollGeneration(libraryId: string, id: string): void {
    const key = savedSearchPollKey(libraryId, id);
    this.generations.set(key, this.pollGeneration(libraryId, id) + 1);
    const entry = this.inFlight.get(key);
    if (!entry) return;
    this.inFlight.delete(key);
    entry.controller.abort();
  }

  private pollGeneration(libraryId: string, id: string): number {
    return this.generations.get(savedSearchPollKey(libraryId, id)) ?? 0;
  }

  private isCurrentEntry(libraryId: string, id: string, entry: PollEntry): boolean {
    return (
      !entry.controller.signal.aborted &&
      this.inFlight.get(savedSearchPollKey(libraryId, id)) === entry
    );
  }

  private publishUpdateBestEffort(): void {
    try {
      this.dependencies.dispatchUpdated();
    } catch {
      // The CAS write is already durable; renderer event delivery is best-effort.
    }
  }

  private async notifyBestEffort(notification: SavedSearchNotification): Promise<void> {
    try {
      await this.dependencies.notify(notification);
    } catch {
      // Poll state is already durable; OS notification delivery is best-effort.
    }
  }
}

export function createSavedSearchService(
  dependencies: SavedSearchServiceDependencies,
): SavedSearchService {
  return new SavedSearchService(dependencies);
}

const savedSearchService = new SavedSearchService(createDefaultSavedSearchServiceDependencies());

export async function listSavedSearches(): Promise<SavedSearchView[]> {
  return savedSearchService.list();
}

export async function createSavedSearch(
  criteria: DiscoveryQuery,
  sources?: DiscoverySource[],
): Promise<CreateSavedSearchResult> {
  return savedSearchService.create(criteria, sources);
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await savedSearchService.delete(id);
}

export async function restoreSavedSearch(id: string): Promise<void> {
  await savedSearchService.restore(id);
}

export async function clearSavedSearchBadge(id: string): Promise<void> {
  await savedSearchService.clearBadge(id);
}

/** Run one saved search now. Returns the number of newly-seen results. */
export async function runSavedSearch(
  id: string,
  options: { signal?: AbortSignal; silent?: boolean } = {},
): Promise<number> {
  return savedSearchService.run(id, options);
}

/** Poll every due saved search once. Returns total newly-seen results committed. */
export async function runDueSavedSearches(signal?: AbortSignal): Promise<number> {
  return savedSearchService.runDue(signal);
}

/** Startup catch-up, followed by one wake-up after each completed cycle. */
export function startSavedSearchLoop(): () => void {
  return savedSearchService.startLoop();
}

export function stopSavedSearchLoop(): void {
  savedSearchService.stopLoop();
}

function cancelledOutcome(): PollOutcome {
  return { committed: false, freshCount: 0 };
}

function staleOutcome(): PollOutcome {
  return { committed: false, freshCount: 0 };
}
