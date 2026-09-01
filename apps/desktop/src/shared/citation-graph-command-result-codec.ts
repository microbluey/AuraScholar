import type { CitationGraph, GraphEdge, GraphNode } from "@aurascholar/core";
import type {
  CitationGraphGetActiveLibraryDoisCommandResult,
  CitationGraphGetCachedCommandResult,
  CitationGraphPutCachedCommandResult,
} from "../../electron/citation-graph-command-contract";
import type { LibraryScopeToken } from "../../electron/library-read-command-contract";
import type { CitationGraphBuildCommandResult } from "../../electron/scholarly-command-contract";
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
  MAX_CITATION_GRAPH_SCOPE_TOKEN_BYTES,
  normalizeCitationGraphDoi as normalizeSharedCitationGraphDoi,
} from "./citation-graph-limits";

/** Validates and clones Citation Graph command responses received over IPC. */
export function decodeCitationGraphBuildResult(value: unknown): CitationGraphBuildCommandResult {
  const result = requireExactCitationGraphObject(value, "Citation graph build result", ["graph"]);
  return { graph: result.graph === null ? null : decodeCitationGraph(result.graph) };
}

export function decodeCitationGraphGetCachedResult(
  value: unknown,
  requestedDoi?: string,
): CitationGraphGetCachedCommandResult {
  const result = requireExactCitationGraphObject(value, "Citation graph cache result", ["entry"]);
  if (result.entry === null) return { entry: null };

  const entry = requireExactCitationGraphObject(result.entry, "Citation graph cache entry", [
    "cacheVersion",
    "fetchedAt",
    "graph",
  ]);
  const graph = decodeCitationGraph(entry.graph);
  if (requestedDoi !== undefined && !citationGraphMatchesDoi(graph, requestedDoi)) {
    throw new Error("Citation graph cache center DOI does not match the requested DOI");
  }
  return {
    entry: {
      cacheVersion: requirePositiveSafeInteger(entry.cacheVersion, "Citation graph cache version"),
      fetchedAt: requireNonnegativeSafeInteger(entry.fetchedAt, "Citation graph cache timestamp"),
      graph,
    },
  };
}

export function decodeCitationGraphPutCachedResult(
  value: unknown,
): CitationGraphPutCachedCommandResult {
  const result = requireExactCitationGraphObject(value, "Citation graph cache write result", [
    "stored",
  ]);
  if (typeof result.stored !== "boolean") {
    throw new Error("Citation graph cache write result is invalid");
  }
  return { stored: result.stored };
}

export function decodeCitationGraphGetActiveLibraryDoisResult(
  value: unknown,
  requestedDois: readonly string[],
  expectedScope: LibraryScopeToken,
): CitationGraphGetActiveLibraryDoisCommandResult {
  const result = requireExactCitationGraphObject(
    value,
    "Citation graph active Library DOI result",
    ["dois", "scope"],
  );
  const requestedNormalizedDois = normalizeRequestedCitationGraphDois(requestedDois);
  const dois = decodeActiveLibraryDois(result.dois, requestedNormalizedDois);
  const scope = decodeCitationGraphScopeToken(result.scope);
  const decodedExpectedScope = decodeCitationGraphScopeToken(expectedScope);
  if (
    scope.libraryId !== decodedExpectedScope.libraryId ||
    scope.scopeToken !== decodedExpectedScope.scopeToken
  ) {
    throw new Error("Citation graph active Library scope does not match the request");
  }
  return {
    dois,
    scope,
  };
}

function decodeCitationGraphScopeToken(value: unknown): LibraryScopeToken {
  const scope = requireExactCitationGraphObject(value, "Citation graph Library scope", [
    "libraryId",
    "scopeToken",
  ]);
  return {
    libraryId: requireCitationGraphIdentifier(
      scope.libraryId,
      "Citation graph Library id",
      MAX_CITATION_GRAPH_LIBRARY_ID_BYTES,
    ),
    scopeToken: requireCitationGraphIdentifier(
      scope.scopeToken,
      "Citation graph Library scope token",
      MAX_CITATION_GRAPH_SCOPE_TOKEN_BYTES,
    ),
  };
}

