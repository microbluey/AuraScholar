import type { CitationGraph } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import { describe, expect, it, vi } from "vitest";
import {
  resolveCanvasCitationRelations,
  type ResolveCanvasCitationRelationsOptions,
} from "./canvas-citation-resolver";
import type { CanvasCitationPaperIdentity } from "./canvas-citation";

const PAPERS: CanvasCitationPaperIdentity[] = [
  { nodeId: "node-a", workId: "work-a", doi: "10.1000/a" },
  { nodeId: "node-b", workId: "work-b", doi: "10.1000/b" },
  { nodeId: "node-c", workId: "work-c", doi: null },
];

const GRAPH: CitationGraph = {
  centerId: "openalex-a",
  truncated: false,
  nodes: [
    {
      id: "openalex-a",
      title: "A",
      citedByCount: 10,
      doi: "10.1000/a",
      relation: "center",
    },
    {
      id: "openalex-b",
      title: "B",
      citedByCount: 5,
      doi: "https://doi.org/10.1000/B",
      relation: "reference",
    },
  ],
  edges: [{ source: "openalex-a", target: "openalex-b" }],
};

function fakeDb(): Database {
  return {
    async query<T>(): Promise<T[]> {
      return [];
    },
    async run(): Promise<number> {
      return 1;
    },
    async exec(): Promise<void> {},
    async queryScalar(): Promise<unknown> {
      return undefined;
    },
  };
}

