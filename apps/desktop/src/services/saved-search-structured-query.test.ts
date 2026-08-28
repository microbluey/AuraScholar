import { describe, expect, it, vi } from "vitest";
import type { SavedSearchRow } from "@aurascholar/db/repos/saved-searches";
import type { DiscoverySearchReportWithLibrary } from "./discovery";
import {
  createSavedSearchService,
  type SavedSearchServiceDependencies,
  type SavedSearchWriteGateway,
} from "./saved-searches";

function row(criteria_json: string | null): SavedSearchRow {
  return {
    id: "saved-criteria",
    library_id: "library-criteria",
    query: "graph retrieval",
    criteria_json,
    sources_json: '["openalex"]',
    seen_ids_json: "[]",
    new_count: 0,
    last_run_at: null,
    next_run_at: null,
    last_error: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
  };
}

function report(): DiscoverySearchReportWithLibrary {
  return {
    results: [],
    sources: {
      openalex: { count: 0, source: "openalex", status: "empty" },
    },
    cursors: {},
  } as unknown as DiscoverySearchReportWithLibrary;
}

function dependencies(current: SavedSearchRow, search: SavedSearchServiceDependencies["search"]) {
  const writes: SavedSearchWriteGateway = {
    clearNew: vi.fn(async () => ({ updated: 1 })),
    create: vi.fn(async () => ({ created: true, id: current.id })),
    delete: vi.fn(async () => ({ updated: 1 })),
    recordError: vi.fn(async () => ({ committed: true, updatedAt: 2 })),
    recordRun: vi.fn(async () => ({ committed: true, freshCount: 0, updatedAt: 2 })),
    restore: vi.fn(async () => ({ updated: 1 })),
  };
  return {
    clearTimer: vi.fn(),
    dispatchUpdated: vi.fn(),
    loopIntervalMs: 60,
    nextRunDelayMs: 1_000,
    notify: vi.fn(async () => undefined),
    now: vi.fn(() => 1_000),
    onLoopError: vi.fn(),
    openScope: vi.fn(async () => ({
      libraryId: current.library_id,
      repository: {
        due: vi.fn(async () => [current]),
        get: vi.fn(async () => current),
        list: vi.fn(async () => [current]),
      },
    })),
    schedule: vi.fn((callback) => globalThis.setTimeout(callback, 60)),
    search,
    writes,
  } satisfies SavedSearchServiceDependencies;
}

describe("saved-search structured criteria polling", () => {
  it("replays every persisted advanced condition during polling", async () => {
    const current = row(
      '{"text":"graph retrieval","author":"Ada","yearFrom":2020,"yearTo":2024,"venue":"NeurIPS"}',
    );
    const search = vi.fn(async () => report());
    const service = createSavedSearchService(dependencies(current, search));

    await service.run(current.id, { silent: true });

    expect(search).toHaveBeenCalledWith(
      {
        text: "graph retrieval",
        author: "Ada",
        yearFrom: 2020,
        yearTo: 2024,
        venue: "NeurIPS",
      },
      ["openalex"],
      expect.any(AbortSignal),
    );
  });

  it("falls back to the text query for legacy rows without criteria JSON", async () => {
    const current = row(null);
    const search = vi.fn(async () => report());
    const service = createSavedSearchService(dependencies(current, search));

    await service.run(current.id, { silent: true });

    expect(search).toHaveBeenCalledWith(
      { text: "graph retrieval" },
      ["openalex"],
      expect.any(AbortSignal),
    );
  });

  it.each(["{", '{"text":"different query","author":"Ada"}'])(
    "falls back to the text query when persisted criteria are unsafe (%s)",
    async (criteriaJson) => {
      const current = row(criteriaJson);
      const search = vi.fn(async () => report());
      const service = createSavedSearchService(dependencies(current, search));

      await service.run(current.id, { silent: true });

      expect(search).toHaveBeenCalledWith(
        { text: "graph retrieval" },
        ["openalex"],
        expect.any(AbortSignal),
      );
    },
  );
});
