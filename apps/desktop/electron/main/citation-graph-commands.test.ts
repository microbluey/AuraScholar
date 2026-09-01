import type { CitationGraph, GraphNode } from "@aurascholar/core";
import { WorksRepo, type Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DataCommandInput,
  DataCommandName,
  DataCommandOutput,
} from "../data-command-contract";
import type { LibraryScopeToken } from "../library-read-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeDataCommand } from "./data-commands";
import type { DataCommandDependencies } from "./data-command-runtime";
import {
  CITATION_GRAPH_PROVENANCE as PROVENANCE,
  citationGraphProvenanceFor as provenanceFor,
  insertCitationGraphCacheRow as insertGraphCacheRow,
} from "./citation-graph-test-fixtures";
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
function graphWithCenterTitle(title: string): CitationGraph {
  return {
    ...GRAPH,
    nodes: GRAPH.nodes.map((node) => (node.id === GRAPH.centerId ? { ...node, title } : node)),
  };
}
let database: Database;
let dependencies: DataCommandDependencies;
let libraryId: string;
let scope: LibraryScopeToken;
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
  scope = await command("library.getScope", {});
});
function command<K extends DataCommandName>(
  name: K,
  input: DataCommandInput<K>,
): Promise<DataCommandOutput<K>> {
  return executeDataCommand({ input, name }, dependencies) as Promise<DataCommandOutput<K>>;
}
describe("Citation Graph data commands", () => {
  it("reads the global graph cache without requiring an active local Library", async () => {
    await insertGraphCacheRow(database, "10.1000/center", JSON.stringify(GRAPH), 9_900);
    await database.run(`UPDATE libraries SET deleted_at = 10_000 WHERE id = ?`, [libraryId]);
    await expect(
      command("citationGraph.getCached", { doi: " HTTPS://DOI.ORG/10.1000/CENTER " }),
    ).resolves.toEqual({
      entry: { cacheVersion: 1, fetchedAt: 9_900, graph: GRAPH, provenance: PROVENANCE },
    });
  });
  it("returns old cache timestamps for renderer-owned freshness decisions", async () => {
    await insertGraphCacheRow(database, "10.1000/center", JSON.stringify(GRAPH), 0);
    await expect(command("citationGraph.getCached", { doi: "10.1000/center" })).resolves.toEqual({
      entry: { cacheVersion: 1, fetchedAt: 0, graph: GRAPH, provenance: PROVENANCE },
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
    await insertGraphCacheRow(
      database,
      "10.1000/mismatched",
      JSON.stringify(mismatchedGraph),
      9_900,
    );
    await insertGraphCacheRow(database, "10.1000/unbound", JSON.stringify(unboundGraph), 9_900);
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
      command("citationGraph.putCached", {
        doi: "10.1000/center",
        expectedCacheVersion: null,
        graph: mismatchedGraph,
        provenance: PROVENANCE,
      }),
    ).resolves.toEqual({ stored: false });
    await expect(
      command("citationGraph.putCached", {
        doi: "10.1000/center",
        expectedCacheVersion: null,
        graph: unboundGraph,
        provenance: PROVENANCE,
      }),
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
      command("citationGraph.putCached", {
        doi: "10.1000/center",
        expectedCacheVersion: null,
        graph,
        provenance: PROVENANCE,
      }),
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
      command("citationGraph.putCached", {
        doi: "10.1000/center",
        expectedCacheVersion: null,
        graph: safeGraph,
        provenance: PROVENANCE,
      }),
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
    await insertGraphCacheRow(database, "10.1000/center", JSON.stringify(GRAPH), 20_000);
    await insertGraphCacheRow(database, legacyDoi, JSON.stringify(legacyGraph), 10_000);
    await expect(command("citationGraph.getCached", { doi: legacyDoi })).resolves.toEqual({
      entry: { cacheVersion: 1, fetchedAt: 20_000, graph: GRAPH, provenance: PROVENANCE },
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
    await insertGraphCacheRow(database, "10.1000/malformed", "{", 9_900);
    await insertGraphCacheRow(
      database,
      "10.1000/oversized",
      "x".repeat(2 * 1024 * 1024 + 1),
      9_900,
    );
    await insertGraphCacheRow(
      database,
      "10.1000/sparse-nodes",
      JSON.stringify({ ...GRAPH, nodes: sparseNodes }),
      9_900,
    );
    await insertGraphCacheRow(
      database,
      "10.1000/sparse-edges",
      JSON.stringify({ ...GRAPH, edges: sparseEdges }),
      9_900,
    );
    await insertGraphCacheRow(database, legacyDoi, JSON.stringify(GRAPH), 9_900, 7);

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
      entry: { cacheVersion: 7, fetchedAt: 9_900, graph: GRAPH, provenance: PROVENANCE },
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
        expectedCacheVersion: null,
        graph: GRAPH,
        provenance: PROVENANCE,
      }),
    ).resolves.toEqual({ stored: true });

    const rows = await database.query<{
      fetched_at: number;
      payload_json: string;
      provider: string;
      provenance_json: string;
      work_id: string;
    }>(`SELECT work_id, payload_json, fetched_at, provider, provenance_json FROM graph_cache`);
    expect(rows).toEqual([
      expect.objectContaining({
        payload_json: JSON.stringify(GRAPH),
        provider: "openalex",
        provenance_json: JSON.stringify(PROVENANCE),
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
      command("citationGraph.putCached", {
        doi: "10.1000/delimiter",
        expectedCacheVersion: null,
        graph: delimiterGraph,
        provenance: provenanceFor("10.1000/delimiter"),
      }),
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
        input: { doi: "10.1000/center", graph: GRAPH, provenance: undefined },
        name: "citationGraph.putCached",
      },
      {
        input: {
          doi: "10.1000/center",
          graph: GRAPH,
          provenance: { ...PROVENANCE, provider: "semantic-scholar" },
        },
        name: "citationGraph.putCached",
      },
      {
        input: {
          doi: "10.1000/center",
          graph: GRAPH,
          provenance: { ...PROVENANCE, requestedDoi: "10.1000/other" },
        },
        name: "citationGraph.putCached",
      },
      {
        input: {
          dois: ["10.1000/center"],
          expectedScope: { libraryId: "library:foreign" },
        },
        name: "citationGraph.getActiveLibraryDois",
      },
      {
        input: { dois: ["10.1000/center", "10.1000/CENTER"], expectedScope: scope },
        name: "citationGraph.getActiveLibraryDois",
      },
      {
        input: {
          dois: Array.from({ length: 501 }, (_, index) => `10.1000/${index}`),
          expectedScope: scope,
        },
        name: "citationGraph.getActiveLibraryDois",
      },
      {
        input: { dois: sparseDois, expectedScope: scope },
        name: "citationGraph.getActiveLibraryDois",
      },
    ];

    for (const request of invalidRequests) {
      await expect(executeDataCommand(request, rejectingDependencies)).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
    expect(transactionCalls).toBe(0);
  });

  it("uses a null cache version for insert-if-absent and preserves the winner on conflict", async () => {
    const before = Date.now();
    await expect(
      command("citationGraph.putCached", {
        doi: "10.1000/center",
        expectedCacheVersion: null,
        graph: GRAPH,
        provenance: PROVENANCE,
      }),
    ).resolves.toEqual({ stored: true });

    const firstRows = await database.query<{
      cache_version: number;
      fetched_at: number;
      payload_json: string;
    }>(
      `SELECT cache_version, fetched_at, payload_json
       FROM graph_cache WHERE work_id = ?`,
      ["10.1000/center"],
    );
    expect(firstRows).toHaveLength(1);
    expect(firstRows[0]).toMatchObject({
      cache_version: 1,
      payload_json: JSON.stringify(GRAPH),
    });
    expect(firstRows[0]?.fetched_at).toBeGreaterThanOrEqual(before);

    await expect(
      command("citationGraph.putCached", {
        doi: "10.1000/center",
        expectedCacheVersion: null,
        graph: graphWithCenterTitle("Conflicting insert"),
        provenance: PROVENANCE,
      }),
    ).resolves.toEqual({ stored: false });
    await expect(
      database.query(
        `SELECT cache_version, fetched_at, payload_json FROM graph_cache WHERE work_id = ?`,
        ["10.1000/center"],
      ),
    ).resolves.toEqual(firstRows);
  });

  it("treats an omitted cache version as the legacy insert-only form", async () => {
    await expect(
      command("citationGraph.putCached", {
        doi: "10.1000/center",
        graph: GRAPH,
        provenance: PROVENANCE,
      }),
    ).resolves.toEqual({ stored: true });
    await expect(
      database.query<{ cache_version: number }>(
        `SELECT cache_version FROM graph_cache WHERE work_id = ?`,
        ["10.1000/center"],
      ),
    ).resolves.toEqual([{ cache_version: 1 }]);
  });

  it("updates a matching cache version while recording the wall-clock fetchedAt", async () => {
    await insertGraphCacheRow(database, "10.1000/center", JSON.stringify(GRAPH), 1_234, 7);
    const updatedGraph = graphWithCenterTitle("Matching update");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5_000);
    try {
      await expect(
        command("citationGraph.putCached", {
          doi: "10.1000/center",
          expectedCacheVersion: 7,
          graph: updatedGraph,
          provenance: PROVENANCE,
        }),
      ).resolves.toEqual({ stored: true });
    } finally {
      nowSpy.mockRestore();
    }

    await expect(
      database.query(
        `SELECT cache_version, fetched_at, payload_json FROM graph_cache WHERE work_id = ?`,
        ["10.1000/center"],
      ),
    ).resolves.toEqual([
      { cache_version: 8, fetched_at: 5_000, payload_json: JSON.stringify(updatedGraph) },
    ]);
  });

  it("does not let a stale cache version overwrite a newer graph", async () => {
    await insertGraphCacheRow(database, "10.1000/center", JSON.stringify(GRAPH), 5_000, 3);
    const winningGraph = graphWithCenterTitle("Winner");
    const staleGraph = graphWithCenterTitle("Stale writer");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(6_000);
    try {
      await expect(
        command("citationGraph.putCached", {
          doi: "10.1000/center",
          expectedCacheVersion: 3,
          graph: winningGraph,
          provenance: PROVENANCE,
        }),
      ).resolves.toEqual({ stored: true });
      await expect(
        command("citationGraph.putCached", {
          doi: "10.1000/center",
          expectedCacheVersion: 3,
          graph: staleGraph,
          provenance: PROVENANCE,
        }),
      ).resolves.toEqual({ stored: false });
    } finally {
      nowSpy.mockRestore();
    }

    await expect(
      database.query(
        `SELECT cache_version, fetched_at, payload_json FROM graph_cache WHERE work_id = ?`,
        ["10.1000/center"],
      ),
    ).resolves.toEqual([
      { cache_version: 4, fetched_at: 6_000, payload_json: JSON.stringify(winningGraph) },
    ]);
  });

  it("increments versions for same-millisecond writes without manufacturing a future timestamp", async () => {
    await insertGraphCacheRow(database, "10.1000/center", JSON.stringify(GRAPH), 1_000, 10);
    const firstGraph = graphWithCenterTitle("Same millisecond one");
    const secondGraph = graphWithCenterTitle("Same millisecond two");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000);
    try {
      await expect(
        command("citationGraph.putCached", {
          doi: "10.1000/center",
          expectedCacheVersion: 10,
          graph: firstGraph,
          provenance: PROVENANCE,
        }),
      ).resolves.toEqual({ stored: true });
      await expect(
        command("citationGraph.putCached", {
          doi: "10.1000/center",
          expectedCacheVersion: 11,
          graph: secondGraph,
          provenance: PROVENANCE,
        }),
      ).resolves.toEqual({ stored: true });
    } finally {
      nowSpy.mockRestore();
    }

    await expect(
      database.query(
        `SELECT cache_version, fetched_at, payload_json FROM graph_cache WHERE work_id = ?`,
        ["10.1000/center"],
      ),
    ).resolves.toEqual([
      { cache_version: 12, fetched_at: 2_000, payload_json: JSON.stringify(secondGraph) },
    ]);
  });

  it("repairs a future fetchedAt on the next successful versioned write", async () => {
    await insertGraphCacheRow(database, "10.1000/center", JSON.stringify(GRAPH), 99_999, 20);
    const repairedGraph = graphWithCenterTitle("Future repaired");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    try {
      await expect(
        command("citationGraph.putCached", {
          doi: "10.1000/center",
          expectedCacheVersion: 20,
          graph: repairedGraph,
          provenance: PROVENANCE,
        }),
      ).resolves.toEqual({ stored: true });
    } finally {
      nowSpy.mockRestore();
    }

    await expect(
      database.query<{ cache_version: number; fetched_at: number; payload_json: string }>(
        `SELECT cache_version, fetched_at, payload_json FROM graph_cache WHERE work_id = ?`,
        ["10.1000/center"],
      ),
    ).resolves.toEqual([
      { cache_version: 21, fetched_at: 10_000, payload_json: JSON.stringify(repairedGraph) },
    ]);
  });

  it("rejects invalid expected cache versions before obtaining a database lease", async () => {
    let transactionCalls = 0;
    const noLeaseDependencies: DataCommandDependencies = {
      async transaction() {
        transactionCalls += 1;
        throw new Error("transaction reached");
      },
    };
    const invalidVersions: unknown[] = [
      -1,
      0,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      undefined,
    ];

    for (const expectedCacheVersion of invalidVersions) {
      await expect(
        executeDataCommand(
          {
            name: "citationGraph.putCached",
            input: {
              doi: "10.1000/center",
              expectedCacheVersion,
              graph: GRAPH,
              provenance: PROVENANCE,
            },
          },
          noLeaseDependencies,
        ),
      ).rejects.toThrow("Citation graph expected cache version is invalid");
    }
    expect(transactionCalls).toBe(0);
  });

  it("does not advance a cache version at the MAX_SAFE_INTEGER boundary", async () => {
    await insertGraphCacheRow(
      database,
      "10.1000/center",
      JSON.stringify(GRAPH),
      1_000,
      Number.MAX_SAFE_INTEGER,
    );
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2_000);
    try {
      await expect(
        command("citationGraph.putCached", {
          doi: "10.1000/center",
          expectedCacheVersion: Number.MAX_SAFE_INTEGER,
          graph: graphWithCenterTitle("Overflow attempt"),
          provenance: PROVENANCE,
        }),
      ).resolves.toEqual({ stored: false });
    } finally {
      nowSpy.mockRestore();
    }

    await expect(
      database.query(
        `SELECT cache_version, fetched_at, payload_json FROM graph_cache WHERE work_id = ?`,
        ["10.1000/center"],
      ),
    ).resolves.toEqual([
      {
        cache_version: Number.MAX_SAFE_INTEGER,
        fetched_at: 1_000,
        payload_json: JSON.stringify(GRAPH),
      },
    ]);
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
        expectedScope: scope,
      }),
    ).resolves.toEqual({ dois: ["10.1000/active"], scope });
  });

  it("rejects membership reads when the durable active Library has been deleted", async () => {
    await database.run(`UPDATE libraries SET deleted_at = 10_000 WHERE id = ?`, [libraryId]);

    await expect(
      command("citationGraph.getActiveLibraryDois", { dois: [], expectedScope: scope }),
    ).rejects.toThrow("Local Library identity is not active");
  });

  it("rejects a scope token captured before an active Library change", async () => {
    const foreignLibraryId = "library:citation-graph-scope-foreign";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Citation Graph', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    await database.run(`UPDATE settings SET value_json = ? WHERE key = 'local.library_id'`, [
      JSON.stringify(foreignLibraryId),
    ]);

    await expect(
      command("citationGraph.getActiveLibraryDois", {
        dois: [],
        expectedScope: scope,
      }),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
  });

  it("rotates the scope token across an A-to-B-to-A identity cycle", async () => {
    const foreignLibraryId = "library:citation-graph-scope-cycle";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Cycle Citation Graph', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    await database.run(`UPDATE settings SET value_json = ? WHERE key = 'local.library_id'`, [
      JSON.stringify(foreignLibraryId),
    ]);
    await expect(command("library.getScope", {})).resolves.toMatchObject({
      libraryId: foreignLibraryId,
    });
    await database.run(`UPDATE settings SET value_json = ? WHERE key = 'local.library_id'`, [
      JSON.stringify(libraryId),
    ]);
    const returnedScope = await command("library.getScope", {});
    expect(returnedScope.libraryId).toBe(libraryId);
    expect(returnedScope.scopeToken).not.toBe(scope.scopeToken);
    await expect(
      command("citationGraph.getActiveLibraryDois", { dois: [], expectedScope: scope }),
    ).rejects.toThrow("Rejected stale or foreign Library scope");
  });

  it("fails closed before exposing an oversized durable Library id", async () => {
    const oversizedLibraryId = "界".repeat(171);
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Oversized Citation Graph Library', 'personal', 1, 1)`,
      [oversizedLibraryId],
    );
    await database.run(`UPDATE settings SET value_json = ? WHERE key = 'local.library_id'`, [
      JSON.stringify(oversizedLibraryId),
    ]);

    await expect(command("library.getScope", {})).rejects.toThrow(
      "Local Library scope id is invalid",
    );
  });
});