/** Validates and deeply clones a graph payload without binding it to a DOI. */
export function decodeCitationGraph(value: unknown): CitationGraph {
  const graph = requireExactCitationGraphObject(value, "Citation graph", [
    "centerId",
    "nodes",
    "edges",
    "truncated",
  ]);
  if (typeof graph.truncated !== "boolean") {
    throw new Error("Citation graph truncation state is invalid");
  }
  const nodes = decodeCitationGraphNodes(graph.nodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) {
    throw new Error("Citation graph node ids must be unique");
  }
  const centerId = requireCitationGraphIdentifier(
    graph.centerId,
    "Citation graph center id",
    MAX_CITATION_GRAPH_NODE_ID_BYTES,
  );
  const centerNodes = nodes.filter((node) => node.relation === "center");
  if (centerNodes.length !== 1 || centerNodes[0]?.id !== centerId) {
    throw new Error("Citation graph must contain exactly one matching center node");
  }

  const edges = decodeCitationGraphEdges(graph.edges, nodeIds);
  assertCitationGraphPayloadSize({ centerId, edges, nodes, truncated: graph.truncated });
  return { centerId, edges, nodes, truncated: graph.truncated };
}

function decodeCitationGraphNodes(value: unknown): GraphNode[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_CITATION_GRAPH_NODES ||
    !isDenseArray(value)
  ) {
    throw new Error(`Citation graph nodes are limited to ${MAX_CITATION_GRAPH_NODES}`);
  }
  return value.map((node, index) => decodeCitationGraphNode(node, index));
}

function decodeCitationGraphNode(value: unknown, index: number): GraphNode {
  const node = requireExactCitationGraphObject(
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

  const year = requireOptionalCitationGraphYear(readOptionalField(node, "year"), index);
  const doi = requireOptionalCitationGraphText(
    readOptionalField(node, "doi"),
    `Citation graph DOI at index ${index}`,
    MAX_CITATION_GRAPH_DOI_BYTES,
  );
  const venue = requireOptionalCitationGraphText(
    readOptionalField(node, "venue"),
    `Citation graph venue at index ${index}`,
    MAX_CITATION_GRAPH_NODE_TEXT_BYTES,
  );
  const firstAuthor = requireOptionalCitationGraphText(
    readOptionalField(node, "firstAuthor"),
    `Citation graph first author at index ${index}`,
    MAX_CITATION_GRAPH_NODE_TEXT_BYTES,
  );
  return {
    citedByCount: node.citedByCount as number,
    ...(doi === undefined ? {} : { doi }),
    ...(firstAuthor === undefined ? {} : { firstAuthor }),
    id: requireCitationGraphIdentifier(
      node.id,
      `Citation graph node id at index ${index}`,
      MAX_CITATION_GRAPH_NODE_ID_BYTES,
    ),
    relation: node.relation,
    title: requireCitationGraphText(
      node.title,
      `Citation graph title at index ${index}`,
      MAX_CITATION_GRAPH_NODE_TEXT_BYTES,
    ),
    ...(venue === undefined ? {} : { venue }),
    ...(year === undefined ? {} : { year }),
  };
}

function decodeCitationGraphEdges(value: unknown, nodeIds: ReadonlySet<string>): GraphEdge[] {
  if (!Array.isArray(value) || value.length > MAX_CITATION_GRAPH_EDGES || !isDenseArray(value)) {
    throw new Error(`Citation graph edges are limited to ${MAX_CITATION_GRAPH_EDGES}`);
  }
  const edgeKeys = new Set<string>();
  return value.map((edge, index) => {
    const decoded = decodeCitationGraphEdge(edge, index, nodeIds);
    const key = JSON.stringify([decoded.source, decoded.target]);
    if (edgeKeys.has(key)) throw new Error("Citation graph edges must be unique");
    edgeKeys.add(key);
    return decoded;
  });
}

function decodeCitationGraphEdge(
  value: unknown,
  index: number,
  nodeIds: ReadonlySet<string>,
): GraphEdge {
  const edge = requireExactCitationGraphObject(value, `Citation graph edge at index ${index}`, [
    "source",
    "target",
  ]);
  const source = requireCitationGraphIdentifier(
    edge.source,
    `Citation graph edge source at index ${index}`,
    MAX_CITATION_GRAPH_NODE_ID_BYTES,
  );
  const target = requireCitationGraphIdentifier(
    edge.target,
    `Citation graph edge target at index ${index}`,
    MAX_CITATION_GRAPH_NODE_ID_BYTES,
  );
  if (source === target) throw new Error("Citation graph edges cannot be self-referential");
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    throw new Error("Citation graph edges must reference graph nodes");
  }
  return { source, target };
}

