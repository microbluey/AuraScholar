import { useCallback, useRef, useState } from "react";
import {
  resolveActiveLibraryRouteRequest,
  type LibraryDeepLinkView,
  type LibraryExtraFilter,
  type LibraryFilter,
  type LibraryRouteRequest,
} from "./library-workspace-state";

export function useLibraryBrowseState(input: {
  onCancelRoute(): void;
  urlRouteRequest: LibraryRouteRequest | null;
}) {
  const { onCancelRoute, urlRouteRequest } = input;
  const [cancelledRouteKey, setCancelledRouteKey] = useState<string | null>(null);
  const currentRouteRequest = resolveActiveLibraryRouteRequest(urlRouteRequest, cancelledRouteKey);
  const currentRouteKey = currentRouteRequest?.key ?? null;
  const [search, setSearchState] = useState("");
  const [activeCollection, setActiveCollectionState] = useState<string | null>(null);
  const [activeFilter, setActiveFilterState] = useState<LibraryFilter>("all");
  const [activeTag, setActiveTagState] = useState<string | null>(null);
  const [activeSource, setActiveSourceState] = useState<string | null>(null);
  const [extraFilter, setExtraFilterState] = useState<LibraryExtraFilter | null>(null);
  const searchRef = useRef(search);
  const activeCollectionRef = useRef(activeCollection);
  const activeFilterRef = useRef(activeFilter);
  const appliedRouteKeyRef = useRef<string | null>(null);
  const routeCancellationStartedRef = useRef<string | null>(null);

  const cancelCurrentRouteRequest = useCallback(() => {
    if (!currentRouteKey || routeCancellationStartedRef.current === currentRouteKey) return;
    routeCancellationStartedRef.current = currentRouteKey;
    appliedRouteKeyRef.current = null;
    setCancelledRouteKey(currentRouteKey);
    onCancelRoute();
  }, [currentRouteKey, onCancelRoute, setCancelledRouteKey]);
  const setSearch = useCallback(
    (value: string) => {
      cancelCurrentRouteRequest();
      searchRef.current = value;
      setSearchState(value);
    },
    [cancelCurrentRouteRequest],
  );
  const setActiveCollection = useCallback(
    (value: string | null) => {
      cancelCurrentRouteRequest();
      activeCollectionRef.current = value;
      setActiveCollectionState(value);
    },
    [cancelCurrentRouteRequest],
  );
  const setActiveFilter = useCallback(
    (value: LibraryFilter) => {
      cancelCurrentRouteRequest();
      activeFilterRef.current = value;
      setActiveFilterState(value);
    },
    [cancelCurrentRouteRequest],
  );
  const setActiveTag = useCallback(
    (value: string | null) => {
      cancelCurrentRouteRequest();
      setActiveTagState(value);
    },
    [cancelCurrentRouteRequest],
  );
  const setActiveSource = useCallback(
    (value: string | null) => {
      cancelCurrentRouteRequest();
      setActiveSourceState(value);
    },
    [cancelCurrentRouteRequest],
  );
  const setExtraFilter = useCallback(
    (value: LibraryExtraFilter | null) => {
      cancelCurrentRouteRequest();
      setExtraFilterState(value);
    },
    [cancelCurrentRouteRequest],
  );
  const applyRouteView = useCallback((view: LibraryDeepLinkView) => {
    activeFilterRef.current = view.activeFilter;
    setActiveFilterState(view.activeFilter);
    activeCollectionRef.current = view.activeCollection;
    setActiveCollectionState(view.activeCollection);
    setActiveTagState(view.activeTag);
    setActiveSourceState(view.activeSource);
    setExtraFilterState(view.extraFilter);
    searchRef.current = view.search;
    setSearchState(view.search);
  }, []);

  return {
    activeCollection,
    activeCollectionRef,
    activeFilter,
    activeFilterRef,
    activeSource,
    activeTag,
    appliedRouteKeyRef,
    applyRouteView,
    cancelCurrentRouteRequest,
    currentRouteKey,
    currentRouteRequest,
    extraFilter,
    search,
    searchRef,
    setActiveCollection,
    setActiveFilter,
    setActiveSource,
    setActiveTag,
    setExtraFilter,
    setSearch,
  };
}
