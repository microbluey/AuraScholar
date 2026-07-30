import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { DiscoverySource } from "@aurascholar/core";
import type { ConfirmFunction } from "../../components/ConfirmDialog";
import {
  clearSavedSearchBadge,
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  restoreSavedSearch,
  runSavedSearch,
  type SavedSearchView,
} from "../../services/saved-searches";
import { describeSafeError } from "../../services/sensitive-text";
import { createDiscoverySavedSearchController } from "./discovery-saved-search-controller";
import type {
  ActivateSavedSearchInput,
  DiscoverySavedSearchFailureKind,
} from "./discovery-saved-search-model";

const MIN_SAVED_SEARCH_BUSY_MS = 350;

interface DiscoverySavedSearchSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_DELETE_SEARCH__?: unknown;
  __AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SEARCH__?: unknown;
  __AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SAVE_SEARCH__?: unknown;
}

export interface UseDiscoverySavedSearchControllerOptions {
  confirm: ConfirmFunction;
  defaultSources: readonly DiscoverySource[];
  enabled: boolean;
  onMessage: (message: string) => void;
  onOpenSearch: (input: ActivateSavedSearchInput) => Promise<boolean>;
  query: string;
  selectedSources: ReadonlySet<DiscoverySource>;
}

export function useDiscoverySavedSearchController({
  confirm,
  defaultSources,
  enabled,
  onMessage,
  onOpenSearch,
  query,
  selectedSources,
}: UseDiscoverySavedSearchControllerOptions) {
  const controllerRef = useRef<ReturnType<typeof createDiscoverySavedSearchController> | null>(
    null,
  );
  if (!controllerRef.current) {
    controllerRef.current = createDiscoverySavedSearchController({
      data: {
        clearBadge: clearSavedSearchBadge,
        create: createSavedSearch,
        delete: deleteSavedSearch,
        list: listSavedSearches,
        restore: restoreSavedSearch,
        run: runSavedSearch,
      },
      defaultSources,
      desktopRuntime: enabled,
      consumeFailure: consumeSavedSearchSmokeFailure,
      waitForMinimumElapsed,
    });
  }
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    const onUpdate = () => void controller.refresh();
    window.addEventListener("aurascholar:saved-searches-updated", onUpdate);
    return () => {
      window.removeEventListener("aurascholar:saved-searches-updated", onUpdate);
      controller.stop();
    };
  }, [controller]);

  const saveCurrent = useCallback(
    () => controller.save(query, [...selectedSources], { reportMessage: onMessage }),
    [controller, onMessage, query, selectedSources],
  );
  const open = useCallback(
    (saved: SavedSearchView) =>
      controller.open(saved, {
        activateSearch: onOpenSearch,
        confirm,
        reportMessage: onMessage,
      }),
    [confirm, controller, onMessage, onOpenSearch],
  );
  const check = useCallback(
    (id: string) => controller.check(id, { reportMessage: onMessage }),
    [controller, onMessage],
  );
  const remove = useCallback(
    (saved: SavedSearchView) =>
      controller.remove(saved, {
        activateSearch: onOpenSearch,
        confirm,
        reportMessage: onMessage,
      }),
    [confirm, controller, onMessage, onOpenSearch],
  );
  const restoreLastDelete = useCallback(
    () => controller.undoDelete({ reportMessage: onMessage }),
    [controller, onMessage],
  );
  const recentItems = useMemo(() => snapshot.items.slice(0, 3), [snapshot.items]);
  const newCount = useMemo(
    () => snapshot.items.reduce((sum, saved) => sum + saved.newCount, 0),
    [snapshot.items],
  );

  return {
    ...snapshot,
    check,
    newCount,
    open,
    recentItems,
    remove,
    restoreLastDelete,
    saveCurrent,
  };
}

async function waitForMinimumElapsed(startedAt: number): Promise<void> {
  const remaining = MIN_SAVED_SEARCH_BUSY_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

function consumeSavedSearchSmokeFailure(kind: DiscoverySavedSearchFailureKind): Error | null {
  const target = window as DiscoverySavedSearchSmokeWindow;
  const key = smokeFailureKey(kind);
  const failure = target[key];
  if (failure == null) return null;
  delete target[key];
  return failure instanceof Error ? failure : new Error(describeSafeError(failure));
}

function smokeFailureKey(
  kind: DiscoverySavedSearchFailureKind,
): keyof DiscoverySavedSearchSmokeWindow {
  if (kind === "delete") return "__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_DELETE_SEARCH__";
  if (kind === "restore") return "__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_RESTORE_SEARCH__";
  return "__AURASCHOLAR_SMOKE_DISCOVERY_FAIL_NEXT_SAVE_SEARCH__";
}
