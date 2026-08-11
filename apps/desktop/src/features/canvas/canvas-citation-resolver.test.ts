import type { CitationGraph } from "@aurascholar/core";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_CANVAS_CITATION_RELATIONS_TO_PERSIST,
  MAX_CANVAS_CITATION_WORK_IDS,
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

function options(
  overrides: Partial<ResolveCanvasCitationRelationsOptions> = {},
): ResolveCanvasCitationRelationsOptions {
  return {
    listLocalRelations: vi.fn(async () => []),
    persistRelations: vi.fn(async () => undefined),
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

  it("uses scoped Canvas commands for local reads and one batched persistence call", async () => {
    const command = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    command.mockResolvedValueOnce({ relations: [] }).mockResolvedValueOnce({ persisted: 1 });
    const loadGraph = vi.fn(async (doi: string) => (doi === "10.1000/a" ? GRAPH : null));

    await expect(resolveCanvasCitationRelations(PAPERS, { loadGraph })).resolves.toMatchObject({
      graphCount: 1,
      relations: [{ citingWorkId: "work-a", citedWorkId: "work-b" }],
      source: "graph",
    });
    expect(command).toHaveBeenNthCalledWith(1, "canvas.getCitationRelations", {
      workIds: ["work-a", "work-b", "work-c"],
    });
    expect(command).toHaveBeenNthCalledWith(2, "canvas.persistCitationRelations", {
      relations: [{ citingWorkId: "work-a", citedWorkId: "work-b" }],
    });
  });

  it("persists all new graph relations in one batch", async () => {
    const papers = [
      { nodeId: "node-a", workId: "work-a", doi: "10.1000/a" },
      { nodeId: "node-b", workId: "work-b", doi: "10.1000/b" },
      { nodeId: "node-c", workId: "work-c", doi: "10.1000/c" },
    ];
    const graphForA = GRAPH;
    const graphForB: CitationGraph = {
      centerId: "openalex-b",
      truncated: false,
      nodes: [
        {
          id: "openalex-b",
          title: "B",
          citedByCount: 5,
          doi: "10.1000/b",
          relation: "center",
        },
        {
          id: "openalex-c",
          title: "C",
          citedByCount: 1,
          doi: "10.1000/c",
          relation: "reference",
        },
      ],
      edges: [{ source: "openalex-b", target: "openalex-c" }],
    };
    const persistRelations = vi.fn(async () => undefined);

    await resolveCanvasCitationRelations(
      papers,
      options({
        loadGraph: vi.fn(async (doi: string) => {
          if (doi === "10.1000/a") return graphForA;
          if (doi === "10.1000/b") return graphForB;
          return null;
        }),
        persistRelations,
      }),
    );

    expect(persistRelations).toHaveBeenCalledTimes(1);
    expect(persistRelations).toHaveBeenCalledWith([
      { citingWorkId: "work-a", citedWorkId: "work-b" },
      { citingWorkId: "work-b", citedWorkId: "work-c" },
    ]);
  });

  it("fails before IPC instead of sending an oversized graph relation batch", async () => {
    const citingPapers = Array.from({ length: 40 }, (_, index) => ({
      nodeId: `node-citing-${index}`,
      workId: `work-citing-${index}`,
      doi: "10.1000/citing",
    }));
    const citedPapers = Array.from({ length: 26 }, (_, index) => ({
      nodeId: `node-cited-${index}`,
      workId: `work-cited-${index}`,
      doi: "10.1000/cited",
    }));
    const graph: CitationGraph = {
      centerId: "openalex-citing",
      truncated: false,
      nodes: [
        {
          id: "openalex-citing",
          title: "Citing",
          citedByCount: 0,
          doi: "10.1000/citing",
          relation: "center",
        },
        {
          id: "openalex-cited",
          title: "Cited",
          citedByCount: 0,
          doi: "10.1000/cited",
          relation: "reference",
        },
      ],
      edges: [{ source: "openalex-citing", target: "openalex-cited" }],
    };
    const persistRelations = vi.fn(async () => undefined);

    await expect(
      resolveCanvasCitationRelations(
        [...citingPapers, ...citedPapers],
        options({
          loadGraph: vi.fn(async (doi: string) => (doi === "10.1000/citing" ? graph : null)),
          persistRelations,
        }),
      ),
    ).rejects.toThrow(`引用关系过多（最多 ${MAX_CANVAS_CITATION_RELATIONS_TO_PERSIST} 条）`);
    expect(persistRelations).not.toHaveBeenCalled();
  });

  it("fails before graph work when a scoped local response exceeds the relation limit", async () => {
    const listLocalRelations = vi.fn(async () =>
      Array.from({ length: MAX_CANVAS_CITATION_RELATIONS_TO_PERSIST + 1 }, (_, index) => ({
        citingWorkId: `local-citing-${index}`,
        citedWorkId: `local-cited-${index}`,
      })),
    );
    const loadGraph = vi.fn(async () => null);

    await expect(
      resolveCanvasCitationRelations(PAPERS, options({ listLocalRelations, loadGraph })),
    ).rejects.toThrow(`引用关系过多（最多 ${MAX_CANVAS_CITATION_RELATIONS_TO_PERSIST} 条）`);
    expect(loadGraph).not.toHaveBeenCalled();
  });

  it("does not persist graph edges when their merged result exceeds the relation limit", async () => {
    const localRelations = Array.from(
      { length: MAX_CANVAS_CITATION_RELATIONS_TO_PERSIST },
      (_, index) => ({
        citingWorkId: `local-citing-${index}`,
        citedWorkId: `local-cited-${index}`,
      }),
    );
    const persistRelations = vi.fn(async () => undefined);

    await expect(
      resolveCanvasCitationRelations(
        PAPERS,
        options({
          listLocalRelations: vi.fn(async () => localRelations),
          loadGraph: vi.fn(async (doi: string) => (doi === "10.1000/a" ? GRAPH : null)),
          persistRelations,
        }),
      ),
    ).rejects.toThrow(`引用关系过多（最多 ${MAX_CANVAS_CITATION_RELATIONS_TO_PERSIST} 条）`);
    expect(persistRelations).not.toHaveBeenCalled();
  });

  it("fails before local IPC when the canvas selection exceeds the scoped work limit", async () => {
    const listLocalRelations = vi.fn(async () => []);
    const loadGraph = vi.fn(async () => null);
    const papers = Array.from({ length: MAX_CANVAS_CITATION_WORK_IDS + 1 }, (_, index) => ({
      nodeId: `node-${index}`,
      workId: `work-${index}`,
      doi: null,
    }));

    await expect(
      resolveCanvasCitationRelations(papers, options({ listLocalRelations, loadGraph })),
    ).rejects.toThrow(`画布论文过多（最多 ${MAX_CANVAS_CITATION_WORK_IDS} 篇）`);
    expect(listLocalRelations).not.toHaveBeenCalled();
    expect(loadGraph).not.toHaveBeenCalled();
  });

  it("propagates a local scoped-read failure before loading graphs", async () => {
    const failure = new Error("local citation scope unavailable");
    const loadGraph = vi.fn();

    await expect(
      resolveCanvasCitationRelations(
        PAPERS,
        options({
          listLocalRelations: vi.fn(async () => {
            throw failure;
          }),
          loadGraph,
        }),
      ),
    ).rejects.toBe(failure);
    expect(loadGraph).not.toHaveBeenCalled();
  });

  it("propagates a batched persistence failure", async () => {
    const failure = new Error("citation batch rejected");

    await expect(
      resolveCanvasCitationRelations(
        PAPERS,
        options({
          loadGraph: vi.fn(async (doi: string) => (doi === "10.1000/a" ? GRAPH : null)),
          persistRelations: vi.fn(async () => {
            throw failure;
          }),
        }),
      ),
    ).rejects.toBe(failure);
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

  it("stops before batch persistence when the active selection request is aborted", async () => {
    const controller = new AbortController();
    const persistRelations = vi.fn(async () => undefined);
    const loadGraph = vi.fn(async () => {
      controller.abort();
      return GRAPH;
    });

    await expect(
      resolveCanvasCitationRelations(
        PAPERS,
        options({ loadGraph, persistRelations, signal: controller.signal }),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(persistRelations).not.toHaveBeenCalled();
  });

  it("does not project a resolution when cancellation occurs during batch persistence", async () => {
    const controller = new AbortController();
    const persistRelations = vi.fn(async () => {
      controller.abort();
    });

    await expect(
      resolveCanvasCitationRelations(
        PAPERS,
        options({
          loadGraph: vi.fn(async (doi: string) => (doi === "10.1000/a" ? GRAPH : null)),
          persistRelations,
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(persistRelations).toHaveBeenCalledOnce();
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
