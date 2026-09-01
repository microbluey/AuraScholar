import { Buffer } from "node:buffer";
import type { CitationGraph, GraphEdge, GraphNode } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import {
  citationGraphMatchesDoi,
  citationGraphUtf8ByteLength,
  MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS,
  MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES,
  MAX_CITATION_GRAPH_DOI_BYTES,
  MAX_CITATION_GRAPH_EDGES,
  MAX_CITATION_GRAPH_LIBRARY_ID_BYTES,
  MAX_CITATION_GRAPH_NODE_ID_BYTES,
  MAX_CITATION_GRAPH_NODE_TEXT_BYTES,
  MAX_CITATION_GRAPH_NODES,
  normalizeCitationGraphDoi,
} from "../../src/shared/citation-graph-limits";
import type {
  CitationGraphCacheEntry,
  CitationGraphGetActiveLibraryDoisCommandInput,
  CitationGraphGetActiveLibraryDoisCommandResult,
  CitationGraphGetCachedCommandInput,
  CitationGraphGetCachedCommandResult,
  CitationGraphPutCachedCommandInput,
  DataCommandOutput,
  DataCommandRequest,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_CITATION_GRAPH_DOI_LENGTH = MAX_CITATION_GRAPH_DOI_BYTES;
const MAX_CITATION_GRAPH_NODE_ID_LENGTH = MAX_CITATION_GRAPH_NODE_ID_BYTES;
const MAX_CITATION_GRAPH_NODE_TEXT_LENGTH = MAX_CITATION_GRAPH_NODE_TEXT_BYTES;
const MAX_ACTIVE_LIBRARY_DOIS = MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS;

type CitationGraphReadCommandName = "citationGraph.getActiveLibraryDois";
type CitationGraphCacheCommandName = "citationGraph.getCached" | "citationGraph.putCached";
type CitationGraphCommandName = CitationGraphReadCommandName | CitationGraphCacheCommandName;

export type CitationGraphCommandRequest = Extract<
  DataCommandRequest,
  { name: CitationGraphCommandName }
>;

interface CachedCitationGraphRow {
  fetched_at: number;
  payload_json: string;
}

/**
 * Main-process boundary for graph cache state and active-Library DOI
 * membership. Cache rows are runtime-global DOI data, while the membership
 * query always resolves its Library identity inside the database lease.
 */
export async function executeCitationGraphCommand(
  request: CitationGraphCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<CitationGraphCommandName>> {
  switch (request.name) {
    case "citationGraph.getCached": {
      const input = parseCitationGraphGetCachedInput(request.input);
      const doi = normalizeCitationGraphDoi(input.doi);
      if (!doi) return { entry: null };
      return executeCitationGraphCacheMutation(dependencies, request.name, (database) =>
        loadCachedCitationGraph(database, doi, input.doi),
      );
    }
    case "citationGraph.putCached": {
      const input = parseCitationGraphPutCachedInput(request.input);
      const doi = normalizeCitationGraphDoi(input.doi);
      if (!doi) return { stored: false };
      // Do not place an unbound or differently-centered graph under this DOI.
      // The freshly built graph can still be displayed by the caller.
      if (!citationGraphMatchesDoi(input.graph, doi)) return { stored: false };
      const payloadJson = serializeCitationGraph(input.graph);
      return executeCitationGraphCacheMutation(dependencies, request.name, async (database) => {
        await database.run(
          `INSERT OR REPLACE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
          [doi, payloadJson, Date.now()],
        );
        return { stored: true };
      });
    }
    case "citationGraph.getActiveLibraryDois": {
      const input = parseCitationGraphGetActiveLibraryDoisInput(request.input);
      return executeCitationGraphQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireLocalLibraryId(database);
        await assertActiveLocalLibrary(database, libraryId);
        return loadActiveLibraryDois(database, libraryId, input);
      });
    }
  }
}

function executeCitationGraphQuery<K extends CitationGraphReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

/**
 * Cache reads may delete malformed rows or migrate a legacy key, so both
 * cache commands intentionally run in a short main-process transaction.
 */
function executeCitationGraphCacheMutation<K extends CitationGraphCacheCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  return dependencies.transaction(commandName, operation);
}

function parseCitationGraphGetCachedInput(value: unknown): CitationGraphGetCachedCommandInput {
  const input = requireExactCitationGraphInput(value, "citationGraph.getCached", ["doi"]);
  return { doi: requireCitationGraphDoi(input.doi, "DOI") };
}

function parseCitationGraphPutCachedInput(value: unknown): CitationGraphPutCachedCommandInput {
  const input = requireExactCitationGraphInput(value, "citationGraph.putCached", ["doi", "graph"]);
  return {
    doi: requireCitationGraphDoi(input.doi, "DOI"),
    graph: requireCitationGraph(input.graph),
  };
}

function parseCitationGraphGetActiveLibraryDoisInput(
  value: unknown,
): CitationGraphGetActiveLibraryDoisCommandInput {
  const input = requireExactCitationGraphInput(value, "citationGraph.getActiveLibraryDois", [
    "dois",
  ]);
  if (!Array.isArray(input.dois) || input.dois.length > MAX_ACTIVE_LIBRARY_DOIS) {
    throw new Error(`Citation graph DOI lookups are limited to ${MAX_ACTIVE_LIBRARY_DOIS}`);
  }
  if (!isDenseCitationGraphArray(input.dois)) {
    throw new Error("Citation graph DOI lookups must be dense");
  }

  const dois = input.dois.map((doi, index) =>
    canonicalCitationGraphDoi(requireCitationGraphDoi(doi, `DOI at index ${index}`)),
  );
  if (new Set(dois).size !== dois.length) {
    throw new Error("Citation graph DOIs must be unique");
  }
  return { dois };
}

function requireExactCitationGraphInput(
  value: unknown,
  commandName: CitationGraphCommandName,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireCitationGraphDoi(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const doi = value.trim();
  if (!doi) throw new Error(`${label} is required`);
  if (citationGraphUtf8ByteLength(doi) > MAX_CITATION_GRAPH_DOI_LENGTH) {
    throw new Error(`${label} is too long`);
  }
  return doi;
}

function canonicalCitationGraphDoi(doi: string): string {
  return normalizeCitationGraphDoi(doi) ?? doi.toLowerCase();
}

function requireCitationGraph(value: unknown): CitationGraph {
  const graph = requireExactCitationGraphRecord(value, "Citation graph", [
    "centerId",
    "nodes",
    "edges",
    "truncated",
  ]);
  const centerId = requireCitationGraphNodeId(graph.centerId, "Citation graph center id");
  if (typeof graph.truncated !== "boolean") {
    throw new Error("Citation graph truncation state is invalid");
  }
  if (
    !Array.isArray(graph.nodes) ||
    graph.nodes.length === 0 ||
    graph.nodes.length > MAX_CITATION_GRAPH_NODES ||
    !isDenseCitationGraphArray(graph.nodes)
  ) {
    throw new Error(`Citation graph nodes are limited to ${MAX_CITATION_GRAPH_NODES}`);
  }
  if (
    !Array.isArray(graph.edges) ||
    graph.edges.length > MAX_CITATION_GRAPH_EDGES ||
    !isDenseCitationGraphArray(graph.edges)
  ) {
    throw new Error(`Citation graph edges are limited to ${MAX_CITATION_GRAPH_EDGES}`);
  }

  const nodes = graph.nodes.map((node, index) => requireCitationGraphNode(node, index));
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new Error("Citation graph node ids must be unique");
  const centerNodes = nodes.filter((node) => node.relation === "center");
  if (centerNodes.length !== 1 || centerNodes[0]?.id !== centerId) {
    throw new Error("Citation graph must contain exactly one matching center node");
  }

  const edges = graph.edges.map((edge, index) => requireCitationGraphEdge(edge, index, nodeIds));
  const edgeKeys = edges.map((edge) => JSON.stringify([edge.source, edge.target]));
  if (new Set(edgeKeys).size !== edgeKeys.length) {
    throw new Error("Citation graph edges must be unique");
  }

  return { centerId, edges, nodes, truncated: graph.truncated };
}

function requireCitationGraphNode(value: unknown, index: number): GraphNode {
  const node = requireExactCitationGraphRecord(
    value,
    `Citation graph node at index ${index}`,
    ["id", "title", "citedByCount", "relation"],
    ["year", "doi", "venue", "firstAuthor"],
  );
  if (node.relation !== "center" && node.relation !== "reference" && node.relation !== "citer") {
    throw new Error(`Citation graph node relation at index ${index} is invalid`);
  }
  if (!Number.isSafeInteger(node.citedByCount) || (node.citedByCount as number) < 0) {
    throw new Error(`Citation graph cited-by count at index ${index} is invalid`);
  }

  const year = optionalCitationGraphYear(readOptionalCitationGraphField(node, "year"), index);
  const doi = optionalCitationGraphText(
    readOptionalCitationGraphField(node, "doi"),
    `Citation graph DOI at index ${index}`,
    MAX_CITATION_GRAPH_DOI_LENGTH,
  );
  const venue = optionalCitationGraphText(
    readOptionalCitationGraphField(node, "venue"),
    `Citation graph venue at index ${index}`,
    MAX_CITATION_GRAPH_NODE_TEXT_LENGTH,
  );
  const firstAuthor = optionalCitationGraphText(
    readOptionalCitationGraphField(node, "firstAuthor"),
    `Citation graph first author at index ${index}`,
    MAX_CITATION_GRAPH_NODE_TEXT_LENGTH,
  );
  return {
    citedByCount: node.citedByCount as number,
    ...(doi === undefined ? {} : { doi }),
    ...(firstAuthor === undefined ? {} : { firstAuthor }),
    id: requireCitationGraphNodeId(node.id, `Citation graph node id at index ${index}`),
    relation: node.relation,
    title: requireCitationGraphText(
      node.title,
      `Citation graph title at index ${index}`,
      MAX_CITATION_GRAPH_NODE_TEXT_LENGTH,
    ),
    ...(venue === undefined ? {} : { venue }),
    ...(year === undefined ? {} : { year }),
  };
}

function requireCitationGraphEdge(
  value: unknown,
  index: number,
  nodeIds: ReadonlySet<string>,
): GraphEdge {
  const edge = requireExactCitationGraphRecord(value, `Citation graph edge at index ${index}`, [
    "source",
    "target",
  ]);
  const source = requireCitationGraphNodeId(
    edge.source,
    `Citation graph edge source at index ${index}`,
  );
  const target = requireCitationGraphNodeId(
    edge.target,
    `Citation graph edge target at index ${index}`,
  );
  if (source === target) throw new Error("Citation graph edges cannot be self-referential");
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    throw new Error("Citation graph edges must reference graph nodes");
  }
  return { source, target };
}

function requireExactCitationGraphRecord(
  value: unknown,
  label: string,
  requiredFields: readonly string[],
  optionalFields: readonly string[] = [],
): Record<string, unknown> {
  const allowedFields = [...requiredFields, ...optionalFields];
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !allowedFields.includes(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function isDenseCitationGraphArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function requireCitationGraphNodeId(value: unknown, label: string): string {
  return requireCitationGraphText(value, label, MAX_CITATION_GRAPH_NODE_ID_LENGTH, true);
}

function requireCitationGraphText(
  value: unknown,
  label: string,
  maximum: number,
  requireNonEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    citationGraphUtf8ByteLength(value) > maximum ||
    (requireNonEmpty && !value.trim())
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function optionalCitationGraphText(
  value: unknown,
  label: string,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requireCitationGraphText(value, label, maximum);
}

function readOptionalCitationGraphField(value: Record<string, unknown>, field: string): unknown {
  return Object.hasOwn(value, field) ? value[field] : undefined;
}

function optionalCitationGraphYear(value: unknown, index: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    throw new Error(`Citation graph year at index ${index} is invalid`);
  }
  return value as number;
}

function serializeCitationGraph(graph: CitationGraph): string {
  const payloadJson = JSON.stringify(graph);
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES) {
    throw new Error("Citation graph cache payload is too large");
  }
  return payloadJson;
}

function parseCachedCitationGraph(payloadJson: unknown): CitationGraph | null {
  if (
    typeof payloadJson !== "string" ||
    Buffer.byteLength(payloadJson, "utf8") > MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES
  ) {
    return null;
  }
  try {
    return requireCitationGraph(JSON.parse(payloadJson));
  } catch {
    return null;
  }
}

function isValidCacheTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

async function loadCachedCitationGraph(
  database: Database,
  doi: string,
  rawDoi: string,
): Promise<CitationGraphGetCachedCommandResult> {
  const legacyCacheKey = rawDoi.trim();
  const cacheKeys = legacyCacheKey !== doi ? [doi, legacyCacheKey] : [doi];
  for (const cacheKey of cacheKeys) {
    const rows = await database.query<CachedCitationGraphRow>(
      `SELECT payload_json, fetched_at FROM graph_cache WHERE work_id = ?`,
      [cacheKey],
    );
    const row = rows[0];
    if (!row) continue;

    const graph = parseCachedCitationGraph(row.payload_json);
    if (!graph || !isValidCacheTimestamp(row.fetched_at) || !citationGraphMatchesDoi(graph, doi)) {
      await database.run(`DELETE FROM graph_cache WHERE work_id = ?`, [cacheKey]);
      continue;
    }

    const entry: CitationGraphCacheEntry = { fetchedAt: row.fetched_at, graph };
    if (cacheKey !== doi) {
      await database.run(
        `INSERT OR IGNORE INTO graph_cache (work_id, payload_json, fetched_at) VALUES (?, ?, ?)`,
        [doi, row.payload_json, row.fetched_at],
      );
      await database.run(`DELETE FROM graph_cache WHERE work_id = ?`, [cacheKey]);
    } else if (legacyCacheKey !== doi) {
      // A valid canonical row wins over any conflicting legacy spelling.
      // Retire that raw-key row atomically so it cannot linger indefinitely.
      await database.run(`DELETE FROM graph_cache WHERE work_id = ?`, [legacyCacheKey]);
    }
    return { entry };
  }
  return { entry: null };
}

async function loadActiveLibraryDois(
  database: Database,
  libraryId: string,
  input: CitationGraphGetActiveLibraryDoisCommandInput,
): Promise<CitationGraphGetActiveLibraryDoisCommandResult> {
  requireCitationGraphText(
    libraryId,
    "Citation graph active Library id",
    MAX_CITATION_GRAPH_LIBRARY_ID_BYTES,
    true,
  );
  if (input.dois.length === 0) return { dois: [], libraryId };
  const placeholders = input.dois.map(() => "?").join(",");
  const rows = await database.query<{ doi: string }>(
    `SELECT DISTINCT doi
     FROM works
     WHERE library_id = ?
       AND doi IN (${placeholders})
       AND deleted_at IS NULL
     ORDER BY doi`,
    [libraryId, ...input.dois],
  );
  return { dois: rows.map((row) => row.doi), libraryId };
}
