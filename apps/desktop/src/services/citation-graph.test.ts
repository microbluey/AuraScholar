import type { CitationGraph } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import { describe, expect, it, vi } from "vitest";
import {
  isCitationGraph,
  loadCitationGraphByDoi,
  parseCachedCitationGraph,
} from "./citation-graph";

const GRAPH: CitationGraph = {
  centerId: "W-center",
  truncated: false,
  nodes: [
    {
      id: "W-center",
      title: "Center",
      citedByCount: 10,
      doi: "10.1000/center",
      relation: "center",
    },
    {
      id: "W-reference",
      title: "Reference",
      citedByCount: 5,
      doi: "10.1000/reference",
      relation: "reference",
    },
  ],
  edges: [{ source: "W-center", target: "W-reference" }],
};

function fakeDb(rows: Array<{ fetched_at: number; payload_json: string }> = []) {
  const calls: Array<{ params?: unknown[]; sql: string }> = [];
  const db: Database = {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      calls.push({ sql, params });
      return rows as T[];
    },
    async run(sql: string, params?: unknown[]): Promise<number> {
      calls.push({ sql, params });
      return 1;
    },
    async exec(): Promise<void> {},
    async queryScalar(): Promise<unknown> {
      return undefined;
    },
  };
  return { calls, db };
}

function fakeDbByCacheKey(
  rows: Record<string, { fetched_at: number; payload_json: string } | undefined>,
) {
  const calls: Array<{ params?: unknown[]; sql: string }> = [];
  const db: Database = {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      calls.push({ sql, params });
      const key = String(params?.[0] ?? "");
      const row = rows[key];
      return (row ? [row] : []) as T[];
    },
    async run(sql: string, params?: unknown[]): Promise<number> {
      calls.push({ sql, params });
      return 1;
    },
    async exec(): Promise<void> {},
    async queryScalar(): Promise<unknown> {
      return undefined;
    },
  };
  return { calls, db };
}

describe("citation graph loading", () => {
  it("validates cached graph payloads defensively", () => {
    expect(isCitationGraph(GRAPH)).toBe(true);
    expect(parseCachedCitationGraph(JSON.stringify(GRAPH))).toEqual(GRAPH);
    expect(parseCachedCitationGraph("{")).toBeNull();
    expect(parseCachedCitationGraph(JSON.stringify({ ...GRAPH, centerId: "missing" }))).toBeNull();
  });

  it("reuses a fresh normalized DOI cache entry without rebuilding", async () => {
    const { calls, db } = fakeDb([{ payload_json: JSON.stringify(GRAPH), fetched_at: 9_900 }]);
    const buildGraph = vi.fn();

    await expect(
      loadCitationGraphByDoi(" HTTPS://DOI.ORG/10.1000/CENTER ", {
        buildGraph,
        db,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(buildGraph).not.toHaveBeenCalled();
    expect(calls).toEqual([
      {
        sql: "SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?",
        params: ["10.1000/center"],
      },
    ]);
  });

  it("removes an invalid fresh cache row before rebuilding and replacing it", async () => {
    const { calls, db } = fakeDb([{ payload_json: "{}", fetched_at: 9_900 }]);
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph,
        db,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(buildGraph).toHaveBeenCalledWith("10.1000/center", undefined);
    expect(calls.map((call) => call.sql)).toEqual([
      "SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?",
      "DELETE FROM graph_cache WHERE work_id = ?",
      "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
    ]);
  });

  it("rebuilds a cache entry at the TTL boundary", async () => {
    const { calls, db } = fakeDb([{ payload_json: JSON.stringify(GRAPH), fetched_at: 9_900 }]);
    const buildGraph = vi.fn(async () => GRAPH);

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph,
        cacheTtlMs: 100,
        db,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(buildGraph).toHaveBeenCalledOnce();
    expect(calls.map((call) => call.sql)).toEqual([
      "SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?",
      "DELETE FROM graph_cache WHERE work_id = ?",
      "INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
    ]);
  });

  it("migrates a fresh legacy raw DOI cache key to the normalized key", async () => {
    const legacyKey = "HTTPS://DOI.ORG/10.1000/CENTER";
    const { calls, db } = fakeDbByCacheKey({
      [legacyKey]: { payload_json: JSON.stringify(GRAPH), fetched_at: 9_900 },
    });
    const buildGraph = vi.fn();

    await expect(
      loadCitationGraphByDoi(legacyKey, {
        buildGraph,
        db,
        now: () => 10_000,
      }),
    ).resolves.toEqual(GRAPH);

    expect(buildGraph).not.toHaveBeenCalled();
    expect(calls).toEqual([
      {
        sql: "SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?",
        params: ["10.1000/center"],
      },
      {
        sql: "SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?",
        params: [legacyKey],
      },
      {
        sql: "INSERT OR IGNORE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)",
        params: ["10.1000/center", JSON.stringify(GRAPH), 9_900],
      },
      {
        sql: "DELETE FROM graph_cache WHERE work_id = ?",
        params: [legacyKey],
      },
    ]);
  });

  it("does not write a graph after its request is aborted", async () => {
    const { calls, db } = fakeDb();
    const controller = new AbortController();
    const buildGraph = vi.fn(async () => {
      controller.abort();
      return GRAPH;
    });

    await expect(
      loadCitationGraphByDoi("10.1000/center", {
        buildGraph,
        db,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(calls.some((call) => call.sql.startsWith("INSERT"))).toBe(false);
  });
});