function options(
  overrides: Partial<ResolveCanvasCitationRelationsOptions> = {},
): ResolveCanvasCitationRelationsOptions {
  return {
    db: fakeDb(),
    listLocalRelations: vi.fn(async () => []),
    persistRelation: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("canvas citation relation resolver", () => {
  it("uses active Library relations without making graph requests", async () => {
    const loadGraph = vi.fn();
    const result = await resolveCanvasCitationRelations(
      PAPERS,
      options({
        listLocalRelations: vi.fn(async () => [{ citingWorkId: "work-b", citedWorkId: "work-a" }]),
        loadGraph,
      }),
    );

    expect(result).toEqual({
      graphCount: 0,
      relations: [{ citingWorkId: "work-b", citedWorkId: "work-a" }],
      source: "library",
      truncated: false,
    });
    expect(loadGraph).not.toHaveBeenCalled();
  });

  it("loads graphs only for selected works not yet covered by local relations", async () => {
    const papers = [
      { nodeId: "node-a", workId: "work-a", doi: "10.1000/a" },
      { nodeId: "node-b", workId: "work-b", doi: "10.1000/b" },
      { nodeId: "node-d", workId: "work-d", doi: "10.1000/d" },
    ];
    const graph: CitationGraph = {
      centerId: "openalex-d",
      truncated: false,
      nodes: [
        {
          id: "openalex-d",
          title: "D",
          citedByCount: 2,
          doi: "10.1000/d",
          relation: "center",
        },
        {
          id: "openalex-a",
          title: "A",
          citedByCount: 10,
          doi: "10.1000/a",
          relation: "reference",
        },
      ],
      edges: [{ source: "openalex-d", target: "openalex-a" }],
    };
    const loadGraph = vi.fn(async (_doi: string, _signal?: AbortSignal) => graph);

    const result = await resolveCanvasCitationRelations(
      papers,
      options({
        listLocalRelations: vi.fn(async () => [{ citingWorkId: "work-a", citedWorkId: "work-b" }]),
        loadGraph,
      }),
    );

    expect(loadGraph.mock.calls.map(([doi]) => doi)).toEqual(["10.1000/d"]);
    expect(result).toEqual({
      graphCount: 1,
      relations: [
        { citingWorkId: "work-a", citedWorkId: "work-b" },
        { citingWorkId: "work-d", citedWorkId: "work-a" },
      ],
      source: "mixed",
      truncated: false,
    });
  });

  it("falls back to cached or remote graphs and persists mapped local relations", async () => {
    const loadGraph = vi.fn(async (doi: string) => (doi === "10.1000/a" ? GRAPH : null));
    const persistRelation = vi.fn(async () => undefined);
    const result = await resolveCanvasCitationRelations(
      PAPERS,
      options({ loadGraph, persistRelation }),
    );

    expect(loadGraph).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      graphCount: 1,
      relations: [{ citingWorkId: "work-a", citedWorkId: "work-b" }],
      source: "graph",
      truncated: false,
    });
    expect(persistRelation).toHaveBeenCalledWith(expect.anything(), {
      citingWorkId: "work-a",
      citedWorkId: "work-b",
    });
  });

  it("persists graph relations only when both Library works are still active", async () => {
    const runs: Array<{ params?: unknown[]; sql: string }> = [];
    const db: Database = {
      ...fakeDb(),
      async run(sql: string, params?: unknown[]): Promise<number> {
        runs.push({ sql, params });
        return 1;
      },
    };

    await resolveCanvasCitationRelations(PAPERS, {
      db,
      listLocalRelations: vi.fn(async () => []),
      loadGraph: vi.fn(async (doi: string) => (doi === "10.1000/a" ? GRAPH : null)),
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.sql).toContain("SELECT ?, ?, 'openalex'");
    expect(runs[0]?.sql).toContain("FROM works WHERE id = ? AND deleted_at IS NULL");
    expect(runs[0]?.params).toEqual(["work-a", "work-b", "work-a", "work-b"]);
  });

  it("keeps useful graph results when another selected DOI fails", async () => {
    const loadGraph = vi.fn(async (doi: string) => {
      if (doi === "10.1000/a") throw new Error("temporary graph failure");
      return GRAPH;
    });

    await expect(
      resolveCanvasCitationRelations(PAPERS, options({ loadGraph })),
    ).resolves.toMatchObject({
      graphCount: 1,
      relations: [{ citingWorkId: "work-a", citedWorkId: "work-b" }],
      source: "graph",
    });
  });

  it("stops before persistence when the active selection request is aborted", async () => {
    const controller = new AbortController();
    const persistRelation = vi.fn(async () => undefined);
    const loadGraph = vi.fn(async () => {
      controller.abort();
      return GRAPH;
    });

    await expect(
      resolveCanvasCitationRelations(
        PAPERS,
        options({ loadGraph, persistRelation, signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(persistRelation).not.toHaveBeenCalled();
  });

  it("caps graph requests deterministically and reports a truncated resolution", async () => {
    const papers = [
      { nodeId: "node-c", workId: "work-c", doi: "10.1000/c" },
      { nodeId: "node-a", workId: "work-a", doi: "10.1000/a" },
      { nodeId: "node-b", workId: "work-b", doi: "10.1000/b" },
    ];
    const loadGraph = vi.fn(async (_doi: string, _signal?: AbortSignal) => null);

    const result = await resolveCanvasCitationRelations(
      papers,
      options({ loadGraph, maxGraphLoads: 2 }),
    );

    expect(loadGraph.mock.calls.map(([doi]) => doi)).toEqual(["10.1000/a", "10.1000/b"]);
    expect(result).toEqual({
      graphCount: 0,
      relations: [],
      source: "none",
      truncated: true,
    });
  });

  it("caps graph requests at the default twelve DOI budget", async () => {
    const papers = Array.from({ length: 13 }, (_, index) => ({
      nodeId: `node-${index}`,
      workId: `work-${index}`,
      doi: `10.1000/${String(index).padStart(2, "0")}`,
    }));
    const loadGraph = vi.fn(async () => null);

    const result = await resolveCanvasCitationRelations(papers, options({ loadGraph }));

    expect(loadGraph).toHaveBeenCalledTimes(12);
    expect(result).toMatchObject({ source: "none", truncated: true });
  });
});