function normalizeRequestedCitationGraphDois(requestedDois: readonly string[]): Set<string> {
  if (
    !Array.isArray(requestedDois) ||
    requestedDois.length > MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS ||
    !isDenseArray(requestedDois)
  ) {
    throw new Error(
      `Citation graph active Library DOI requests are limited to ${MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS}`,
    );
  }
  const normalizedDois = new Set<string>();
  for (const [index, requestedDoi] of requestedDois.entries()) {
    const normalized = normalizeCitationGraphDoi(
      requireCitationGraphDoi(requestedDoi, `Requested DOI at index ${index}`),
    );
    if (normalizedDois.has(normalized)) {
      throw new Error("Citation graph requested DOIs must be unique");
    }
    normalizedDois.add(normalized);
  }
  return normalizedDois;
}

function decodeActiveLibraryDois(
  value: unknown,
  requestedNormalizedDois: ReadonlySet<string>,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS ||
    !isDenseArray(value)
  ) {
    throw new Error(
      `Citation graph active Library DOIs are limited to ${MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS}`,
    );
  }
  const seenDois = new Set<string>();
  return value.map((doi, index) => {
    const decoded = requireCitationGraphDoi(
      doi,
      `Citation graph active Library DOI at index ${index}`,
    );
    const normalized = normalizeCitationGraphDoi(decoded);
    if (!requestedNormalizedDois.has(normalized)) {
      throw new Error("Citation graph active Library DOI is outside the requested set");
    }
    if (seenDois.has(normalized)) {
      throw new Error("Citation graph active Library DOIs must be unique");
    }
    seenDois.add(normalized);
    return decoded;
  });
}

function requireOptionalCitationGraphYear(value: unknown, index: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    throw new Error(`Citation graph year at index ${index} is invalid`);
  }
  return value as number;
}

function requireOptionalCitationGraphText(
  value: unknown,
  label: string,
  maximumBytes: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requireCitationGraphText(value, label, maximumBytes);
}

function requireCitationGraphDoi(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const doi = value.trim();
  if (!doi) throw new Error(`${label} is required`);
  if (citationGraphUtf8ByteLength(doi) > MAX_CITATION_GRAPH_DOI_BYTES) {
    throw new Error(`${label} is invalid`);
  }
  return doi;
}

function normalizeCitationGraphDoi(value: string): string {
  const normalized = normalizeSharedCitationGraphDoi(value);
  if (!normalized) throw new Error("Citation graph DOI is required");
  return normalized;
}

function requireCitationGraphIdentifier(
  value: unknown,
  label: string,
  maximumBytes: number,
): string {
  return requireCitationGraphText(value, label, maximumBytes, true);
}

function requireCitationGraphText(
  value: unknown,
  label: string,
  maximumBytes: number,
  requireNonEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    citationGraphUtf8ByteLength(value) > maximumBytes ||
    (requireNonEmpty && !value.trim())
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireNonnegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function requireExactCitationGraphObject(
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

function readOptionalField(value: Record<string, unknown>, field: string): unknown {
  return Object.hasOwn(value, field) ? value[field] : undefined;
}

function assertCitationGraphPayloadSize(value: CitationGraph): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("Citation graph payload cannot be serialized");
  }
  if (citationGraphUtf8ByteLength(serialized) > MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES) {
    throw new Error(
      `Citation graph payload is limited to ${MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES} bytes`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}
