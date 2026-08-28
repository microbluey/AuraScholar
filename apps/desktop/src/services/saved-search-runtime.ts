import { auraNotifier } from "./aura-platform";
import type {
  SavedSearchReadRepository,
  SavedSearchServiceDependencies,
  SavedSearchWriteGateway,
} from "./saved-search-service-contract";

const POLL_INTERVAL_MS = 12 * 60 * 60 * 1000;
const LOOP_INTERVAL_MS = 60 * 60 * 1000;

const defaultWrites: SavedSearchWriteGateway = {
  async clearNew(input) {
    return window.aura.data.command("savedSearch.clearNew", input);
  },
  async create(input) {
    return window.aura.data.command("savedSearch.create", input);
  },
  async delete(input) {
    return window.aura.data.command("savedSearch.delete", input);
  },
  async recordError(input) {
    return window.aura.data.command("savedSearch.recordError", input);
  },
  async recordRun(input) {
    return window.aura.data.command("savedSearch.recordRun", input);
  },
  async restore(input) {
    return window.aura.data.command("savedSearch.restore", input);
  },
};

const defaultReads: SavedSearchReadRepository = {
  async due() {
    return (await window.aura.data.command("savedSearch.listDue", {})).savedSearches;
  },
  async get(savedSearchId) {
    return (await window.aura.data.command("savedSearch.get", { savedSearchId })).savedSearch;
  },
  async list() {
    return (await window.aura.data.command("savedSearch.list", {})).savedSearches;
  },
};

export function createDefaultSavedSearchServiceDependencies(): SavedSearchServiceDependencies {
  return {
    clearTimer: (timer) => globalThis.clearTimeout(timer),
    dispatchUpdated: () => {
      window.dispatchEvent(new CustomEvent("aurascholar:saved-searches-updated"));
    },
    loopIntervalMs: LOOP_INTERVAL_MS,
    nextRunDelayMs: POLL_INTERVAL_MS,
    notify: (notification) => auraNotifier.notify(notification),
    now: () => Date.now(),
    onLoopError: () => undefined,
    async openScope() {
      const { libraryId } = await window.aura.data.command("savedSearch.getScope", {});
      return { libraryId, repository: defaultReads };
    },
    schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    async search(query, sources, signal) {
      const { searchDiscoveryDetailed } = await import("./discovery");
      return searchDiscoveryDetailed(query, sources, signal);
    },
    writes: defaultWrites,
  };
}
