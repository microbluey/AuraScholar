import type { Database } from "@aurascholar/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLibraryDb: vi.fn(),
}));

vi.mock("./aura-db", () => ({
  getLibraryDb: mocks.getLibraryDb,
}));

import { loadLibraryShellStats } from "./app-shell-data";

const LIBRARY_ID = "library-1";

function databaseWithQuery(query: unknown): Database {
  return {
    exec: vi.fn(),
    query: query as Database["query"],
    queryScalar: vi.fn(),
    run: vi.fn(),
  };
}

describe("app shell data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the active library summary and maps collection rows", async () => {
    const query = vi.fn(async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM works") && sql.includes("deleted_at IS NULL")) {
        return [{ n: 12 }] as T[];
      }
      if (sql.includes("FROM works") && sql.includes("deleted_at IS NOT NULL")) {
        return [{ n: 2 }] as T[];
      }
      if (sql.includes("FROM annotations")) return [{ n: 7 }] as T[];
      if (sql.includes("FROM canvas_nodes")) return [{ n: 9 }] as T[];
      if (sql.includes("FROM snippets")) return [{ n: 4 }] as T[];
      if (sql.includes("FROM collections c")) {
        return [
          {
            count: 3,
            id: "collection-1",
            name: "Methods",
            parent_id: null,
            sort_order: 1,
          },
          {
            count: 1,
            id: "collection-2",
            name: "Causal inference",
            parent_id: "collection-1",
            sort_order: 0,
          },
        ] as T[];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    mocks.getLibraryDb.mockResolvedValue({
      db: databaseWithQuery(query),
      libraryId: LIBRARY_ID,
    });

    await expect(loadLibraryShellStats()).resolves.toEqual({
      annotations: 7,
      canvasNodes: 9,
      collections: [
        {
          count: 3,
          id: "collection-1",
          name: "Methods",
          parentId: null,
          sortOrder: 1,
        },
        {
          count: 1,
          id: "collection-2",
          name: "Causal inference",
          parentId: "collection-1",
          sortOrder: 0,
        },
      ],
      snippets: 4,
      total: 12,
      trash: 2,
    });

    expect(query).toHaveBeenCalledTimes(6);
    const queryCalls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    for (const [, params] of queryCalls) {
      expect(params).toEqual([LIBRARY_ID]);
    }
    expect(
      queryCalls.find(
        ([sql]) => sql.includes("FROM works") && sql.includes("deleted_at IS NULL"),
      )?.[0],
    ).toContain("library_id = ?");
    expect(
      queryCalls.find(
        ([sql]) => sql.includes("FROM works") && sql.includes("deleted_at IS NOT NULL"),
      )?.[0],
    ).toContain("library_id = ?");
    expect(queryCalls.find(([sql]) => sql.includes("FROM annotations"))?.[0]).toContain(
      "w.library_id = ? AND a.deleted_at IS NULL",
    );
    expect(queryCalls.find(([sql]) => sql.includes("FROM canvas_nodes"))?.[0]).toContain(
      "cw.library_id = ?",
    );
    expect(queryCalls.find(([sql]) => sql.includes("FROM snippets"))?.[0]).toContain(
      "w.library_id = ? AND s.deleted_at IS NULL",
    );
    expect(queryCalls.find(([sql]) => sql.includes("FROM collections c"))?.[0]).toContain(
      "c.library_id = ? AND c.deleted_at IS NULL",
    );
  });

  it("uses zero defaults when count queries return no rows", async () => {
    const query = vi.fn(async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM collections c")) return [] as T[];
      return [] as T[];
    });
    mocks.getLibraryDb.mockResolvedValue({
      db: databaseWithQuery(query),
      libraryId: LIBRARY_ID,
    });

    await expect(loadLibraryShellStats()).resolves.toEqual({
      annotations: 0,
      canvasNodes: 0,
      collections: [],
      snippets: 0,
      total: 0,
      trash: 0,
    });
  });

  it("propagates read failures to the shell refresh boundary", async () => {
    const failure = new Error("read failed");
    const query = vi.fn(async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("FROM canvas_nodes")) throw failure;
      return [] as T[];
    });
    mocks.getLibraryDb.mockResolvedValue({
      db: databaseWithQuery(query),
      libraryId: LIBRARY_ID,
    });

    await expect(loadLibraryShellStats()).rejects.toBe(failure);
  });
});
