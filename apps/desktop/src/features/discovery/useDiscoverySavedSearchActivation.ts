import { useCallback } from "react";
import type { DiscoveryQuery, DiscoverySource } from "@aurascholar/core";
import type { ActivateSavedSearchInput } from "./discovery-saved-search-model";

export type SavedSearchRunner = (options: {
  query?: DiscoveryQuery;
  sources?: DiscoverySource[];
}) => Promise<boolean>;

export interface SavedSearchActivationHandlers {
  runSearch: SavedSearchRunner;
  setAdvancedOpen(value: boolean): void;
  setAuthor(value: string): void;
  setMode(value: "opensource"): void;
  setQuery(value: string): void;
  setSelectedSources(value: Set<DiscoverySource>): void;
  setVenue(value: string): void;
  setYearFrom(value: string): void;
  setYearTo(value: string): void;
}

export async function activateDiscoverySavedSearch(
  { criteria, sources }: ActivateSavedSearchInput,
  {
    runSearch,
    setAdvancedOpen,
    setAuthor,
    setMode,
    setQuery,
    setSelectedSources,
    setVenue,
    setYearFrom,
    setYearTo,
  }: SavedSearchActivationHandlers,
): Promise<boolean> {
  setMode("opensource");
  setQuery(criteria.text);
  setAuthor(criteria.author ?? "");
  setYearFrom(criteria.yearFrom?.toString() ?? "");
  setYearTo(criteria.yearTo?.toString() ?? "");
  setVenue(criteria.venue ?? "");
  setAdvancedOpen(
    Boolean(
      criteria.author ||
      criteria.yearFrom !== undefined ||
      criteria.yearTo !== undefined ||
      criteria.venue,
    ),
  );
  setSelectedSources(new Set(sources));
  return runSearch({ query: criteria, sources });
}

export function useDiscoverySavedSearchActivation({
  runSearch,
  setAdvancedOpen,
  setAuthor,
  setMode,
  setQuery,
  setSelectedSources,
  setVenue,
  setYearFrom,
  setYearTo,
}: SavedSearchActivationHandlers): (input: ActivateSavedSearchInput) => Promise<boolean> {
  return useCallback(
    (input) =>
      activateDiscoverySavedSearch(input, {
        runSearch,
        setAdvancedOpen,
        setAuthor,
        setMode,
        setQuery,
        setSelectedSources,
        setVenue,
        setYearFrom,
        setYearTo,
      }),
    [
      runSearch,
      setAdvancedOpen,
      setAuthor,
      setMode,
      setQuery,
      setSelectedSources,
      setVenue,
      setYearFrom,
      setYearTo,
    ],
  );
}
