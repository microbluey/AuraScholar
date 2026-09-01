import type { CitationGraph, GraphNode } from "@aurascholar/core";
import { WorksRepo, type Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
} from "../data-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand } from "./data-commands";
import type { DataCommandDependencies } from "./data-command-runtime";

const GRAPH: CitationGraph = {
  centerId: "W-center",
  edges: [{ source: "W-center", target: "W-reference" }],
  nodes: [
    {
      citedByCount: 10,
      doi: "10.1000/center",
      id: "W-center",
      relation: "center",
      title: "Center work",
    },
    {
      citedByCount: 5,
      doi: "10.1000/reference",
      id: "W-reference",
      relation: "reference",
      title: "Reference work",
    },
  ],
  truncated: false,
};

let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let works: WorksRepo;

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "citation-graph-command-device",
    deviceName: "Citation Graph commands",
    platform: "test",
  }));
  const coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
    transaction: (commandName, operation) => coordinator.transaction(commandName, operation),
  };
  works = new WorksRepo(database, libraryId);
});

function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}

describe("Citation Graph data commands", () => {
  it("reads the global graph cache without requiring an active local Library", async () => {
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      ["10.1000/center", JSON.stringify(GRAPH), 9_900],
    );
    await database.run(`UPDATE libraries SET deleted_at = 10_000 WHERE id = ?`, [libraryId]);

    await expect(
      command("citationGraph.getCached", { doi: " HTTPS://DOI.ORG/10.1000/CENTER " }),
    ).resolves.toEqual({ entry: { fetchedAt: 9_900, graph: GRAPH } });
  });

  it("returns old cache timestamps for renderer-owned freshness decisions", async () => {
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      ["10.1000/center", JSON.stringify(GRAPH), 0],
    );

    await expect(command("citationGraph.getCached", { doi: "10.1000/center" })).resolves.toEqual({
      entry: { fetchedAt: 0, graph: GRAPH },
    });
    await expect(
      database.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM graph_cache WHERE work_id = ?`,
        ["10.1000/center"],
      ),
    ).resolves.toEqual([{ count: 1 }]);
  });

  it("drops cached graphs whose center DOI is missing or bound to another request", async () => {
    const mismatchedGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, doi: "10.1000/other" } : node,
      ),
    };
    const unboundGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) => {
        if (node.id !== GRAPH.centerId) return node;
        const { doi: _doi, ...withoutDoi } = node;
        return withoutDoi;
      }),
    };
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      ["10.1000/mismatched", JSON.stringify(mismatchedGraph), 9_900],
    );
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      ["10.1000/unbound", JSON.stringify(unboundGraph), 9_900],
    );

    await expect(
      command("citationGraph.getCached", { doi: "10.1000/mismatched" }),
    ).resolves.toEqual({ entry: null });
    await expect(command("citationGraph.getCached", { doi: "10.1000/unbound" })).resolves.toEqual({
      entry: null,
    });
    await expect(
      database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM graph_cache`),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("does not store an unbound or mismatched graph under a DOI key", async () => {
    const mismatchedGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, doi: "10.1000/other" } : node,
      ),
    };
    const unboundGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) => {
        if (node.id !== GRAPH.centerId) return node;
        const { doi: _doi, ...withoutDoi } = node;
        return withoutDoi;
      }),
    };

    await expect(
      command("citationGraph.putCached", { doi: "10.1000/center", graph: mismatchedGraph }),
    ).resolves.toEqual({ stored: false });
    await expect(
      command("citationGraph.putCached", { doi: "10.1000/center", graph: unboundGraph }),
    ).resolves.toEqual({ stored: false });
    await expect(
      database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM graph_cache`),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("ignores inherited optional node fields at the main boundary", async () => {
    const inheritedCenter = Object.create({ doi: "10.1000/center", venue: "spoofed" }) as GraphNode;
    Object.assign(inheritedCenter, {
      citedByCount: 10,
      id: GRAPH.centerId,
      relation: "center",
      title: "Center work",
    });
    const graph: CitationGraph = { ...GRAPH, nodes: [inheritedCenter, GRAPH.nodes[1]!] };

    await expect(
      command("citationGraph.putCached", { doi: "10.1000/center", graph }),
    ).resolves.toEqual({ stored: false });
    await expect(
      database.query<{ count: number }>(`SELECT COUNT(*) AS count FROM graph_cache`),
    ).resolves.toEqual([{ count: 0 }]);

    const ownDoiWithInheritedInvalidYear = Object.create({ year: "spoofed" }) as GraphNode;
    Object.assign(ownDoiWithInheritedInvalidYear, {
      citedByCount: 10,
      doi: "10.1000/center",
      id: GRAPH.centerId,
      relation: "center",
      title: "Center work",
    });
    const safeGraph: CitationGraph = {
      ...GRAPH,
      nodes: [ownDoiWithInheritedInvalidYear, GRAPH.nodes[1]!],
    };
    await expect(
      command("citationGraph.putCached", { doi: "10.1000/center", graph: safeGraph }),
    ).resolves.toEqual({ stored: true });
    const rows = await database.query<{ payload_json: string }>(
      `SELECT payload_json FROM graph_cache WHERE work_id = ?`,
      ["10.1000/center"],
    );
    expect(JSON.parse(rows[0]!.payload_json).nodes[0]).not.toHaveProperty("year");
  });

  it("prefers a valid canonical row and retires a conflicting legacy raw-key row", async () => {
    const legacyDoi = "HTTPS://DOI.ORG/10.1000/CENTER";
    const legacyGraph: CitationGraph = {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.id === GRAPH.centerId ? { ...node, title: "Legacy center" } : node,
      ),
    };
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      ["10.1000/center", JSON.stringify(GRAPH), 20_000],
    );
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      [legacyDoi, JSON.stringify(legacyGraph), 10_000],
    );

    await expect(command("citationGraph.getCached", { doi: legacyDoi })).resolves.toEqual({
      entry: { fetchedAt: 20_000, graph: GRAPH },
    });
    await expect(
      database.query<{ work_id: string }>(`SELECT work_id FROM graph_cache ORDER BY work_id`),
    ).resolves.toEqual([{ work_id: "10.1000/center" }]);
  });

  it("removes malformed and sparse-derived cached JSON and migrates a legacy raw DOI key", async () => {
    const legacyDoi = "HTTPS://DOI.ORG/10.1000/CENTER";
    const sparseNodes = [GRAPH.nodes[0]!];
    sparseNodes.length = 2;
    const sparseEdges = [GRAPH.edges[0]!];
    sparseEdges.length = 2;
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      ["10.1000/malformed", "{", 9_900],
    );
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      ["10.1000/oversized", "x".repeat(2 * 1024 * 1024 + 1), 9_900],
    );
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      ["10.1000/sparse-nodes", JSON.stringify({ ...GRAPH, nodes: sparseNodes }), 9_900],
    );
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      ["10.1000/sparse-edges", JSON.stringify({ ...GRAPH, edges: sparseEdges }), 9_900],
    );
    await database.run(
      `INSERT INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
      [legacyDoi, JSON.stringify(GRAPH), 9_900],
    );

    await expect(command("citationGraph.getCached", { doi: "10.1000/malformed" })).resolves.toEqual(
      {
        entry: null,
      },
    );
    await expect(command("citationGraph.getCached", { doi: "10.1000/oversized" })).resolves.toEqual(
      {
        entry: null,
      },
    );
    await expect(
      command("citationGraph.getCached", { doi: "10.1000/sparse-nodes" }),
    ).resolves.toEqual({
      entry: null,
    });
    await expect(
      command("citationGraph.getCached", { doi: "10.1000/sparse-edges" }),
    ).resolves.toEqual({
      entry: null,
    });
    await expect(command("citationGraph.getCached", { doi: legacyDoi })).resolves.toEqual({
      entry: { fetchedAt: 9_900, graph: GRAPH },
    });
    await expect(
      database.query<{ work_id: string }>(`SELECT work_id FROM graph_cache ORDER BY work_id`),
    ).resolves.toEqual([{ work_id: "10.1000/center" }]);
  });

  it("stores only a main-process timestamp under the normalized DOI key", async () => {
    const before = Date.now();
    await expect(
      command("citationGraph.putCached", {
        doi: "doi: 10.1000/CENTER",
        graph: GRAPH,
      }),
    ).resolves.toEqual({ stored: true });

    const rows = await database.query<{
      fetched_at: number;
      payload_json: string;
      work_id: string;
    }>(`SELECT work_id, payload_json, fetched_at FROM graph_cache`);
    expect(rows).toEqual([
      expect.objectContaining({
        payload_json: JSON.stringify(GRAPH),
        work_id: "10.1000/center",
      }),
    ]);
    expect(rows[0]?.fetched_at).toBeGreaterThanOrEqual(before);
  });

  it("keeps distinct edges when node ids contain the legacy key delimiter", async () => {
    const delimiterGraph: CitationGraph = {
      centerId: "center",
      edges: [
        { source: "a", target: "b\u0000c" },
        { source: "a\u0000b", target: "c" },
      ],
      nodes: [
        {
          citedByCount: 0,
          doi: "10.1000/delimiter",
          id: "center",
          relation: "center",
          title: "Center",
        },
        { citedByCount: 0, id: "a", relation: "reference", title: "A" },
        { citedByCount: 0, id: "b\u0000c", relation: "reference", title: "B C" },
        { citedByCount: 0, id: "a\u0000b", relation: "reference", title: "A B" },
        { citedByCount: 0, id: "c", relation: "reference", title: "C" },
      ],
      truncated: false,
    };

    await expect(
      command("citationGraph.putCached", { doi: "10.1000/delimiter", graph: delimiterGraph }),
    ).resolves.toEqual({ stored: true });
  });

  it("rejects malformed cache and membership input before obtaining a database lease", async () => {
    let executeCalls = 0;
    let transactionCalls = 0;
    const rejectingDependencies: DataCommandDependencies = {
      async execute() {
        executeCalls += 1;
        throw new Error("execute reached");
      },
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const sparseNodes = [GRAPH.nodes[0]!];
    sparseNodes.length = 2;
    const sparseEdges = [GRAPH.edges[0]!];
    sparseEdges.length = 2;
    const sparseDois = new Array<string>(1);
    const invalidRequests = [
      { input: {}, name: "citationGraph.getCached" },
      {
        input: { doi: "10.1000/center", libraryId: "library:foreign" },
        name: "citationGraph.getCached",
      },
      {
        input: { doi: "10.1000/center", fetchedAt: 1, graph: GRAPH },
        name: "citationGraph.putCached",
      },
      {
        input: {
          doi: "10.1000/center",
          graph: { ...GRAPH, centerId: "missing" },
        },
        name: "citationGraph.putCached",
      },
      {
        input: {
          doi: "10.1000/center",
          graph: { ...GRAPH, edges: [{ source: "W-center", target: "missing" }] },
        },
        name: "citationGraph.putCached",
      },
      {
        input: {
          doi: "10.1000/center",
          graph: { ...GRAPH, nodes: sparseNodes },
        },
        name: "citationGraph.putCached",
      },
      {
        input: {
          doi: "10.1000/center",
          graph: { ...GRAPH, edges: sparseEdges },
        },
        name: "citationGraph.putCached",
      },
      {
        input: { dois: ["10.1000/center"], libraryId: "library:foreign" },
        name: "citationGraph.getActiveLibraryDois",
      },
      {
        input: { dois: ["10.1000/center", "10.1000/CENTER"] },
        name: "citationGraph.getActiveLibraryDois",
      },
      {
        input: { dois: Array.from({ length: 501 }, (_, index) => `10.1000/${index}`) },
        name: "citationGraph.getActiveLibraryDois",
      },
      {
        input: { dois: sparseDois },
        name: "citationGraph.getActiveLibraryDois",
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("returns DOI membership for active local works only", async () => {
    await works.upsert({ doi: "10.1000/active", title: "Active local DOI" });
    const archived = await works.upsert({ doi: "10.1000/archived", title: "Archived local DOI" });
    await works.softDelete(archived.id);

    const foreignLibraryId = "library:citation-graph-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Citation Graph', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    await new WorksRepo(database, foreignLibraryId).upsert({
      doi: "10.1000/foreign",
      title: "Foreign DOI",
    });

    await expect(
      command("citationGraph.getActiveLibraryDois", {
        dois: ["10.1000/ACTIVE", "10.1000/archived", "10.1000/foreign", "10.1000/missing"],
      }),
    ).resolves.toEqual({ dois: ["10.1000/active"], libraryId });
  });

  it("rejects membership reads when the durable active Library has been deleted", async () => {
    await database.run(`UPDATE libraries SET deleted_at = 10_000 WHERE id = ?`, [libraryId]);

    await expect(command("citationGraph.getActiveLibraryDois", { dois: [] })).rejects.toThrow(
      "Local Library identity is not active",
    );
  });
});
