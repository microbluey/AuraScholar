import { describe, expect, it, vi } from "vitest";
import {
  activateDiscoverySavedSearch,
  type SavedSearchActivationHandlers,
} from "./useDiscoverySavedSearchActivation";

function handlers(result = true): SavedSearchActivationHandlers {
  return {
    runSearch: vi.fn(async () => result),
    setAdvancedOpen: vi.fn(),
    setAuthor: vi.fn(),
    setMode: vi.fn(),
    setQuery: vi.fn(),
    setSelectedSources: vi.fn(),
    setVenue: vi.fn(),
    setYearFrom: vi.fn(),
    setYearTo: vi.fn(),
  };
}

describe("saved search activation", () => {
  it("restores every advanced condition and reruns the structured query", async () => {
    const action = handlers();
    const criteria = {
      text: "graph retrieval",
      author: "Ada",
      yearFrom: 2020,
      yearTo: 2024,
      venue: "NeurIPS",
    };
    const sources = ["openalex", "s2"] as const;

    await expect(
      activateDiscoverySavedSearch({ criteria, sources: [...sources] }, action),
    ).resolves.toBe(true);

    expect(action.setMode).toHaveBeenCalledWith("opensource");
    expect(action.setQuery).toHaveBeenCalledWith("graph retrieval");
    expect(action.setAuthor).toHaveBeenCalledWith("Ada");
    expect(action.setYearFrom).toHaveBeenCalledWith("2020");
    expect(action.setYearTo).toHaveBeenCalledWith("2024");
    expect(action.setVenue).toHaveBeenCalledWith("NeurIPS");
    expect(action.setAdvancedOpen).toHaveBeenCalledWith(true);
    expect(action.setSelectedSources).toHaveBeenCalledWith(new Set(sources));
    expect(action.runSearch).toHaveBeenCalledWith({ query: criteria, sources });
  });

  it("clears stale advanced state when opening a text-only subscription", async () => {
    const action = handlers(false);
    const criteria = { text: "retrieval" };
    const sources = ["crossref"] as const;

    await expect(
      activateDiscoverySavedSearch({ criteria, sources: [...sources] }, action),
    ).resolves.toBe(false);

    expect(action.setAuthor).toHaveBeenCalledWith("");
    expect(action.setYearFrom).toHaveBeenCalledWith("");
    expect(action.setYearTo).toHaveBeenCalledWith("");
    expect(action.setVenue).toHaveBeenCalledWith("");
    expect(action.setAdvancedOpen).toHaveBeenCalledWith(false);
    expect(action.runSearch).toHaveBeenCalledWith({ query: criteria, sources });
  });
});
